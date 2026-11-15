import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, validateSettings, validateMotorOutput, buildRequest, requestAnalysis, requestMetadata, mapMotorAnalysis } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/motor.json', import.meta.url)));
const february = JSON.parse(readFileSync(new URL('./fixtures/motor-fevereiro.json', import.meta.url)));
const dryYear = JSON.parse(readFileSync(new URL('./fixtures/motor-seco.json', import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL('./fixtures/metadata.json', import.meta.url)));
const farm = normalizeFarm({ type: 'Polygon', coordinates: [[[-49,-21],[-48,-21],[-48,-20],[-49,-20],[-49,-21]]] });
const copy = () => structuredClone(fixture);

test('consumes the actual engine contract and keeps its first three ranked sequences', () => {
  validateMotorOutput(fixture);
  const result = mapMotorAnalysis(fixture, farm);
  assert.equal(result.demo, false);
  assert.deepEqual(result.recommendations.map((r) => r.category), ['rank1', 'rank2', 'rank3']);
  assert.deepEqual(result.recommendations.map((r) => r.sequence_id), ['soja>crotalaria', 'soja>milho', 'soja>sorgo']);
  assert.match(result.priority_note, /water 33\.3%, soil 33\.3% and income 33\.3%.*Equal weights/);
  const februaryWinner = mapMotorAnalysis(february, farm).recommendations[0];
  assert.equal(februaryWinner.sequence_id, 'crotalaria>soja');
  assert.deepEqual(februaryWinner.rank_facts, [
    { label: 'Rank · today', value: '#1' }, { label: 'Score · today', value: '78.1 / 100' },
    { label: 'Rank · future', value: '#1' }, { label: 'Score · future', value: '77.5 / 100' },
  ]);
  assert.equal(result.discarded.length, 75);
});
test('current rotation stays beside the three winners with comparable actual engine metrics', () => {
  const view = mapMotorAnalysis(fixture, farm);
  const current = view.current_rotation;
  assert.equal(current.status, 'ready');
  assert.equal(current.title, 'Current rotation');
  assert.equal(current.strategy.category, 'current');
  assert.equal(current.strategy.sequence_id, 'soja>milho');
  // The reference is also the second ranked card; both roles must remain visible.
  assert.equal(view.recommendations.length, 3);
  const rankedCurrent = view.recommendations.find(card => card.sequence_id === current.strategy.sequence_id);
  assert.equal(rankedCurrent.category, 'rank2');
  assert.deepEqual(current.strategy.timeline, rankedCurrent.timeline);
  assert.deepEqual(current.strategy.facts, rankedCurrent.facts);
  assert.deepEqual(current.strategy.rank_facts, rankedCurrent.rank_facts);
  assert.doesNotMatch(view.recommendations[0].tradeoff, /reference from your crop history/);
  const money = (v) => v.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  const index = (v) => `${(v * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })} / 100`;
  for (const card of [current.strategy, ...view.recommendations]) {
    const source = fixture.sequencias.find((seq) => seq.id === card.sequence_id);
    assert.deepEqual(card.comparison_facts, [
      { label: 'Revenue / ha · today', value: money(source.hoje.receita_ha) },
      { label: 'Soil · today', value: index(source.hoje.solo) },
      { label: 'Suitability · future', value: index(source.futuro.encaixe) },
    ]);
  }
});
test('current rotation outside the calendar explains the actual discard without inventing metrics', () => {
  const view = mapMotorAnalysis(february, farm);
  const current = view.current_rotation;
  assert.equal(current.status, 'discarded');
  assert.equal(current.strategy, null);
  assert.match(current.description, /Soybean → Corn/);
  assert.match(current.description, /has no planting window in the second season/);
  assert.doesNotMatch(current.description, /BRL/);
  assert.equal(view.recommendations.length, 3);
});

// Presentation-only altitude case: remove a viable sequence and compact the
// supplied ranks, without pretending to recompute its agricultural scores.
function altitudeDiscard() {
  const data = copy(), id = 'soja>trigo';
  const seq = data.sequencias.find(seq => seq.id === id);
  assert.ok(seq, 'The fixture must contain the calendar-feasible wheat sequence');
  data.sequencias = data.sequencias.filter(seq => seq.id !== id);
  for (const scenario of ['hoje', 'futuro']) {
    [...data.sequencias].sort((a, b) => a[`rank_${scenario}`] - b[`rank_${scenario}`])
      .forEach((seq, i) => { seq[`rank_${scenario}`] = i + 1; });
  }
  const motivo = { cultura: 'trigo', posicao: 2, slot: 'safrinha', mes_livre: 2,
    mes_plantio: 3, altitude_min_m: 800, altitude_m: 484.41 };
  data.entrada.altitude_m = 484.41;
  data.entrada.rotacao_atual = [...seq.culturas];
  data.descartadas.push({ id, culturas: [...seq.culturas], atual: true, motivo });
  data.atual = { id, culturas: [...seq.culturas], viavel: false, motivo: structuredClone(motivo) };
  for (const item of [...data.sequencias, ...data.descartadas]) item.atual = item.id === id;
  return data;
}

test('altitude discards explain the minimum and field elevation in both reference formats', () => {
  const data = altitudeDiscard();
  for (const legacy of [false, true]) {
    const raw = structuredClone(data);
    if (legacy) delete raw.atual;
    const view = mapMotorAnalysis(raw, farm);
    const reason = view.discarded.find(reason => reason.startsWith('Soybean → Wheat:'));
    assert.match(reason, /Wheat.*minimum elevation of 800 m.*field is at 484\.41 m/);
    assert.doesNotMatch(reason, /only available|has no planting window/);
    assert.equal(view.current_rotation.status, 'discarded');
    assert.equal(view.current_rotation.strategy, null);
    assert.match(view.current_rotation.description, /excluded due to elevation.*800 m.*484\.41 m/);
    assert.doesNotMatch(view.current_rotation.description, /calendar|BRL/);
    assert.match(view.summary, /excluded by the engine/);
    assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), data.sequencias.slice(0, 3).map(seq => seq.id));
  }
  // The dedicated reference is sufficient even if no full discarded list is sent.
  data.descartadas = [];
  assert.match(mapMotorAnalysis(data, farm).current_rotation.description, /excluded due to elevation/);
});

