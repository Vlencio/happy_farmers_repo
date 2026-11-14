import { bbox } from '@turf/turf';

export const CATEGORIES = ['income', 'soil', 'climate'];
export const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const DEFAULT_SETTINGS = { mes_plantio: 10, horizonte: 2 };
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
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('A latitude da fazenda é inválida.');
  if (!Array.isArray(history) || history.length > 12) throw new Error('Revise o histórico de plantio (até 12 registros).');
  const rotacao_atual = history.map(({ crop }) => {
    const match = cultures.find((c) => normalize(c.id) === normalize(crop) || normalize(c.label) === normalize(crop));
    if (!match) throw new Error(`A cultura “${crop}” não está no catálogo do motor. Remova ou corrija esse registro para continuar.`);
    return match.id;
  });
  // Seasons and notes remain in the browser: the engine accepts only ordered crop IDs.
  return { lat, rotacao_atual, prioridades: { agua: 1, solo: 1, renda: 1 }, ...validateSettings(settings), precos: {} };
}

export function validateMotorOutput(value) {
  integer(value?.entrada?.mes_plantio, 'entrada.mes_plantio', 1, 12);
  integer(value?.entrada?.horizonte, 'entrada.horizonte', 1, 2);
  list(value.slots, 'slots', value.entrada.horizonte, value.entrada.horizonte);
  value.slots.forEach((slot) => { if (!['safra', 'safrinha'].includes(slot)) invalid('slots'); });
  for (const scenario of ['hoje', 'futuro']) {
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
  for (const seq of value.sequencias) {
    for (const scenario of ['hoje', 'futuro']) {
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
        for (const key of ['chuva_mm', 'etc_mm', 'deficit_mm', 'receita_ha', 'fator_sequencia', 'fator']) finite(crop[key], key, 0);
        list(crop.meses, 'meses', 1, 12);
        for (const month of crop.meses) {
          integer(month.mes, 'meses.mes', 1, 12); integer(month.dias, 'meses.dias', 1, 62);
          for (const key of ['kc', 'chuva_mm', 'etc_mm', 'deficit_mm']) finite(month[key], `meses.${key}`, 0);
        }
        if (crop.meses[0].mes !== crop.mes_plantio || crop.meses.at(-1).mes !== crop.mes_colheita) invalid('meses do ciclo');
      }
    }
    seq.hoje.culturas.forEach((crop, i) => {
      const future = seq.futuro.culturas[i];
      if (crop.meses.length !== future.meses.length || crop.meses.some((m, j) => m.mes !== future.meses[j].mes || m.dias !== future.meses[j].dias)) invalid('calendários dos cenários');
    });
  }
  for (const seq of value.descartadas) {
    const reason = seq.motivo;
    string(reason?.cultura, 'motivo.cultura');
    integer(reason.posicao, 'motivo.posicao', 1, value.entrada.horizonte);
    if (!['safra', 'safrinha'].includes(reason.slot)) invalid('motivo.slot');
    integer(reason.mes_livre, 'motivo.mes_livre', 1, 12);
    if (reason.mes_plantio !== null) integer(reason.mes_plantio, 'motivo.mes_plantio', 1, 12);
  }
  return value;
}

function timeline(seq, firstMonth) {
  let last = firstMonth - 1;
  const monthLabel = (absolute) => `${MONTHS[absolute % 12]} · ano ${Math.floor(absolute / 12) + 1}`;
  const stages = seq.hoje.culturas.map((crop, i) => {
    const future = seq.futuro.culturas[i];
    let start = crop.mes_plantio - 1;
    while (start < last) start += 12;
    let end = start;
    const monthly = crop.meses.map((month, j) => {
      if (j > 0) { end++; while (end % 12 !== month.mes - 1) end++; }
      const f = future.meses[j];
      return { month: monthLabel(end), days: `${month.dias} d`, kc: number(month.kc, 2),
        rain: `${number(month.chuva_mm)} / ${number(f.chuva_mm)}`,
        demand: `${number(month.etc_mm)} / ${number(f.etc_mm)}`,
        deficit: `${number(month.deficit_mm)} / ${number(f.deficit_mm)}` };
    });
    last = end;
    return { title: `${cropLabel(crop.cultura)} · ${crop.slot}`, period: `${monthLabel(start)} → ${monthLabel(end)}`,
      start_month: start - firstMonth + 2, end_month: end - firstMonth + 2,
      description: `${crop.ciclo_dias} dias de ciclo; ${crop.espera_dias} dias de espera pelo plantio. Receita bruta por hectare: ${money(crop.receita_ha)} hoje e ${money(future.receita_ha)} no futuro.`,
      water: `Atendimento hídrico: ${index(crop.atendimento_hidrico)} hoje → ${index(future.atendimento_hidrico)} no futuro. Déficit no ciclo: ${number(crop.deficit_mm)} → ${number(future.deficit_mm)} mm.`,
      soil: `Índice de solo: ${index(crop.solo)} hoje → ${index(future.solo)} no futuro. Fator da sequência: ${number(crop.fator_sequencia, 2)}×. O índice combina fixação de nitrogênio, cobertura e diversidade; não é uma medição do solo.`,
      risk: `Encaixe de temperatura: ${index(crop.encaixe_temp)} → ${index(future.encaixe_temp)}. Encaixe de chuva: ${index(crop.encaixe_chuva)} → ${index(future.encaixe_chuva)}. Valores na ordem hoje → futuro.`, monthly };
  });
  return { timeline: stages, month_labels: Array.from({ length: Math.max(12, last - firstMonth + 2) }, (_, i) => monthLabel(firstMonth - 1 + i)) };
}

