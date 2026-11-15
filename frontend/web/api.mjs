import { bbox } from '@turf/turf';
import { supportsSoil, validateSoilTexture, validateOutputSoil, soilNote } from './soil.mjs';
import { buildExposure, validateSequenceExposure } from './exposure.mjs';
import { buildWarnings, validateSequenceWarnings } from './warnings.mjs';
import { buildBenefits, validateSequenceBenefits } from './benefits.mjs';
import { DEFAULT_ADJUSTMENT, validateAdjustment, validateOutputAdjustment, supportsAdjustment, hasAdjustment, adjustmentNote } from './scenario.mjs';
export { assertAdjustmentApplied, supportsAdjustment } from './scenario.mjs';

export const CATEGORIES = ['rank1', 'rank2', 'rank3'];
export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DEFAULT_SETTINGS = { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { ...DEFAULT_ADJUSTMENT } };
// POWER can take up to 300 s on a first lookup; leave time for scoring and transport.
export const ANALYSIS_TIMEOUT_MS = 360_000;
const accents = { feijao: 'Feijão', algodao: 'Algodão', braquiaria: 'Braquiária', crotalaria: 'Crotalária' };
export const cropLabel = (id) => accents[id] || id.charAt(0).toUpperCase() + id.slice(1);
const number = (value, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const index = (value) => `${number(value * 100)} / 100`;
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const invalid = (path) => { throw new Error(`Resposta incompatível com o contrato do motor: ${path}.`); };
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
function validateDiscardReason(reason, horizon) {
  string(reason?.cultura, 'motivo.cultura');
  integer(reason.posicao, 'motivo.posicao', 1, horizon);
  if (!['safra', 'safrinha'].includes(reason.slot)) invalid('motivo.slot');
  integer(reason.mes_livre, 'motivo.mes_livre', 1, 12);
  if (reason.mes_plantio !== null) integer(reason.mes_plantio, 'motivo.mes_plantio', 1, 12);
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
    if (value.sequencias.some(seq => Object.hasOwn(seq, 'modelos'))) invalid('modelos: resumo ausente');
    return;
  }
  const models = value.modelos;
  if (!models || typeof models !== 'object' || Array.isArray(models)) invalid('modelos');
  list(models.nomes, 'modelos.nomes', 1, 100);
  models.nomes.forEach(name => string(name, 'modelos.nomes'));
  if (new Set(models.nomes).size !== models.nomes.length) invalid('modelos.nomes: repetidos');
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
    if (months.size !== 12) invalid('modelos.clima: meses repetidos');
    if (!value.sequencias.length) {
      if (models.primeiro[name] !== null) invalid('modelos.primeiro: sem sequência viável');
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
      if ((model.rank === 1) !== (models.primeiro[model.modelo] === seq.id)) invalid('modelos.primeiro: rank divergente');
    }
    for (const key of ['rank_min', 'rank_max']) integer(range[key], `modelos.${key}`, 1, value.sequencias.length);
    for (const key of ['receita_ano_ha_min', 'receita_ano_ha_max']) finite(range[key], `modelos.${key}`, 0);
    const ranks = range.por_modelo.map(model => model.rank);
    const revenues = range.por_modelo.map(model => model.receita_ano_ha);
    if (range.rank_min !== Math.min(...ranks) || range.rank_max !== Math.max(...ranks) ||
      Math.abs(range.receita_ano_ha_min - Math.min(...revenues)) > .001 ||
      Math.abs(range.receita_ano_ha_max - Math.max(...revenues)) > .001) invalid('modelos: faixa divergente');
  }
  for (const [i] of models.nomes.entries()) {
    const ranks = value.sequencias.map(seq => seq.modelos.por_modelo[i].rank);
    if (new Set(ranks).size !== ranks.length) invalid('modelos.por_modelo.rank: repetido');
  }
}
export function validateSettings(value) {
  if (!Number.isInteger(value?.mes_plantio) || value.mes_plantio < 1 || value.mes_plantio > 12 || ![1, 2].includes(value.horizonte)) {
    throw new Error('Escolha o mês em que o talhão fica livre e uma ou duas culturas.');
  }
  // Drafts saved before priority controls used equal weights.
  const priorities = value.prioridades === undefined ? DEFAULT_SETTINGS.prioridades : value.prioridades;
  if (!priorities || ['agua', 'solo', 'renda'].some(key => !Number.isInteger(priorities[key]) || priorities[key] < 0 || priorities[key] > 3)) {
    throw new Error('Escolha uma prioridade de 0 a 3 para água, solo e renda.');
  }
  if ((value.solo_padrao !== undefined && typeof value.solo_padrao !== 'boolean') || (value.solo_padrao && value.solo_textura)) {
    throw new Error('Escolha uma textura de solo ou a referência padrão.');
  }
  return { mes_plantio: value.mes_plantio, horizonte: value.horizonte,
    prioridades: { agua: priorities.agua, solo: priorities.solo, renda: priorities.renda },
    ajuste: validateAdjustment(value.ajuste),
    ...(validateSoilTexture(value.solo_textura) ? { solo_textura: value.solo_textura } : {}),
    ...(value.solo_padrao ? { solo_padrao: true } : {}) };
}
export function buildRequest(farm, history, settings = DEFAULT_SETTINGS, cultures = [], metadata = {}) {
  if (!farm?.geojson || !Number.isFinite(farm.area_ha) || farm.area_ha <= 0) throw new Error('Defina uma área válida antes de analisar.');
  const bounds = bbox(farm.geojson);
  const lat = (bounds[1] + bounds[3]) / 2;
  const lon = (bounds[0] + bounds[2]) / 2;
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('A latitude da fazenda é inválida.');
  if (!Number.isFinite(lon) || Math.abs(lon) > 180) throw new Error('A longitude da fazenda é inválida.');
  if (!Array.isArray(history) || history.length > 12) throw new Error('Revise o histórico de plantio (até 12 registros).');
  const rotacao_atual = history.map(({ crop }) => {
    const match = cultures.find((c) => normalize(c.id) === normalize(crop) || normalize(c.label) === normalize(crop));
    if (!match) throw new Error(`A cultura “${crop}” não está no catálogo do motor. Remova ou corrija esse registro para continuar.`);
    return match.id;
  });
  const { ajuste, solo_padrao, ...options } = validateSettings(settings);
  if (options.solo_textura && !supportsSoil(metadata)) {
    throw new Error('A textura de solo ainda não está disponível neste servidor. Use a referência padrão para analisar.');
  }
  if (hasAdjustment(ajuste) && !supportsAdjustment(metadata)) {
    throw new Error('Os ajustes de cenário ainda não estão disponíveis neste servidor. Volte ao clima sem ajuste para analisar.');
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
  validateOutputAdjustment(value.entrada);
  for (const key of ['agua', 'solo', 'renda']) finite(value.entrada.prioridades?.[key], `entrada.prioridades.${key}`, 0, 1);
  if (Object.values(value.entrada.prioridades).every(weight => weight === 0)) invalid('entrada.prioridades: pesos não normalizados');
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
    if (months.size !== 12) invalid('clima: meses repetidos');
  }
  list(value.sequencias, 'sequencias'); list(value.descartadas, 'descartadas');
  const ids = new Set();
  for (const seq of [...value.sequencias, ...value.descartadas]) {
    string(seq.id, 'id');
    list(seq.culturas, 'culturas', value.entrada.horizonte, value.entrada.horizonte);
    seq.culturas.forEach((crop) => string(crop, 'cultura'));
    if (ids.has(seq.id) || seq.id !== seq.culturas.join('>') || typeof seq.atual !== 'boolean') invalid('sequência');
    ids.add(seq.id);
  }
  if ([...value.sequencias, ...value.descartadas].filter((seq) => seq.atual).length > 1) invalid('mais de uma rotação atual');
  for (const seq of value.sequencias) {
    if (!hasDry && (Object.hasOwn(seq, 'seco') || Object.hasOwn(seq, 'rank_seco'))) invalid('cenário seco sem clima.seco');
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
        if (crop.cultura !== seq.culturas[i] || crop.slot !== value.slots[i]) invalid('ordem das culturas/slots');
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
        if (crop.meses[0].mes !== crop.mes_plantio || crop.meses.at(-1).mes !== crop.mes_colheita) invalid('meses do ciclo');
      }
    }
    for (const scenario of scenarios.slice(1)) {
      seq.hoje.culturas.forEach((crop, i) => {
        const other = seq[scenario].culturas[i];
        if (['mes_plantio', 'mes_colheita', 'ciclo_dias', 'espera_dias'].some((key) => crop[key] !== other[key]) ||
          crop.meses.length !== other.meses.length || crop.meses.some((m, j) => m.mes !== other.meses[j].mes || m.dias !== other.meses[j].dias)) invalid('calendários dos cenários');
      });
    }
    validateSequenceExposure(seq, scenarios, value.entrada.mes_plantio);
    validateSequenceWarnings(seq, scenarios);
    validateSequenceBenefits(seq, scenarios);
  }
  for (const seq of value.descartadas) {
    validateDiscardReason(seq.motivo, value.entrada.horizonte);
  }
  validateModelRanges(value);
  // The dedicated reference owns identity and availability; metrics stay in sequencias.
  // Older responses can still use only the per-sequence markers.
  if (Object.hasOwn(value, 'atual')) {
    const current = value.atual;
    if (current === null) {
      if (value.entrada.rotacao_atual.length) invalid('atual: referência ausente para o histórico');
    } else {
      if (!current || typeof current !== 'object' || Array.isArray(current)) invalid('atual');
      if (!value.entrada.rotacao_atual.length) invalid('atual: referência sem histórico');
      string(current.id, 'atual.id');
      list(current.culturas, 'atual.culturas', value.entrada.horizonte, value.entrada.horizonte);
      current.culturas.forEach((crop) => string(crop, 'atual.culturas'));
      if (current.id !== current.culturas.join('>') || typeof current.viavel !== 'boolean') invalid('atual');
      if (current.viavel) {
        if (current.motivo !== null || !value.sequencias.some((seq) => seq.id === current.id)) invalid('atual: sequência viável');
      } else {
        validateDiscardReason(current.motivo, value.entrada.horizonte);
      }
    }
  }
  return value;
}

