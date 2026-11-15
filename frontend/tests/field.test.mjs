import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFieldContext, getAnalysisSlope, matchesDemoBoundary, modelSpreadText } from '../web/field.mjs';
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

// The capability is a proposed extension; the real metadata fixture does not advertise it.
test('analysis slope requires explicit API support and preserves a valid zero slope', () => {
  assert.equal(getAnalysisSlope(farm, metadata), null);
  for (const support of [false, null, undefined, 'true', 1]) {
    assert.equal(getAnalysisSlope(farm, { ...metadata, capabilities: { declividade_pct: support } }), null);
  }
  const enabled = structuredClone(metadata);
  enabled.capabilities = { declividade_pct: true };
  assert.equal(getAnalysisSlope(farm, enabled), 4.05);
  enabled.demo_field.terrain.decl_media_pct = 0;
  assert.equal(getAnalysisSlope(farm, enabled), 0);
  enabled.demo_field.terrain.decl_media_pct = 100;
  assert.equal(getAnalysisSlope(farm, enabled), 100);
});

test('analysis slope follows only the exact demo boundary, even with enabled support', () => {
  const enabled = { ...metadata, capabilities: { declividade_pct: true } };
  const imported = structuredClone(farm); imported.source = 'file'; imported.name = 'Outra identificação';
  const ring = imported.geojson.geometry.coordinates[0].slice(0, -1).reverse();
  imported.geojson.geometry.coordinates[0] = [...ring, ring[0]];
  assert.equal(getAnalysisSlope(imported, enabled), 4.05);
  const modified = structuredClone(farm); modified.name = 'Talhão de demonstração'; modified.source = 'sample';
  modified.geojson.geometry.coordinates[0][1][0] += 0.00001;
  assert.equal(getAnalysisSlope(modified, enabled), null);
  const nearby = structuredClone(farm);
  nearby.geojson.geometry.coordinates[0] = nearby.geojson.geometry.coordinates[0].map(([lon, lat]) => [lon + 0.001, lat]);
  assert.equal(getAnalysisSlope(nearby, enabled), null);
  assert.equal(getAnalysisSlope(null, enabled), null);
  assert.equal(getAnalysisSlope(farm, { capabilities: { declividade_pct: true } }), null);
});

test('supported demo slope must be finite and within the engine accepted range', () => {
  for (const value of [undefined, null, '4.05', NaN, Infinity, -1, 100.01]) {
    const enabled = structuredClone(metadata);
    enabled.capabilities = { declividade_pct: true };
    enabled.demo_field.terrain.decl_media_pct = value;
    assert.throws(() => getAnalysisSlope(farm, enabled), /inválidos/);
  }
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
