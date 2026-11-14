import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateMotorOutput, buildRequest, requestAnalysis, requestMetadata, mapMotorAnalysis } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/motor.json', import.meta.url)));
const february = JSON.parse(readFileSync(new URL('./fixtures/motor-fevereiro.json', import.meta.url)));
const dryYear = JSON.parse(readFileSync(new URL('./fixtures/motor-seco.json', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url)));
const farm = normalizeFarm({ type: 'Polygon', coordinates: [[[-49,-21],[-48,-21],[-48,-20],[-49,-20],[-49,-21]]] });
const copy = () => structuredClone(fixture);

test('consumes the actual engine contract and keeps three objective winners', () => {
  validateMotorOutput(fixture);
  const result = mapMotorAnalysis(fixture, farm);
  assert.equal(result.demo, false);
  assert.deepEqual(result.recommendations.map((r) => r.category), ['income', 'soil', 'climate']);
  assert.deepEqual(result.recommendations.map((r) => r.sequence_id), ['soja>milho', 'soja>crotalaria', 'soja>sorgo']);
  assert.equal(mapMotorAnalysis(february, farm).recommendations[2].sequence_id, 'sorgo>soja');
  assert.equal(result.discarded.length, 74);
});
test('sends latitude/longitude, canonical crop IDs in order and cycle settings; keeps notes local', async () => {
  const history = [{ crop: 'Feijão', season: '2024', notes: 'Observação local' }, { crop: 'soja', season: '2025', notes: '' }];
  const request = buildRequest(farm, history, { mes_plantio: 2, horizonte: 1 }, metadata.cultures);
  assert.deepEqual(request, { lat: -20.5, lon: -48.5, rotacao_atual: ['feijao', 'soja'], prioridades: { agua: 1, solo: 1, renda: 1 }, horizonte: 1, mes_plantio: 2, precos: {} });
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
  const target = data.sequencias.find((s) => s.futuro.culturas.every((c) => c.receita_ha > 0) && s.rank_hoje > 1);
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
  const target = data.sequencias.findLast((s) => s.futuro.culturas.every((c) => c.receita_ha > 0));
  target.futuro.agua = 0.8;
  assert.equal(mapMotorAnalysis(data, farm).recommendations[2].sequence_id, target.id);
});
test('climate excludes a zero-revenue crop even when its sequence has income; falls back only if none qualify', () => {
  const data = copy();
  const cover = data.sequencias.find((s) => s.id === 'soja>milheto');
  assert.ok(cover.futuro.receita_ha > 0);
  assert.ok(cover.futuro.culturas.some((c) => c.receita_ha === 0));
  cover.futuro.encaixe = 1; cover.futuro.agua = 1;
  assert.notEqual(mapMotorAnalysis(data, farm).recommendations[2].sequence_id, cover.id);
  for (const seq of data.sequencias) seq.futuro.culturas[0].receita_ha = 0;
  const rec = mapMotorAnalysis(data, farm).recommendations[2];
  assert.equal(rec.sequence_id, cover.id);
  assert.match(rec.reason, /nenhuma tem receita positiva/);
});
test('multiplies gross revenue by farm hectares without changing engine metrics', () => {
  const result = mapMotorAnalysis(fixture, { area_ha: 2 });
  const facts = result.recommendations[0].facts;
  const source = fixture.sequencias.find((s) => s.id === result.recommendations[0].sequence_id);
  const money = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  assert.equal(facts[0].value, money(source.hoje.receita_ha));
  assert.equal(facts[3].value, money(source.hoje.receita_ha * 2));
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
  assert.equal(result.discarded.length, 74);
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
    (v) => v.sequencias[0].futuro.culturas[0].encaixe_calor = 1.1,
    (v) => v.sequencias[0].futuro.culturas[0].dias_calor = -1,
    (v) => delete v.sequencias[0].futuro.culturas[0].dias_calor,
  ]) { const data = copy(); change(data); assert.throws(() => validateMotorOutput(data), /contrato/); }
});
// Synthetic extension of the contract, not an engine calculation for 2020/21.
function withDryScenario() {
  const data = copy(); data.clima.seco = structuredClone(data.clima.hoje);
  for (const seq of data.sequencias) {
    seq.seco = structuredClone(seq.hoje); seq.rank_seco = seq.rank_hoje;
    seq.seco.receita_ha = 1234;
    for (const crop of seq.seco.culturas) for (const month of crop.meses) month.chuva_mm = 7;
  }
  return data;
}
test('dry scenario is optional and supplies a third set of facts and monthly numbers when complete', () => {
  const current = mapMotorAnalysis(fixture, farm);
  assert.equal(current.recommendations[0].facts.length, 6);
  assert.match(current.scenario_note, /ainda não está disponível/);
  const data = withDryScenario();
  const view = mapMotorAnalysis(data, { area_ha: 2 });
  assert.deepEqual(view.recommendations.map((r) => r.sequence_id), current.recommendations.map((r) => r.sequence_id));
  const rec = view.recommendations[0];
  assert.equal(rec.facts.length, 9);
  assert.equal(rec.facts[7].value.replace(/\s/g, ''), 'R$2.468');
  assert.equal(rec.timeline[0].monthly[0].rain.split(' / ').at(-1), '7');
  assert.equal(rec.timeline[0].monthly[0].rain.split(' / ').length, 3);
  assert.match(rec.water_caption, /hoje \/ futuro \/ ano seco/);
  assert.match(view.scenario_note, /2020\/21/);
});
test('rejects partial, invalid and calendar-misaligned dry scenarios', () => {
  for (const change of [
    (v) => delete v.clima.seco,
    (v) => delete v.sequencias[0].seco,
    (v) => delete v.sequencias[0].rank_seco,
    (v) => v.sequencias[0].seco.renda = 1.01,
    (v) => v.sequencias[0].seco.receita_ha = NaN,
    (v) => v.sequencias[0].seco.culturas[0].meses[0].dias = 1,
    (v) => v.clima.seco[1].mes = v.clima.seco[0].mes,
  ]) { const data = withDryScenario(); change(data); assert.throws(() => validateMotorOutput(data), /contrato/); }
});
test('actual P1 dry-year output is shown without changing the three winners', () => {
  const view = mapMotorAnalysis(dryYear, farm);
  assert.deepEqual(view.recommendations.map((r) => r.sequence_id), mapMotorAnalysis(fixture, farm).recommendations.map((r) => r.sequence_id));
  assert.match(view.scenario_note, /2020\/21/);
  assert.equal(view.recommendations[0].facts.length, 9);
  assert.equal(view.recommendations[0].timeline[0].monthly[0].rain.split(' / ').length, 3);
});
test('point provenance warning reaches Rune unchanged, including fallback and outside Minas', () => {
  const raw = copy();
  raw.origem = { hoje: 'fallback_tabela_demo', aviso: 'POWER fora do ar. O ponto do talhão está fora de Minas Gerais.' };
  assert.equal(mapMotorAnalysis(raw, farm).source_warning, raw.origem.aviso);
  assert.equal(mapMotorAnalysis(fixture, farm).source_warning, '');
  raw.origem.aviso = { unexpected: true };
  assert.throws(() => validateMotorOutput(raw), /origem.aviso/);
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

test('malformed error bodies and null metadata produce readable errors, not TypeErrors', async () => {
  for (const value of [null, 'unavailable', { detail: [null, {}, { loc: 7, msg: 'Invalid input' }] }]) {
    await assert.rejects(requestAnalysis('/api', {}, { fetcher: async () => ({ ok: false, status: 503, json: async () => value }) }), /HTTP 503/);
  }
  for (const value of [null, { cultures: [null] }]) {
    await assert.rejects(requestMetadata('/api', { fetcher: async () => ({ ok: true, json: async () => value }) }), /contrato/);
  }
});
