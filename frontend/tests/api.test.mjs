import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMotorOutput, buildRequest, requestAnalysis, requestMetadata, mapMotorAnalysis } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/motor.json', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url)));
const farm = normalizeFarm({ type: 'Polygon', coordinates: [[[-49,-21],[-48,-21],[-48,-20],[-49,-20],[-49,-21]]] });
const copy = () => structuredClone(fixture);

test('consumes the actual engine contract and keeps three objective winners', () => {
  validateMotorOutput(fixture);
  const result = mapMotorAnalysis(fixture, farm);
  assert.equal(result.demo, false);
  assert.deepEqual(result.recommendations.map((r) => r.category), ['income', 'soil', 'climate']);
  assert.deepEqual(result.recommendations.map((r) => r.sequence_id), ['soja>milho', 'soja>crotalaria', 'soja>girassol']);
  assert.equal(result.discarded.length, 59);
});
test('sends latitude, canonical crop IDs in order and cycle settings; keeps notes local', async () => {
  const history = [{ crop: 'Feijão', season: '2024', notes: 'Observação local' }, { crop: 'soja', season: '2025', notes: '' }];
  const request = buildRequest(farm, history, { mes_plantio: 2, horizonte: 1 }, metadata.cultures);
  assert.deepEqual(request, { lat: -20.5, rotacao_atual: ['feijao', 'soja'], prioridades: { agua: 1, solo: 1, renda: 1 }, horizonte: 1, mes_plantio: 2, precos: {} });
  assert.deepEqual(buildRequest(farm, []).rotacao_atual, []);
  let captured;
  await requestAnalysis('/api/', request, { fetcher: async (url, options) => {
    captured = { url, options }; return { ok: true, json: async () => fixture };
  } });
  assert.equal(captured.url, '/api/analyze');
  assert.equal(captured.options.method, 'POST');
  assert.deepEqual(JSON.parse(captured.options.body), request);
});
test('unsupported restored crops block submission rather than silently losing history', () => {
  assert.throws(() => buildRequest(farm, [{ crop: 'Café' }], undefined, metadata.cultures), /Café.*catálogo/);
  assert.throws(() => buildRequest(farm, [], { mes_plantio: 0, horizonte: 2 }), /mês/);
});
test('uses objective metrics even when the engine overall ranks disagree', () => {
  const data = copy();
  const target = data.sequencias.at(-1);
  target.hoje.receita_ha = 999999;
  target.hoje.solo = 1;
  target.futuro.encaixe = 1;
  target.futuro.agua = 1;
  const mapped = mapMotorAnalysis(data, farm);
  assert.ok(mapped.recommendations.every((r) => r.sequence_id === target.id));
});
test('compares future climate and uses future water to break climate ties', () => {
  const data = copy();
  for (const seq of data.sequencias) { seq.futuro.encaixe = 0.5; seq.futuro.agua = 0.5; }
  data.sequencias.at(-1).futuro.agua = 0.8;
  assert.equal(mapMotorAnalysis(data, farm).recommendations[2].sequence_id, data.sequencias.at(-1).id);
});
test('multiplies gross revenue by farm hectares without changing engine metrics', () => {
  const result = mapMotorAnalysis(fixture, { area_ha: 2 });
  const facts = result.recommendations[0].facts;
  assert.equal(facts[0].value.replace(/\s/g, ''), 'R$14.284');
  assert.equal(facts[3].value.replace(/\s/g, ''), 'R$28.568');
});
test('timeline crosses December and preserves monthly actual/future water figures', () => {
  const result = mapMotorAnalysis(fixture, farm).recommendations[0];
  assert.deepEqual(result.month_labels.slice(0, 4), ['out · ano 1', 'nov · ano 1', 'dez · ano 1', 'jan · ano 2']);
  assert.equal(result.timeline[1].start_month, 5);
  assert.equal(result.timeline[1].end_month, 9);
  assert.equal(result.timeline[1].monthly[0].month, 'fev · ano 2');
  const source = fixture.sequencias.find((s) => s.id === result.sequence_id);
  assert.equal(result.timeline[1].monthly.length, source.hoje.culturas[1].meses.length);
  assert.match(result.timeline[1].monthly[0].deficit, /\//);
});
test('empty viable sequences remain empty, with reasons from the engine', () => {
  const data = copy(); data.sequencias = [];
  const result = mapMotorAnalysis(data, farm);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.discarded.length, 59);
  assert.ok(result.discarded.some((reason) => reason.includes('não tem plantio')));
  assert.ok(result.discarded.some((reason) => reason.includes('só fica livre')));
});
test('rejects nonfinite metrics, malformed scenarios, calendars and duplicated sequence IDs', () => {
  for (const change of [
    (v) => v.sequencias[0].hoje.receita_ha = NaN,
    (v) => v.sequencias[0].futuro = null,
    (v) => v.sequencias[0].hoje.culturas[0].meses[0].mes = 13,
    (v) => v.sequencias.push(v.sequencias[0]),
    (v) => v.clima.futuro.pop(),
    (v) => v.sequencias[0].futuro.culturas[0].meses[0].dias = 5,
  ]) { const data = copy(); change(data); assert.throws(() => validateMotorOutput(data), /contrato/); }
});
test('metadata loads the engine catalog with friendly accents', async () => {
  const result = await requestMetadata('/api', { fetcher: async () => ({ ok: true, json: async () => metadata }) });
  assert.equal(result.cultures.find((c) => c.id === 'crotalaria').label, 'Crotalária');
});
test('HTTP validation errors explain the invalid field; outages never become fake results', async () => {
  await assert.rejects(requestAnalysis('/api', {}, { fetcher: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), /503/);
  await assert.rejects(requestAnalysis('/api', {}, { fetcher: async () => ({ ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body','lat'], msg: 'Invalid latitude' }] }) }) }), /lat: Invalid latitude/);
  await assert.rejects(requestAnalysis('/api', {}, { fetcher: async () => ({ ok: true, json: async () => { throw new Error(); } }) }), /JSON/);
});
test('abort signals reach the API fetch', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestAnalysis('/api', {}, { signal: controller.signal, fetcher: async (_url, options) => {
    options.signal.throwIfAborted();
  } }), { name: 'AbortError' });
});
