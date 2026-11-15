import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOIL_TEXTURES, supportsSoil, validateSoilTexture, validateOutputSoil,
  assertSoilApplied, soilNote, requestSoilSuggestion,
} from '../web/soil.mjs';
import { DEFAULT_SETTINGS, buildRequest, validateSettings, validateMotorOutput } from '../web/api.mjs';
import { restoreDraft } from '../web/draft.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/motor.json', import.meta.url)));
const geojson = JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url)));
const farm = normalizeFarm(geojson);
const supported = { capabilities: { solo_textura: true, ajuste: true } };
const point = { lat: -20.032, lon: -48.526 };
const settings = texture => ({ ...DEFAULT_SETTINGS, solo_textura: texture });
const response = soil => ({ ok: true, json: async () => ({ solo: soil }) });
const withSoil = (solo_textura, cad_mm) => {
  // Transport-only example: does not recalculate any score or hydrological value.
  const raw = structuredClone(baseline);
  Object.assign(raw.entrada, { solo_textura, cad_mm });
  return raw;
};
const saved = () => ({
  version: 2, farm: { geojson, name: 'Talhão', source: 'sample' },
  history: [{ crop: 'soja', season: '2025/26', notes: 'Registro local' }],
  settings: { mes_plantio: 2, horizonte: 1, prioridades: { agua: 3, solo: 1, renda: 0 },
    ajuste: { chuva_pct: -20, temp_c: 1.5 }, solo_textura: 'medio' },
});
const restore = value => restoreDraft(JSON.stringify(value));

test('soil selection requires an explicit boolean capability without blocking legacy analyses', () => {
  const unsupported = [undefined, null, {}, { capabilities: {} },
    { capabilities: { solo_textura: false } }, { capabilities: { solo_textura: 'true' } },
    { capabilities: { solo_textura: 1 } }];
  for (const metadata of unsupported) {
    assert.equal(supportsSoil(metadata), false);
    assert.throws(() => buildRequest(farm, [], settings('arenoso'), [], metadata), /textura de solo ainda não está disponível/);
    assert.equal(Object.hasOwn(buildRequest(farm, [], DEFAULT_SETTINGS, [], metadata), 'solo_textura'), false);
  }
  assert.equal(supportsSoil(supported), true);
  assert.equal(Object.hasOwn(buildRequest(farm, [], DEFAULT_SETTINGS, [], supported), 'solo_textura'), false);
});

test('only canonical texture values are sent and optional omission does not select a texture silently', () => {
  assert.deepEqual(SOIL_TEXTURES, ['arenoso', 'medio', 'argiloso']);
  for (const texture of SOIL_TEXTURES) {
    assert.equal(validateSoilTexture(texture), texture);
    const options = { ...settings(texture), prioridades: { agua: 0, solo: 3, renda: 1 }, ajuste: { chuva_pct: -20, temp_c: 2 } };
    const before = structuredClone(options);
    const request = buildRequest(farm, [], options, [], supported);
    assert.equal(request.solo_textura, texture);
    assert.deepEqual(request.prioridades, options.prioridades);
    assert.deepEqual(request.ajuste, options.ajuste);
    assert.equal(Object.hasOwn(request, 'cad_mm'), false, 'Only the engine chooses water-holding capacity.');
    assert.deepEqual(options, before);
  }
  for (const texture of [undefined, null]) {
    assert.equal(validateSoilTexture(texture), undefined);
    assert.equal(Object.hasOwn(validateSettings(settings(texture)), 'solo_textura'), false);
    assert.equal(Object.hasOwn(buildRequest(farm, [], settings(texture), [], supported), 'solo_textura'), false);
  }
  for (const texture of ['', 'Médio', 'argiloso ', 'siltoso', 0, false, [], {}, ['arenoso']]) {
    assert.throws(() => validateSoilTexture(texture), /textura de solo válida/);
    assert.throws(() => validateSettings(settings(texture)), /textura de solo válida/);
    assert.throws(() => buildRequest(farm, [], settings(texture), [], supported), /textura de solo válida/);
  }
});

