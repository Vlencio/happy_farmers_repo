import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFieldContext, matchesDemoBoundary, modelSpreadText } from '../web/field.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url)));
const boundary = metadata.demo_field.boundary;
const farm = normalizeFarm(boundary);

test('real field facts retain the 50% August / 60% September distinction and source resolutions', () => {
  const field = buildFieldContext(farm, metadata);
  assert.equal(field.months.length, 12);
  assert.match(field.coverage, /agosto 50%, setembro 60% e outubro 40%/);
  assert.match(field.terrain, /4,05%.*7,07%.*17,82%/);
  assert.match(field.station, /-2,5 a -1,2 °C/);
  assert.match(field.source, /250 m.*30 m/);
  assert.match(field.model_spread, /ainda não/);
});
test('demo facts follow the boundary, including imported, reversed and rotated rings', () => {
  const imported = structuredClone(farm); imported.source = 'file'; imported.name = 'Meu arquivo';
  const points = imported.geojson.geometry.coordinates[0].slice(0, -1).reverse();
  const rotated = [...points.slice(3), ...points.slice(0, 3)];
  imported.geojson.geometry.coordinates[0] = [...rotated, rotated[0]];
  assert.ok(matchesDemoBoundary(imported, boundary));
  assert.ok(buildFieldContext(imported, metadata));
  imported.geojson.geometry = { type: 'MultiPolygon', coordinates: [imported.geojson.geometry.coordinates] };
  assert.ok(matchesDemoBoundary(imported, boundary));
});
test('changing the outline hides all demo facts, even with forged sample name and source', () => {
  const other = structuredClone(farm); other.source = 'sample'; other.name = 'Talhão de demonstração';
  other.geojson.geometry.coordinates[0][1][0] += 0.00001;
  assert.equal(buildFieldContext(other, metadata), null);
  assert.equal(buildFieldContext(null, metadata), null);
  assert.equal(buildFieldContext(farm, {}), null);
});
test('invalid monthly observations are rejected instead of rendered as zero or extrapolated', () => {
  for (const change of [
    (m) => m.demo_field.ndvi.pop(),
    (m) => m.demo_field.ndvi[0].freq_solo = 2,
    (m) => m.demo_field.ndvi[0].ndvi_medio = NaN,
    (m) => m.demo_field.ndvi[0].mes = 2,
  ]) { const m = structuredClone(metadata); change(m); assert.throws(() => buildFieldContext(farm, m), /inválidos/); }
});
test('model range is computed from delivery, including rainfall sign disagreement; never shown on another field', () => {
  const spread = { scope: 'talhao_demo_2', models: [
    { model: 'A', rain_delta_mm: -80, tmax_delta_c: 1.3 },
    { model: 'B', rain_delta_mm: 8, tmax_delta_c: 2.3 },
    { model: 'C', rain_delta_mm: 33, tmax_delta_c: 1.5 },
  ] };
  assert.match(modelSpreadText(spread), /3 modelos.*\+1,3 a \+2,3.*-80 a \+33.*discordam do sinal/);
  const other = normalizeFarm({ type: 'Polygon', coordinates: [[[-49,-21],[-48,-21],[-48,-20],[-49,-20],[-49,-21]]] });
  assert.equal(buildFieldContext(other, { ...metadata, model_spread: spread }), null);
  spread.models[1].rain_delta_mm = NaN;
  assert.throws(() => modelSpreadText(spread), /inválidos/);
});
