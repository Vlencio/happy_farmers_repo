import { bbox } from '@turf/turf';
import { englishSourceNotice, englishApiError } from './external-text.mjs';
import { supportsSoil, validateSoilTexture, validateOutputSoil, soilNote } from './soil.mjs';
import { buildExposure, validateSequenceExposure } from './exposure.mjs';
import { buildWarnings, validateSequenceWarnings } from './warnings.mjs';
import { buildBenefits, validateSequenceBenefits } from './benefits.mjs';
import { cropRevenueContext, isSoilOnlyPlan, soilPlanRole, sequenceRevenueNote, revenueAmount, revenueRange, sequenceRevenueAmount } from './revenue.mjs';
import { DEFAULT_ADJUSTMENT, validateAdjustment, validateOutputAdjustment, supportsAdjustment, hasAdjustment, adjustmentNote } from './scenario.mjs';
export { assertAdjustmentApplied, supportsAdjustment } from './scenario.mjs';

export const CATEGORIES = ['rank1', 'rank2', 'rank3'];
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DEFAULT_SETTINGS = { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { ...DEFAULT_ADJUSTMENT } };
// POWER can take up to 300 s on a first lookup; leave time for scoring and transport.
export const ANALYSIS_TIMEOUT_MS = 360_000;
const cropLabels = { soja: 'Soybean', milho: 'Corn', sorgo: 'Sorghum', feijao: 'Common bean', girassol: 'Sunflower', algodao: 'Cotton', trigo: 'Wheat', milheto: 'Pearl millet', braquiaria: 'Brachiaria', crotalaria: 'Sunn hemp' };
export const cropLabel = (id) => cropLabels[id] || id.charAt(0).toUpperCase() + id.slice(1);
const seasonLabel = slot => slot === 'safrinha' ? 'Second season' : 'Main season';
const number = (value, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const index = (value) => `${number(value * 100)} / 100`;
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const invalid = (path) => { throw new Error(`Response does not match the engine contract: ${path}.`); };
function finite(value, path, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(path);
}
function integer(value, path, min, max) {
  finite(value, path, min, max); if (!Number.isInteger(value)) invalid(path);
}
function string(value, path) {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) invalid(path);
}
function list(value, path, min = 0, max = 2000) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalid(path);
}
function validateDiscardReason(reason, horizon, altitude) {
  string(reason?.cultura, 'motivo.cultura');
  integer(reason.posicao, 'motivo.posicao', 1, horizon);
  if (!['safra', 'safrinha'].includes(reason.slot)) invalid('motivo.slot');
  integer(reason.mes_livre, 'motivo.mes_livre', 1, 12);
  if (reason.mes_plantio !== null) integer(reason.mes_plantio, 'motivo.mes_plantio', 1, 12);
  if (Object.hasOwn(reason, 'altitude_min_m') || Object.hasOwn(reason, 'altitude_m')) {
    finite(reason.altitude_min_m, 'motivo.altitude_min_m');
    finite(reason.altitude_m, 'motivo.altitude_m', -100, 6000);
    if (reason.altitude_m !== altitude || reason.altitude_min_m <= reason.altitude_m || reason.mes_plantio === null) {
      invalid('motivo.altitude: inconsistent with the input or exclusion');
    }
  }
}
function validateRotationFactors(crop) {
  for (const key of ['repete', 'bonus_n']) {
    if (Object.hasOwn(crop, key) && typeof crop[key] !== 'boolean') invalid(`culturas.${key}`);
  }
  if (Object.hasOwn(crop, 'penalidade_hospedeiro')) finite(crop.penalidade_hospedeiro, 'culturas.penalidade_hospedeiro', 0, 1);
  if (Object.hasOwn(crop, 'dias_apos_anterior') && crop.dias_apos_anterior !== null) {
    integer(crop.dias_apos_anterior, 'culturas.dias_apos_anterior', 0, Infinity);
  }
  if (Object.hasOwn(crop, 'hospedeiro_comum') && crop.hospedeiro_comum !== null) {
    const host = crop.hospedeiro_comum;
    if (!host || typeof host !== 'object' || Array.isArray(host)) invalid('culturas.hospedeiro_comum');
    string(host.anterior, 'culturas.hospedeiro_comum.anterior');
    list(host.pragas, 'culturas.hospedeiro_comum.pragas', 1);
    host.pragas.forEach(pest => string(pest, 'culturas.hospedeiro_comum.pragas'));
  }
}
function validateModelRanges(value) {
  const present = Object.hasOwn(value, 'modelos');
  if (!present) {
    if (value.sequencias.some(seq => Object.hasOwn(seq, 'modelos'))) invalid('modelos: missing summary');
    return;
  }
  const models = value.modelos;
  if (!models || typeof models !== 'object' || Array.isArray(models)) invalid('modelos');
  list(models.nomes, 'modelos.nomes', 1, 100);
  models.nomes.forEach(name => string(name, 'modelos.nomes'));
  if (new Set(models.nomes).size !== models.nomes.length) invalid('modelos.nomes: duplicates');
  if (!['razao', 'aproximada'].includes(models.chuva)) invalid('modelos.chuva');
  if (typeof models.et0_sem_correcao !== 'boolean') invalid('modelos.et0_sem_correcao');
  integer(models.aviso_faixa_rank, 'modelos.aviso_faixa_rank', 0, Infinity);
  for (const field of ['clima', 'primeiro']) {
    if (!models[field] || typeof models[field] !== 'object' || Array.isArray(models[field]) ||
      Object.keys(models[field]).length !== models.nomes.length) invalid(`modelos.${field}`);
  }
  for (const name of models.nomes) {
    list(models.clima[name], 'modelos.clima', 12, 12);
    const months = new Set();
    for (const month of models.clima[name]) {
      integer(month?.mes, 'modelos.clima.mes', 1, 12); months.add(month.mes);
      for (const key of ['chuva_mm', 'et0_mm']) finite(month[key], `modelos.clima.${key}`, 0);
      for (const key of ['tmin_c', 'tmax_c']) finite(month[key], `modelos.clima.${key}`);
    }
    if (months.size !== 12) invalid('modelos.clima: duplicate months');
    if (!value.sequencias.length) {
      if (models.primeiro[name] !== null) invalid('modelos.primeiro: no viable sequence');
    } else if (!value.sequencias.some(seq => seq.id === models.primeiro[name])) invalid('modelos.primeiro');
  }
  for (const seq of value.sequencias) {
    const range = seq.modelos;
    if (!range || typeof range !== 'object' || Array.isArray(range)) invalid('sequencias.modelos');
    list(range.por_modelo, 'modelos.por_modelo', models.nomes.length, models.nomes.length);
    for (const [i, model] of range.por_modelo.entries()) {
      if (model?.modelo !== models.nomes[i]) invalid('modelos.por_modelo.modelo');
      finite(model.score, 'modelos.por_modelo.score', 0, 100);
      integer(model.rank, 'modelos.por_modelo.rank', 1, value.sequencias.length);
      finite(model.receita_ano_ha, 'modelos.por_modelo.receita_ano_ha', 0);
      if ((model.rank === 1) !== (models.primeiro[model.modelo] === seq.id)) invalid('modelos.primeiro: inconsistent rank');
    }
    for (const key of ['rank_min', 'rank_max']) integer(range[key], `modelos.${key}`, 1, value.sequencias.length);
    for (const key of ['receita_ano_ha_min', 'receita_ano_ha_max']) finite(range[key], `modelos.${key}`, 0);
    const ranks = range.por_modelo.map(model => model.rank);
    const revenues = range.por_modelo.map(model => model.receita_ano_ha);
    if (range.rank_min !== Math.min(...ranks) || range.rank_max !== Math.max(...ranks) ||
      Math.abs(range.receita_ano_ha_min - Math.min(...revenues)) > .001 ||
      Math.abs(range.receita_ano_ha_max - Math.max(...revenues)) > .001) invalid('modelos: inconsistent range');
  }
  for (const [i] of models.nomes.entries()) {
    const ranks = value.sequencias.map(seq => seq.modelos.por_modelo[i].rank);
    if (new Set(ranks).size !== ranks.length) invalid('modelos.por_modelo.rank: duplicate');
  }
}
export function validateSettings(value) {
  if (!Number.isInteger(value?.mes_plantio) || value.mes_plantio < 1 || value.mes_plantio > 12 || ![1, 2].includes(value.horizonte)) {
    throw new Error('Choose the month when the field becomes available and one or two crops.');
  }
  // Drafts saved before priority controls used equal weights.
  const priorities = value.prioridades === undefined ? DEFAULT_SETTINGS.prioridades : value.prioridades;
  if (!priorities || ['agua', 'solo', 'renda'].some(key => !Number.isInteger(priorities[key]) || priorities[key] < 0 || priorities[key] > 3)) {
    throw new Error('Choose a priority from 0 to 3 for water, soil and income.');
  }
  if ((value.solo_padrao !== undefined && typeof value.solo_padrao !== 'boolean') || (value.solo_padrao && value.solo_textura)) {
    throw new Error('Choose a soil texture or the default reference.');
  }
  return { mes_plantio: value.mes_plantio, horizonte: value.horizonte,
    prioridades: { agua: priorities.agua, solo: priorities.solo, renda: priorities.renda },
    ajuste: validateAdjustment(value.ajuste),
    ...(validateSoilTexture(value.solo_textura) ? { solo_textura: value.solo_textura } : {}),
    ...(value.solo_padrao ? { solo_padrao: true } : {}) };
}
export function buildRequest(farm, history, settings = DEFAULT_SETTINGS, cultures = [], metadata = {}) {
  if (!farm?.geojson || !Number.isFinite(farm.area_ha) || farm.area_ha <= 0) throw new Error('Define a valid field before analyzing.');
  const bounds = bbox(farm.geojson);
  const lat = (bounds[1] + bounds[3]) / 2;
  const lon = (bounds[0] + bounds[2]) / 2;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('The farm latitude is invalid.');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error('The farm longitude is invalid.');
  if (!Array.isArray(history) || history.length > 12) throw new Error('Review the crop history (up to 12 entries).');
  const rotacao_atual = history.map(({ crop }) => {
    const match = cultures.find((c) => normalize(c.id) === normalize(crop) || normalize(c.label) === normalize(crop));
    if (!match) throw new Error(`The crop “${crop}” is not in the engine catalog. Remove or correct this entry to continue.`);
    return match.id;
  });
  const { ajuste, solo_padrao, ...options } = validateSettings(settings);
  if (options.solo_textura && !supportsSoil(metadata)) {
    throw new Error('Soil texture is not available on this server yet. Use the default reference to analyze.');
  }
  if (hasAdjustment(ajuste) && !supportsAdjustment(metadata)) {
    throw new Error('Scenario adjustments are not available on this server yet. Reset to the original climate to analyze.');
  }
  // Seasons and notes remain in the browser: the engine accepts only ordered crop IDs.
  return { lat, lon, rotacao_atual, ...options, precos: {}, ...(hasAdjustment(ajuste) ? { ajuste } : {}) };
}

