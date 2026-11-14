import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalysis, buildRequest, requestAnalysis } from '../web/api.mjs';
import { demoAnalysis } from '../web/demo.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

test('demonstration remains explicitly labeled with all three distinct objectives', () => {
  const result = validateAnalysis(demoAnalysis());
  assert.equal(result.demo, true);
  assert.deepEqual(result.recommendations.map((r) => r.category), ['income','soil','climate']);
  assert.ok(result.recommendations.every((r) => r.timeline.length > 1));
});
test('rejects incomplete, duplicated and malformed engine responses', () => {
  const duplicate = demoAnalysis(); duplicate.recommendations[1].category = 'income';
  assert.throws(() => validateAnalysis(duplicate), /repetidas/);
  const missing = demoAnalysis(); missing.recommendations.pop();
  assert.throws(() => validateAnalysis(missing), /três/);
  const bad = demoAnalysis(); bad.recommendations[0].timeline[0].end_month = 13;
  assert.throws(() => validateAnalysis(bad), /meses/);
  const version = demoAnalysis(); version.schema_version = '2.0';
  assert.throws(() => validateAnalysis(version), /Versão/);
});
test('sends farm geometry and optional history with the agreed contract', async () => {
  const farm = normalizeFarm({ type:'Polygon', coordinates:[[[0,0],[1,0],[1,1],[0,0]]] });
  const history = [{ crop:'Soja', season:'2025/26', notes:'Contexto de teste' }];
  const request = buildRequest(farm, history);
  assert.deepEqual(buildRequest(farm, []).history, []);
  let captured;
  await requestAnalysis('http://localhost:8000/', request, { fetcher: async (url, options) => {
    captured = { url, options }; return { ok:true, json: async () => demoAnalysis() };
  } });
  assert.equal(captured.url, 'http://localhost:8000/analyze');
  assert.equal(captured.options.method, 'POST');
  assert.deepEqual(JSON.parse(captured.options.body).farm.boundary, farm.geojson);
  assert.deepEqual(JSON.parse(captured.options.body).history, history);
});
test('HTTP and invalid JSON errors do not turn into demonstration results', async () => {
  await assert.rejects(requestAnalysis('http://test', {}, { fetcher: async () => ({ ok:false, status:503 }) }), /503/);
  await assert.rejects(requestAnalysis('http://test', {}, { fetcher: async () => ({ ok:true, json: async () => { throw new Error(); } }) }), /JSON/);
});
test('abort signals reach the API fetch', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestAnalysis('http://test', {}, { signal:controller.signal, fetcher: async (_url, options) => {
    options.signal.throwIfAborted();
  } }), { name:'AbortError' });
});
