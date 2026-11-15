// Optional transport contract; the engine owns the soil-water calculation.
import { englishSourceNotice } from './external-text.mjs';
export const SOIL_TEXTURES = ['arenoso', 'medio', 'argiloso'];
const labels = { arenoso: 'Sandy', medio: 'Medium-textured', argiloso: 'Clay' };
export const supportsSoil = metadata => metadata?.capabilities?.solo_textura === true;
export function validateSoilTexture(value) {
  if (value === undefined || value === null) return undefined;
  if (!SOIL_TEXTURES.includes(value)) throw new Error('Choose a valid soil texture.');
  return value;
}
export function validateOutputSoil(raw) {
  const input = raw?.entrada;
  if (!input || (!Object.hasOwn(input, 'solo_textura') && !Object.hasOwn(input, 'cad_mm'))) return;
  if (!SOIL_TEXTURES.includes(input.solo_textura) || !Number.isFinite(input.cad_mm) || input.cad_mm <= 0) {
    throw new Error('Response does not match the engine contract: entrada.solo_textura/cad_mm.');
  }
}
export function assertSoilApplied(raw, request) {
  validateOutputSoil(raw);
  if (raw?.entrada?.solo_textura !== request.solo_textura) {
    throw new Error('The server did not confirm the selected soil texture. Analyze again before comparing results.');
  }
}
export function soilNote(raw) {
  validateOutputSoil(raw);
  const { solo_textura: texture, cad_mm: capacity } = raw.entrada;
  return texture
    ? `${labels[texture]} soil: ${capacity.toLocaleString('en-US')} mm of water storage used in this analysis. This is a calculation reference, not a field measurement.`
    : 'Soil texture not specified: this analysis uses the 60 mm reference storage. This is not a field measurement.';
}
// Point metadata is available only when the API announces the soil capability.
// lat/lon identify the requested point, not the center of a regional grid cell.
export async function requestSoilSuggestion(baseUrl, point, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/metadata?${new URLSearchParams(point)}`, { signal });
  if (!response.ok) throw new Error('The soil suggestion could not be retrieved. You can select a texture.');
  const body = await response.json(), soil = body?.solo;
  if (soil == null) return null;
  if (typeof soil !== 'object' || Array.isArray(soil) || soil.lat !== point.lat || soil.lon !== point.lon ||
      !((soil.textura_sugerida === null && soil.fonte === null) ||
        (typeof soil.fonte === 'string' && soil.fonte.trim() && soil.fonte.length <= 2000)) ||
      (soil.textura_sugerida !== null && !SOIL_TEXTURES.includes(soil.textura_sugerida))) {
    throw new Error('The soil suggestion does not match the requested point. You can select a texture.');
  }
  return { ...soil, fonte: soil.fonte === null ? null : englishSourceNotice(soil.fonte) };
}