export function validateMotorOutput(value) {
  validateOutputSoil(value);
  if (value?.origem != null) {
    if (typeof value.origem !== 'object' || Array.isArray(value.origem)) invalid('origem');
    const warning = value.origem.aviso;
    if (warning != null && (typeof warning !== 'string' || warning.length > 4000)) invalid('origem.aviso');
  }
  integer(value?.entrada?.mes_plantio, 'entrada.mes_plantio', 1, 12);
  integer(value?.entrada?.horizonte, 'entrada.horizonte', 1, 2);
  if (Object.hasOwn(value.entrada, 'altitude_m')) finite(value.entrada.altitude_m, 'entrada.altitude_m', -100, 6000);
  validateOutputAdjustment(value.entrada);
  for (const key of ['agua', 'solo', 'renda']) finite(value.entrada.prioridades?.[key], `entrada.prioridades.${key}`, 0, 1);
  if (Object.values(value.entrada.prioridades).every(weight => weight === 0)) invalid('entrada.prioridades: weights not normalized');
  list(value.entrada.rotacao_atual, 'entrada.rotacao_atual', 0, 12);
  value.entrada.rotacao_atual.forEach((crop) => string(crop, 'entrada.rotacao_atual.cultura'));
  list(value.slots, 'slots', value.entrada.horizonte, value.entrada.horizonte);
  value.slots.forEach((slot) => { if (!['safra', 'safrinha'].includes(slot)) invalid('slots'); });
  const hasDry = Object.hasOwn(value.clima ?? {}, 'seco');
  const scenarios = hasDry ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
  for (const scenario of scenarios) {
    list(value.clima?.[scenario], `clima.${scenario}`, 12, 12);
    const months = new Set();
    for (const month of value.clima[scenario]) {
      integer(month.mes, 'clima.mes', 1, 12); months.add(month.mes);
      for (const key of ['chuva_mm', 'et0_mm']) finite(month[key], `clima.${key}`, 0);
      for (const key of ['tmin_c', 'tmax_c']) finite(month[key], `clima.${key}`);
    }
    if (months.size !== 12) invalid('clima: duplicate months');
  }
  list(value.sequencias, 'sequencias'); list(value.descartadas, 'descartadas');
  const ids = new Set();
  for (const seq of [...value.sequencias, ...value.descartadas]) {
    string(seq.id, 'id');
    list(seq.culturas, 'culturas', value.entrada.horizonte, value.entrada.horizonte);
    seq.culturas.forEach((crop) => string(crop, 'cultura'));
    if (ids.has(seq.id) || seq.id !== seq.culturas.join('>') || typeof seq.atual !== 'boolean') invalid('sequence');
    ids.add(seq.id);
  }
  if ([...value.sequencias, ...value.descartadas].filter((seq) => seq.atual).length > 1) invalid('more than one current rotation');
  for (const seq of value.sequencias) {
    if (!hasDry && (Object.hasOwn(seq, 'seco') || Object.hasOwn(seq, 'rank_seco'))) invalid('dry-year scenario without clima.seco');
    for (const scenario of scenarios) {
      integer(seq[`rank_${scenario}`], `rank_${scenario}`, 1, value.sequencias.length);
      const result = seq[scenario];
      finite(result?.score, 'score', 0, 100);
      for (const key of ['agua', 'solo', 'renda', 'encaixe']) finite(result[key], key, 0, 1);
      if (Object.hasOwn(result, 'atendimento_hidrico')) finite(result.atendimento_hidrico, `${scenario}.atendimento_hidrico`, 0, 1);
      finite(result.receita_ha, 'receita_ha', 0);
      // Older servers omit both annual-income fields. A partial or invalid pair
      // must not become a plausible annual amount in the interface.
      if (Object.hasOwn(result, 'anos_ocupados') || Object.hasOwn(result, 'receita_ano_ha')) {
        finite(result.anos_ocupados, `${scenario}.anos_ocupados`, 1);
        finite(result.receita_ano_ha, `${scenario}.receita_ano_ha`, 0);
      }
      list(result.culturas, 'culturas', seq.culturas.length, seq.culturas.length);
      for (const [i, crop] of result.culturas.entries()) {
        if (crop.cultura !== seq.culturas[i] || crop.slot !== value.slots[i]) invalid('crop/season order');
        for (const key of ['mes_plantio', 'mes_colheita']) integer(crop[key], key, 1, 12);
        integer(crop.ciclo_dias, 'ciclo_dias', 1, 365);
        integer(crop.espera_dias, 'espera_dias', 0, 365);
        for (const key of ['encaixe_temp', 'encaixe_chuva', 'atendimento_hidrico', 'solo']) finite(crop[key], key, 0, 1);
        if (Object.hasOwn(crop, 'encaixe_calor') || Object.hasOwn(crop, 'dias_calor')) {
          finite(crop.encaixe_calor, 'encaixe_calor', 0, 1);
          finite(crop.dias_calor, 'dias_calor', 0);
        }
        for (const key of ['chuva_mm', 'etc_mm', 'deficit_mm', 'receita_ha', 'fator_sequencia', 'fator']) finite(crop[key], key, 0);
        validateRotationFactors(crop);
        list(crop.meses, 'meses', 1, 12);
        for (const month of crop.meses) {
          integer(month.mes, 'meses.mes', 1, 12); integer(month.dias, 'meses.dias', 1, 62);
          for (const key of ['kc', 'chuva_mm', 'etc_mm', 'deficit_mm']) finite(month[key], `meses.${key}`, 0);
        }
        if (crop.meses[0].mes !== crop.mes_plantio || crop.meses.at(-1).mes !== crop.mes_colheita) invalid('crop-cycle months');
      }
    }
    for (const scenario of scenarios.slice(1)) {
      seq.hoje.culturas.forEach((crop, i) => {
        const other = seq[scenario].culturas[i];
        if (['mes_plantio', 'mes_colheita', 'ciclo_dias', 'espera_dias'].some((key) => crop[key] !== other[key]) ||
          crop.meses.length !== other.meses.length || crop.meses.some((m, j) => m.mes !== other.meses[j].mes || m.dias !== other.meses[j].dias)) invalid('scenario calendars');
      });
    }
    validateSequenceExposure(seq, scenarios, value.entrada.mes_plantio);
    validateSequenceWarnings(seq, scenarios);
    validateSequenceBenefits(seq, scenarios);
  }
  for (const seq of value.descartadas) {
    validateDiscardReason(seq.motivo, value.entrada.horizonte, value.entrada.altitude_m);
  }
  validateModelRanges(value);
  // The dedicated reference owns identity and availability; metrics stay in sequencias.
  // Older responses can still use only the per-sequence markers.
  if (Object.hasOwn(value, 'atual')) {
    const current = value.atual;
    if (current === null) {
      if (value.entrada.rotacao_atual.length) invalid('atual: missing reference for the history');
    } else {
      if (!current || typeof current !== 'object' || Array.isArray(current)) invalid('atual');
      if (!value.entrada.rotacao_atual.length) invalid('atual: reference without history');
      string(current.id, 'atual.id');
      list(current.culturas, 'atual.culturas', value.entrada.horizonte, value.entrada.horizonte);
      current.culturas.forEach((crop) => string(crop, 'atual.culturas'));
      if (current.id !== current.culturas.join('>') || typeof current.viavel !== 'boolean') invalid('atual');
      if (current.viavel) {
        if (current.motivo !== null || !value.sequencias.some((seq) => seq.id === current.id)) invalid('atual: viable sequence');
      } else {
        validateDiscardReason(current.motivo, value.entrada.horizonte, value.entrada.altitude_m);
      }
    }
  }
  return value;
}

