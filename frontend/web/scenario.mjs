// Only the engine changes climate, scores and calendars. This module validates
// the requested what-if and labels the values returned by the engine.
export const DEFAULT_ADJUSTMENT = { chuva_pct: 0, temp_c: 0 };
export const supportsAdjustment = metadata => metadata?.capabilities?.ajuste === true;
export const hasAdjustment = value => value.chuva_pct !== 0 || value.temp_c !== 0;

export function validateAdjustment(value = DEFAULT_ADJUSTMENT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['chuva_pct', 'temp_c'].includes(key))
    || typeof value.chuva_pct !== 'number' || !Number.isFinite(value.chuva_pct) || value.chuva_pct < -50 || value.chuva_pct > 30
    || typeof value.temp_c !== 'number' || !Number.isFinite(value.temp_c) || value.temp_c < 0 || value.temp_c > 4) {
    throw new Error('Choose a rainfall adjustment between −50% and +30% and a temperature adjustment between 0 and +4 °C.');
  }
  return { chuva_pct: value.chuva_pct, temp_c: value.temp_c };
}

export function validateOutputAdjustment(entrada) {
  if (!Object.hasOwn(entrada ?? {}, 'ajuste')) return { ...DEFAULT_ADJUSTMENT };
  try {
    if (entrada.ajuste === undefined) throw new Error();
    return validateAdjustment(entrada.ajuste);
  } catch {
    throw new Error('Response does not match the engine contract: entrada.ajuste.');
  }
}

export function assertAdjustmentApplied(raw, request) {
  const requested = validateAdjustment(request?.ajuste);
  const actual = validateOutputAdjustment(raw?.entrada);
  if (requested.chuva_pct !== actual.chuva_pct || requested.temp_c !== actual.temp_c) {
    throw new Error('The engine did not confirm the requested scenario adjustment. Try again; the returned results were not displayed.');
  }
}

export function adjustmentNote(ajuste) {
  if (!hasAdjustment(ajuste)) return '';
  const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const rain = ajuste.chuva_pct === 0 ? 'rainfall unchanged' : `${number(Math.abs(ajuste.chuva_pct))}% ${ajuste.chuva_pct < 0 ? 'less' : 'more'} rainfall`;
  const heat = ajuste.temp_c === 0 ? 'temperature unchanged' : `temperature +${number(ajuste.temp_c)} °C`;
  return `What-if scenario: ${rain}; ${heat}. This is a simulation, not a forecast. The same adjustment applies to all displayed months and scenarios, including the dry year when available.${ajuste.temp_c > 0 ? ' Hot-day counts use the available thresholds; intermediate values are estimated by interpolation. Extrapolation is only used outside the range of those data.' : ''}`;
}
