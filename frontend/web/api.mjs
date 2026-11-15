import { bbox } from '@turf/turf';
import { buildExposure, validateSequenceExposure } from './exposure.mjs';

export const CATEGORIES = ['income', 'soil', 'climate'];
export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DEFAULT_SETTINGS = { mes_plantio: 10, horizonte: 2 };
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
export function validateSettings(value) {
  if (!Number.isInteger(value?.mes_plantio) || value.mes_plantio < 1 || value.mes_plantio > 12 || ![1, 2].includes(value.horizonte)) {
    throw new Error('Escolha o mês em que o talhão fica livre e uma ou duas culturas.');
  }
  return { mes_plantio: value.mes_plantio, horizonte: value.horizonte };
}
export function buildRequest(farm, history, settings = DEFAULT_SETTINGS, cultures = []) {
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
  // Seasons and notes remain in the browser: the engine accepts only ordered crop IDs.
  return { lat, lon, rotacao_atual, prioridades: { agua: 1, solo: 1, renda: 1 }, ...validateSettings(settings), precos: {} };
}

export function validateMotorOutput(value) {
  if (value?.origem != null) {
    if (typeof value.origem !== 'object' || Array.isArray(value.origem)) invalid('origem');
    const warning = value.origem.aviso;
    if (warning != null && (typeof warning !== 'string' || warning.length > 4000)) invalid('origem.aviso');
  }
  integer(value?.entrada?.mes_plantio, 'entrada.mes_plantio', 1, 12);
  integer(value?.entrada?.horizonte, 'entrada.horizonte', 1, 2);
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
      finite(result.receita_ha, 'receita_ha', 0);
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
  }
  for (const seq of value.descartadas) {
    validateDiscardReason(seq.motivo, value.entrada.horizonte);
  }
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
      description: `${crop.ciclo_dias} dias de ciclo; ${crop.espera_dias} dias de espera pelo plantio. Receita bruta por hectare (${order}): ${compare('receita_ha', money)}.`,
      water: `Atendimento hídrico (${order}): ${compare('atendimento_hidrico', (v) => number(v * 100))} de 100. Déficit no ciclo: ${compare('deficit_mm')} mm.`,
      soil: `Índice de solo (${order}): ${compare('solo', (v) => number(v * 100))} de 100. Fator da sequência: ${number(crop.fator_sequencia, 2)}×. O índice combina fixação de nitrogênio, cobertura e diversidade; não é uma medição do solo.`,
      risk: `Encaixe de temperatura: ${compare('encaixe_temp', (v) => number(v * 100))} de 100. Encaixe de chuva: ${compare('encaixe_chuva', (v) => number(v * 100))} de 100. ${crops.every((c) => c.encaixe_calor != null) ? `Encaixe de calor: ${compare('encaixe_calor', (v) => number(v * 100))} de 100; dias quentes na fase sensível: ${compare('dias_calor')}. ` : ''}Ordem: ${order}. Valide os limites de calor com seu agrônomo; ausência de penalização não comprova tolerância.`, monthly };
  });
  return { timeline: stages, water_caption: `Chuva, demanda e déficit: ${order}, em milímetros. Dias e Kc correspondem ao período da cultura dentro de cada mês. Deslize a tabela para ver todas as colunas.`, month_labels: Array.from({ length: Math.max(12, last - firstMonth + 2) }, (_, i) => monthLabel(firstMonth - 1 + i)) };
}

function comparisonFacts(seq) {
  return [
    { label: 'Receita / ha · hoje', value: money(seq.hoje.receita_ha) },
    { label: 'Solo · hoje', value: index(seq.hoje.solo) },
    { label: 'Encaixe · futuro', value: index(seq.futuro.encaixe) },
  ];
}

function discardedReason(seq) {
  const r = seq.motivo;
  return `${seq.culturas.map(cropLabel).join(' → ')}: ${cropLabel(r.cultura)} (${r.slot}, posição ${r.posicao}) ${r.mes_plantio === null ? `não tem plantio previsto na ${r.slot}` : `tem plantio em ${MONTHS[r.mes_plantio - 1]}, mas a área só fica livre em ${MONTHS[r.mes_livre - 1]}`}.`;
}

