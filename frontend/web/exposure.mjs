const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// The engine uses a fixed 365-day calendar, including February with 28 days.
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const RAIN_TOLERANCE = 0.01;
const number = (value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const invalid = (path) => { throw new Error(`Resposta incompatível com o contrato do motor: descoberto.${path}.`); };
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
  if (!presence.every(Boolean)) invalid('cenários incompletos');
  const blocks = scenarios.map((key) => seq[key].descoberto);
  for (const [i, block] of blocks.entries()) {
    const path = scenarios[i];
    validateAmounts(block, path, 365);
    if (!Array.isArray(block.meses) || block.meses.length > 12) invalid(`${path}.meses`);
    let previous = -1;
    for (const month of block.meses) {
      integer(month?.mes, `${path}.meses.mes`, 1, 12);
      const offset = (month.mes - firstMonth + 12) % 12;
      if (offset <= previous) invalid(`${path}.meses: ordem ou repetição`);
      previous = offset;
      validateAmounts(month, `${path}.meses`, MONTH_DAYS[month.mes - 1], 1);
    }
    for (const key of ['dias', 'dias_expostos', 'chuva_mm', 'chuva_exposta_mm']) {
      const sum = block.meses.reduce((total, month) => total + month[key], 0);
      const tolerance = key.startsWith('chuva') ? RAIN_TOLERANCE : 0;
      if (Math.abs(block[key] - sum) > tolerance + 1e-9) invalid(`${path}.${key}: soma mensal`);
    }
    if (hasOwn(block, 'indice_erosao')) finite(block.indice_erosao, `${path}.indice_erosao`);
  }
  const baseline = blocks[0];
  for (const other of blocks.slice(1)) {
    if (other.dias !== baseline.dias || other.dias_expostos !== baseline.dias_expostos ||
      other.meses.length !== baseline.meses.length || other.meses.some((month, i) => {
        const base = baseline.meses[i];
        return month.mes !== base.mes || month.dias !== base.dias || month.dias_expostos !== base.dias_expostos;
      })) invalid('dias diferentes entre cenários');
    if (hasOwn(other, 'indice_erosao') !== hasOwn(baseline, 'indice_erosao')) invalid('índice de erosão incompleto');
  }
  return true;
}

export function buildExposure(seq, firstMonth) {
  const scenarios = seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
  if (!validateSequenceExposure(seq, scenarios, firstMonth)) return null;
  const blocks = scenarios.map((key) => seq[key].descoberto);
  const today = blocks[0];
  const order = seq.seco ? 'hoje / futuro / ano seco' : 'hoje / futuro';
  const compare = (key) => blocks.map((block) => number(block[key])).join(' / ');
  const monthLabel = (absolute) => `${MONTHS[absolute % 12]} · ano ${Math.floor(absolute / 12) + 1}`;
  const hasErosion = hasOwn(today, 'indice_erosao');
  return {
    period: `Primeiros 365 dias: ${monthLabel(firstMonth - 1)} → ${monthLabel(firstMonth + 10)}.`,
    caption: `Chuva: ${order}, em milímetros. Os dias são os mesmos em todos os cenários. Esta janela cobre somente os primeiros 12 meses do planejamento, mesmo quando o calendário das culturas continua.`,
    note: 'Sem cultura: dias sem plantas em pé, incluindo espera, colheita e o período após a última cultura. Exposto: a parte desses dias sem palhada. O motor supõe que a palhada dura até o próximo plantio; sem histórico, a espera inicial conta como exposta. As barras mostram proporções de dias no mês, não as datas exatas dos intervalos.',
    erosion_note: hasErosion
      ? 'O índice de exposição à erosão permite comparar sequências no mesmo talhão. Combina chuva em solo exposto e declividade; não representa perda de solo em t/ha e não altera o score nem o ranking.'
      : 'Índice de exposição à erosão indisponível nesta análise. É necessário considerar a declividade do talhão; os dias e a chuva em solo exposto continuam disponíveis.',
    card_facts: [
      { label: 'Dias expostos · 365 dias', value: `${today.dias_expostos} dias` },
      { label: 'Chuva em solo exposto · hoje', value: `${number(today.chuva_exposta_mm)} mm` },
    ],
    facts: [
      { label: 'Dias sem cultura · 365 dias', value: `${today.dias} dias` },
      { label: 'Dias expostos · 365 dias', value: `${today.dias_expostos} dias` },
      { label: `Chuva sem cultura · ${order}`, value: `${compare('chuva_mm')} mm` },
      { label: `Chuva em solo exposto · ${order}`, value: `${compare('chuva_exposta_mm')} mm` },
      ...(hasErosion ? [{ label: `Índice de exposição à erosão · ${order}`, value: compare('indice_erosao') }] : []),
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
