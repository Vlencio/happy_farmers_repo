import { normalizeFarm } from './geometry.mjs';
import { MONTHS } from './api.mjs';
import { englishSourceNotice } from './external-text.mjs';

const fmt = (value, digits = 1) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const fail = () => { throw new Error('Field context data is incomplete or invalid.'); };
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
  if (spread == null) return 'The data team has not provided a range across climate models yet.';
  if (spread.scope !== 'talhao_demo_2' || !Array.isArray(spread.models) || !spread.models.length) fail();
  for (const model of spread.models) {
    if (typeof model.model !== 'string' || !model.model.trim()) fail();
    finite(model.rain_delta_mm); finite(model.tmax_delta_c);
  }
  const rain = spread.models.map((m) => m.rain_delta_mm);
  const temp = spread.models.map((m) => m.tmax_delta_c);
  const signed = (v, digits = 1) => `${v > 0 ? '+' : ''}${fmt(v, digits)}`;
  return `${spread.models.length} models: change in mean maximum temperature from ${signed(Math.min(...temp), 2)} to ${signed(Math.max(...temp), 2)} °C; annual rainfall from ${signed(Math.min(...rain))} to ${signed(Math.max(...rain))} mm. ${Math.min(...rain) < 0 && Math.max(...rain) > 0 ? 'The models disagree on the direction of rainfall change. ' : ''}Range across models, not a confidence interval. Future minus historical.`;
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
    summary: 'Observations for the demo field. These data belong to this boundary, regardless of the selected sequence.',
    coverage: `Possible bare soil or crop residue: August ${august}, September ${september} and October ${october} of observed years. Criterion: NDVI below 0.35; this is not a direct measurement of soil cover.`,
    terrain: `Mean slope ${fmt(terrain.decl_media_pct, 2)}%; 90% of the field below ${fmt(terrain.decl_p90_pct, 2)}%; maximum ${fmt(terrain.decl_max_pct, 2)}%. Generally gentle terrain, without attributing erosion risk to a crop.`,
    station: `${station.name}, about ${fmt(station.distance_km)} km away. Monthly minimum-temperature correction: ${fmt(Math.min(...corrections))} to ${fmt(Math.max(...corrections))} °C relative to POWER. Temperatures and hot-day counts use this correction; ET0 and rainfall do not. Rainfall: approximately −5% bias and 0.90 correlation with the station.`,
    source: englishSourceNotice(field.sources),
    model_spread: modelSpreadText(metadata.model_spread), months,
  };
}
