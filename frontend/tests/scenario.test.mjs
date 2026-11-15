import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, buildRequest, validateSettings, validateMotorOutput, mapMotorAnalysis, assertAdjustmentApplied, supportsAdjustment } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/motor-seco.json', import.meta.url)));
const farm = normalizeFarm(JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url))));
const supported = { capabilities: { ajuste: true } };
const settings = ajuste => ({ ...DEFAULT_SETTINGS, ajuste });
const withAdjustment = ajuste => {
  // Presentation-only contract case; numbers are left untouched deliberately.
  // Real adjusted engine outputs are checked separately by the integration/browser tests.
  const raw = structuredClone(baseline); raw.entrada.ajuste = ajuste; return raw;
};

test('the normal request stays compatible with a server that has no scenario support', () => {
  for (const metadata of [undefined, {}, { capabilities: { ajuste: false } }, supported]) {
    const request = buildRequest(farm, [], DEFAULT_SETTINGS, [], metadata);
    assert.equal(Object.hasOwn(request, 'ajuste'), false);
    assert.deepEqual(request.prioridades, { agua: 1, solo: 1, renda: 1 });
  }
  assert.deepEqual(validateSettings({ mes_plantio: 2, horizonte: 1 }).ajuste, { chuva_pct: 0, temp_c: 0 });
});

test('only an explicit true capability enables a nonzero scenario request', () => {
  for (const metadata of [undefined, null, {}, { capabilities: { ajuste: false } }, { capabilities: { ajuste: 'true' } }, { capabilities: { ajuste: 1 } }]) {
    assert.equal(supportsAdjustment(metadata), false);
    assert.throws(() => buildRequest(farm, [], settings({ chuva_pct: -20, temp_c: 0 }), [], metadata), /ainda não estão disponíveis.*sem ajuste/);
  }
  assert.equal(supportsAdjustment(supported), true);
});

test('supported requests preserve finite range endpoints and fractions without changing priorities', () => {
  for (const ajuste of [{ chuva_pct: -50, temp_c: 0 }, { chuva_pct: 30, temp_c: 4 }, { chuva_pct: -12.5, temp_c: 0.25 }]) {
    const request = buildRequest(farm, [], { ...settings(ajuste), prioridades: { agua: 0, solo: 0, renda: 3 } }, [], supported);
    assert.deepEqual(request.ajuste, ajuste);
    assert.notEqual(request.ajuste, ajuste);
    assert.deepEqual(request.prioridades, { agua: 0, solo: 0, renda: 3 });
  }
});

test('invalid adjustments are rejected before sending or displaying a result', () => {
  for (const ajuste of [null, [], {}, { chuva_pct: -51, temp_c: 0 }, { chuva_pct: 31, temp_c: 0 },
    { chuva_pct: 0, temp_c: -1 }, { chuva_pct: 0, temp_c: 4.01 }, { chuva_pct: NaN, temp_c: 0 },
    { chuva_pct: 0, temp_c: Infinity }, { chuva_pct: '-20', temp_c: 2 }, { chuva_pct: false, temp_c: 0 },
    { chuva_pct: 0, temp_c: 0, unknown: 1 }]) {
    assert.throws(() => validateSettings(settings(ajuste)), /ajuste/);
    assert.throws(() => validateMotorOutput(withAdjustment(ajuste)), /entrada.ajuste/);
  }
  assert.throws(() => validateMotorOutput(withAdjustment(undefined)), /entrada.ajuste/);
});

test('a requested adjustment requires the same effective values in the engine response', () => {
  const request = { ajuste: { chuva_pct: -20, temp_c: 2 } };
  assert.doesNotThrow(() => assertAdjustmentApplied(withAdjustment({ chuva_pct: -20, temp_c: 2 }), request));
  for (const raw of [baseline, withAdjustment({ chuva_pct: -20, temp_c: 0 }), withAdjustment({ chuva_pct: 0, temp_c: 2 })]) {
    assert.throws(() => assertAdjustmentApplied(raw, request), /não confirmou o ajuste/);
  }
  assert.doesNotThrow(() => assertAdjustmentApplied(baseline, {}));
  assert.doesNotThrow(() => assertAdjustmentApplied(withAdjustment({ chuva_pct: 0, temp_c: 0 }), {}));
  assert.throws(() => assertAdjustmentApplied(withAdjustment({ chuva_pct: -20, temp_c: 0 }), {}), /não confirmou o ajuste/);
});

test('adjusted results explicitly label the what-if and the adjusted dry-year base', () => {
  const raw = withAdjustment({ chuva_pct: -20, temp_c: 2 });
  const before = structuredClone(raw);
  const result = mapMotorAnalysis(raw, farm);
  assert.match(result.adjustment_note, /Cenário “e se”: 20% menos chuva; temperatura \+2 °C/);
  assert.match(result.adjustment_note, /não uma previsão.*todos os meses e cenários.*ano seco/);
  assert.match(result.adjustment_note, /dias quentes.*interpolação ou extrapolação/);
  assert.match(result.scenario_note, /base de 2020\/21.*ajustados.*não são as observações originais/);
  assert.deepEqual(raw, before);
  assert.deepEqual(result.recommendations, mapMotorAnalysis(baseline, farm).recommendations);
  assert.deepEqual(result.current_rotation, mapMotorAnalysis(baseline, farm).current_rotation);
});

test('unadjusted and rain-only analyses do not claim a new heat adjustment', () => {
  assert.equal(mapMotorAnalysis(baseline, farm).adjustment_note, '');
  assert.match(mapMotorAnalysis(baseline, farm).scenario_note, /observações de 2020\/21/);
  const rain = mapMotorAnalysis(withAdjustment({ chuva_pct: 30, temp_c: 0 }), farm);
  assert.match(rain.adjustment_note, /30% mais chuva; temperatura sem alteração/);
  assert.doesNotMatch(rain.adjustment_note, /dias quentes/);
  const heat = mapMotorAnalysis(withAdjustment({ chuva_pct: 0, temp_c: 0.5 }), farm);
  assert.match(heat.adjustment_note, /chuva sem alteração; temperatura \+0,5 °C/);
});