function timeline(seq, firstMonth) {
  let last = firstMonth - 1;
  const scenarios = seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
  const order = seq.seco ? 'today / future / dry year' : 'today / future';
  const monthLabel = (absolute) => `${MONTHS[absolute % 12]} · year ${Math.floor(absolute / 12) + 1}`;
  const stages = seq.hoje.culturas.map((crop, i) => {
    const crops = scenarios.map((key) => seq[key].culturas[i]);
    const revenue = cropRevenueContext(seq, crop.cultura, cropLabel(crop.cultura));
    const compare = (key, format = number) => crops.map((c) => format(c[key])).join(' / ');
    let start = crop.mes_plantio - 1;
    while (start < last) start += 12;
    let end = start;
    const monthly = crop.meses.map((month, j) => {
      if (j > 0) { end++; while (end % 12 !== month.mes - 1) end++; }
      const compareMonth = (key) => crops.map((c) => number(c.meses[j][key])).join(' / ');
      return { month: monthLabel(end), days: `${month.dias} d`, kc: number(month.kc, 2),
        rain: compareMonth('chuva_mm'), demand: compareMonth('etc_mm'), deficit: compareMonth('deficit_mm') };
    });
    last = end;
    return { title: `${cropLabel(crop.cultura)} · ${seasonLabel(crop.slot)}`, period: `${monthLabel(start)} → ${monthLabel(end)}`,
      start_month: start - firstMonth + 2, end_month: end - firstMonth + 2,
      description: `${crop.ciclo_dias} days in the crop cycle; ${crop.espera_dias} days waiting for planting. ${crop.dias_apos_anterior != null ? `${crop.dias_apos_anterior} days between the end of the previous crop and this planting${i === 0 ? ' (for the first crop, the end of the crop history is an assumption in the calculation)' : ''}. ` : ''}${revenue.kind === 'soil' ? '' : `Gross revenue per hectare for this crop cycle (${order}): ${compare('receita_ha', value => revenueAmount(value, revenue.kind === 'market' ? 'Market revenue not included' : 'No revenue estimated'))}.`}`.trim(),
      revenue_title: revenue.title, revenue_note: revenue.note,
      water: `Water demand met (${order}): ${compare('atendimento_hidrico', (v) => number(v * 100))} out of 100. Deficit over the crop cycle: ${compare('deficit_mm')} mm.`,
      soil: `Soil index (${order}): ${compare('solo', (v) => number(v * 100))} out of 100. Sequence factor: ${number(crop.fator_sequencia, 3)}×. ${rotationFactors(crop)}The index combines nitrogen fixation, cover and diversity, adjusted for climate suitability; it is not a soil measurement.`,
      risk: `Temperature suitability: ${compare('encaixe_temp', (v) => number(v * 100))} out of 100. Rainfall suitability: ${compare('encaixe_chuva', (v) => number(v * 100))} out of 100. ${crops.every((c) => c.encaixe_calor != null) ? `Heat suitability: ${compare('encaixe_calor', (v) => number(v * 100))} out of 100; hot days during the sensitive growth stage: ${compare('dias_calor')}. ` : ''}Order: ${order}. Check heat thresholds with your agronomist; no penalty does not prove tolerance.`, monthly };
  });
  return { timeline: stages, water_caption: `Rainfall, demand and deficit: ${order}, in millimeters. Days and Kc refer to the part of each month occupied by the crop. Scroll the table to see every column.`, month_labels: Array.from({ length: Math.max(12, last - firstMonth + 2) }, (_, i) => monthLabel(firstMonth - 1 + i)) };
}

