const number = (value, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const money = (value) => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
const SCENARIOS = { hoje: 'today\'s climate', futuro: 'future climate', seco: 'dry year' };
const SLOTS = { safra: 'Main season', safrinha: 'Second season' };
const CODES = ['fixa_nitrogenio', 'bonus_apos_fixadora', 'deixa_palhada', 'pouco_solo_exposto', 'estavel_no_futuro', 'clima_favoravel'];
const invalid = (path) => { throw new Error(`Response does not match the engine contract: beneficios.${path}.`); };
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

// Validate supplied benefits; deciding whether a sequence earns one stays in the engine.
export function validateSequenceBenefits(seq, scenarios) {
  if (!Object.hasOwn(seq, 'beneficios')) return false;
  if (!Array.isArray(seq.beneficios) || seq.beneficios.length > 2000) invalid('lista');
  for (const [i, benefit] of seq.beneficios.entries()) {
    const path = String(i);
    if (!object(benefit)) invalid(path);
    string(benefit.codigo, `${path}.codigo`, 100);
    string(benefit.texto, `${path}.texto`);
    if (benefit.cultura !== null && !seq.culturas.includes(benefit.cultura)) invalid(`${path}.cultura`);
    if (benefit.cenario !== null && !scenarios.includes(benefit.cenario)) invalid(`${path}.cenario`);
    if (!object(benefit.dados)) invalid(`${path}.dados`);
    jsonData(benefit.dados, `${path}.dados`);
    if (!CODES.includes(benefit.codigo)) continue;
    const cropRequired = ['fixa_nitrogenio', 'bonus_apos_fixadora', 'deixa_palhada'].includes(benefit.codigo);
    if (cropRequired !== (benefit.cultura !== null)) invalid(`${path}.cultura`);
    if (benefit.cenario !== (benefit.codigo === 'estavel_no_futuro' ? 'futuro' : null)) invalid(`${path}.cenario`);
    const d = benefit.dados;
    const amount = (key, min = 0, max = Infinity) => finite(d[key], `${path}.dados.${key}`, min, max);
    switch (benefit.codigo) {
      case 'bonus_apos_fixadora':
        if (!['safra', 'safrinha'].includes(d.slot)) invalid(`${path}.dados.slot`);
        amount('fator_sequencia');
        if (Object.hasOwn(d, 'dias_apos_anterior')) {
          amount('dias_apos_anterior');
          if (!Number.isInteger(d.dias_apos_anterior)) invalid(`${path}.dados.dias_apos_anterior`);
        }
        break;
      case 'pouco_solo_exposto':
        amount('dias_expostos', 0, 365);
        if (!Number.isInteger(d.dias_expostos)) invalid(`${path}.dados.dias_expostos`);
        amount('chuva_exposta_mm'); break;
      case 'estavel_no_futuro':
        amount('queda', -Infinity, 1); amount('receita_hoje'); amount('receita_futuro'); break;
      case 'clima_favoravel': amount('menor_fator', 0, 1); break;
    }
  }
  return true;
}

function present(benefit, cropLabel) {
  const d = benefit.dados;
  const crop = benefit.cultura === null ? null : cropLabel(benefit.cultura);
  const scenario = benefit.codigo === 'clima_favoravel' ? 'today\'s and future climate'
    : benefit.cenario === null ? null : SCENARIOS[benefit.cenario];
  const context = [crop || 'Whole sequence', Object.hasOwn(SLOTS, d.slot) ? SLOTS[d.slot] : null, scenario].filter(Boolean).join(' · ');
  const item = (title, description, evidence, card_summary) => ({ title, context, description, evidence, card_summary });
  switch (benefit.codigo) {
    case 'fixa_nitrogenio':
      return item('Nitrogen fixation', 'The crop table classifies this crop as a nitrogen fixer. The engine uses this attribute in the soil index; it is not a field measurement.',
        'Nitrogen fixation: yes, according to the crop table.', `${crop}: nitrogen fixer in the engine\'s crop table.`);
    case 'bonus_apos_fixadora':
      return item('Bonus after green manure',
        'This non-fixing crop receives a bonus after nitrogen-fixing green manure. The current rule requires planting within 60 days of the previous cycle ending; the time limit and bonus are provisional. The applied factor may also include a shared pest or disease host penalty.',
        `${d.dias_apos_anterior === undefined ? 'The interval between crops is not provided in this response.' : `Planted ${d.dias_apos_anterior} days after the previous cycle ended.`} Applied sequence factor: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} · ${SLOTS[d.slot]}: after green manure, factor ${number(d.fator_sequencia, 3)}×.`);
    case 'deixa_palhada':
      return item('Mulch cover', 'According to the crop table, this crop leaves mulch. The engine assumes it covers the soil from the end of the cycle until the next planting, without measuring its amount or persistence in the field.',
        'Soil cover: yes, according to the crop table.', `${crop}: mulch is assumed to last until the next planting.`);
    case 'pouco_solo_exposto':
      return item('Limited exposed soil', 'The engine flags a short period without a crop or mulch in the first 365 days. Rainfall refers to today\'s climate.',
        `${d.dias_expostos} exposed days; ${number(d.chuva_exposta_mm)} mm of rain on exposed soil.`, `${d.dias_expostos} exposed days in the first 365 days.`);
    case 'estavel_no_futuro': {
      const change = d.queda === 0 ? 'no change' : `${d.queda < 0 ? 'increase' : 'decline'} of ${number(Math.abs(d.queda) * 100)}%`;
      return item('Stable future revenue', 'The engine classifies gross revenue as stable or increasing from today to the future. This is not a forecast of selling prices or profit.',
        `Reported change: ${change}. Revenue today: ${money(d.receita_hoje)}/ha; future: ${money(d.receita_futuro)}/ha.`, `Future revenue: ${change}.`);
    }
    case 'clima_favoravel':
      return item('Favorable factors today and in the future', 'Temperature, rainfall, heat and water-supply factors are favorable in the monthly assessment of today\'s and future climate. This benefit excludes the dry year and does not demonstrate resilience to extreme events.',
        `Lowest factor across crops, today and in the future: ${number(d.menor_fator * 100)} / 100.`, `Today and future: lowest climate or water factor at ${number(d.menor_fator * 100)} / 100.`);
    default: {
      return item('Additional engine benefit', 'The engine reported this benefit, but an English explanation is not yet available.',
        `Engine code: ${benefit.codigo}.`, `${context}: additional engine benefit; English explanation unavailable.`);
    }
  }
}

export function buildBenefits(seq, cropLabel) {
  if (!validateSequenceBenefits(seq, seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'])) return null;
  return {
    items: seq.beneficios.map(benefit => present(benefit, cropLabel)),
    summary: seq.beneficios.length
      ? `${seq.beneficios.length} ${seq.beneficios.length === 1 ? 'benefit flagged' : 'benefits flagged'} by the engine.`
      : 'The engine flagged no benefits for this sequence.',
    note: 'Benefits describe the attributes and calculations used by the engine; they do not establish a field outcome. Also consider this strategy\'s risks and data gaps.',
  };
}
