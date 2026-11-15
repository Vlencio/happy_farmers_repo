import { normalizeFarm } from './geometry.mjs';
import { MONTHS } from './api.mjs';

const fmt = (value, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const fail = () => { throw new Error('Os dados de contexto do talhão estão incompletos ou inválidos.'); };
const finite = (value, min = -Infinity, max = Infinity) => {
  if (!Number.isFinite(value) || value < min || value > max) fail();
};

// Compare the actual boundary, not a name, source tag, center or approximate area.
// Ignore only ring orientation/start vertex, polygon ordering and altitude.
function boundaryKey(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const ringKey = (ring) => {
    const points = ring.slice(0, -1).map((point) => JSON.stringify(point.slice(0, 2)));
    const rotate = (values) => {
      const start = values.reduce((best, value, i) => value < values[best] ? i : best, 0);
      return [...values.slice(start), ...values.slice(0, start)].join(';');
    };
    return [rotate(points), rotate([...points].reverse())].sort()[0];
  };
  return polygons.map(([outer, ...holes]) => `${ringKey(outer)}|${holes.map(ringKey).sort().join('|')}`).sort().join('||');
}
export function matchesDemoBoundary(farm, reference) {
  if (!farm?.geojson || !reference) return false;
  try {
    return boundaryKey(normalizeFarm(farm.geojson).geojson.geometry) === boundaryKey(normalizeFarm(reference).geojson.geometry);
  } catch { return false; }
}

export function getAnalysisSlope(farm, metadata) {
  // Proposed API capability: omit the field until the server explicitly accepts it.
  if (metadata?.capabilities?.declividade_pct !== true) return null;
  const field = metadata.demo_field;
  if (!field || !matchesDemoBoundary(farm, field.boundary)) return null;
  const slope = field.terrain?.decl_media_pct;
  finite(slope, 0, 100);
  return slope;
}

export function modelSpreadText(spread) {
  if (spread == null) return 'A faixa entre modelos ainda não foi disponibilizada pela equipe de dados.';
  if (spread.scope !== 'talhao_demo_2' || !Array.isArray(spread.models) || !spread.models.length) fail();
  for (const model of spread.models) {
    if (typeof model.model !== 'string' || !model.model.trim()) fail();
    finite(model.rain_delta_mm); finite(model.tmax_delta_c);
  }
  const rain = spread.models.map((m) => m.rain_delta_mm);
  const temp = spread.models.map((m) => m.tmax_delta_c);
  const signed = (v) => `${v > 0 ? '+' : ''}${fmt(v)}`;
  return `${spread.models.length} modelos: mudança na temperatura máxima média de ${signed(Math.min(...temp))} a ${signed(Math.max(...temp))} °C; chuva anual de ${signed(Math.min(...rain))} a ${signed(Math.max(...rain))} mm. ${Math.min(...rain) < 0 && Math.max(...rain) > 0 ? 'Na chuva, os modelos discordam do sinal da mudança. ' : ''}Faixa entre modelos, não intervalo de confiança. Futuro menos histórico.`;
}

export function buildFieldContext(farm, metadata) {
  const field = metadata?.demo_field;
  if (!field || !matchesDemoBoundary(farm, field.boundary)) return null;
  if (!Array.isArray(field.ndvi) || field.ndvi.length !== 12 || new Set(field.ndvi.map((m) => m.mes)).size !== 12) fail();
  const months = [...field.ndvi].sort((a, b) => a.mes - b.mes).map((month) => {
    if (!Number.isInteger(month.mes)) fail();
    finite(month.mes, 1, 12); finite(month.ndvi_medio, -1, 1); finite(month.freq_solo, 0, 1);
    return { label: MONTHS[month.mes - 1], value: fmt(month.ndvi_medio, 2), height: Math.max(0, month.ndvi_medio),
      frequency: `${fmt(month.freq_solo * 100)}%` };
  });
  const terrain = field.terrain;
  for (const key of ['decl_media_pct', 'decl_p90_pct', 'decl_max_pct']) finite(terrain?.[key], 0);
  const station = field.station;
  if (typeof station?.name !== 'string' || !Array.isArray(station.corrections) || station.corrections.length !== 12) fail();
  finite(station.distance_km, 0);
  for (const row of station.corrections) { finite(row.off_tmin); finite(row.off_tmax); }
  const corrections = station.corrections.map((row) => row.off_tmin);
  const august = months[7].frequency, september = months[8].frequency, october = months[9].frequency;
  return {
    summary: 'Observações do talhão de demonstração. Estes dados pertencem a este contorno, independentemente da sequência escolhida.',
    coverage: `Indício de solo descoberto ou palhada: agosto ${august}, setembro ${september} e outubro ${october} dos anos observados. Critério: NDVI abaixo de 0,35; não é uma medição direta da cobertura do solo.`,
    terrain: `Declividade média de ${fmt(terrain.decl_media_pct, 2)}%; 90% da área abaixo de ${fmt(terrain.decl_p90_pct, 2)}%; máxima de ${fmt(terrain.decl_max_pct, 2)}%. Relevo suave na média, sem atribuir risco de erosão a uma cultura.`,
    station: `${station.name}, a cerca de ${fmt(station.distance_km)} km. Correção mensal da mínima: ${fmt(Math.min(...corrections))} a ${fmt(Math.max(...corrections))} °C em relação ao POWER. Temperaturas e dias quentes usam a correção; ET0 e chuva não. Chuva: viés aproximado de −5% e correlação de 0,90 com a estação.`,
    source: field.sources,
    model_spread: modelSpreadText(metadata.model_spread), months,
  };
}
