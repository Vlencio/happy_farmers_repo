// Run while npm run dev/preview is active. Exercises the proxy and real Python engine.
import assert from 'node:assert/strict';
import { buildRequest, mapMotorAnalysis, requestAnalysis, requestMetadata, assertAdjustmentApplied } from '../web/api.mjs';
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
    const history = [{ crop: 'Sunn hemp', season: '2025', notes: 'Local only' }];
    const request = buildRequest(farm, history, { horizonte, mes_plantio }, metadata.cultures);
    const raw = await requestAnalysis(baseUrl, request);
    assert.equal(raw.origem.hoje, 'tabela_demo');
    assert.equal(raw.entrada.altitude_m, 484.41, 'The API uses the demonstration field SRTM elevation.');
    assert.ok(raw.sequencias.every(seq => !seq.culturas.includes('trigo')), 'Wheat below its minimum elevation is excluded from viable options.');
    assert.equal(raw.clima.seco.length, 12);
    assert.deepEqual(raw.entrada.rotacao_atual, ['crotalaria']);
    assert.equal(raw.entrada.horizonte, horizonte);
    assert.equal(raw.entrada.mes_plantio, mes_plantio);
    assert.equal(raw.sequencias.length + raw.descartadas.length, metadata.cultures.length ** horizonte);
    const view = mapMotorAnalysis(raw, farm);
    assert.match(view.data_sources, /demonstration field/);
    assert.equal(view.source_warning, '', 'Routine demo provenance belongs with data sources, not in the exception warning.');
    assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id));
    assert.equal(view.recommendations.length, Math.min(3, raw.sequencias.length));
    if (horizonte === 1 && [3, 4, 5, 12].includes(mes_plantio)) {
      const expected = { 3: [], 4: [], 5: ['soja', 'milho'], 12: ['algodao'] };
      assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), expected[mes_plantio]);
    }
    if (!raw.sequencias.length) empty++;
    for (const rec of [...view.recommendations, ...(view.current_rotation.strategy ? [view.current_rotation.strategy] : [])]) {
      assert.equal(rec.timeline.length, horizonte);
      const source = raw.sequencias.find(seq => seq.id === rec.sequence_id);
      assert.deepEqual(rec.rank_facts.map(fact => fact.value), [
        `#${source.rank_hoje}`, `${source.hoje.score.toLocaleString('en-US', { maximumFractionDigits: 1 })} / 100`,
        `#${source.rank_futuro}`, `${source.futuro.score.toLocaleString('en-US', { maximumFractionDigits: 1 })} / 100`,
      ]);
      assert.ok(Array.isArray(source.avisos), 'The API must pass through warnings from the current engine.');
      assert.equal(rec.warnings.risks.length, source.avisos.filter(warning => warning.tipo === 'risco').length);
      assert.equal(rec.warnings.gaps.length, source.avisos.filter(warning => warning.tipo === 'lacuna').length);
      assert.ok(Array.isArray(source.beneficios), 'The API must pass through benefits from the current engine.');
      assert.equal(rec.benefits.items.length, source.beneficios.length);
      for (const warning of [...rec.warnings.risks, ...rec.warnings.gaps]) {
        assert.ok(warning.context && warning.description && warning.evidence && warning.card_summary);
      }
      const exposure = source.hoje.descoberto;
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
console.log(`${calls} month/horizon combinations passed against the real API; ${empty} without viable sequences, ${extended} timelines longer than 12 months.`);

// These expectations exercise the engine's slot rule, not a front-end reconstruction.
const currentCases = [
  { crops: ['algodao', 'soja', 'milho'], month: 10, horizon: 2, id: 'soja>milho', status: 'ready' },
  { crops: ['algodao', 'soja', 'milho'], month: 10, horizon: 1, id: 'soja', status: 'ready' },
  { crops: ['algodao', 'soja', 'milho'], month: 2, horizon: 2, id: 'soja>milho', status: 'discarded' },
  { crops: ['soja', 'milho', 'soja'], month: 2, horizon: 2, id: 'milho>soja', status: 'ready' },
  { crops: ['milho'], month: 10, horizon: 2, id: 'milho>milho', status: 'ready' },
  { crops: ['soja', 'trigo'], month: 10, horizon: 2, id: 'soja>trigo', status: 'discarded', altitude: true },
  { crops: [], month: 10, horizon: 2, id: null, status: 'no_history' },
];
for (const { crops, month, horizon, id, status, altitude } of currentCases) {
  const history = crops.map((crop, i) => ({ crop, season: String(2020 + i), notes: '' }));
  const raw = await requestAnalysis(baseUrl, buildRequest(farm, history, { mes_plantio: month, horizonte: horizon }, metadata.cultures));
  assert.ok(Object.hasOwn(raw, 'atual'), 'Restart the local API to load the updated engine.');
  assert.equal(raw.atual?.id ?? null, id);
  const view = mapMotorAnalysis(raw, farm);
  assert.equal(view.current_rotation.status, status);
  assert.equal(view.recommendations.length, 3);
  if (status === 'ready') {
    const source = raw.sequencias.find(seq => seq.id === id);
    assert.equal(view.current_rotation.strategy.sequence_id, id);
    assert.equal(view.current_rotation.strategy.timeline.length, horizon);
    assert.equal(view.current_rotation.strategy.comparison_facts[0].value, source.hoje.receita_ha.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 }));
  } else {
    assert.equal(view.current_rotation.strategy, null);
    if (status === 'discarded' && altitude) {
      assert.equal(raw.atual.motivo.altitude_min_m, 800);
      assert.equal(raw.atual.motivo.altitude_m, 484.41);
      assert.match(view.current_rotation.description, /elevation.*800.*484\.41/i);
      assert.doesNotMatch(view.current_rotation.description, /does not fit the selected calendar/);
    } else if (status === 'discarded') assert.match(view.current_rotation.description, /has no planting window in the second season/);
  }
}
console.log(`${currentCases.length} current-rotation cases passed against the real API, including long history, equivalent seasons, calendar/elevation exclusions and no history.`);