function timeline(seq, firstMonth) {
  let last = firstMonth - 1;
  const scenarios = seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
  const order = seq.seco ? 'hoje / futuro / ano seco' : 'hoje / futuro';
  const monthLabel = (absolute) => `${MONTHS[absolute % 12]} · ano ${Math.floor(absolute / 12) + 1}`;
  const stages = seq.hoje.culturas.map((crop, i) => {
    const crops = scenarios.map((key) => seq[key].culturas[i]);
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
    return { title: `${cropLabel(crop.cultura)} · ${crop.slot}`, period: `${monthLabel(start)} → ${monthLabel(end)}`,
      start_month: start - firstMonth + 2, end_month: end - firstMonth + 2,
      description: `${crop.ciclo_dias} dias de ciclo; ${crop.espera_dias} dias de espera pelo plantio. ${crop.dias_apos_anterior != null ? `${crop.dias_apos_anterior} dias entre o fim da cultura anterior e este plantio${i === 0 ? ' (para a primeira cultura, o fim do histórico é uma suposição do cálculo)' : ''}. ` : ''}Receita bruta por hectare (${order}): ${compare('receita_ha', money)}.`,
      water: `Atendimento hídrico (${order}): ${compare('atendimento_hidrico', (v) => number(v * 100))} de 100. Déficit no ciclo: ${compare('deficit_mm')} mm.`,
      soil: `Índice de solo (${order}): ${compare('solo', (v) => number(v * 100))} de 100. Fator da sequência: ${number(crop.fator_sequencia, 3)}×. ${rotationFactors(crop)}O índice combina fixação de nitrogênio, cobertura e diversidade, ajustadas ao encaixe climático; não é uma medição do solo.`,
      risk: `Encaixe de temperatura: ${compare('encaixe_temp', (v) => number(v * 100))} de 100. Encaixe de chuva: ${compare('encaixe_chuva', (v) => number(v * 100))} de 100. ${crops.every((c) => c.encaixe_calor != null) ? `Encaixe de calor: ${compare('encaixe_calor', (v) => number(v * 100))} de 100; dias quentes na fase sensível: ${compare('dias_calor')}. ` : ''}Ordem: ${order}. Valide os limites de calor com seu agrônomo; ausência de penalização não comprova tolerância.`, monthly };
  });
  return { timeline: stages, water_caption: `Chuva, demanda e déficit: ${order}, em milímetros. Dias e Kc correspondem ao período da cultura dentro de cada mês. Deslize a tabela para ver todas as colunas.`, month_labels: Array.from({ length: Math.max(12, last - firstMonth + 2) }, (_, i) => monthLabel(firstMonth - 1 + i)) };
}