test('legacy calendar reasons keep their explanation even when the API echoes altitude', () => {
  const old = mapMotorAnalysis(february, farm);
  const raw = structuredClone(february); raw.entrada.altitude_m = 484.41;
  const view = mapMotorAnalysis(raw, farm);
  assert.deepEqual(view.current_rotation, old.current_rotation);
  assert.deepEqual(view.discarded, old.discarded);
  assert.match(view.current_rotation.description, /does not fit the selected calendar.*has no planting window/);
});

test('altitude discard evidence must be complete, finite, below the minimum and agree with the input', () => {
  const changes = [
    r => { delete r.altitude_min_m; }, r => { delete r.altitude_m; },
    r => { r.altitude_min_m = null; }, r => { r.altitude_m = null; },
    r => { r.altitude_min_m = '800'; }, r => { r.altitude_m = '484.41'; },
    r => { r.altitude_min_m = Infinity; }, r => { r.altitude_m = NaN; },
    r => { r.altitude_m = -101; }, r => { r.altitude_m = 6001; },
    r => { r.altitude_m = 500; }, r => { r.altitude_min_m = 484.41; },
    r => { r.altitude_min_m = 400; }, r => { r.mes_plantio = null; },
  ];
  for (const reference of [false, true]) for (const change of changes) {
    const raw = altitudeDiscard();
    change(reference ? raw.atual.motivo : raw.descartadas.find(seq => seq.id === 'soja>trigo').motivo);
    assert.throws(() => validateMotorOutput(raw), /motivo.altitude/);
  }
  for (const altitude of [null, '484.41', NaN, Infinity, -101, 6001]) {
    const raw = altitudeDiscard(); raw.entrada.altitude_m = altitude;
    assert.throws(() => validateMotorOutput(raw), /entrada.altitude_m/);
  }
  const missing = altitudeDiscard(); delete missing.entrada.altitude_m;
  assert.throws(() => validateMotorOutput(missing), /motivo.altitude/);
});
// Derived cases below exercise presentation states, not fresh engine calculations.
test('missing history and a missing current marker have distinct states without replacing the winners', () => {
  const data = copy();
  delete data.atual; // Legacy response without the dedicated reference.
  for (const seq of [...data.sequencias, ...data.descartadas]) seq.atual = false;
  const missing = mapMotorAnalysis(data, farm);
  assert.equal(missing.current_rotation.status, 'unavailable');
  assert.equal(missing.current_rotation.strategy, null);
  data.entrada.rotacao_atual = [];
  data.atual = null;
  const noHistory = mapMotorAnalysis(data, farm);
  assert.equal(noHistory.current_rotation.status, 'no_history');
  assert.equal(noHistory.current_rotation.strategy, null);
  assert.match(noHistory.current_rotation.description, /Add your crop history/);
  assert.deepEqual(noHistory.recommendations.map((r) => r.sequence_id), missing.recommendations.map((r) => r.sequence_id));
});
test('long history uses the corrected engine reference without a horizon-length block', () => {
  const data = copy();
  data.entrada.rotacao_atual = ['algodao', 'soja', 'milho'];
  const view = mapMotorAnalysis(data, farm);
  assert.equal(view.current_rotation.status, 'ready');
  assert.equal(view.current_rotation.strategy.sequence_id, 'soja>milho');
  const rankedCurrent = view.recommendations.find(card => card.sequence_id === 'soja>milho');
  assert.deepEqual(view.current_rotation.strategy.comparison_facts, rankedCurrent.comparison_facts);
  assert.match(rankedCurrent.tradeoff, /reference from your crop history/);
  assert.doesNotMatch(view.recommendations[0].tradeoff, /reference from your crop history/);
});
test('dedicated reference supplies identity and discard reason while markers remain a legacy fallback', () => {
  const data = copy();
  for (const seq of [...data.sequencias, ...data.descartadas]) seq.atual = false;
  const current = mapMotorAnalysis(data, farm).current_rotation;
  assert.equal(current.strategy.sequence_id, data.atual.id);
  const cards = mapMotorAnalysis(data, farm).recommendations;
  assert.match(cards.find(card => card.sequence_id === data.atual.id).tradeoff, /reference from your crop history/);
  assert.ok(cards.filter(card => card.sequence_id !== data.atual.id).every(card => !card.tradeoff.includes('reference from your crop history')));

  const discarded = structuredClone(february);
  discarded.descartadas = [];
  for (const seq of discarded.sequencias) seq.atual = false;
  assert.equal(mapMotorAnalysis(discarded, farm).current_rotation.status, 'discarded');
  assert.match(mapMotorAnalysis(discarded, farm).current_rotation.description, /has no planting window in the second season/);

  const legacy = copy(); delete legacy.atual;
  assert.deepEqual(mapMotorAnalysis(legacy, farm).current_rotation, mapMotorAnalysis(fixture, farm).current_rotation);
  const legacyDiscarded = structuredClone(february); delete legacyDiscarded.atual;
  assert.equal(mapMotorAnalysis(legacyDiscarded, farm).current_rotation.status, 'discarded');

  // An older deployed API can still mark the first crops, so its long history is unsafe.
  legacy.entrada.rotacao_atual = ['soja', 'milho', 'algodao'];
  const oldView = mapMotorAnalysis(legacy, farm);
  assert.equal(oldView.current_rotation.status, 'unavailable');
  assert.equal(oldView.current_rotation.strategy, null);
  assert.ok(oldView.recommendations.every(card => !card.tradeoff.includes('reference from your crop history')));
});
test('rejects malformed dedicated references rather than displaying another sequence or empty metrics', () => {
  for (const change of [
    (v) => v.atual = null,
    (v) => v.atual = 'soja>milho',
    (v) => v.entrada.rotacao_atual = [],
    (v) => v.atual.viavel = 'true',
    (v) => v.atual.culturas = ['milho', 'soja'],
    (v) => v.atual.motivo = {},
    (v) => { v.atual.id = 'desconhecida>milho'; v.atual.culturas[0] = 'desconhecida'; },
    (v) => { v.atual.viavel = false; v.atual.motivo = null; },
  ]) { const data = copy(); change(data); assert.throws(() => validateMotorOutput(data), /contract/); }
});
test('a one-crop history uses the repeated sequence supplied by the engine and explains it', () => {
  const data = copy();
  data.entrada.rotacao_atual = ['milho'];
  data.atual = { id: 'milho>milho', culturas: ['milho', 'milho'], viavel: true, motivo: null };
  for (const seq of [...data.sequencias, ...data.descartadas]) seq.atual = seq.id === 'milho>milho';
  const view = mapMotorAnalysis(data, farm);
  assert.equal(view.current_rotation.status, 'ready');
  assert.equal(view.current_rotation.strategy.sequence_id, 'milho>milho');
  assert.match(view.current_rotation.description, /repeats it in both positions/);
  assert.deepEqual(view.recommendations.map((r) => r.sequence_id), mapMotorAnalysis(fixture, farm).recommendations.map((r) => r.sequence_id));
});
test('rejects malformed history and multiple current markers across feasible and discarded sequences', () => {
  for (const history of [undefined, null, 'soja', [null], [''], Array(13).fill('soja')]) {
    const data = copy(); data.entrada.rotacao_atual = history;
    assert.throws(() => validateMotorOutput(data), /entrada.rotacao_atual/);
  }
  const data = copy(); data.descartadas[0].atual = true;
  assert.throws(() => validateMotorOutput(data), /more than one current rotation/);
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
  assert.throws(() => buildRequest(farm, [{ crop: 'Café' }], undefined, metadata.cultures), /Café.*catalog/);
  assert.throws(() => buildRequest(farm, [], { mes_plantio: 0, horizonte: 2 }), /month/);
});
test('preserves engine order despite individual revenue, soil and future metrics', () => {
  const data = copy();
  const target = data.sequencias.find((s) => s.futuro.culturas.every((c) => c.receita_ha > 0) && s.rank_hoje > 1);
  target.hoje.receita_ha = 999999;
  target.hoje.solo = 1;
  target.futuro.encaixe = 1;
  target.futuro.agua = 1;
  const mapped = mapMotorAnalysis(data, farm);
  assert.deepEqual(mapped.recommendations.map(rec => rec.sequence_id), data.sequencias.slice(0, 3).map(seq => seq.id));
});
test('does not re-sort or break ties in the engine ranking', () => {
  const data = copy();
  data.entrada.prioridades = { agua: 1, solo: 0, renda: 0 };
  for (const seq of data.sequencias) { seq.hoje.score = 100; seq.hoje.agua = 1; }
  data.sequencias.reverse(); // Adapter-only case: the response order is authoritative.
  const view = mapMotorAnalysis(data, farm);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), data.sequencias.slice(0, 3).map(seq => seq.id));
  assert.match(view.priority_note, /water 100%, soil 0% and income 0%/);
  assert.doesNotMatch(view.priority_note, /Equal weights/);
});
test('keeps cover crops ranked by the engine without a commercial filter', () => {
  const data = copy();
  const cover = data.sequencias.find((s) => s.id === 'soja>milheto');
  assert.ok(cover.futuro.receita_ha > 0);
  assert.ok(cover.futuro.culturas.some((c) => c.receita_ha === 0));
  data.sequencias = [cover, ...data.sequencias.filter(seq => seq !== cover)];
  const rec = mapMotorAnalysis(data, farm).recommendations[0];
  assert.equal(rec.sequence_id, cover.id);
  assert.match(rec.reason, /Rank.*among viable sequences.*Priorities/i);
  assert.doesNotMatch(rec.reason, /all crops generate revenue|objective/);
});
test('sends every UI priority exactly, including all zeros, and rejects invalid controls', () => {
  for (const prioridades of [{ agua: 3, solo: 2, renda: 0 }, { agua: 0, solo: 0, renda: 3 }, { agua: 0, solo: 0, renda: 0 }]) {
    const request = buildRequest(farm, [], { ...DEFAULT_SETTINGS, prioridades });
    assert.deepEqual(request.prioridades, prioridades);
    assert.notEqual(request.prioridades, prioridades);
  }
  assert.deepEqual(validateSettings({ mes_plantio: 2, horizonte: 1 }).prioridades, { agua: 1, solo: 1, renda: 1 });
  for (const invalid of [null, {}, { agua: 1, solo: 1 }, { agua: -1, solo: 1, renda: 1 }, { agua: 4, solo: 1, renda: 1 },
    { agua: 0.5, solo: 1, renda: 1 }, { agua: '1', solo: 1, renda: 1 }, { agua: NaN, solo: 1, renda: 1 }]) {
    assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, prioridades: invalid }), /priority from 0 to 3/);
  }
});

