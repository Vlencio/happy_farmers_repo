import { area, bbox, booleanValid, booleanWithin, booleanDisjoint, kinks, polygon } from '@turf/turf';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const fail = (message) => { throw new Error(message); };

// Accept one farm, including disconnected parcels and inner rings, in WGS84.
// Do not silently close rings, reproject coordinates or discard extra features.
export function normalizeFarm(input, { name = 'Minha fazenda', source = 'import' } = {}) {
  if (!input || typeof input !== 'object') fail('O arquivo não contém um GeoJSON válido.');
  if (input.crs) fail('Use coordenadas WGS84 (longitude e latitude), sem um CRS alternativo.');
  let feature = input;
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features) || input.features.length !== 1) {
      fail('Envie uma única fazenda: um Feature com Polygon ou MultiPolygon.');
    }
    feature = input.features[0];
  }
  const geometry = feature?.type === 'Feature' ? feature.geometry : feature;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    fail('O limite precisa ser Polygon ou MultiPolygon. Pontos e linhas não definem uma área.');
  }
  if (feature.crs || geometry.crs) fail('Use coordenadas WGS84, sem um CRS alternativo.');
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!Array.isArray(polygons) || !polygons.length) fail('O contorno está vazio.');
  let vertices = 0;
  const cleanPolygons = polygons.map((rings) => {
    if (!Array.isArray(rings) || !rings.length) fail('O polígono não tem contorno.');
    return rings.map((ring) => {
      if (!Array.isArray(ring) || ring.length < 4) fail('Cada contorno precisa de ao menos três pontos e estar fechado.');
      vertices += ring.length - 1;
      if (vertices > 5000) fail('Use um GeoJSON simplificado, com até 5.000 vértices.');
      const clean = ring.map((point) => {
        if (!Array.isArray(point) || point.length < 2 || point.length > 3 ||
            !point.every(Number.isFinite)) fail('Há coordenadas inválidas no arquivo.');
        const [lon, lat] = point;
        if (lon < -180 || lon > 180 || lat < -85 || lat > 85) {
          fail('Coordenadas fora do mapa. Use longitude/latitude WGS84, entre −85° e 85° de latitude.');
        }
        return [lon, lat];
      });
      if (clean[0][0] !== clean.at(-1)[0] || clean[0][1] !== clean.at(-1)[1]) {
        fail('O contorno está aberto. O primeiro e o último ponto precisam ser iguais.');
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
    fail('O contorno se cruza ou tem anéis inválidos. Ajuste os pontos e tente novamente.');
  }
  // Turf's general validity check does not reject every misplaced inner ring.
  for (const rings of cleanPolygons) {
    const outer = polygon([rings[0]]);
    const holes = rings.slice(1).map((ring) => polygon([ring]));
    for (let i = 0; i < holes.length; i++) {
      if (!booleanWithin(holes[i], outer)) fail('Uma área excluída está fora do contorno principal. Confira os anéis internos.');
      for (let j = 0; j < i; j++) {
        if (!booleanDisjoint(holes[i], holes[j])) fail('As áreas excluídas do contorno não podem se sobrepor.');
      }
    }
  }
  const bounds = bbox(geojson);
  if (bounds[2] - bounds[0] > 180) fail('Contornos que cruzam o antimeridiano não são suportados neste protótipo.');
  const areaHa = area(geojson) / 10000;
  if (!Number.isFinite(areaHa) || areaHa <= 0) fail('O contorno precisa ter uma área maior que zero.');
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
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) fail('O arquivo excede 2 MB. Simplifique o contorno antes de importar.');
  let input;
  try { input = JSON.parse(text); } catch { fail('Não foi possível ler o JSON. Verifique o conteúdo do arquivo.'); }
  return normalizeFarm(input, options);
}