function strategy(seq, farm, firstMonth, presentation, isCurrent = false) {
  return {
    ...presentation, sequence_id: seq.id, crop: seq.culturas.map(cropLabel).join(' → '),
    comparison_facts: comparisonFacts(seq),
    exposure: buildExposure(seq, firstMonth),
    tradeoff: `Ranking geral: #${seq.rank_hoje} hoje e #${seq.rank_futuro} no futuro${seq.seco ? `; #${seq.rank_seco} no ano seco` : ''}. O ranking combina água, solo e renda com pesos iguais; cada card usa seu próprio objetivo. ${isCurrent ? 'Esta sequência é a referência do histórico informado. ' : ''}Receita é bruta, sem descontar custos. Valide preços, limites de calor e constantes provisórias do motor com seu agrônomo. Preços históricos não são uma previsão de venda.`,
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
    ], ...timeline(seq, firstMonth),
  };
}

function currentRotation(value, farm) {
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
    }, true));
  }
  const discarded = hasReference
    ? value.atual?.viavel === false && value.atual
    : value.descartadas.find((item) => item.atual);
  if (discarded) return state('discarded', `A rotação de referência não cabe no calendário escolhido. ${discardedReason(discarded)}${repetition}`);
  return state('unavailable', 'Não foi possível identificar a rotação atual neste resultado. As alternativas disponíveis continuam abaixo.');
}

export function mapMotorAnalysis(raw, farm, { demo = false, dataNotice = '' } = {}) {
  const value = validateMotorOutput(raw);
  const current_rotation = currentRotation(value, farm);
  const choose = (score, tie = (seq) => -seq.rank_hoje, pool = value.sequencias) => [...pool].sort((a, b) => score(b) - score(a) || tie(b) - tie(a) || a.id.localeCompare(b.id))[0];
  const commercial = value.sequencias.filter((seq) => seq.futuro.culturas.every((crop) => crop.receita_ha > 0));
  const winners = [choose((s) => s.hoje.receita_ha), choose((s) => s.hoje.solo), choose((s) => s.futuro.encaixe, (s) => s.futuro.agua, commercial.length ? commercial : value.sequencias)];
  const criteria = [
    ['receita bruta / ha · clima de hoje', 'Maior receita bruta por hectare entre as sequências viáveis no clima de hoje. Custos de produção não entram neste valor.'],
    ['índice de solo · clima de hoje', 'Maior índice de solo entre as sequências viáveis no clima de hoje, conforme os fatores de cobertura, fixação de nitrogênio e diversidade do motor.'],
    ['encaixe climático · cenário futuro', `Maior encaixe climático futuro ${commercial.length ? 'entre sequências em que todas as culturas geram receita no futuro' : 'entre todas as sequências, pois nenhuma tem receita positiva em todas as culturas no futuro'}. Considera temperatura, chuva e penalização de calor. Empate: maior atendimento hídrico futuro. Não é probabilidade de resistir a eventos extremos.`],
  ];
  const recommendations = value.sequencias.length ? winners.map((seq, i) => strategy(seq, farm, value.entrada.mes_plantio, {
    category: CATEGORIES[i], metric: i === 0 ? money(seq.hoje.receita_ha) : index(i === 1 ? seq.hoje.solo : seq.futuro.encaixe),
    metric_label: criteria[i][0], reason: criteria[i][1],
  }, current_rotation.strategy?.sequence_id === seq.id)) : [];
  return { demo, summary: `${value.sequencias.length} sequências viáveis e ${value.descartadas.length} descartadas por calendário. Talhão livre em ${MONTHS[value.entrada.mes_plantio - 1]}; ${value.entrada.horizonte} cultura(s). ${demo ? 'Exemplo fixo: não utiliza seu histórico nem suas opções. ' : ''}${dataNotice}`,
    source_warning: value.origem?.aviso || '',
    scenario_note: value.clima.seco ? 'Ano seco: observações de 2020/21, não uma média nem uma previsão. Ele é comparado nos detalhes; os três cards mantêm seus critérios de hoje e futuro.' : 'A comparação com o ano seco ainda não está disponível nesta resposta do motor.',
    current_rotation, recommendations, discarded: value.descartadas.map(discardedReason) };
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
