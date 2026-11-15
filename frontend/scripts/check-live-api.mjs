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
    const history = [{ crop: 'Crotalária', season: '2025', notes: 'Somente local' }];
    const request = buildRequest(farm, history, { horizonte, mes_plantio }, metadata.cultures);
    const raw = await requestAnalysis(baseUrl, request);
    assert.equal(raw.origem.hoje, 'tabela_demo');
    assert.equal(raw.entrada.altitude_m, 484.41, 'A API usa a altitude SRTM do talhão de demonstração.');
    assert.ok(raw.sequencias.every(seq => !seq.culturas.includes('trigo')), 'Trigo abaixo da altitude mínima não entra nas opções viáveis.');
    assert.equal(raw.clima.seco.length, 12);
    assert.deepEqual(raw.entrada.rotacao_atual, ['crotalaria']);
    assert.equal(raw.entrada.horizonte, horizonte);
    assert.equal(raw.entrada.mes_plantio, mes_plantio);
    assert.equal(raw.sequencias.length + raw.descartadas.length, metadata.cultures.length ** horizonte);
    const view = mapMotorAnalysis(raw, farm);
    assert.match(view.source_warning, /talhão de demonstração/);
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
        `#${source.rank_hoje}`, `${source.hoje.score.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 100`,
        `#${source.rank_futuro}`, `${source.futuro.score.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} / 100`,
      ]);
      assert.ok(Array.isArray(source.avisos), 'A API deve repassar os avisos do motor atualizado.');
      assert.equal(rec.warnings.risks.length, source.avisos.filter(warning => warning.tipo === 'risco').length);
      assert.equal(rec.warnings.gaps.length, source.avisos.filter(warning => warning.tipo === 'lacuna').length);
      assert.ok(Array.isArray(source.beneficios), 'A API deve repassar os benefícios do motor atualizado.');
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
console.log(`${calls} combinações de mês/horizonte passaram na API real; ${empty} sem sequência viável, ${extended} timelines acima de 12 meses.`);

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
    if (status === 'discarded' && altitude) {
      assert.equal(raw.atual.motivo.altitude_min_m, 800);
      assert.equal(raw.atual.motivo.altitude_m, 484.41);
      assert.match(view.current_rotation.description, /altitude.*800.*484,41/i);
      assert.doesNotMatch(view.current_rotation.description, /não cabe no calendário/);
    } else if (status === 'discarded') assert.match(view.current_rotation.description, /não tem plantio previsto na safrinha/);
  }
}
console.log(`${currentCases.length} casos de rotação atual passaram na API real, incluindo histórico longo, slot equivalente, descartes por calendário/altitude e ausência de histórico.`);

// Ranking comes from a new engine analysis for each set of priorities.
// Keep the demo field and soybean/corn history used in the engine's examples:
// history contributes to soil diversity, so empty history can change tied scores.
const weightedHistory = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
const weightedCases = [
  { name: 'pesos iguais', prioridades: { agua: 1, solo: 1, renda: 1 }, ids: ['soja>crotalaria', 'soja>milho', 'soja>sorgo'] },
  { name: 'só renda', prioridades: { agua: 0, solo: 0, renda: 3 }, ids: ['soja>milho', 'soja>sorgo', 'soja>girassol'] },
  { name: 'só solo', prioridades: { agua: 0, solo: 3, renda: 0 }, ids: ['soja>crotalaria', 'feijao>crotalaria', 'milho>crotalaria'] },
  { name: 'só água e desempate do motor', prioridades: { agua: 3, solo: 0, renda: 0 }, ids: ['soja>crotalaria', 'soja>feijao', 'soja>milheto'] },
  { name: 'todos zero usam pesos iguais', prioridades: { agua: 0, solo: 0, renda: 0 }, ids: ['soja>crotalaria', 'soja>milho', 'soja>sorgo'] },
];
let weightedBaseline;
for (const { name, prioridades, ids } of weightedCases) {
  const request = buildRequest(farm, weightedHistory, { mes_plantio: 10, horizonte: 2, prioridades }, metadata.cultures);
  assert.deepEqual(request.prioridades, prioridades, name);
  const raw = await requestAnalysis(baseUrl, request);
  if (name === 'pesos iguais') weightedBaseline = raw;
  const view = mapMotorAnalysis(raw, farm);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), ids, name);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id), name);
  assert.equal(view.current_rotation.status, 'ready');
  assert.equal(view.current_rotation.strategy.sequence_id, 'soja>milho');
  assert.ok(view.recommendations.every(rec => rec.reason.includes(view.priority_note)), name);
  if (prioridades.agua === 3) assert.ok(raw.sequencias.slice(0, 3).every(seq => seq.hoje.score === 100));
  if (name.includes('iguais')) assert.deepEqual(raw.entrada.prioridades, { agua: 0.333, solo: 0.333, renda: 0.333 });
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
console.log(`${weightedCases.length} cenários de prioridades passaram na API real; fevereiro tem crotalaria>soja e sorgo>soja nas duas primeiras posições, e feijao>soja muda de 3º hoje para 9º no futuro.`);

// The actual API now owns what-if calculations. Exercise the browser request
// builder, effective echo and presentation, without reproducing climate formulas.
assert.equal(metadata.capabilities.ajuste, true, 'Reinicie a API com o suporte real a ajustes.');
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
  assert.match(view.adjustment_note, /simulação, não.*previsão/);
  assert.match(view.scenario_note, /2020\/21.*não são as observações originais/);
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
console.log(`${adjustmentCases.length} ajustes reais passaram, incluindo limites e frações; ajuste zero e reset preservam a análise normal e entrada fora da faixa é recusada.`);
