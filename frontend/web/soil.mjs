// Optional transport contract; the engine owns the soil-water calculation.
export const SOIL_TEXTURES = ['arenoso', 'medio', 'argiloso'];
const labels = { arenoso: 'Arenoso', medio: 'Médio', argiloso: 'Argiloso' };
export const supportsSoil = metadata => metadata?.capabilities?.solo_textura === true;
export function validateSoilTexture(value) {
  if (value === undefined || value === null) return undefined;
  if (!SOIL_TEXTURES.includes(value)) throw new Error('Escolha uma textura de solo válida.');
  return value;
}
export function validateOutputSoil(raw) {
  const input = raw?.entrada;
  if (!input || (!Object.hasOwn(input, 'solo_textura') && !Object.hasOwn(input, 'cad_mm'))) return;
  if (!SOIL_TEXTURES.includes(input.solo_textura) || !Number.isFinite(input.cad_mm) || input.cad_mm <= 0) {
    throw new Error('Resposta incompatível com o contrato do motor: entrada.solo_textura/cad_mm.');
  }
}
export function assertSoilApplied(raw, request) {
  validateOutputSoil(raw);
  if (raw?.entrada?.solo_textura !== request.solo_textura) {
    throw new Error('O servidor não confirmou a textura de solo escolhida. Analise novamente antes de comparar os resultados.');
  }
}
export function soilNote(raw) {
  validateOutputSoil(raw);
  const { solo_textura: texture, cad_mm: capacity } = raw.entrada;
  return texture
    ? `Solo ${labels[texture].toLowerCase()}: reserva de água de ${capacity.toLocaleString('pt-BR')} mm usada nesta análise. É uma referência do cálculo, não uma medição do talhão.`
    : 'Textura não informada: esta análise usa a reserva de referência de 60 mm. Não é uma medição do talhão.';
}
// Proposed metadata extension, pending API integration. Only used with the capability.
// lat/lon identify the requested point, not the center of a regional grid cell.
export async function requestSoilSuggestion(baseUrl, point, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/metadata?${new URLSearchParams(point)}`, { signal });
  if (!response.ok) throw new Error('A sugestão de solo não pôde ser consultada. Você pode informar a textura.');
  const body = await response.json(), soil = body?.solo;
  if (soil == null) return null;
  if (typeof soil !== 'object' || Array.isArray(soil) || soil.lat !== point.lat || soil.lon !== point.lon ||
      typeof soil.fonte !== 'string' || !soil.fonte.trim() || soil.fonte.length > 2000 ||
      (soil.textura_sugerida !== null && !SOIL_TEXTURES.includes(soil.textura_sugerida))) {
    throw new Error('A sugestão de solo não corresponde ao ponto consultado. Você pode informar a textura.');
  }
  return soil;
}