function rotationFactors(crop) {
  const notes = [];
  if (crop.repete) notes.push('Repeats the previous crop.');
  if (crop.bonus_n) notes.push('Receives the green-manure bonus within the 60-day window used in the calculation.');
  if (crop.hospedeiro_comum) notes.push(`Shares a pest or disease with ${cropLabel(crop.hospedeiro_comum.anterior)}.${crop.penalidade_hospedeiro === undefined ? '' : ` Shared-host factor applied: ${number(crop.penalidade_hospedeiro, 3)}×.`}`);
  return notes.length ? `${notes.join(' ')} ` : '';
}

function comparisonFacts(seq) {
  return [
    isSoilOnlyPlan(seq)
      ? { label: 'Primary role', value: soilPlanRole(seq) }
      : { label: 'Gross revenue / ha · full rotation · today', value: sequenceRevenueAmount(seq, seq.hoje.receita_ha) },
    { label: 'Soil · today', value: index(seq.hoje.solo) },
    { label: 'Suitability · future', value: index(seq.futuro.encaixe) },
  ];
}

function annualIncomeFacts(seq) {
  return [['hoje', 'today'], ['futuro', 'future'], ['seco', 'dry year']].flatMap(([key, label]) => {
    const result = seq[key];
    if (!result || result.receita_ano_ha === undefined) return [];
    return [
      ...(isSoilOnlyPlan(seq) ? [] : [{ label: `Gross revenue / ha / year · ${label}`, value: sequenceRevenueAmount(seq, result.receita_ano_ha) }]),
      { label: `Years accounted for · ${label}`, value: `${number(result.anos_ocupados, 2)} ${result.anos_ocupados === 1 ? 'year' : 'years'}` },
    ];
  });
}