function rotationFactors(crop) {
  const notes = [];
  if (crop.repete) notes.push('Repete a cultura anterior.');
  if (crop.bonus_n) notes.push('Recebe o bônus após adubo verde dentro da janela de 60 dias adotada pelo cálculo.');
  if (crop.hospedeiro_comum) notes.push(`Compartilha praga ou doença com ${cropLabel(crop.hospedeiro_comum.anterior)}.${crop.penalidade_hospedeiro === undefined ? '' : ` Fator de hospedeiro comum aplicado: ${number(crop.penalidade_hospedeiro, 3)}×.`}`);
  return notes.length ? `${notes.join(' ')} ` : '';
}

function comparisonFacts(seq) {
  return [
    { label: 'Receita / ha · hoje', value: money(seq.hoje.receita_ha) },
    { label: 'Solo · hoje', value: index(seq.hoje.solo) },
    { label: 'Encaixe · futuro', value: index(seq.futuro.encaixe) },
  ];
}

function annualIncomeFacts(seq) {
  return [['hoje', 'hoje'], ['futuro', 'futuro'], ['seco', 'ano seco']].flatMap(([key, label]) => {
    const result = seq[key];
    if (!result || result.receita_ano_ha === undefined) return [];
    return [
      { label: `Receita / ha / ano · ${label}`, value: money(result.receita_ano_ha) },
      { label: `Anos considerados · ${label}`, value: `${number(result.anos_ocupados, 2)} ${result.anos_ocupados === 1 ? 'ano' : 'anos'}` },
    ];
  });
}

