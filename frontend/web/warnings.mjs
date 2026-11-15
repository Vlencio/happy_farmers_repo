const number = (value, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const money = (value) => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
const percent = (value) => `${number(value * 100)}%`;
const SCENARIOS = { hoje: 'today\'s climate', futuro: 'future climate', seco: 'dry year' };
const SLOTS = { safra: 'Main season', safrinha: 'Second season' };
const FACTORS = { temperatura: 'temperature', chuva: 'rainfall', calor: 'heat', agua: 'water demand met' };
const TYPES = {
  fator_limitante: 'risco', queda_no_futuro: 'risco', queda_no_ano_ruim: 'risco',
  repete_a_cultura: 'risco', solo_exposto: 'risco', sem_historico: 'lacuna',
  sem_limiar_de_calor: 'lacuna', limiar_de_calor_pouco_confiavel: 'lacuna',
  sem_valor_de_mercado: 'lacuna', ky_padrao: 'lacuna', valor_a_conferir: 'lacuna',
  hospedeiro_comum: 'risco', fator_agua_diario: 'risco', rank_varia_entre_modelos: 'risco',
};
const FIELDS = { preco: 'Price', temp_calor_c: 'Heat threshold', produtividade: 'Main-season yield',
  produtividade_safrinha: 'Second-season yield', ky: 'Yield response to water shortage (Ky)' };
const STATUSES = { memoria: 'from memory', 'sem fonte': 'no source', 'a conferir': 'needs verification', 'provisório': 'provisional' };
const invalid = (path) => { throw new Error(`Response does not match the engine contract: avisos.${path}.`); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function string(value, path, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(path);
}
function finite(value, path, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(path);
}
function jsonData(value, path, depth = 0) {
  if (depth > 5) invalid(path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') return finite(value, path);
  if (typeof value === 'string') { if (value.length > 2000) invalid(path); return; }
  if (!value || typeof value !== 'object' || Object.keys(value).length > 100) invalid(path);
  for (const [key, entry] of Object.entries(value)) jsonData(entry, `${path}.${key}`, depth + 1);
}

// Validate the delivered evidence, without recreating the engine's warning thresholds.
export function validateSequenceWarnings(seq, scenarios) {
  if (!Object.hasOwn(seq, 'avisos')) return false;
  if (!Array.isArray(seq.avisos) || seq.avisos.length > 2000) invalid('lista');
  for (const [i, warning] of seq.avisos.entries()) {
    const path = String(i);
    if (!object(warning)) invalid(path);
    if (!['risco', 'lacuna'].includes(warning.tipo)) invalid(`${path}.tipo`);
    string(warning.codigo, `${path}.codigo`, 100);
    string(warning.texto, `${path}.texto`);
    if (warning.cultura !== null && !seq.culturas.includes(warning.cultura)) invalid(`${path}.cultura`);
    if (warning.cenario !== null && !scenarios.includes(warning.cenario)) invalid(`${path}.cenario`);
    if (!object(warning.dados)) invalid(`${path}.dados`);
    jsonData(warning.dados, `${path}.dados`);
    const type = Object.hasOwn(TYPES, warning.codigo) ? TYPES[warning.codigo] : null;
    if (!type) continue; // Future codes remain flagged without guessing an English explanation.
    if (warning.tipo !== type) invalid(`${path}.tipo`);
    const d = warning.dados;
    const amount = (key, min = 0, max = Infinity) => finite(d[key], `${path}.dados.${key}`, min, max);
    const needsCrop = ['fator_limitante', 'fator_agua_diario', 'repete_a_cultura', 'hospedeiro_comum', 'sem_limiar_de_calor',
      'limiar_de_calor_pouco_confiavel', 'sem_valor_de_mercado', 'ky_padrao', 'valor_a_conferir'].includes(warning.codigo);
    if (needsCrop !== (warning.cultura !== null)) invalid(`${path}.cultura`);
    const needsScenario = ['fator_limitante', 'fator_agua_diario', 'queda_no_futuro', 'queda_no_ano_ruim', 'rank_varia_entre_modelos'].includes(warning.codigo);
    if (needsScenario !== (warning.cenario !== null)) invalid(`${path}.cenario`);
    if (['fator_limitante', 'fator_agua_diario', 'repete_a_cultura', 'hospedeiro_comum'].includes(warning.codigo) && !['safra', 'safrinha'].includes(d.slot)) invalid(`${path}.dados.slot`);
    switch (warning.codigo) {
      case 'fator_limitante':
        if (!Object.hasOwn(FACTORS, d.fator)) invalid(`${path}.dados.fator`);
        amount('valor', 0, 1); break;
      case 'fator_agua_diario':
        amount('fator_agua', 0, 1); amount('atendimento_hidrico', 0, 1); amount('ky'); break;
      case 'hospedeiro_comum':
        amount('penalidade', 0, 1); amount('fator_sequencia');
        string(d.anterior, `${path}.dados.anterior`, 100);
        if (!Array.isArray(d.pragas) || !d.pragas.length) invalid(`${path}.dados.pragas`);
        for (const [index, pest] of d.pragas.entries()) string(pest, `${path}.dados.pragas.${index}`);
        break;
      case 'rank_varia_entre_modelos': {
        if (warning.cenario !== 'futuro') invalid(`${path}.cenario`);
        amount('rank_min', 1); amount('rank_max', d.rank_min); amount('limite');
        for (const key of ['rank_min', 'rank_max', 'limite']) {
          if (!Number.isInteger(d[key])) invalid(`${path}.dados.${key}`);
        }
        if (!object(d.por_modelo) || !Object.keys(d.por_modelo).length) invalid(`${path}.dados.por_modelo`);
        for (const [model, rank] of Object.entries(d.por_modelo)) {
          string(model, `${path}.dados.por_modelo`, 100);
          finite(rank, `${path}.dados.por_modelo.${model}`, d.rank_min, d.rank_max);
          if (!Number.isInteger(rank)) invalid(`${path}.dados.por_modelo.${model}`);
        }
        break;
      }
      case 'queda_no_futuro':
        if (warning.cenario !== 'futuro') invalid(`${path}.cenario`);
        amount('queda', 0, 1); amount('receita_hoje'); amount('receita_futuro'); break;
      case 'queda_no_ano_ruim':
        amount('queda', 0, 1); amount('receita_mediano'); amount('receita_ruim'); break;
      case 'repete_a_cultura': amount('fator_sequencia', 0, 1); break;
      case 'solo_exposto':
        amount('dias_expostos', 0, 365);
        if (!Number.isInteger(d.dias_expostos)) invalid(`${path}.dados.dias_expostos`);
        amount('chuva_exposta_mm'); break;
      case 'limiar_de_calor_pouco_confiavel': amount('temp_calor_c', -Infinity); break;
      case 'ky_padrao': amount('ky'); break;
      case 'valor_a_conferir':
        string(d.campo, `${path}.dados.campo`, 100); string(d.status, `${path}.dados.status`, 200);
        if (!Object.hasOwn(d, 'valor')) invalid(`${path}.dados.valor`);
        // Unknown field names and null values are valid in the extensible status contract.
        if (d.valor !== null && ['preco', 'temp_calor_c', 'produtividade', 'produtividade_safrinha', 'ky'].includes(d.campo)) {
          amount('valor', d.campo === 'temp_calor_c' ? -Infinity : 0);
        }
        break;
    }
  }
  return true;
}

function fieldLabel(field) {
  return Object.hasOwn(FIELDS, field) ? FIELDS[field] : `Additional field (${field})`;
}
function fieldValue(field, value) {
  if (value === null) return 'not provided';
  if (typeof value !== 'number') return readable(value);
  if (field === 'preco') return `${money(value)}/t`;
  if (field === 'temp_calor_c') return `${number(value)} °C`;
  if (['produtividade', 'produtividade_safrinha'].includes(field)) return `${number(value)} t/ha`;
  return number(value, 3);
}
function readable(value) {
  if (value === null) return 'not provided';
  if (typeof value === 'number') return number(value, 3);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.map(readable).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${fieldLabel(key)}: ${readable(entry)}`).join('; ');
  return 'Text value: English translation unavailable';
}

function pestLabel(value) {
  const names = { 'mosca-branca': 'whitefly', 'mofo-branco': 'white mold' };
  for (const [original, translated] of Object.entries(names)) {
    if (value === original || value.startsWith(`${original} (`)) return translated + value.slice(original.length);
  }
  return 'Additional pest or disease: English name unavailable';
}

function present(warning, cropLabel) {
  const d = warning.dados;
  const crop = warning.cultura === null ? null : cropLabel(warning.cultura);
  const scenario = warning.cenario === null ? null : SCENARIOS[warning.cenario];
  const context = [crop || 'Whole sequence', Object.hasOwn(SLOTS, d.slot) ? SLOTS[d.slot] : null, scenario,
    warning.codigo === 'fator_agua_diario' ? 'daily mode · median year' : null].filter(Boolean).join(' · ');
  const item = (title, description, evidence, card_summary) => ({ title, context, description, evidence, card_summary });
  switch (warning.codigo) {
    case 'fator_limitante': {
      const factor = FACTORS[d.fator];
      return item(`Limitation: ${factor}`,
        `This is the lowest of the temperature, rainfall, heat and water-supply factors for this crop. This warning uses the monthly assessment.`,
        `${factor} factor: ${number(d.valor * 100)} / 100.`,
        `${crop} · ${scenario}: ${factor} at ${number(d.valor * 100)} / 100.`);
    }
    case 'queda_no_futuro':
      return item('Lower revenue in the future', 'Estimated gross revenue for this sequence falls from today\'s climate to the future. Production costs are excluded from this comparison.',
        `Decline: ${percent(d.queda)}. Revenue today: ${money(d.receita_hoje)}/ha; future: ${money(d.receita_futuro)}/ha.`,
        `Future revenue is ${percent(d.queda)} lower.`);
    case 'queda_no_ano_ruim':
      return item('Lower revenue in a bad year', 'Daily-mode comparison between the median year and the bad year reported by the engine. This bad year is separate from the fixed dry-year scenario.',
        `Decline: ${percent(d.queda)}. Median year: ${money(d.receita_mediano)}/ha; bad year: ${money(d.receita_ruim)}/ha.`,
        `${scenario}: revenue is ${percent(d.queda)} lower in the bad year.`);
    case 'repete_a_cultura':
      return item('Repeated crop', 'This crop repeats the previous crop. The engine applies a provisional pest and disease penalty; local occurrence has not been measured.',
        `Applied sequence factor: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} · ${SLOTS[d.slot]}: repetition, factor ${number(d.fator_sequencia, 3)}×.`);
    case 'hospedeiro_comum':
      return item('Shared pest or disease with the previous crop',
        `This crop and ${cropLabel(d.anterior)} share pest or disease hosts considered by the engine. The penalty is provisional; it does not indicate a measured occurrence in the field. The sequence factor may also include a bonus after green manure.`,
        `Previous crop: ${cropLabel(d.anterior)}. Pests or diseases: ${d.pragas.map(pestLabel).join('; ')}. Shared-host factor: ${number(d.penalidade, 3)}×; applied sequence factor: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} after ${cropLabel(d.anterior)}: shared pest or disease; factor ${number(d.penalidade, 3)}×.`);
    case 'fator_agua_diario':
      return item('Water limitation in daily mode',
        'In the median year of daily mode, water shortage reduces yield by the reported factor. The calculation uses Ky, the crop\'s sensitivity to water shortage. This assessment is separate from the monthly water balance.',
        `Water-shortage factor: ${number(d.fator_agua * 100)} / 100. Water demand met: ${number(d.atendimento_hidrico * 100)} / 100. Ky: ${number(d.ky, 3)}.`,
        `${crop} · ${scenario}, daily mode: water-shortage factor ${number(d.fator_agua * 100)} / 100 in the median year.`);
    case 'rank_varia_entre_modelos':
      return item('Rank varies across climate models',
        'This sequence\'s future rank changes across climate models. The range compares the available models; it is neither a confidence interval nor a probability.',
        `Future rank: #${d.rank_min} to #${d.rank_max}. ${Object.entries(d.por_modelo).map(([model, rank]) => `${model}: #${rank}`).join('; ')}. Rank-spread threshold used for this warning: ${d.limite} positions.`,
        `Future ranks range from #${d.rank_min} to #${d.rank_max} across models.`);
    case 'solo_exposto':
      return item('Exposed soil', 'Days without a standing crop or mulch within the first 365 days. Rainfall refers to today\'s climate.',
        `${d.dias_expostos} exposed days; ${number(d.chuva_exposta_mm)} mm of rain on exposed soil.`,
        `${d.dias_expostos} exposed days, with ${number(d.chuva_exposta_mm)} mm of rain today.`);
    case 'sem_historico':
      return item('Planting history not provided', 'Without planting history, the first crop receives no repeated-crop or shared-host penalty, and no bonus after nitrogen-fixing green manure.',
        'No planting history was provided for this analysis.', 'No planting history: the previous crop\'s effect was not assessed.');
    case 'sem_limiar_de_calor':
      return item('Missing heat threshold', 'The engine does not apply a heat penalty to this crop. The absence of a penalty does not demonstrate heat tolerance.',
        'No heat threshold is provided in the crop table.', `${crop}: no heat threshold is available for assessment.`);
    case 'limiar_de_calor_pouco_confiavel':
      return item('Uncertain heat threshold', 'The engine flags lower confidence in hot-day counts above this threshold because POWER and NEX differ. The threshold needs local review.',
        `Threshold used: ${number(d.temp_calor_c)} °C.`, `${crop}: the ${number(d.temp_calor_c)} °C threshold is uncertain.`);
    case 'sem_valor_de_mercado':
      return item('Market value not included', 'Forage, seed and soil benefits are excluded from this crop\'s revenue. This does not mean the crop has no value for the farm.',
        `Price used: ${money(0)}/t.`, `${crop}: zero price in the revenue calculation.`);
    case 'ky_padrao':
      return item('No crop-specific water-response value', 'In daily mode, the engine uses a default Ky value (yield sensitivity to water shortage) because the FAO table has no crop-specific value.',
        `Ky used: ${number(d.ky, 3)}.`, `${crop}: default Ky of ${number(d.ky, 3)}.`);
    case 'valor_a_conferir': {
      const field = fieldLabel(d.campo);
      const status = Object.hasOwn(STATUSES, d.status) ? STATUSES[d.status] : 'untranslated source status';
      const value = fieldValue(d.campo, d.valor);
      return item(`${field} needs verification`, 'This value is marked for verification in the crop table. Check its source and suitability for local conditions.',
        `${field}: ${value}. Status: ${status}.`, `${crop}: ${field.toLowerCase()} ${value} needs verification (${status}).`);
    }
    default: {
      const title = warning.tipo === 'risco' ? 'Additional engine risk' : 'Additional data gap';
      return item(title, 'The engine reported this warning, but an English explanation is not yet available.',
        `Engine code: ${warning.codigo}.`, `${context}: ${title.toLowerCase()}; English explanation unavailable.`);
    }
  }
}

export function buildWarnings(seq, cropLabel) {
  if (!validateSequenceWarnings(seq, seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'])) return null;
  const risks = [], gaps = [];
  for (const warning of seq.avisos) (warning.tipo === 'risco' ? risks : gaps).push(present(warning, cropLabel));
  return {
    risks, gaps,
    summary: seq.avisos.length
      ? `${risks.length} ${risks.length === 1 ? 'flagged risk' : 'flagged risks'} and ${gaps.length} ${gaps.length === 1 ? 'data gap' : 'data gaps'}.`
      : 'The engine flagged no warnings for this sequence.',
    note: 'Warnings support local review and do not change strategy scores or order. No warnings does not guarantee freedom from risk or data gaps.',
  };
}