test('rejects missing, nonfinite or unnormalized effective response priorities', () => {
  for (const prioridades of [undefined, null, { agua: 0, solo: 0, renda: 0 }, { agua: 3, solo: 0, renda: 0 }, { agua: NaN, solo: 0, renda: 1 }]) {
    const data = copy(); data.entrada.prioridades = prioridades;
    assert.throws(() => mapMotorAnalysis(data, farm), /entrada.prioridades/);
  }
});

test('one or two viable sequences produce exactly that many distinct cards', () => {
  for (const count of [1, 2]) {
    const data = copy();
    // Keep the first entries and renumber the future rank so the reduced response stays a valid ranking.
    data.sequencias = data.sequencias.slice(0, count).map((seq, i) => ({ ...seq, rank_futuro: i + 1 }));
    // This presentation-only case has no history: slicing can remove the current rotation.
    data.entrada.rotacao_atual = []; data.atual = null;
    for (const seq of [...data.sequencias, ...data.descartadas]) seq.atual = false;
    const view = mapMotorAnalysis(data, farm);
    assert.equal(view.recommendations.length, count);
    assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), data.sequencias.map(seq => seq.id));
    assert.deepEqual(view.recommendations.map(rec => rec.category), ['rank1', 'rank2'].slice(0, count));
  }
});