// Ranking comes from a new engine analysis for each set of priorities.
// Keep the demo field and soybean/corn history used in the engine's examples:
// history contributes to soil diversity, so empty history can change tied scores.
const weightedHistory = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
const weightedCases = [
  { name: 'equal weights', prioridades: { agua: 1, solo: 1, renda: 1 }, ids: ['soja>crotalaria', 'soja>milho', 'soja>sorgo'] },
  { name: 'income only', prioridades: { agua: 0, solo: 0, renda: 3 }, ids: ['soja>milho', 'soja>sorgo', 'soja>girassol'] },
  { name: 'soil only', prioridades: { agua: 0, solo: 3, renda: 0 }, ids: ['soja>crotalaria', 'feijao>crotalaria', 'milho>crotalaria'] },
  { name: 'water only and engine tie-break', prioridades: { agua: 3, solo: 0, renda: 0 }, ids: ['soja>crotalaria', 'soja>feijao', 'soja>milheto'] },
  { name: 'all zero use equal weights', prioridades: { agua: 0, solo: 0, renda: 0 }, ids: ['soja>crotalaria', 'soja>milho', 'soja>sorgo'] },
];
let weightedBaseline;
for (const { name, prioridades, ids } of weightedCases) {
  const request = buildRequest(farm, weightedHistory, { mes_plantio: 10, horizonte: 2, prioridades }, metadata.cultures);
  assert.deepEqual(request.prioridades, prioridades, name);
  const raw = await requestAnalysis(baseUrl, request);
  if (name === 'equal weights') weightedBaseline = raw;
  const view = mapMotorAnalysis(raw, farm);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), ids, name);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id), name);
  assert.equal(view.current_rotation.status, 'ready');
  assert.equal(view.current_rotation.strategy.sequence_id, 'soja>milho');
  assert.ok(view.recommendations.every(rec => rec.reason.includes(view.priority_note)), name);
  if (prioridades.agua === 3) assert.ok(raw.sequencias.slice(0, 3).every(seq => seq.hoje.score === 100));
  if (name.includes('equal weights')) assert.deepEqual(raw.entrada.prioridades, { agua: 0.333, solo: 0.333, renda: 0.333 });
}
const futureShift = await requestAnalysis(baseUrl, buildRequest(farm, weightedHistory, { mes_plantio: 2, horizonte: 2 }, metadata.cultures));
assert.equal(futureShift.sequencias[0].id, 'crotalaria>soja');
assert.equal(futureShift.sequencias[0].rank_hoje, 1);
assert.equal(futureShift.sequencias[0].rank_futuro, 1);
assert.equal(futureShift.sequencias[0].hoje.score, 78.101);
assert.equal(futureShift.sequencias[0].futuro.score, 77.506);
const februaryView = mapMotorAnalysis(futureShift, farm);
assert.equal(februaryView.recommendations[0].rank_facts[2].value, '#1');
assert.equal(futureShift.sequencias[1].id, 'sorgo>soja');
assert.equal(futureShift.sequencias[1].rank_futuro, 2);
assert.equal(februaryView.recommendations[1].rank_facts[2].value, '#2');
assert.equal(futureShift.sequencias[2].id, 'feijao>soja');
assert.equal(futureShift.sequencias[2].rank_futuro, 9);
assert.equal(februaryView.recommendations[2].rank_facts[2].value, '#9');
console.log(`${weightedCases.length} priority scenarios passed against the real API; February has sunn hemp>soybean and sorghum>soybean in the top two, and common bean>soybean moves from rank3 today to rank9 in the future.`);

