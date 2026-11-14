// Run while npm run dev/preview is active. Exercises the proxy and real Python engine.
import assert from 'node:assert/strict';
import { buildRequest, mapMotorAnalysis, requestAnalysis, requestMetadata } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';
import { buildFieldContext } from '../web/field.mjs';
import { readFileSync } from 'node:fs';

const baseUrl = process.env.HAPPY_FARMERS_TEST_API || 'http://127.0.0.1:4173/api';
const metadata = await requestMetadata(baseUrl);
const farm = normalizeFarm(JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url))));
assert.ok(buildFieldContext(farm, metadata));
let calls = 0, empty = 0, extended = 0;
for (const horizonte of [1, 2]) {
  for (let mes_plantio = 1; mes_plantio <= 12; mes_plantio++) {
    const history = [{ crop: 'Crotalária', season: '2025', notes: 'Somente local' }];
    const request = buildRequest(farm, history, { horizonte, mes_plantio }, metadata.cultures);
    const raw = await requestAnalysis(baseUrl, request);
    assert.deepEqual(raw.entrada.rotacao_atual, ['crotalaria']);
    assert.equal(raw.entrada.horizonte, horizonte);
    assert.equal(raw.entrada.mes_plantio, mes_plantio);
    assert.equal(raw.sequencias.length + raw.descartadas.length, metadata.cultures.length ** horizonte);
    const view = mapMotorAnalysis(raw, farm);
    if (horizonte === 2 && [2, 10].includes(mes_plantio)) {
      assert.equal(view.recommendations[2].sequence_id, mes_plantio === 10 ? 'soja>sorgo' : 'sorgo>soja');
    }
    assert.equal(view.recommendations.length, raw.sequencias.length ? 3 : 0);
    if (!raw.sequencias.length) empty++;
    for (const rec of view.recommendations) {
      assert.equal(rec.timeline.length, horizonte);
      if (rec.month_labels.length > 12) extended++;
      for (const stage of rec.timeline) {
        assert.ok(stage.start_month >= 1 && stage.end_month <= rec.month_labels.length);
        assert.equal(stage.monthly[0].month, rec.month_labels[stage.start_month - 1]);
        assert.equal(stage.monthly.at(-1).month, rec.month_labels[stage.end_month - 1]);
      }
    }
    calls++;
  }
}
console.log(`${calls} combinações de mês/horizonte passaram na API real; ${empty} sem sequência viável, ${extended} timelines acima de 12 meses.`);