test('multiplies gross revenue by farm hectares without changing engine metrics', () => {
  const result = mapMotorAnalysis(fixture, { area_ha: 2 });
  const facts = result.recommendations[0].facts;
  const source = fixture.sequencias.find((s) => s.id === result.recommendations[0].sequence_id);
  const money = (v) => v.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  assert.equal(facts[0].value, money(source.hoje.receita_ha));
  assert.equal(facts[3].value, money(source.hoje.receita_ha * 2));
});
test('timeline crosses December and preserves monthly actual/future water figures', () => {
  const result = mapMotorAnalysis(fixture, farm).recommendations[0];
  assert.deepEqual(result.month_labels.slice(0, 4), ['Oct · year 1', 'Nov · year 1', 'Dec · year 1', 'Jan · year 2']);
  assert.equal(result.timeline[1].start_month, 5);
  assert.equal(result.sequence_id, 'soja>crotalaria');
  assert.equal(result.timeline[1].end_month, 8);
  assert.equal(result.timeline[1].monthly[0].month, 'Feb · year 2');
  const source = fixture.sequencias.find((s) => s.id === result.sequence_id);
  assert.equal(result.timeline[1].monthly.length, source.hoje.culturas[1].meses.length);
  assert.match(result.timeline[1].monthly[0].deficit, /\//);
});
test('empty viable sequences remain empty, with reasons from the engine', () => {
  const data = copy(); data.sequencias = [];
  delete data.atual; // This synthetic legacy result has no current reference.
  const result = mapMotorAnalysis(data, farm);
  assert.deepEqual(result.recommendations, []);
  assert.equal(result.discarded.length, 75);
  assert.ok(result.discarded.some((reason) => reason.includes('has no planting window')));
  assert.ok(result.discarded.some((reason) => reason.includes('only available')));
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
  ]) { const data = copy(); change(data); assert.throws(() => validateMotorOutput(data), /contract/); }
});
// Synthetic extension of the contract, not an engine calculation for 2020/21.
function withDryScenario() {
  const data = copy(); data.clima.seco = structuredClone(data.clima.hoje);
  for (const seq of data.sequencias) {
    seq.seco = structuredClone(seq.hoje); seq.rank_seco = seq.rank_hoje;
    seq.seco.receita_ha = 1234;
    seq.seco.receita_ano_ha = 1234 / seq.seco.anos_ocupados;
    for (const crop of seq.seco.culturas) for (const month of crop.meses) month.chuva_mm = 7;
  }
  return data;
}
test('dry scenario is optional and supplies a third set of facts and monthly numbers when complete', () => {
  const current = mapMotorAnalysis(fixture, farm);
  assert.equal(current.recommendations[0].facts.length, 12);
  assert.match(current.scenario_note, /is not available/);
  const data = withDryScenario();
  const view = mapMotorAnalysis(data, { area_ha: 2 });
  assert.deepEqual(view.recommendations.map((r) => r.sequence_id), current.recommendations.map((r) => r.sequence_id));
  const rec = view.recommendations[0];
  assert.equal(rec.facts.length, 18);
  assert.equal(rec.facts[7].value.replace(/\s/g, ''), 'BRL2,468');
  assert.equal(rec.timeline[0].monthly[0].rain.split(' / ').at(-1), '7');
  assert.equal(rec.timeline[0].monthly[0].rain.split(' / ').length, 3);
  assert.match(rec.water_caption, /today \/ future \/ dry year/);
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
  ]) { const data = withDryScenario(); change(data); assert.throws(() => validateMotorOutput(data), /contract/); }
});
test('actual P1 dry-year output is shown without changing the three winners', () => {
  const view = mapMotorAnalysis(dryYear, farm);
  assert.deepEqual(view.recommendations.map((r) => r.sequence_id), mapMotorAnalysis(fixture, farm).recommendations.map((r) => r.sequence_id));
  assert.match(view.scenario_note, /2020\/21/);
  assert.equal(view.recommendations[0].facts.length, 18);
  assert.equal(view.recommendations[0].timeline[0].monthly[0].rain.split(' / ').length, 3);
  assert.equal(view.current_rotation.status, 'ready');
  const rankedCurrent = view.recommendations.find(card => card.sequence_id === view.current_rotation.strategy.sequence_id);
  assert.equal(rankedCurrent.category, 'rank2');
  assert.deepEqual(view.current_rotation.strategy.facts, rankedCurrent.facts);
  assert.deepEqual(view.current_rotation.strategy.timeline, rankedCurrent.timeline);
  assert.deepEqual(view.current_rotation.strategy.comparison_facts, rankedCurrent.comparison_facts);
});
test('point provenance warning reaches Rune in English without losing fallback or coverage warnings', () => {
  const raw = copy();
  raw.origem = { hoje: 'fallback_tabela_demo', aviso: 'POWER fora do ar. O ponto do talhão está fora de Minas Gerais.' };
  assert.equal(mapMotorAnalysis(raw, farm).source_warning, 'POWER is unavailable. The field point is outside Minas Gerais.');
  assert.equal(mapMotorAnalysis(fixture, farm).source_warning, '');
  raw.origem.aviso = { unexpected: true };
  assert.throws(() => validateMotorOutput(raw), /origem.aviso/);
});
test('metadata loads the engine catalog with English labels and stable crop IDs', async () => {
  const before = structuredClone(metadata);
  const result = await requestMetadata('/api', { fetcher: async () => ({ ok: true, json: async () => metadata }) });
  assert.equal(result.cultures.find((c) => c.id === 'crotalaria').label, 'Sunn hemp');
  assert.deepEqual(result.cultures.map(crop => crop.id), metadata.cultures.map(crop => crop.id));
  for (const crop of result.cultures) {
    assert.equal(buildRequest(farm, [{ crop: crop.label }], DEFAULT_SETTINGS, result.cultures).rotacao_atual[0], crop.id);
  }
  assert.match(result.data_notice, /Today’s climate.*future: around 2060/);
  assert.deepEqual(metadata, before, 'Presentation localization must not mutate the original API payload');
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
    await assert.rejects(requestMetadata('/api', { fetcher: async () => ({ ok: true, json: async () => value }) }), /contract/);
  }
});