function waterFacts(seq) {
  return [['hoje', 'hoje'], ['futuro', 'futuro'], ['seco', 'ano seco']].flatMap(([key, label]) => {
    const result = seq[key];
    return result?.atendimento_hidrico === undefined ? [] : [
      { label: `Atendimento de água · ${label}`, value: `${number(result.atendimento_hidrico * 100)}% da demanda` },
    ];
  });
}

function modelFacts(seq) {
  if (!seq.modelos) return [];
  return [
    { label: 'Posição · futuro entre modelos', value: `#${seq.modelos.rank_min}–#${seq.modelos.rank_max}` },
    { label: 'Receita / ha / ano · futuro entre modelos', value: `${money(seq.modelos.receita_ano_ha_min)} a ${money(seq.modelos.receita_ano_ha_max)}` },
  ];
}

function modelNote(seq, models) {
  if (!seq.modelos) return '';
  const { rank_min, rank_max } = seq.modelos;
  const positions = rank_min === rank_max ? `${rank_min}ª posição` : `${rank_min}ª–${rank_max}ª posição`;
  return `Futuro entre modelos: ${positions} (${models.nomes.length} ${models.nomes.length === 1 ? 'modelo' : 'modelos'}). Faixa mín–máx, não intervalo de confiança.${models.chuva === 'aproximada' ? ' Chuva por aproximação.' : ''}`;
}

function closeLeaders(sequences) {
  if (sequences.length < 2) return new Set();
  const leader = sequences[0].hoje.score;
  const close = seq => leader >= seq.hoje.score && leader - seq.hoje.score < 2;
  if (!close(sequences[1])) return new Set();
  // A third card only joins if it is close to the leader, never by chaining gaps.
  return new Set(sequences.slice(0, 3).filter(close).map(seq => seq.id));
}

function discardedReason(seq) {
  const r = seq.motivo;
  return `${seq.culturas.map(cropLabel).join(' → ')}: ${cropLabel(r.cultura)} (${r.slot}, posição ${r.posicao}) ${r.mes_plantio === null ? `não tem plantio previsto na ${r.slot}` : `tem plantio em ${MONTHS[r.mes_plantio - 1]}, mas a área só fica livre em ${MONTHS[r.mes_livre - 1]}`}.`;
}

