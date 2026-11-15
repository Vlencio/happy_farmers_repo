// Run while npm run dev/preview is active. Exercises the proxy and real Python engine.
import assert from 'node:assert/strict';
import { buildRequest, mapMotorAnalysis, requestAnalysis, requestMetadata } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';
import { buildFieldContext } from '../web/field.mjs';
import { readFileSync } from 'node:fs';

const baseUrl = process.env.HAPPY_FARMERS_TEST_API || 'http://127.0.0.1:4173/api';
const metadata = await requestMetadata(baseUrl);
assert.equal(metadata.point_climate_available, true);
const farm = normalizeFarm(JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url))));
assert.ok(buildFieldContext(farm, metadata));
let calls = 0, empty = 0, extended = 0;
for (const horizonte of [1, 2]) {
  for (let mes_plantio = 1; mes_plantio <= 12; mes_plantio++) {
    const history = [{ crop: 'Crotalária', season: '2025', notes: 'Somente local' }];
    const request = buildRequest(farm, history, { horizonte, mes_plantio }, metadata.cultures);
    const raw = await requestAnalysis(baseUrl, request);
    assert.equal(raw.origem.hoje, 'tabela_demo');
    assert.equal(raw.clima.seco.length, 12);
    assert.deepEqual(raw.entrada.rotacao_atual, ['crotalaria']);
    assert.equal(raw.entrada.horizonte, horizonte);
    assert.equal(raw.entrada.mes_plantio, mes_plantio);
    assert.equal(raw.sequencias.length + raw.descartadas.length, metadata.cultures.length ** horizonte);
    const view = mapMotorAnalysis(raw, farm);
    assert.match(view.source_warning, /talhão de demonstração/);
    if (horizonte === 2 && [2, 10].includes(mes_plantio)) {
      assert.equal(view.recommendations[2].sequence_id, mes_plantio === 10 ? 'soja>sorgo' : 'sorgo>soja');
    }
    assert.equal(view.recommendations.length, raw.sequencias.length ? 3 : 0);
    if (!raw.sequencias.length) empty++;
    for (const rec of [...view.recommendations, ...(view.current_rotation.strategy ? [view.current_rotation.strategy] : [])]) {
      assert.equal(rec.timeline.length, horizonte);
      const exposure = raw.sequencias.find(seq => seq.id === rec.sequence_id).hoje.descoberto;
      assert.equal(rec.exposure.months.length, 12);
      assert.equal(rec.exposure.months.reduce((total, month) => total + month.days, 0), exposure.dias);
      assert.equal(rec.exposure.months.reduce((total, month) => total + month.exposed_days, 0), exposure.dias_expostos);
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

// These expectations exercise the engine's slot rule, not a front-end reconstruction.
const currentCases = [
  { crops: ['algodao', 'soja', 'milho'], month: 10, horizon: 2, id: 'soja>milho', status: 'ready' },
  { crops: ['algodao', 'soja', 'milho'], month: 10, horizon: 1, id: 'soja', status: 'ready' },
  { crops: ['algodao', 'soja', 'milho'], month: 2, horizon: 2, id: 'soja>milho', status: 'discarded' },
  { crops: ['soja', 'milho', 'soja'], month: 2, horizon: 2, id: 'milho>soja', status: 'ready' },
  { crops: ['milho'], month: 10, horizon: 2, id: 'milho>milho', status: 'ready' },
  { crops: [], month: 10, horizon: 2, id: null, status: 'no_history' },
];
for (const { crops, month, horizon, id, status } of currentCases) {
  const history = crops.map((crop, i) => ({ crop, season: String(2020 + i), notes: '' }));
  const raw = await requestAnalysis(baseUrl, buildRequest(farm, history, { mes_plantio: month, horizonte: horizon }, metadata.cultures));
  assert.ok(Object.hasOwn(raw, 'atual'), 'Reinicie a API local para carregar o motor atualizado.');
  assert.equal(raw.atual?.id ?? null, id);
  const view = mapMotorAnalysis(raw, farm);
  assert.equal(view.current_rotation.status, status);
  assert.equal(view.recommendations.length, 3);
  if (status === 'ready') {
    const source = raw.sequencias.find(seq => seq.id === id);
    assert.equal(view.current_rotation.strategy.sequence_id, id);
    assert.equal(view.current_rotation.strategy.timeline.length, horizon);
    assert.equal(view.current_rotation.strategy.comparison_facts[0].value, source.hoje.receita_ha.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }));
  } else {
    assert.equal(view.current_rotation.strategy, null);
    if (status === 'discarded') assert.match(view.current_rotation.description, /não tem plantio previsto na safrinha/);
  }
}
console.log(`${currentCases.length} casos de rotação atual passaram na API real, incluindo histórico longo, slot equivalente, descarte e ausência de histórico.`);