test('soil output requires the texture and positive finite capacity together and preserves legacy absence', () => {
  assert.doesNotThrow(() => validateOutputSoil(baseline));
  assert.doesNotThrow(() => validateMotorOutput(baseline));
  for (const [texture, capacity] of [['arenoso', 30], ['medio', 45], ['argiloso', 60]]) {
    const raw = withSoil(texture, capacity), before = structuredClone(raw);
    assert.doesNotThrow(() => validateOutputSoil(raw));
    assert.doesNotThrow(() => validateMotorOutput(raw));
    assert.deepEqual(raw, before);
  }
  for (const [texture, capacity] of [
    ['arenoso', undefined], [undefined, 30], [null, 60], ['desconhecido', 30],
    ['medio', 0], ['medio', -45], ['medio', NaN], ['medio', Infinity], ['medio', '45'], ['medio', true],
  ]) {
    const raw = withSoil(texture, capacity);
    assert.throws(() => validateOutputSoil(raw), /entrada.solo_textura\/cad_mm/);
    assert.throws(() => validateMotorOutput(raw), /entrada.solo_textura\/cad_mm/);
  }
});

test('requested soil needs a matching engine echo and unsolicited soil cannot replace the default silently', () => {
  assert.doesNotThrow(() => assertSoilApplied(baseline, {}));
  assert.doesNotThrow(() => assertSoilApplied(withSoil('medio', 45), { solo_textura: 'medio' }));
  assert.throws(() => assertSoilApplied(baseline, { solo_textura: 'medio' }), /não confirmou a textura/);
  assert.throws(() => assertSoilApplied(withSoil('argiloso', 60), { solo_textura: 'medio' }), /não confirmou a textura/);
  assert.throws(() => assertSoilApplied(withSoil('medio', 45), {}), /não confirmou a textura/);
  assert.throws(() => assertSoilApplied(withSoil('medio', undefined), { solo_textura: 'medio' }), /entrada.solo_textura\/cad_mm/);
});

test('soil explanations use the supplied capacity and distinguish a model reference from a field measurement', () => {
  assert.match(soilNote(baseline), /Textura não informada.*60 mm.*Não é uma medição/);
  // A future changed capacity is displayed as supplied, never derived again from the enum.
  const raw = withSoil('medio', 42.5);
  assert.equal(soilNote(raw), 'Solo médio: reserva de água de 42,5 mm usada nesta análise. É uma referência do cálculo, não uma medição do talhão.');
});

test('suggested soil is requested for the exact point and retains its source and nullable coverage', async () => {
  const controller = new AbortController();
  const soil = { ...point, textura_sugerida: 'argiloso', fonte: 'GLDAS · NASA, grade 0,25°', argila_pct: 51.8 };
  const before = structuredClone(soil);
  const received = await requestSoilSuggestion('/api/', point, { signal: controller.signal, fetcher: async (url, options) => {
    assert.equal(url, '/api/metadata?lat=-20.032&lon=-48.526');
    assert.equal(options.signal, controller.signal);
    return response(soil);
  } });
  assert.deepEqual(received, before);
  assert.deepEqual(soil, before);
  const noCoverage = { ...point, textura_sugerida: null, fonte: 'Ponto fora da cobertura da grade de Minas Gerais.' };
  assert.deepEqual(await requestSoilSuggestion('/api', point, { fetcher: async () => response(noCoverage) }), noCoverage);
  assert.equal(await requestSoilSuggestion('/api', point, { fetcher: async () => response(null) }), null);
  assert.equal(await requestSoilSuggestion('/api', point, { fetcher: async () => ({ ok: true, json: async () => ({}) }) }), null);
});

test('an uncovered point accepts the API null source without weakening point or texture validation', async () => {
  const uncovered = { ...point, textura_sugerida: null, fonte: null };
  assert.deepEqual(await requestSoilSuggestion('/api', point, { fetcher: async () => response(uncovered) }), uncovered);
  for (const soil of [{ ...uncovered, lat: point.lat + 1 }, { ...uncovered, textura_sugerida: 'argiloso' }]) {
    await assert.rejects(requestSoilSuggestion('/api', point, { fetcher: async () => response(soil) }), /não corresponde ao ponto/);
  }
});

test('a suggestion for another point, malformed texture or missing source is rejected', async () => {
  const original = { ...point, textura_sugerida: 'medio', fonte: 'GLDAS · NASA' };
  const changes = [
    value => { value.lat = -20.125; }, value => { value.lon = -48.625; },
    value => { value.lat = String(point.lat); }, value => { delete value.lon; },
    value => { value.textura_sugerida = 'Médio'; }, value => { value.textura_sugerida = ''; },
    value => { delete value.textura_sugerida; }, value => { value.fonte = ''; },
    value => { value.fonte = ' '; }, value => { value.fonte = null; },
    value => { value.fonte = 'x'.repeat(2001); }, value => { delete value.fonte; },
  ];
  for (const change of changes) {
    const soil = structuredClone(original); change(soil);
    await assert.rejects(requestSoilSuggestion('/api', point, { fetcher: async () => response(soil) }), /não corresponde ao ponto/);
  }
  for (const soil of [[], 'medio', 1, true]) {
    await assert.rejects(requestSoilSuggestion('/api', point, { fetcher: async () => response(soil) }), /não corresponde ao ponto/);
  }
  await assert.rejects(requestSoilSuggestion('/api', point, { fetcher: async () => ({ ok: false, status: 503 }) }), /não pôde ser consultada/);
  await assert.rejects(requestSoilSuggestion('/api', point, { fetcher: async () => { throw new DOMException('Cancelled', 'AbortError'); } }), { name: 'AbortError' });
});