function strategy(seq, farm, firstMonth, presentation, priorityNote, isCurrent = false, tied = new Set(), models = null) {
  return {
    ...presentation, sequence_id: seq.id, crop: seq.culturas.map(cropLabel).join(' → '),
    tie_note: tied.has(seq.id) ? 'Empate técnico · hoje' : '',
    model_note: modelNote(seq, models),
    comparison_facts: comparisonFacts(seq),
    rank_facts: [
      { label: 'Posição · hoje', value: `#${seq.rank_hoje}` },
      { label: 'Score · hoje', value: `${number(seq.hoje.score)} / 100` },
      { label: 'Posição · futuro', value: `#${seq.rank_futuro}` },
      { label: 'Score · futuro', value: `${number(seq.futuro.score)} / 100` },
    ],
    exposure: buildExposure(seq, firstMonth),
    warnings: buildWarnings(seq, cropLabel),
    benefits: buildBenefits(seq, cropLabel),
    tradeoff: `Ranking geral: #${seq.rank_hoje} hoje e #${seq.rank_futuro} no futuro${seq.seco ? `; #${seq.rank_seco} no ano seco` : ''}. ${priorityNote} ${isCurrent ? 'Esta sequência é a referência do histórico informado. ' : ''}Receita é bruta, sem descontar custos. As receitas por hectare e da área somam toda a sequência. ${seq.hoje.receita_ano_ha !== undefined ? 'A prioridade renda usa a receita por ano de ocupação, comparada ao sistema de referência do motor. Os anos considerados vão do talhão livre ao fim da última colheita, com mínimo de 1 ano; uma sequência mais curta não é multiplicada para simular novas safras. ' : 'Esta resposta não informa receita anual nem anos de ocupação. '}Valide preços, limites de calor e constantes provisórias do motor com seu agrônomo. Preços históricos não são uma previsão de venda.`,
    facts: [
      { label: 'Receita / ha · hoje', value: money(seq.hoje.receita_ha) },
      { label: 'Receita / ha · futuro', value: money(seq.futuro.receita_ha) },
      { label: 'Ranking · hoje / futuro', value: `#${seq.rank_hoje} / #${seq.rank_futuro}` },
      { label: 'Receita da área · hoje', value: money(seq.hoje.receita_ha * farm.area_ha) },
      { label: 'Receita da área · futuro', value: money(seq.futuro.receita_ha * farm.area_ha) },
      { label: 'Score geral · hoje / futuro', value: `${number(seq.hoje.score)} / ${number(seq.futuro.score)}` },
      ...(seq.seco ? [
        { label: 'Receita / ha · ano seco', value: money(seq.seco.receita_ha) },
        { label: 'Receita da área · ano seco', value: money(seq.seco.receita_ha * farm.area_ha) },
        { label: 'Ranking / score · ano seco', value: `#${seq.rank_seco} / ${number(seq.seco.score)}` },
      ] : []),
      ...annualIncomeFacts(seq),
      ...waterFacts(seq),
      ...modelFacts(seq),
    ], ...timeline(seq, firstMonth),
  };
}

function currentRotation(value, farm, priorityNote, tied) {
  const state = (status, description, strategy = null) => ({ status, title: 'Rotação atual', description, strategy });
  const history = value.entrada.rotacao_atual;
  if (!history.length) return state('no_history', 'Adicione seu histórico de plantio para comparar a rotação atual com as alternativas.');
  const hasReference = Object.hasOwn(value, 'atual');
  // Only legacy responses lack the dedicated reference and can mark the oldest crops.
  if (!hasReference && history.length > value.entrada.horizonte) return state('unavailable', 'Não foi possível identificar com segurança a rotação atual neste resultado. As alternativas continuam disponíveis.');
  const repetition = history.length < value.entrada.horizonte
    ? ' Como o histórico tem uma única cultura, a referência repete essa cultura nas duas posições do planejamento.' : '';
  const seq = hasReference
    ? value.atual?.viavel && value.sequencias.find((item) => item.id === value.atual.id)
    : value.sequencias.find((item) => item.atual);
  if (seq) {
    const description = `Referência identificada a partir do histórico informado, com os mesmos indicadores das alternativas.${repetition}`;
    return state('ready', description, strategy(seq, farm, value.entrada.mes_plantio, {
      category: 'current', metric: money(seq.hoje.receita_ha), metric_label: 'receita bruta / ha · clima de hoje', reason: description,
    }, priorityNote, true, tied, value.modelos));
  }
  const discarded = hasReference
    ? value.atual?.viavel === false && value.atual
    : value.descartadas.find((item) => item.atual);
  if (discarded) return state('discarded', `A rotação de referência não cabe no calendário escolhido. ${discardedReason(discarded)}${repetition}`);
  return state('unavailable', 'Não foi possível identificar a rotação atual neste resultado. As alternativas disponíveis continuam abaixo.');
}