test('near-leading scores are shown as a technical tie without changing engine ranks, scores, or current reference', () => {
  const view = mapMotorAnalysis(fixture, farm);
  assert.match(view.ranking_note, /Technical tie among the top three.*less than 2 points.*not exact equality/);
  assert.ok(view.recommendations.every(card => card.tie_note === 'Technical tie · today'));
  assert.equal(view.current_rotation.strategy.tie_note, view.recommendations.find(card => card.sequence_id === view.current_rotation.strategy.sequence_id).tie_note);
  assert.deepEqual(view.recommendations.map(card => card.sequence_id), fixture.sequencias.slice(0, 3).map(seq => seq.id));
  assert.deepEqual(view.recommendations.map(card => card.rank_facts[0].value), ['#1', '#2', '#3']);
  assert.deepEqual(view.recommendations.map(card => card.rank_facts[1].value), ['78.2 / 100', '77.9 / 100', '76.5 / 100']);
});

test('tie threshold is strict and measured from the leader rather than chaining adjacent scores', () => {
  // Synthetic scores exercise the display threshold, not a new motor calculation.
  for (const [scores, expected] of [
    [[90, 88, 87], [false, false, false]],
    [[90, 88.001, 87], [true, true, false]],
    [[90, 89, 87.5], [true, true, false]],
    [[90, 89, 88.001], [true, true, true]],
    [[90, 90, 90], [true, true, true]],
  ]) {
    const data = copy();
    data.sequencias.slice(0, 3).forEach((seq, i) => { seq.hoje.score = scores[i]; });
    const view = mapMotorAnalysis(data, farm);
    assert.deepEqual(view.recommendations.map(card => Boolean(card.tie_note)), expected);
    assert.equal(Boolean(view.ranking_note), expected[0]);
    assert.equal(Boolean(view.current_rotation.strategy.tie_note), expected[1]);
    assert.deepEqual(view.recommendations.map(card => card.sequence_id), data.sequencias.slice(0, 3).map(seq => seq.id));
  }
  const one = copy(); one.sequencias = [one.sequencias[0]];
  one.entrada.rotacao_atual = []; one.atual = null;
  for (const seq of [...one.sequencias, ...one.descartadas]) seq.atual = false;
  assert.equal(mapMotorAnalysis(one, farm).ranking_note, '');
  const empty = copy(); empty.sequencias = []; empty.atual = null; empty.entrada.rotacao_atual = [];
  assert.equal(mapMotorAnalysis(empty, farm).ranking_note, '');
});