export function mapMotorAnalysis(raw, farm, { demo = false, dataNotice = '' } = {}) {
  const value = validateMotorOutput(raw);
  const choose = (score, tie = (seq) => -seq.rank_hoje) => [...value.sequencias].sort((a, b) => score(b) - score(a) || tie(b) - tie(a) || a.id.localeCompare(b.id))[0];
  const winners = [choose((s) => s.hoje.receita_ha), choose((s) => s.hoje.solo), choose((s) => s.futuro.encaixe, (s) => s.futuro.agua)];
  const criteria = [
    ['receita bruta / ha · clima de hoje', 'Maior receita bruta por hectare entre as sequências viáveis no clima de hoje. Custos de produção não entram neste valor.'],
    ['índice de solo · clima de hoje', 'Maior índice de solo entre as sequências viáveis no clima de hoje, conforme os fatores de cobertura, fixação de nitrogênio e diversidade do motor.'],
    ['encaixe climático · cenário futuro', 'Maior encaixe de temperatura e chuva no cenário futuro. Em empate, prioriza o atendimento hídrico futuro. É um índice de adequação, não uma probabilidade de resistir a eventos extremos.'],
  ];
  const recommendations = value.sequencias.length ? winners.map((seq, i) => ({
    category: CATEGORIES[i], sequence_id: seq.id, crop: seq.culturas.map(cropLabel).join(' → '),
    metric: i === 0 ? money(seq.hoje.receita_ha) : index(i === 1 ? seq.hoje.solo : seq.futuro.encaixe),
    metric_label: criteria[i][0], reason: criteria[i][1],
    tradeoff: `Ranking geral: #${seq.rank_hoje} hoje e #${seq.rank_futuro} no futuro. O ranking combina água, solo e renda com pesos iguais; cada card usa seu próprio objetivo. ${seq.atual ? 'Esta sequência repete o histórico informado. ' : ''}Receita é bruta, sem descontar custos. Os resultados dependem das tabelas e hipóteses do motor.`,
    facts: [
      { label: 'Receita / ha · hoje', value: money(seq.hoje.receita_ha) },
      { label: 'Receita / ha · futuro', value: money(seq.futuro.receita_ha) },
      { label: 'Ranking · hoje / futuro', value: `#${seq.rank_hoje} / #${seq.rank_futuro}` },
      { label: 'Receita da área · hoje', value: money(seq.hoje.receita_ha * farm.area_ha) },
      { label: 'Receita da área · futuro', value: money(seq.futuro.receita_ha * farm.area_ha) },
      { label: 'Score geral · hoje / futuro', value: `${number(seq.hoje.score)} / ${number(seq.futuro.score)}` },
    ], ...timeline(seq, value.entrada.mes_plantio),
  })) : [];
  return { demo, summary: `${value.sequencias.length} sequências viáveis e ${value.descartadas.length} descartadas por calendário. Talhão livre em ${MONTHS[value.entrada.mes_plantio - 1]}; ${value.entrada.horizonte} cultura(s). ${demo ? 'Exemplo fixo: não utiliza seu histórico nem suas opções. ' : ''}${dataNotice}`,
    recommendations, discarded: value.descartadas.map((seq) => {
      const r = seq.motivo;
      return `${seq.culturas.map(cropLabel).join(' → ')}: ${cropLabel(r.cultura)} (${r.slot}, posição ${r.posicao}) ${r.mes_plantio === null ? `não tem plantio previsto na ${r.slot}` : `tem plantio em ${MONTHS[r.mes_plantio - 1]}, mas a área só fica livre em ${MONTHS[r.mes_livre - 1]}`}.`;
    }) };
}

async function readResponse(response) {
  let value;
  try { value = await response.json(); } catch {
    throw new Error(response.ok ? 'A API retornou uma resposta que não é JSON.' : `Motor indisponível (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = typeof value.detail === 'string' ? value.detail : Array.isArray(value.detail)
      ? value.detail.map((d) => `${d.loc?.slice(1).join('.') || 'entrada'}: ${d.msg}`).join('; ') : '';
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
  list(value.cultures, 'metadata.cultures', 1, 100);
  value.cultures.forEach((crop) => { string(crop.id, 'culture.id'); string(crop.label, 'culture.label'); });
  string(value.data_notice, 'data_notice');
  return value;
}