function waterFacts(seq) {
  return [['hoje', 'today'], ['futuro', 'future'], ['seco', 'dry year']].flatMap(([key, label]) => {
    const result = seq[key];
    return result?.atendimento_hidrico === undefined ? [] : [
      { label: `Water demand met · ${label}`, value: `${number(result.atendimento_hidrico * 100)}% of demand` },
    ];
  });
}

function modelFacts(seq) {
  if (!seq.modelos) return [];
  return [
    { label: 'Rank · future across models', value: `#${seq.modelos.rank_min}–#${seq.modelos.rank_max}` },
    ...(isSoilOnlyPlan(seq) ? [] : [{ label: 'Gross revenue / ha / year · future across models', value: revenueRange(seq, seq.modelos.receita_ano_ha_min, seq.modelos.receita_ano_ha_max) }]),
  ];
}

function modelNote(seq, models) {
  if (!seq.modelos) return '';
  const { rank_min, rank_max } = seq.modelos;
  const positions = rank_min === rank_max ? `rank #${rank_min}` : `ranks #${rank_min}–#${rank_max}`;
  return `Future across models: ${positions} (${models.nomes.length} ${models.nomes.length === 1 ? 'model' : 'models'}). Min–max range, not a confidence interval.${models.chuva === 'aproximada' ? ' Rainfall is approximated.' : ''}`;
}

function closeLeaders(sequences) {
  if (sequences.length < 2) return new Set();
  const leader = sequences[0].hoje.score;
  const close = seq => leader >= seq.hoje.score && leader - seq.hoje.score < 2;
  if (!close(sequences[1])) return new Set();
  // A third card only joins if it is close to the leader, never by chaining gaps.
  return new Set(sequences.slice(0, 3).filter(close).map(seq => seq.id));
}

