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
    throw new Error('Escolha o ajuste de chuva entre −50% e +30% e de temperatura entre 0 e +4 °C.');
  }
  return { chuva_pct: value.chuva_pct, temp_c: value.temp_c };
}

export function validateOutputAdjustment(entrada) {
  if (!Object.hasOwn(entrada ?? {}, 'ajuste')) return { ...DEFAULT_ADJUSTMENT };
  try {
    if (entrada.ajuste === undefined) throw new Error();
    return validateAdjustment(entrada.ajuste);
  } catch {
    throw new Error('Resposta incompatível com o contrato do motor: entrada.ajuste.');
  }
}

export function assertAdjustmentApplied(raw, request) {
  const requested = validateAdjustment(request?.ajuste);
  const actual = validateOutputAdjustment(raw?.entrada);
  if (requested.chuva_pct !== actual.chuva_pct || requested.temp_c !== actual.temp_c) {
    throw new Error('O motor não confirmou o ajuste de cenário solicitado. Tente novamente; os resultados recebidos não foram exibidos.');
  }
}

export function adjustmentNote(ajuste) {
  if (!hasAdjustment(ajuste)) return '';
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const rain = ajuste.chuva_pct === 0 ? 'chuva sem alteração' : `${number(Math.abs(ajuste.chuva_pct))}% ${ajuste.chuva_pct < 0 ? 'menos' : 'mais'} chuva`;
  const heat = ajuste.temp_c === 0 ? 'temperatura sem alteração' : `temperatura +${number(ajuste.temp_c)} °C`;
  return `Cenário “e se”: ${rain}; ${heat}. É uma simulação, não uma previsão. O mesmo ajuste vale para todos os meses e cenários exibidos, incluindo o ano seco quando disponível.${ajuste.temp_c > 0 ? ' Os dias quentes são estimados por interpolação ou extrapolação dos limiares disponíveis.' : ''}`;
}
