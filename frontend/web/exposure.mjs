const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The engine uses a fixed 365-day calendar, including February with 28 days.
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const RAIN_TOLERANCE = 0.01;
const number = (value) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const invalid = (path) => { throw new Error(`Response does not match the engine contract: descoberto.${path}.`); };
const hasOwn = (value, key) => value != null && Object.hasOwn(value, key);
function finite(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(path);
}
function integer(value, path, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) invalid(path);
}
function validateAmounts(value, path, maxDays, minDays = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  integer(value.dias, `${path}.dias`, minDays, maxDays);
  integer(value.dias_expostos, `${path}.dias_expostos`, 0, value.dias);
  for (const key of ['chuva_mm', 'chuva_exposta_mm']) finite(value[key], `${path}.${key}`);
  if (value.chuva_exposta_mm > value.chuva_mm ||
    (value.dias === 0 && value.chuva_mm !== 0) ||
    (value.dias_expostos === 0 && value.chuva_exposta_mm !== 0)) invalid(`${path}.chuva/dias`);
}

export function validateSequenceExposure(seq, scenarios, firstMonth) {
  integer(firstMonth, 'mes_inicial', 1, 12);
  const presence = scenarios.map((key) => hasOwn(seq[key], 'descoberto'));
  if (!presence.some(Boolean)) return false; // Legacy response: absent is not zero exposure.
  if (!presence.every(Boolean)) invalid('incomplete scenarios');
  const blocks = scenarios.map((key) => seq[key].descoberto);
  for (const [i, block] of blocks.entries()) {
    const path = scenarios[i];
    validateAmounts(block, path, 365);
    if (!Array.isArray(block.meses) || block.meses.length > 12) invalid(`${path}.meses`);
    let previous = -1;
    for (const month of block.meses) {
      integer(month?.mes, `${path}.meses.mes`, 1, 12);
      const offset = (month.mes - firstMonth + 12) % 12;
      if (offset <= previous) invalid(`${path}.meses: order or duplicate`);
      previous = offset;
      validateAmounts(month, `${path}.meses`, MONTH_DAYS[month.mes - 1], 1);
    }
    for (const key of ['dias', 'dias_expostos', 'chuva_mm', 'chuva_exposta_mm']) {
      const sum = block.meses.reduce((total, month) => total + month[key], 0);
      const tolerance = key.startsWith('chuva') ? RAIN_TOLERANCE : 0;
      if (Math.abs(block[key] - sum) > tolerance + 1e-9) invalid(`${path}.${key}: monthly sum`);
    }
    if (hasOwn(block, 'indice_erosao')) finite(block.indice_erosao, `${path}.indice_erosao`);
  }
  const baseline = blocks[0];
  for (const other of blocks.slice(1)) {
    if (other.dias !== baseline.dias || other.dias_expostos !== baseline.dias_expostos ||
      other.meses.length !== baseline.meses.length || other.meses.some((month, i) => {
        const base = baseline.meses[i];
        return month.mes !== base.mes || month.dias !== base.dias || month.dias_expostos !== base.dias_expostos;
      })) invalid('different days across scenarios');
    if (hasOwn(other, 'indice_erosao') !== hasOwn(baseline, 'indice_erosao')) invalid('incomplete erosion index');
  }
  return true;
}

export function buildExposure(seq, firstMonth) {
  const scenarios = seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
  if (!validateSequenceExposure(seq, scenarios, firstMonth)) return null;
  const blocks = scenarios.map((key) => seq[key].descoberto);
  const today = blocks[0];
  const order = seq.seco ? 'today / future / dry year' : 'today / future';
  const compare = (key) => blocks.map((block) => number(block[key])).join(' / ');
  const monthLabel = (absolute) => `${MONTHS[absolute % 12]} · year ${Math.floor(absolute / 12) + 1}`;
  const hasErosion = hasOwn(today, 'indice_erosao');
  return {
    period: `First 365 days: ${monthLabel(firstMonth - 1)} → ${monthLabel(firstMonth + 10)}.`,
    caption: `Rainfall: ${order}, in millimeters. Days are the same in every scenario. This window covers only the first 12 months of the plan, even when the crop calendar continues.`,
    note: 'Without a standing crop: days including the wait, harvest and period after the final crop. Exposed: the share of those days without crop residue. The engine assumes residue lasts until the next planting; without crop history, the initial wait counts as exposed. Bars show proportions of days per month, not the exact dates of each interval.',
    erosion_note: hasErosion
      ? 'The erosion exposure index compares sequences in the same field. It combines rainfall on exposed soil with slope; it does not represent soil loss in t/ha and does not change the score or ranking.'
      : 'The erosion exposure index is unavailable in this analysis. It requires the field slope; days and rainfall on exposed soil are still available.',
    card_facts: [
      { label: 'Exposed days · 365 days', value: `${today.dias_expostos} days` },
      { label: 'Rainfall on exposed soil · today', value: `${number(today.chuva_exposta_mm)} mm` },
    ],
    facts: [
      { label: 'Days without a standing crop · 365 days', value: `${today.dias} days` },
      { label: 'Exposed days · 365 days', value: `${today.dias_expostos} days` },
      { label: `Rainfall without a standing crop · ${order}`, value: `${compare('chuva_mm')} mm` },
      { label: `Rainfall on exposed soil · ${order}`, value: `${compare('chuva_exposta_mm')} mm` },
      ...(hasErosion ? [{ label: `Erosion exposure index · ${order}`, value: compare('indice_erosao') }] : []),
    ],
    months: Array.from({ length: 12 }, (_, offset) => {
      const absolute = firstMonth - 1 + offset;
      const month = absolute % 12 + 1;
      const values = blocks.map((block) => block.meses.find((row) => row.mes === month));
      return {
        label: monthLabel(absolute), month_days: MONTH_DAYS[month - 1],
        days: values[0]?.dias ?? 0, exposed_days: values[0]?.dias_expostos ?? 0,
        rain: values.map((row) => number(row?.chuva_mm ?? 0)).join(' / '),
        exposed_rain: values.map((row) => number(row?.chuva_exposta_mm ?? 0)).join(' / '),
      };
    }),
  };
}
