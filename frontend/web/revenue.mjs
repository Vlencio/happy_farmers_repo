// Presentation only. A zero price is possible for commercial crops too; neither
// zero revenue, nitrogen fixation nor residue alone proves a green-manure role.
// These IDs are the dedicated non-harvest crops in the current crop contract.
const COVER_CROPS = new Set(['crotalaria', 'milheto', 'braquiaria']);
const scenarios = seq => ['hoje', 'futuro', 'seco'].filter(key => seq[key]);
const marketExcluded = (seq, id) => seq.avisos?.some(item => item.codigo === 'sem_valor_de_mercado' && item.cultura === id) === true;
const empty = () => ({ kind: '', title: '', note: '' });

export function cropRevenueContext(seq, id, label) {
  const crops = scenarios(seq).flatMap(key => seq[key].culturas.filter(crop => crop.cultura === id));
  if (!crops.length || !crops.some(crop => crop.receita_ha === 0)) return empty();
  const allZero = crops.every(crop => crop.receita_ha === 0);
  const soilRole = COVER_CROPS.has(id) && marketExcluded(seq, id) && allZero
    && crops.every(crop => crop.cobre_solo === true && (id !== 'crotalaria' || crop.fixa_n === true));
  if (soilRole) {
    const greenManure = id === 'crotalaria';
    return {
      kind: 'soil',
      title: greenManure ? 'Green manure & soil cover' : 'Soil cover & residue',
      note: `${label} is modeled for ${greenManure ? 'soil cover and nitrogen fixation' : 'soil cover and crop residue'}. This analysis does not include sales revenue from this crop. Its soil contribution is reflected in the soil score, without assigning a monetary value to those benefits.`,
    };
  }
  if (marketExcluded(seq, id) && allZero) return {
    kind: 'market', title: 'Market revenue not included',
    note: `${label} has no sales revenue included because of the price used in this analysis. Check the price data; this does not establish that it is a cover crop or has no value on the farm.`,
  };
  return {
    kind: 'zero', title: 'No revenue estimated',
    note: `${label} has no gross revenue estimated in ${allZero ? 'the displayed scenarios' : 'one or more scenarios'}. Review the climate risks and price data. A zero estimate alone does not identify a soil-building crop.`,
  };
}

export function isSoilOnlyPlan(seq) {
  return seq.culturas.every(id => cropRevenueContext(seq, id, id).kind === 'soil')
    && scenarios(seq).every(key => seq[key].receita_ha === 0
      && (seq[key].receita_ano_ha === undefined || seq[key].receita_ano_ha === 0))
    && (!seq.modelos || (seq.modelos.receita_ano_ha_min === 0 && seq.modelos.receita_ano_ha_max === 0));
}

export function soilPlanRole(seq) {
  return seq.culturas.includes('crotalaria') ? 'Green manure & soil cover' : 'Soil cover & residue';
}

export function sequenceRevenueNote(seq, cropLabel) {
  const notes = [...new Set(seq.culturas)].map(id => cropRevenueContext(seq, id, cropLabel(id))).filter(item => item.note);
  // Do not silently reinterpret a sequence-level zero when its crop-level data
  // does not explain it (including older or internally inconsistent responses).
  const unexplained = !notes.length && scenarios(seq).some(key => seq[key].receita_ha === 0 || seq[key].receita_ano_ha === 0);
  return notes.map(item => item.note).join(' ') || (unexplained
    ? 'No gross revenue is estimated in one or more scenarios. Review the climate risks and price data; a zero estimate alone does not identify a soil-building crop.' : '');
}

const brl = (amount, digits = 0) => amount.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: digits });

export function revenueAmount(value, zeroLabel = 'No revenue estimated') {
  if (value === 0) return zeroLabel;
  // Small positive values must not round to an apparent zero or become a soil note.
  return value > 0 && value < .01 ? `< ${brl(.01, 2)}` : brl(value, value < 1 ? 2 : 0);
}

// Min-max range: the zero label only when both ends are zero; otherwise a zero end is an amount (BRL 0).
export function revenueRange(seq, min, max) {
  if (min === 0 && max === 0) return sequenceRevenueAmount(seq, 0);
  return `${revenueAmount(min, brl(0))} to ${revenueAmount(max, brl(0))}`;
}

export function sequenceRevenueAmount(seq, value) {
  const excluded = seq.culturas.every(id => marketExcluded(seq, id));
  return revenueAmount(value, excluded ? 'Market revenue not included' : 'No revenue estimated');
}