export function mapMotorAnalysis(raw, farm, { demo = false, dataNotice = '' } = {}) {
  const value = validateMotorOutput(raw);
  const adjustment_note = adjustmentNote(validateOutputAdjustment(value.entrada));
  const priorities = value.entrada.prioridades;
  const equal = priorities.agua === priorities.solo && priorities.solo === priorities.renda;
  const priority_note = `Prioridades aplicadas pelo motor: água ${number(priorities.agua * 100)}%, solo ${number(priorities.solo * 100)}% e renda ${number(priorities.renda * 100)}%.${equal ? ' Pesos iguais entre as três prioridades.' : ''}`;
  const tied = closeLeaders(value.sequencias);
  const ranking_note = tied.size
    ? `Empate técnico entre as ${tied.size === 2 ? 'duas' : 'três'} primeiras sugestões: as notas estão a menos de 2 pontos da maior pontuação. É uma faixa de comparação, não igualdade exata nem garantia estatística. Compare também os demais indicadores.`
    : '';
  const current_rotation = currentRotation(value, farm, priority_note, tied);
  // The engine owns ranking and tie-breaking. Keep its order, including cover crops.
  const recommendations = value.sequencias.slice(0, 3).map((seq, i) => strategy(seq, farm, value.entrada.mes_plantio, {
    category: CATEGORIES[i], metric: `${number(seq.hoje.score)} / 100`,
    metric_label: 'score ponderado · clima de hoje',
    reason: `${seq.rank_hoje}ª posição entre as sequências viáveis no clima de hoje. ${priority_note} A posição no futuro usa os mesmos pesos e pode mudar.`,
  }, priority_note, current_rotation.strategy?.sequence_id === seq.id, tied, value.modelos));
  return { demo, summary: `${value.sequencias.length} sequências viáveis e ${value.descartadas.length} descartadas por calendário. Talhão livre em ${MONTHS[value.entrada.mes_plantio - 1]}; ${value.entrada.horizonte} cultura(s). ${demo ? 'Exemplo fixo: não utiliza seu histórico nem suas opções. ' : ''}${dataNotice}`,
    source_warning: value.origem?.aviso || '', ranking_note, soil_note: soilNote(value),
    scenario_note: value.clima.seco
      ? adjustment_note
        ? 'Ano seco: cenário “e se” aplicado sobre a base de 2020/21. Os valores exibidos foram ajustados pelo motor; não são as observações originais. Ele é comparado nos detalhes com o mesmo ajuste dos demais cenários.'
        : 'Ano seco: observações de 2020/21, não uma média nem uma previsão. Ele é comparado nos detalhes; os cards mostram as melhores posições de hoje com as prioridades aplicadas.'
      : 'A comparação com o ano seco ainda não está disponível nesta resposta do motor.',
    priority_note, adjustment_note, current_rotation, recommendations, discarded: value.descartadas.map(discardedReason) };
}

async function readResponse(response) {
  let value;
  try { value = await response.json(); } catch {
    throw new Error(response.ok ? 'A API retornou uma resposta que não é JSON.' : `Motor indisponível (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = typeof value?.detail === 'string' ? value.detail : Array.isArray(value?.detail)
      ? value.detail.filter(d => d && typeof d.msg === 'string').map((d) => `${Array.isArray(d.loc) ? d.loc.slice(1).join('.') || 'entrada' : 'entrada'}: ${d.msg}`).join('; ') : '';
    throw new Error(`Motor retornou HTTP ${response.status}. ${detail}`.trim());
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
  return value;
}