test('current reference gets a tie only when its own sequence belongs to the leading group', () => {
  // The third card is close to the second, but outside the strict two-point band of the leader.
  const data = copy();
  data.sequencias.slice(0, 3).forEach((seq, i) => { seq.hoje.score = [90, 89, 87.5][i]; });
  const current = data.sequencias[2];
  data.entrada.rotacao_atual = [...current.culturas];
  data.atual = { id: current.id, culturas: current.culturas, viavel: true, motivo: null };
  for (const seq of [...data.sequencias, ...data.descartadas]) seq.atual = seq.id === current.id;
  const view = mapMotorAnalysis(data, farm);
  assert.deepEqual(view.recommendations.map(card => Boolean(card.tie_note)), [true, true, false]);
  assert.equal(view.current_rotation.strategy.tie_note, '');
  assert.equal(view.current_rotation.strategy.sequence_id, current.id);
  assert.deepEqual(view.current_rotation.strategy.rank_facts, view.recommendations[2].rank_facts);
});

test('raw sequence water attendance is shown separately from the rescaled water score and is optional on legacy responses', () => {
  const data = copy();
  data.sequencias[0].hoje.atendimento_hidrico = .875;
  data.sequencias[0].hoje.agua = .4; // These fields may differ; the UI must not equate them.
  const card = mapMotorAnalysis(data, farm).recommendations[0];
  assert.equal(card.facts.find(fact => fact.label === 'Water demand met · today').value, '87.5% of demand');
  for (const seq of data.sequencias) for (const scenario of ['hoje', 'futuro']) delete seq[scenario].atendimento_hidrico;
  assert.ok(mapMotorAnalysis(data, farm).recommendations.every(rec => rec.facts.every(fact => !fact.label.startsWith('Water demand met'))));
  for (const value of [null, '0.5', -.01, 1.01, NaN, Infinity]) {
    const invalid = copy(); invalid.sequencias[0].hoje.atendimento_hidrico = value;
    assert.throws(() => validateMotorOutput(invalid), /atendimento_hidrico/);
  }
});