test('drafts retain explicit soil and migrate legacy absence without creating a new choice', () => {
  const value = saved(), restored = restore(value);
  assert.deepEqual(restored.settings, value.settings);
  assert.deepEqual(restored.history, value.history);
  assert.ok(restored.farm.area_ha > 219);
  assert.equal(restored.repaired, false);
  for (const version of [1, 2]) {
    const old = saved(); old.version = version; delete old.settings.solo_textura;
    const migrated = restore(old);
    assert.deepEqual(migrated.settings, old.settings);
    assert.equal(Object.hasOwn(migrated.settings, 'solo_textura'), false);
    assert.equal(migrated.repaired, false);
  }
});

test('invalid saved soil is repaired independently of the field, history, priorities, scenario and calendar', () => {
  const clean = saved(); delete clean.settings.solo_textura;
  for (const texture of ['siltoso', '', 'arenoso ', {}, false]) {
    const damaged = saved(); damaged.settings.solo_textura = texture;
    const restored = restore(damaged);
    assert.deepEqual(restored.settings, clean.settings);
    assert.deepEqual(restored.farm, restore(clean).farm);
    assert.deepEqual(restored.history, clean.history);
    assert.equal(restored.repaired, true);
  }
});

test('repairing another draft field preserves the valid soil selection', () => {
  for (const damage of [
    value => { value.settings.mes_plantio = 13; },
    value => { value.settings.prioridades = null; },
    value => { value.settings.ajuste = { chuva_pct: -60, temp_c: 0 }; },
    value => { value.history.push({ crop: 'milho', season: 'invalid', notes: '' }); },
    value => { value.farm.geojson = { type: 'Point', coordinates: [0, 0] }; },
  ]) {
    const damaged = saved(); damage(damaged);
    const restored = restore(damaged);
    assert.equal(restored.settings.solo_textura, 'medio');
    assert.equal(restored.repaired, true);
  }
});

test('explicit default persists locally while both soil controls stay out of the request', () => {
  const value = saved();
  delete value.settings.solo_textura;
  value.settings.solo_padrao = true;
  const restored = restore(value);
  assert.deepEqual(restored.settings, value.settings);
  assert.equal(restored.repaired, false);
  for (const metadata of [supported, { capabilities: { ajuste: true, solo_textura: false } }]) {
    const request = buildRequest(farm, [], restored.settings, [], metadata);
    assert.equal(Object.hasOwn(request, 'solo_textura'), false);
    assert.equal(Object.hasOwn(request, 'solo_padrao'), false);
    assert.deepEqual(request.ajuste, value.settings.ajuste);
    assert.deepEqual(request.prioridades, value.settings.prioridades);
  }
  value.settings.prioridades = null;
  const repaired = restore(value);
  assert.equal(repaired.settings.solo_padrao, true);
  assert.equal(Object.hasOwn(repaired.settings, 'solo_textura'), false);
  assert.equal(repaired.repaired, true);
});

test('invalid or conflicting default preference cannot silently override the chosen soil', () => {
  for (const solo_padrao of [true, null, 'true', 1, {}, []]) {
    assert.throws(() => validateSettings({ ...settings('arenoso'), solo_padrao }), /textura de solo ou a referência padrão/);
  }
  assert.deepEqual(validateSettings({ ...settings('arenoso'), solo_padrao: false }), validateSettings(settings('arenoso')));
  const conflicting = saved(); conflicting.settings.solo_padrao = true;
  const restored = restore(conflicting);
  assert.equal(Object.hasOwn(restored.settings, 'solo_textura'), false);
  assert.equal(Object.hasOwn(restored.settings, 'solo_padrao'), false);
  assert.deepEqual(restored.settings.ajuste, conflicting.settings.ajuste);
  assert.equal(restored.repaired, true);
});
