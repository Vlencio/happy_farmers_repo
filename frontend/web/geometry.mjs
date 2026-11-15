import { area, bbox, booleanValid, booleanWithin, booleanDisjoint, kinks, polygon } from '@turf/turf';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };

// Accept one farm, including disconnected parcels and inner rings, in WGS84.
// Do not silently close rings, reproject coordinates or discard extra features.
export function normalizeFarm(input, { name = 'My farm', source = 'import' } = {}) {
  if (!input || typeof input !== 'object') fail('The file does not contain valid GeoJSON.');
  if (input.crs) fail('Use WGS84 coordinates (longitude and latitude), without an alternative CRS.');
  let feature = input;
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features) || input.features.length !== 1) {
      fail('Provide one farm: a Feature with Polygon or MultiPolygon geometry.');
    }
    feature = input.features[0];
  }
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    fail('The boundary must be a Polygon or MultiPolygon. Points and lines do not define an area.');
  }
  if (feature.crs || geometry.crs) fail('Use WGS84 coordinates, without an alternative CRS.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) fail('The boundary is empty.');
  let vertices = 0;
  const cleanPolygons = polygons.map((rings) => {
    if (!Array.isArray(rings) || !rings.length) fail('The polygon has no boundary.');
    return rings.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) fail('Each boundary must have at least three points and form a closed ring.');
      vertices += ring.length - 1;
      if (vertices > 5000) fail('Use simplified GeoJSON with no more than 5,000 vertices.');
      const clean = ring.map((point) => {
        if (!Array.isArray(point) || point.length < 2 || point.length > 3 ||
            !point.every(Number.isFinite)) fail('The file contains invalid coordinates.');
        const [lon, lat] = point;
        if (lon < -180 || lon > 180 || lat < -85 || lat > 85) {
          fail('Coordinates are outside the map. Use WGS84 longitude/latitude, with latitude between −85° and 85°.');
        }
        return [lon, lat];
      });
      if (clean[0][0] !== clean.at(-1)[0] || clean[0][1] !== clean.at(-1)[1]) {
        fail('The boundary is open. The first and last points must match.');
      }
      return clean;
    });
  });
  const rawName = feature.properties?.name;
  const label = (typeof rawName === 'string' && rawName.trim() ? rawName : name).slice(0, 100);
  const geojson = { type: 'Feature', properties: { name: label }, geometry: {
    type: geometry.type, coordinates: geometry.type === 'Polygon' ? cleanPolygons[0] : cleanPolygons,
  } };
  if (!booleanValid(geojson) || kinks(geojson).features.length) {
    fail('The boundary crosses itself or has invalid rings. Adjust the points and try again.');
  }
  // Turf's general validity check does not reject every misplaced inner ring.
  for (const rings of cleanPolygons) {
    const outer = polygon([rings[0]]);
    const holes = rings.slice(1).map((ring) => polygon([ring]));
    for (let i = 0; i < holes.length; i++) {
      if (!booleanWithin(holes[i], outer)) fail('An excluded area lies outside the outer boundary. Check the inner rings.');
      for (let j = 0; j < i; j++) {
        if (!booleanDisjoint(holes[i], holes[j])) fail('Excluded areas within the boundary must not overlap.');
      }
    }
  }
  const bounds = bbox(geojson);
  if (bounds[2] - bounds[0] > 180) fail('Boundaries crossing the antimeridian are not supported in this prototype.');
  const areaHa = area(geojson) / 10000;
  if (!Number.isFinite(areaHa) || areaHa <= 0) fail('The boundary must enclose an area greater than zero.');
  const dx = (bounds[2] - bounds[0]) * Math.cos((bounds[1] + bounds[3]) * Math.PI / 360);
  const dy = bounds[3] - bounds[1];
  const scale = Math.min(280 / (dx || 1), 134 / (dy || 1));
  const outline = cleanPolygons.map((rings) => rings[0].map(([x, y]) => [
    160 + (x - (bounds[0] + bounds[2]) / 2) * Math.cos((bounds[1] + bounds[3]) * Math.PI / 360) * scale,
    80 - (y - (bounds[1] + bounds[3]) / 2) * scale,
  ]));
  return { name: label, source, geojson, area_ha: areaHa, point_count: vertices, outline };
}

export function parseGeoJSON(text, options) {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) fail('The file exceeds 2 MB. Simplify the boundary before importing.');
  let input;
  try { input = JSON.parse(text); } catch { fail('Unable to read the JSON. Check the file contents.'); }
  return normalizeFarm(input, options);
}