test('crop sequence factors explain supplied repetition, green-manure bonus and shared hosts while preserving their precision', () => {
  const data = copy();
  const host = data.sequencias.find(seq => seq.id === 'soja>feijao');
  data.atual = { id: host.id, culturas: host.culturas, viavel: true, motivo: null };
  const hostView = mapMotorAnalysis(data, farm).current_rotation.strategy;
  assert.match(hostView.timeline[1].soil, /Shares a pest or disease with Soybean.*0\.75×/);
  assert.match(hostView.timeline[1].description, /10 days between the end of the previous crop/);
  // Presentation-only extension exercises a combined 1.1 × .92 factor supplied by the engine.
  const crop = data.sequencias[0].hoje.culturas[0];
  crop.bonus_n = true; crop.fator_sequencia = 1.012; crop.dias_apos_anterior = 60;
  const bonus = mapMotorAnalysis(data, farm).recommendations[0].timeline[0];
  assert.match(bonus.soil, /1\.012×.*green-manure bonus.*60-day/);
  assert.match(bonus.description, /60 days.*assumption in the calculation/);
  crop.bonus_n = false; crop.repete = true;
  assert.match(mapMotorAnalysis(data, farm).recommendations[0].timeline[0].soil, /Repeats the previous crop/);
  for (const seq of data.sequencias) for (const scenario of ['hoje', 'futuro']) for (const item of seq[scenario].culturas) {
    for (const key of ['repete', 'bonus_n', 'penalidade_hospedeiro', 'dias_apos_anterior', 'hospedeiro_comum']) delete item[key];
  }
  assert.doesNotThrow(() => mapMotorAnalysis(data, farm));
});

test('new optional crop factors reject invalid flags, intervals and host details', () => {
  for (const [key, values] of Object.entries({
    repete: ['true', null, 0], bonus_n: ['false', null, 1],
    penalidade_hospedeiro: [null, '0.92', -.01, 1.01, NaN, Infinity],
    dias_apos_anterior: ['10', -1, .5, Infinity],
    hospedeiro_comum: [false, [], {}, { anterior: 'soja', pragas: [] }, { anterior: null, pragas: ['mofo-branco'] }, { anterior: 'soja', pragas: [1] }],
  })) for (const value of values) {
    const data = copy(); data.sequencias[0].hoje.culturas[0][key] = value;
    assert.throws(() => validateMotorOutput(data), /culturas/);
  }
  const withoutPrevious = copy();
  withoutPrevious.sequencias[0].hoje.culturas[0].dias_apos_anterior = null;
  assert.doesNotThrow(() => validateMotorOutput(withoutPrevious));
});