// The actual API now owns what-if calculations. Exercise the browser request
// builder, effective echo and presentation, without reproducing climate formulas.
assert.equal(metadata.capabilities.ajuste, true, 'Restart the API with scenario adjustment support.');
const normalRequest = buildRequest(farm, weightedHistory, { mes_plantio: 10, horizonte: 2 }, metadata.cultures, metadata);
assert.ok(!Object.hasOwn(normalRequest, 'ajuste'));
assert.ok(!Object.hasOwn(weightedBaseline.entrada, 'ajuste'));
const adjustmentCases = [
  { chuva_pct: -20, temp_c: 0 }, { chuva_pct: 0, temp_c: 2 },
  { chuva_pct: -20, temp_c: 2 }, { chuva_pct: -50, temp_c: 4 },
  { chuva_pct: 30, temp_c: 0 }, { chuva_pct: -12.5, temp_c: 0.5 },
];
for (const ajuste of adjustmentCases) {
  const request = buildRequest(farm, weightedHistory, { mes_plantio: 10, horizonte: 2, ajuste }, metadata.cultures, metadata);
  assert.deepEqual(request.ajuste, ajuste);
  const raw = await requestAnalysis(baseUrl, request);
  assertAdjustmentApplied(raw, request);
  assert.equal(raw.origem.hoje, 'tabela_demo');
  const view = mapMotorAnalysis(raw, farm);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id));
  assert.match(view.adjustment_note, /simulation, not.*forecast/);
  assert.match(view.scenario_note, /2020\/21.*not the original observations/);
  assert.notDeepEqual(raw.clima, weightedBaseline.clima);
  assert.ok(raw.sequencias.some(seq => seq.hoje.receita_ha !== weightedBaseline.sequencias.find(other => other.id === seq.id).hoje.receita_ha));
}
const zero = await requestAnalysis(baseUrl, { ...normalRequest, ajuste: { chuva_pct: 0, temp_c: 0 } });
assertAdjustmentApplied(zero, { ...normalRequest, ajuste: { chuva_pct: 0, temp_c: 0 } });
assert.deepEqual(zero.clima, weightedBaseline.clima);
assert.deepEqual(zero.sequencias, weightedBaseline.sequencias);
const reset = await requestAnalysis(baseUrl, normalRequest);
assert.deepEqual(reset, weightedBaseline);
await assert.rejects(requestAnalysis(baseUrl, { ...normalRequest, ajuste: { chuva_pct: -51, temp_c: 0 } }), /HTTP 422/);
console.log(`${adjustmentCases.length} real adjustments passed, including endpoints and fractions; zero adjustment and reset preserve the baseline, and out-of-range input is rejected.`);
