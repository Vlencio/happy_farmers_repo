import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFarm, parseGeoJSON } from '../web/geometry.mjs';
const polygon = (coordinates) => ({ type: 'Polygon', coordinates });
const ring = [[-48, -20], [-47.99, -20], [-47.99, -19.99], [-48, -19.99], [-48, -20]];

test('repository example is normalized with the expected area and preserves its boundary', () => {
  const input = JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url)));
  const farm = normalizeFarm(input);
  assert.ok(farm.area_ha > 218 && farm.area_ha < 221);
  assert.equal(farm.point_count, 15);
  assert.deepEqual(farm.geojson.geometry, input.features[0].geometry);
});
test('holes and multipolygons survive GeoJSON round trip and affect the area', () => {
  const hole = [[-47.998, -19.998], [-47.998, -19.994], [-47.994, -19.994], [-47.994, -19.998], [-47.998, -19.998]];
  const withHole = normalizeFarm(polygon([ring, hole]));
  assert.ok(withHole.area_ha < normalizeFarm(polygon([ring])).area_ha);
  assert.equal(withHole.geojson.geometry.coordinates.length, 2);
  const other = ring.map(([x, y]) => [x + .02, y]);
  const multi = normalizeFarm({ type: 'MultiPolygon', coordinates: [[ring, hole], [other]] });
  const restored = parseGeoJSON(JSON.stringify(multi.geojson));
  assert.deepEqual(restored.geojson, multi.geojson);
  assert.ok(multi.area_ha > withHole.area_ha);
});
test('rejects invalid JSON, points, open rings, nonfinite and projected coordinates', () => {
  assert.throws(() => parseGeoJSON('{'), /JSON/);
  assert.throws(() => normalizeFarm({ type: 'Point', coordinates: [0, 0] }), /Polygon/);
  assert.throws(() => normalizeFarm(polygon([ring.slice(0, -1)])), /open/);
  assert.throws(() => normalizeFarm(polygon([[[0,0],[NaN,1],[1,1],[0,0]]])), /invalid/);
  assert.throws(() => normalizeFarm(polygon([[[500000,7400000],[500010,7400000],[500000,7400010],[500000,7400000]]])), /WGS84/);
  assert.throws(() => normalizeFarm({ ...polygon([ring]), crs: { name: 'EPSG:3857' } }), /CRS/);
});
test('rejects self intersections, empty geometries, zero area and multiple farms', () => {
  assert.throws(() => normalizeFarm(polygon([[[0,0],[1,1],[0,1],[1,0],[0,0]]])), /crosses|invalid/);
  assert.throws(() => normalizeFarm(polygon([])), /boundary/);
  assert.throws(() => normalizeFarm(polygon([[[0,0],[1,0],[2,0],[0,0]]])));
  assert.throws(() => normalizeFarm({ type: 'FeatureCollection', features: [polygon([ring]), polygon([ring])] }), /one farm/);
});
test('bounds input work and prevents oversized files', () => {
  assert.throws(() => parseGeoJSON(' '.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
  assert.throws(() => normalizeFarm(polygon([Array.from({length: 5002}, () => [0,0])])), /5,000/);
});
test('rejects holes outside the farm and nested excluded areas', () => {
  const outer = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const outside = [[20,20],[21,20],[21,21],[20,21],[20,20]];
  const hole = [[2,2],[8,2],[8,8],[2,8],[2,2]];
  const nested = [[3,3],[4,3],[4,4],[3,4],[3,3]];
  assert.throws(() => normalizeFarm(polygon([outer, outside])), /outside the outer boundary/);
  assert.throws(() => normalizeFarm(polygon([outer, hole, nested])), /overlap/);
});