// Display band only (2 points, same as the leader band); engine ranks and scores stay untouched.
const TIE_POINTS = 2;
function technicalTies(sequences) {
  const leaders = closeLeaders(sequences);
  const byFuture = [...sequences].sort((a, b) => a.rank_futuro - b.rank_futuro);
  const notes = new Map();
  let withNext = false, future = false;
  sequences.slice(0, 3).forEach((seq, i) => {
    // Only the third card borders a sequence that is not shown: the #4 of today.
    const next = i === 2 ? sequences[3] : undefined;
    const nextTie = Boolean(next) && seq.hoje.score >= next.hoje.score && seq.hoje.score - next.hoje.score < TIE_POINTS;
    const j = byFuture.indexOf(seq);
    const neighbors = [byFuture[j - 1], byFuture[j + 1]].filter(other => other && Math.abs(seq.futuro.score - other.futuro.score) < TIE_POINTS);
    const today = leaders.has(seq.id) || nextTie
      ? `Technical tie · today${nextTie ? `${leaders.has(seq.id) ? ', also' : ''} with the next sequence (#${next.rank_hoje}), which is not shown in the cards` : ''}`
      : '';
    const ahead = neighbors.length
      ? `Technical tie · future with ${neighbors.map(other => `#${other.rank_futuro}`).join(' and ')} in the future ranking`
      : '';
    withNext ||= nextTie; future ||= Boolean(ahead);
    const note = [today, ahead].filter(Boolean).join('. ');
    if (note) notes.set(seq.id, note);
  });
  const ranking_note = [
    leaders.size ? `Technical tie among the top ${leaders.size === 2 ? 'two' : 'three'} suggestions: their scores are less than 2 points below the leader.` : '',
    withNext ? 'The third suggestion is also less than 2 points above the next sequence (#4), which is not shown in the cards.' : '',
    future ? 'Cards marked “Technical tie · future” are less than 2 points from an adjacent sequence in the future ranking.' : '',
  ].filter(Boolean).join(' ');
  return { notes, ranking_note: ranking_note && `${ranking_note} This is a comparison band, not exact equality or a statistical guarantee. Compare the other indicators too.` };
}

// The API sends the demo field's SRTM elevation whenever it uses the demo climate,
// including boundaries drawn within 25 km. Only the exact demo boundary is "this field".
function discardedReason(seq, demoBoundary = false) {
  const r = seq.motivo;
  if (Object.hasOwn(r, 'altitude_min_m')) {
    const where = demoBoundary
      ? `this field is at ${number(r.altitude_m, 2)} m`
      : `the demonstration field, whose climate is used here, is at ${number(r.altitude_m, 2)} m; this boundary has no elevation data of its own`;
    return `${seq.culturas.map(cropLabel).join(' → ')}: ${cropLabel(r.cultura)} (${seasonLabel(r.slot)}, position ${r.posicao}) requires a minimum elevation of ${number(r.altitude_min_m, 2)} m; ${where}. Excluded by the engine due to elevation.`;
  }
  return `${seq.culturas.map(cropLabel).join(' → ')}: ${cropLabel(r.cultura)} (${seasonLabel(r.slot)}, position ${r.posicao}) ${r.mes_plantio === null ? `has no planting window in the ${seasonLabel(r.slot).toLowerCase()}` : `is planted in ${MONTHS[r.mes_plantio - 1]}, but the field is only available in ${MONTHS[r.mes_livre - 1]}`}.`;
}

function strategy(seq, farm, firstMonth, presentation, priorityNote, isCurrent = false, ties = new Map(), models = null) {
  const soilOnly = isSoilOnlyPlan(seq);
  return {
    ...presentation, sequence_id: seq.id, crop: seq.culturas.map(cropLabel).join(' → '),
    tie_note: ties.get(seq.id) ?? '',
    model_note: modelNote(seq, models),
    revenue_note: sequenceRevenueNote(seq, cropLabel),
    comparison_facts: comparisonFacts(seq),
    rank_facts: [
      { label: 'Rank · today', value: `#${seq.rank_hoje}` },
      { label: 'Score · today', value: `${number(seq.hoje.score)} / 100` },
      { label: 'Rank · future', value: `#${seq.rank_futuro}` },
      { label: 'Score · future', value: `${number(seq.futuro.score)} / 100` },
    ],
    exposure: buildExposure(seq, firstMonth),
    warnings: buildWarnings(seq, cropLabel),
    benefits: buildBenefits(seq, cropLabel),
    tradeoff: `Overall rank: #${seq.rank_hoje} today and #${seq.rank_futuro} in the future${seq.seco ? `; #${seq.rank_seco} in the dry year` : ''}. ${priorityNote} ${isCurrent ? 'This sequence is the reference from your crop history. ' : ''}All amounts are in Brazilian reais (BRL). Gross revenue is before costs, not profit. Values labeled "full rotation" cover the entire sequence; field totals also account for your field's area in hectares. ${seq.hoje.receita_ano_ha !== undefined ? 'Values labeled "/ year" are per year of field occupancy. The income priority uses revenue per year of field occupancy, compared with the engine reference system. Occupancy runs from field availability to the end of the final harvest, with a minimum of one year; a shorter sequence is not multiplied to simulate additional seasons. ' : 'This response does not include annual revenue or years of occupancy. '}Check prices, heat thresholds and provisional engine constants with your agronomist. Historical prices are not a sales forecast.`,
    facts: [
      ...(soilOnly ? [{ label: 'Revenue treatment', value: 'Soil benefits are not monetized' }] : [
        { label: 'Gross revenue / ha · full rotation · today', value: sequenceRevenueAmount(seq, seq.hoje.receita_ha) },
        { label: 'Gross revenue / ha · full rotation · future', value: sequenceRevenueAmount(seq, seq.futuro.receita_ha) },
      ]),
      { label: 'Rank · today / future', value: `#${seq.rank_hoje} / #${seq.rank_futuro}` },
      ...(soilOnly ? [] : [
        { label: 'Gross field revenue · full rotation · today', value: sequenceRevenueAmount(seq, seq.hoje.receita_ha * farm.area_ha) },
        { label: 'Gross field revenue · full rotation · future', value: sequenceRevenueAmount(seq, seq.futuro.receita_ha * farm.area_ha) },
      ]),
      { label: 'Overall score · today / future', value: `${number(seq.hoje.score)} / ${number(seq.futuro.score)}` },
      ...(seq.seco ? [
        ...(soilOnly ? [] : [
          { label: 'Gross revenue / ha · full rotation · dry year', value: sequenceRevenueAmount(seq, seq.seco.receita_ha) },
          { label: 'Gross field revenue · full rotation · dry year', value: sequenceRevenueAmount(seq, seq.seco.receita_ha * farm.area_ha) },
        ]),
        { label: 'Rank / score · dry year', value: `#${seq.rank_seco} / ${number(seq.seco.score)}` },
      ] : []),
      ...annualIncomeFacts(seq),
      ...waterFacts(seq),
      ...modelFacts(seq),
    ], ...timeline(seq, firstMonth),
  };
}

function currentRotation(value, farm, priorityNote, ties, demoBoundary = false) {
  const state = (status, description, strategy = null) => ({ status, title: 'Current rotation', description, strategy });
  const history = value.entrada.rotacao_atual;
  if (!history.length) return state('no_history', 'Add your crop history to compare the current rotation with the alternatives.');
  const hasReference = Object.hasOwn(value, 'atual');
  // Only legacy responses lack the dedicated reference and can mark the oldest crops.
  if (!hasReference && history.length > value.entrada.horizonte) return state('unavailable', 'The current rotation could not be reliably identified in this result. The alternatives are still available.');
  const repetition = history.length < value.entrada.horizonte
    ? ' Because the history contains one crop, the reference repeats it in both positions of the plan.' : '';
  const seq = hasReference
    ? value.atual?.viavel && value.sequencias.find((item) => item.id === value.atual.id)
    : value.sequencias.find((item) => item.atual);
  if (seq) {
    const description = `Reference identified from your crop history, using the same indicators as the alternatives.${repetition}`;
    return state('ready', description, strategy(seq, farm, value.entrada.mes_plantio, {
      category: 'current', metric: isSoilOnlyPlan(seq) ? soilPlanRole(seq) : sequenceRevenueAmount(seq, seq.hoje.receita_ha), metric_label: isSoilOnlyPlan(seq) ? 'primary role' : 'gross revenue / ha · full rotation · today’s climate', reason: description,
    }, priorityNote, true, ties, value.modelos));
  }
  const discarded = hasReference
    ? value.atual?.viavel === false && value.atual
    : value.descartadas.find((item) => item.atual);
  if (discarded) return state('discarded', `${Object.hasOwn(discarded.motivo, 'altitude_min_m') ? 'The reference rotation was excluded due to elevation.' : 'The reference rotation does not fit the selected calendar.'} ${discardedReason(discarded, demoBoundary)}${repetition}`);
  return state('unavailable', 'The current rotation could not be identified in this result. Available alternatives are shown below.');
}

// Only the current provider's routine provenance moves out of the warning band.
// New/unrecognized notices stay prominent until their meaning is known.
const ROUTINE_SOURCE_NOTICES = [
  'This point is within 25 km of the demonstration field. We use that field’s climate with the A520 station correction, without a new POWER request.',
  'POWER data for this point and regional NEX-GDDP projections, without the A520 station correction.',
  'Planting months still follow the Triângulo Mineiro calendar; check local suitability.',
];
function climateSources(origin, dataNotice, demo) {
  const notice = englishSourceNotice(origin?.aviso || '');
  const remainder = ROUTINE_SOURCE_NOTICES.reduce((text, routine) => text.replaceAll(routine, ''), notice).trim();
  const knownSource = ['tabela_demo', 'power_api', 'power_arquivo'].includes(origin?.hoje);
  const fallback = origin?.hoje === 'fallback_tabela_demo';
  const outside = origin?.dentro_mg === false;
  const exceptional = fallback || outside || Boolean(notice && (!knownSource || remainder));
  let baseline = englishSourceNotice(dataNotice);
  if (knownSource || fallback) {
    baseline = /\bPOWER\b/.test(baseline)
      ? baseline.replace(/(?<!NASA )\bPOWER\b/g, 'NASA POWER')
      : ['Historical climate source: NASA POWER.', baseline].filter(Boolean).join(' ');
  }
  if (['nex_talhao_demo', 'nex_regional'].includes(origin?.delta)) {
    baseline = baseline.includes('future: around 2060, using regional changes.')
      ? baseline.replace('future: around 2060, using regional changes.', 'future: NASA NEX-GDDP-CMIP6 projections around 2060, using regional changes.')
      : [baseline, 'Future projection source: NASA NEX-GDDP-CMIP6.'].filter(Boolean).join(' ');
  }
  const missingWarning = [
    fallback ? 'POWER climate data is unavailable for this point. The analysis uses demonstration-field climate tables.' : '',
    outside ? 'The field point is outside Minas Gerais. The planting calendar is regional; this result is exploratory.' : '',
  ].filter(Boolean).join(' ');
  return {
    data_sources: [baseline, exceptional ? '' : notice,
      demo ? 'Fixed example: does not use your history or settings.' : ''].filter(Boolean).join(' '),
    source_warning: exceptional ? notice || missingWarning : '',
  };
}

export function mapMotorAnalysis(raw, farm, { demo = false, dataNotice = '', demoBoundary = false } = {}) {
  const value = validateMotorOutput(raw);
  const adjustment_note = adjustmentNote(validateOutputAdjustment(value.entrada));
  const priorities = value.entrada.prioridades;
  const equal = priorities.agua === priorities.solo && priorities.solo === priorities.renda;
  const priority_note = `Priorities applied by the engine: water ${number(priorities.agua * 100)}%, soil ${number(priorities.solo * 100)}% and income ${number(priorities.renda * 100)}%.${equal ? ' Equal weights across all three priorities.' : ''}`;
  const { notes: ties, ranking_note } = technicalTies(value.sequencias);
  const current_rotation = currentRotation(value, farm, priority_note, ties, demoBoundary);
  // The engine owns ranking and tie-breaking. Keep its order, including cover crops.
  const recommendations = value.sequencias.slice(0, 3).map((seq, i) => strategy(seq, farm, value.entrada.mes_plantio, {
    category: CATEGORIES[i], metric: `${number(seq.hoje.score)} / 100`,
    metric_label: 'weighted score · today’s climate',
    reason: `Rank #${seq.rank_hoje} among viable sequences in today’s climate. ${priority_note} Future ranking uses the same weights and may change.`,
  }, priority_note, current_rotation.strategy?.sequence_id === seq.id, ties, value.modelos));
  return { demo, summary: `${value.sequencias.length} viable ${value.sequencias.length === 1 ? 'rotation' : 'rotations'} · field available from ${MONTH_NAMES[value.entrada.mes_plantio - 1]} · planning ${value.entrada.horizonte} ${value.entrada.horizonte === 1 ? 'crop' : 'crops'}`,
    ...climateSources(value.origem, dataNotice, demo), ranking_note, soil_note: soilNote(value),
    scenario_note: value.clima.seco
      ? adjustment_note
        ? 'Dry year: a what-if scenario applied to the 2020/21 baseline. The displayed values have been adjusted by the engine; they are not the original observations. Details compare it with the same adjustment as the other scenarios.'
        : 'Dry year: observations from 2020/21, not an average or a forecast. Details include this comparison; cards show today’s highest-ranked options using your priorities.'
      : 'Dry-year comparison is not available in this engine response.',
    priority_note, adjustment_note, current_rotation, recommendations, discarded: value.descartadas.map((seq) => discardedReason(seq, demoBoundary)) };
}

async function readResponse(response) {
  let value;
  try { value = await response.json(); } catch {
    throw new Error(response.ok ? 'The API returned a response that is not JSON.' : `Engine unavailable (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = typeof value?.detail === 'string' ? value.detail : Array.isArray(value?.detail)
      ? value.detail.filter(d => d && typeof d.msg === 'string').map((d) => `${Array.isArray(d.loc) ? d.loc.slice(1).join('.') || 'entrada' : 'entrada'}: ${d.msg}`).join('; ') : '';
    throw new Error(`The engine returned HTTP ${response.status}. ${detail ? englishApiError(detail) : ''}`.trim());
  }
  return value;
}
export async function requestAnalysis(baseUrl, request, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  return validateMotorOutput(await readResponse(response));
}
export async function requestMetadata(baseUrl, { signal, fetcher = fetch } = {}) {
  const value = await readResponse(await fetcher(`${baseUrl.replace(/\/+$/, '')}/metadata`, { signal }));
  list(value?.cultures, 'metadata.cultures', 1, 100);
  value.cultures.forEach((crop) => { string(crop?.id, 'culture.id'); string(crop?.label, 'culture.label'); });
  string(value.data_notice, 'data_notice');
  return { ...value, cultures: value.cultures.map(crop => ({ ...crop, label: cropLabel(crop.id) })), data_notice: englishSourceNotice(value.data_notice) };
}