// Synthetic model extension checks presentation/validation; it is not a claim
// about the delivered climate models or a regeneration of motor fixtures.
function withModelRanges() {
  const data = copy();
  const names = ['Modelo A', 'Modelo B'];
  data.modelos = { nomes: names, chuva: 'aproximada', et0_sem_correcao: true,
    aviso_faixa_rank: 5, primeiro: {}, clima: {} };
  for (const [m, name] of names.entries()) {
    data.modelos.clima[name] = structuredClone(data.clima.futuro);
    for (const [i, seq] of data.sequencias.entries()) {
      if (m === 0) seq.modelos = { por_modelo: [] };
      const rank = (i + m + 1) % data.sequencias.length + 1;
      seq.modelos.por_modelo.push({ modelo: name, rank, score: 70 - i,
        receita_ano_ha: 1000 + i * 100 + m * 50 });
      if (rank === 1) data.modelos.primeiro[name] = seq.id;
    }
  }
  for (const seq of data.sequencias) {
    const ranks = seq.modelos.por_modelo.map(model => model.rank);
    const revenues = seq.modelos.por_modelo.map(model => model.receita_ano_ha);
    Object.assign(seq.modelos, { rank_min: Math.min(...ranks), rank_max: Math.max(...ranks),
      receita_ano_ha_min: Math.min(...revenues), receita_ano_ha_max: Math.max(...revenues) });
  }
  return data;
}

test('future model ranges use only per-model ranks and annual revenues, keeping the mean future distinct', () => {
  const data = withModelRanges();
  const view = mapMotorAnalysis(data, farm);
  const card = view.recommendations[0];
  assert.match(card.model_note, /ranks #2–#3 \(2 models\).*not a confidence interval.*Rainfall is approximated/);
  assert.equal(card.rank_facts[2].value, '#1'); // Mean future can lie outside the individual-model rank range.
  assert.deepEqual(card.facts.slice(-2), [
    { label: 'Rank · future across models', value: '#2–#3' },
    { label: 'Revenue / ha / year · future across models', value: 'BRL\u00a01,000 to BRL\u00a01,050' },
  ]);
  const rankedCurrent = view.recommendations.find(rec => rec.sequence_id === view.current_rotation.strategy.sequence_id);
  assert.equal(view.current_rotation.strategy.model_note, rankedCurrent.model_note);
  assert.match(view.current_rotation.strategy.model_note, /ranks #3–#4/);
  assert.notEqual(view.current_rotation.strategy.model_note, card.model_note);
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), data.sequencias.slice(0, 3).map(seq => seq.id));
  assert.ok(mapMotorAnalysis(fixture, farm).recommendations.every(rec => rec.model_note === ''));
  data.modelos.chuva = 'razao';
  assert.doesNotMatch(mapMotorAnalysis(data, farm).recommendations[0].model_note, /approximated/);
});

test('model ranges reject incomplete sets, malformed climates and inconsistent ranges instead of showing invented uncertainty', () => {
  for (const mutate of [
    data => delete data.modelos,
    data => { data.modelos = null; },
    data => delete data.sequencias[0].modelos,
    data => { data.modelos.nomes[1] = data.modelos.nomes[0]; },
    data => { data.modelos.chuva = 'previsao'; },
    data => { data.modelos.et0_sem_correcao = 'true'; },
    data => { data.modelos.aviso_faixa_rank = -1; },
    data => { data.modelos.primeiro['Modelo A'] = 'desconhecida'; },
    data => { data.modelos.clima['Modelo A'][0].mes = 2; },
    data => { data.modelos.clima['Modelo A'][0].chuva_mm = NaN; },
    data => data.modelos.clima['Modelo A'].pop(),
    data => data.sequencias[0].modelos.por_modelo.pop(),
    data => { data.sequencias[0].modelos.por_modelo[0].modelo = 'Outro'; },
    data => { data.sequencias[0].modelos.por_modelo[0].rank = 0; },
    data => { data.sequencias[0].modelos.por_modelo[0].score = 101; },
    data => { data.sequencias[0].modelos.por_modelo[0].receita_ano_ha = -1; },
    data => { data.sequencias[0].modelos.rank_min = 1; },
    data => { data.sequencias[0].modelos.rank_max = 2.5; },
    data => { data.sequencias[0].modelos.receita_ano_ha_min = 0; },
    data => { data.sequencias[0].modelos.receita_ano_ha_max = Infinity; },
  ]) {
    const data = withModelRanges(); mutate(data);
    assert.throws(() => validateMotorOutput(data), /modelos/);
  }
  const empty = withModelRanges(); empty.sequencias = []; empty.atual = null; empty.entrada.rotacao_atual = [];
  for (const name of empty.modelos.nomes) empty.modelos.primeiro[name] = null;
  assert.deepEqual(mapMotorAnalysis(empty, farm).recommendations, []);
});
