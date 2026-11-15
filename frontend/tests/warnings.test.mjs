import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWarnings, validateSequenceWarnings } from '../web/warnings.mjs';
import { cropLabel, mapMotorAnalysis, validateMotorOutput } from '../web/api.mjs';

const fixtures = ['motor', 'motor-fevereiro', 'motor-seco'].map(name =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))));
const find = (id, fixture = fixtures[0]) => fixture.sequencias.find(seq => seq.id === id);
const show = seq => buildWarnings(seq, cropLabel);
const warning = (codigo, tipo, dados = {}, cultura = null, cenario = null) =>
  ({ codigo, tipo, dados, cultura, cenario, texto: 'Texto de teste entregue by the engine.' });
const withWarnings = (...avisos) => ({ culturas: ['soja', 'feijao'], avisos });

test('all actual fixture warnings validate without changing supplied evidence', () => {
  for (const fixture of fixtures) {
    const before = structuredClone(fixture);
    const scenarios = fixture.clima.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
    for (const seq of fixture.sequencias) {
      assert.equal(validateSequenceWarnings(seq, scenarios), true);
      const view = show(seq);
      assert.equal(view.risks.length + view.gaps.length, seq.avisos.length);
      assert.ok([...view.risks, ...view.gaps].every(item =>
        ['title', 'context', 'description', 'evidence', 'card_summary'].every(key => typeof item[key] === 'string' && item[key])));
    }
    assert.deepEqual(fixture, before);
  }
});

test('actual soybean-corn and soybean-bean strategies show different risks and their evidence', () => {
  const corn = show(find('soja>milho'));
  assert.equal(corn.risks.length, 2);
  assert.deepEqual(corn.risks.map(risk => risk.context), ['Corn · Second season · today\'s climate', 'Corn · Second season · future climate']);
  assert.deepEqual(corn.risks.map(risk => risk.evidence), ['water demand met factor: 72.4 / 100.', 'water demand met factor: 72.1 / 100.']);
  assert.deepEqual(corn.gaps, []);
  assert.equal(corn.summary, '2 flagged risks and 0 data gaps.');
  assert.match(corn.note, /does not guarantee freedom from risk/);

  const bean = show(find('soja>feijao'));
  assert.equal(bean.risks.length, 4);
  assert.equal(bean.gaps.length, 2); // 32 °C threshold and the bean price marked "memoria" in culturas.csv
  assert.equal(bean.risks[0].context, 'Common bean · Second season · today\'s climate');
  assert.equal(bean.risks[1].context, 'Common bean · Second season · future climate');
  assert.equal(bean.risks[0].evidence, 'heat factor: 77.6 / 100.');
  assert.equal(bean.risks[1].evidence, 'heat factor: 46.1 / 100.');
  assert.equal(bean.risks[2].title, 'Shared pest or disease with the previous crop');
  assert.match(bean.risks[2].evidence, /Previous crop: Soybean.*whitefly.*Shared-host factor: 0.75×; applied sequence factor: 0.75×/);
  assert.match(bean.risks[2].evidence, /Pests or diseases: white mold \(Sclerotinia sclerotiorum\); whitefly \(Bemisia tabaci\), vector of bean golden mosaic virus\./);
  assert.doesNotMatch(bean.risks[2].evidence, /vetora|mosaico|feijoeiro/);
  assert.equal(bean.risks[3].evidence, '160 exposed days; 190.1 mm of rain on exposed soil.');
  assert.equal(bean.gaps[0].evidence, 'Threshold used: 32 °C.');
  assert.ok(!JSON.stringify(bean).includes('feijao'));
});

test('adapter preserves engine ranking and gives current rotation the same sequence warnings', () => {
  const raw = structuredClone(fixtures[2]);
  const view = mapMotorAnalysis(raw, { area_ha: 2 });
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), ['soja>crotalaria', 'soja>milho', 'soja>sorgo']);
  for (const rec of [...view.recommendations, view.current_rotation.strategy]) {
    assert.deepEqual(rec.warnings, show(find(rec.sequence_id, raw)));
  }
  const corn = view.current_rotation.strategy.warnings;
  const cover = view.recommendations.find(rec => rec.sequence_id === 'soja>crotalaria').warnings;
  assert.equal(corn.risks.length, 4); // Two water limitations today/future and two in the dry year.
  assert.equal(corn.gaps.length, 0);
  assert.equal(cover.risks.length, 2);
  assert.equal(cover.gaps.length, 2);
  const dryRisks = corn.risks.filter(risk => risk.context.includes('dry year'));
  assert.equal(dryRisks.length, 2);
  assert.match(dryRisks[0].evidence, /77.8/);
  assert.match(dryRisks[1].evidence, /44.7/);

  for (const seq of raw.sequencias) delete seq.avisos;
  const legacy = mapMotorAnalysis(raw, { area_ha: 2 });
  assert.ok(legacy.recommendations.every(rec => rec.warnings === null));
  assert.equal(legacy.current_rotation.strategy.warnings, null);
  raw.sequencias[0].avisos = [warning('sem_historico', 'lacuna')];
  raw.sequencias[0].avisos[0].dados.invalido = NaN;
  assert.throws(() => validateMotorOutput(raw), /avisos/);
});

test('actual cover crop gaps do not misrepresent absent heat penalties or zero price as benefits', () => {
  const view = show(find('soja>crotalaria'));
  assert.equal(view.risks.length, 0);
  assert.equal(view.gaps.length, 2);
  assert.equal(view.gaps[0].context, 'Sunn hemp');
  assert.match(view.gaps[0].description, /does not demonstrate heat tolerance/);
  assert.match(view.gaps[1].description, /not evidence that the crop has no value/);
  assert.match(view.gaps[1].evidence, /Sales revenue is excluded by the price/);
  assert.doesNotMatch(view.gaps[1].evidence, /BRL\s*0/);
  assert.ok(!view.gaps[0].card_summary.includes('crotalaria'));
});

test('all fourteen supported warning codes have specific labels, evidence and concise summaries', () => {
  // Synthetic contract examples cover the daily-only and pending data-status fields.
  const seq = withWarnings(
    warning('fator_limitante', 'risco', { fator: 'agua', valor: 0.42, slot: 'safra' }, 'soja', 'hoje'),
    warning('queda_no_futuro', 'risco', { queda: 0.25, receita_hoje: 4000, receita_futuro: 3000 }, null, 'futuro'),
    warning('queda_no_ano_ruim', 'risco', { queda: 0.5, receita_mediano: 4000, receita_ruim: 2000 }, null, 'hoje'),
    warning('repete_a_cultura', 'risco', { fator_sequencia: 0.85, slot: 'safrinha' }, 'feijao'),
    warning('solo_exposto', 'risco', { dias_expostos: 60, chuva_exposta_mm: 123.456 }),
    warning('sem_historico', 'lacuna'),
    warning('sem_limiar_de_calor', 'lacuna', {}, 'feijao'),
    warning('limiar_de_calor_pouco_confiavel', 'lacuna', { temp_calor_c: 32 }, 'feijao'),
    warning('sem_valor_de_mercado', 'lacuna', {}, 'feijao'),
    warning('ky_padrao', 'lacuna', { ky: 1.05 }, 'feijao'),
    warning('valor_a_conferir', 'lacuna', { campo: 'preco', status: 'memoria', valor: 3400 }, 'feijao'),
    warning('hospedeiro_comum', 'risco', { fator_sequencia: 0.75, penalidade: 0.75, anterior: 'soja', pragas: ['mosca-branca'], slot: 'safrinha' }, 'feijao'),
    warning('fator_agua_diario', 'risco', { fator_agua: 0.696, atendimento_hidrico: 0.757, ky: 1.25, slot: 'safrinha' }, 'feijao', 'hoje'),
    warning('rank_varia_entre_modelos', 'risco', { rank_min: 2, rank_max: 10, por_modelo: { MIROC6: 2, 'ACCESS-CM2': 10 }, limite: 5 }, null, 'futuro'),
  );
  const view = show(seq);
  assert.equal(view.risks.length, 8);
  assert.equal(view.gaps.length, 6);
  assert.equal(new Set([...view.risks, ...view.gaps].map(item => item.title)).size, 14);
  assert.match(view.risks[0].evidence, /water demand met factor: 42 \/ 100/);
  assert.equal(view.risks[3].evidence, 'Applied sequence factor: 0.85×.');
  assert.match(view.gaps[4].evidence, /1.05/);
  assert.match(view.gaps[5].evidence, /Price: BRL\s*3,400\/t. Status: from memory/);
  assert.ok(!JSON.stringify(view).includes('Texto de teste'));
});

test('late planting is a data gap with crop, slot and nominal and actual months', () => {
  const late = warning('plantio_tardio', 'lacuna', { slot: 'safra', mes_nominal: 10, mes_real: 11 }, 'soja');
  const before = structuredClone(late);
  const view = show(withWarnings(late));
  assert.equal(view.risks.length, 0);
  assert.equal(view.gaps.length, 1);
  const [item] = view.gaps;
  assert.equal(item.title, 'Late planting');
  assert.equal(item.context, 'Soybean · Main season');
  assert.equal(item.evidence, 'Usual planting month: October. Planted in: November.');
  assert.equal(item.card_summary, 'Soybean · Main season: late planting in November (usual: October).');
  assert.match(item.description, /no yield reduction/);
  assert.doesNotMatch(JSON.stringify(item), /soja|Texto de teste|Additional/);
  assert.deepEqual(late, before);
  const cases = [
    w => { w.tipo = 'risco'; }, w => { w.cultura = null; }, w => { w.cenario = 'hoje'; },
    w => { w.dados.slot = 'inverno'; }, w => { w.dados.mes_real = 13; }, w => { w.dados.mes_nominal = 0; },
    w => { w.dados.mes_real = 10.5; }, w => { delete w.dados.mes_nominal; }, w => { w.dados.mes_real = 10; },
  ];
  for (const mutate of cases) {
    const item = structuredClone(late); mutate(item);
    assert.throws(() => show(withWarnings(item)), /engine contract: avisos/);
  }
});

test('common hosts retain previous-crop evidence and distinguish pest penalty from the combined factor', () => {
  const original = withWarnings(warning('hospedeiro_comum', 'risco', {
    penalidade: 0.92, fator_sequencia: 1.012, anterior: 'crotalaria',
    pragas: ['mofo-branco (Sclerotinia sclerotiorum)'], slot: 'safra',
  }, 'feijao'));
  const before = structuredClone(original);
  const item = show(original).risks[0];
  assert.equal(item.context, 'Common bean · Main season');
  assert.match(item.description, /Sunn hemp.*provisional.*does not indicate a measured occurrence/);
  assert.match(item.evidence, /Previous crop: Sunn hemp.*white mold.*0.92×.*1.012×/);
  assert.match(item.card_summary, /Common bean after Sunn hemp/);
  assert.doesNotMatch(JSON.stringify(item), /feijao|crotalaria|Additional engine risk/);
  assert.deepEqual(original, before);
});

test('daily water warns with the median-year factor, raw water attendance and Ky without merging monthly evidence', () => {
  const seq = withWarnings(
    warning('fator_limitante', 'risco', { fator: 'agua', valor: 0.75, slot: 'safrinha' }, 'feijao', 'hoje'),
    warning('fator_agua_diario', 'risco', { fator_agua: 0.696, atendimento_hidrico: 0.757, ky: 1.25, slot: 'safrinha' }, 'feijao', 'hoje'),
  );
  const [monthly, daily] = show(seq).risks;
  assert.equal(daily.title, 'Water limitation in daily mode');
  assert.equal(daily.context, 'Common bean · Second season · today\'s climate · daily mode · median year');
  assert.equal(daily.evidence, 'Water-shortage factor: 69.6 / 100. Water demand met: 75.7 / 100. Ky: 1.25.');
  assert.match(monthly.description, /monthly assessment/);
  assert.match(daily.description, /median year.*Ky.*separate from the monthly water balance/);
  assert.doesNotMatch(daily.card_summary, /75.7|probability/);
});

test('model rank warnings show source positions and model names without treating the range as probability', () => {
  const seq = withWarnings(warning('rank_varia_entre_modelos', 'risco', {
    rank_min: 1, rank_max: 12, por_modelo: { MIROC6: 1, 'ACCESS-CM2': 12, 'MRI-ESM2-0': 4 }, limite: 5,
  }, null, 'futuro'));
  const before = structuredClone(seq);
  const item = show(seq).risks[0];
  assert.equal(item.context, 'Whole sequence · future climate');
  assert.equal(item.card_summary, 'Future ranks range from #1 to #12 across models.');
  assert.match(item.evidence, /#1 to #12.*MIROC6: #1; ACCESS-CM2: #12; MRI-ESM2-0: #4.*5 positions/);
  assert.match(item.description, /neither a confidence interval nor a probability/);
  assert.deepEqual(seq, before);
});

test('income-ceiling gaps show raw revenue ratios per scenario and model and reject malformed evidence', () => {
  const capped = warning('renda_no_teto', 'lacuna', {
    teto: 8330.4, renda_bruta: { hoje: 1.52, futuro: 0.824 }, por_modelo: { MIROC6: 0.774, 'MRI-ESM2-0': 1.048 },
  });
  const before = structuredClone(capped);
  const item = show(withWarnings(capped)).gaps[0];
  assert.equal(item.title, 'Income score at its maximum');
  assert.equal(item.context, 'Whole sequence');
  assert.match(item.evidence, /BRL\s*8,330\/ha\/year.*today's climate 152%; future climate 82.4%; future climate \(MIROC6\) 77.4%; future climate \(MRI-ESM2-0\) 104.8%/);
  assert.equal(item.card_summary, 'Income score capped (today\'s climate, future climate (MRI-ESM2-0)).');
  assert.deepEqual(capped, before);
  const cases = [
    w => { w.tipo = 'risco'; }, w => { w.cenario = 'hoje'; }, w => { w.cultura = 'soja'; },
    w => { w.dados.teto = 0; }, w => { delete w.dados.renda_bruta; }, w => { w.dados.renda_bruta = {}; },
    w => { w.dados.renda_bruta.seco = 1.2; }, w => { w.dados.renda_bruta.hoje = -1; },
    w => { w.dados.por_modelo = {}; }, w => { w.dados.por_modelo.MIROC6 = '0.7'; },
  ];
  for (const mutate of cases) {
    const bad = structuredClone(capped); mutate(bad);
    assert.throws(() => show(withWarnings(bad)), /engine contract: avisos/);
  }
});

test('new warning contracts reject malformed evidence and scope but do not repeat the engine trigger thresholds', () => {
  const host = warning('hospedeiro_comum', 'risco', { fator_sequencia: 1.012, penalidade: 0.92, anterior: 'crotalaria', pragas: ['mofo-branco'], slot: 'safra' }, 'soja');
  const daily = warning('fator_agua_diario', 'risco', { fator_agua: 0.69, atendimento_hidrico: 0.75, ky: 1.25, slot: 'safrinha' }, 'feijao', 'hoje');
  const models = warning('rank_varia_entre_modelos', 'risco', { rank_min: 1, rank_max: 10, por_modelo: { MIROC6: 1, 'ACCESS-CM2': 10 }, limite: 5 }, null, 'futuro');
  const cases = [
    [host, w => { w.cultura = null; }], [host, w => { w.cenario = 'hoje'; }],
    [host, w => { w.dados.penalidade = 1.1; }], [host, w => { w.dados.fator_sequencia = -1; }],
    [host, w => { delete w.dados.fator_sequencia; }], [host, w => { w.dados.anterior = ''; }],
    [host, w => { w.dados.pragas = 'mofo-branco'; }], [host, w => { w.dados.pragas = []; }],
    [host, w => { w.dados.pragas = [null]; }], [host, w => { w.dados.pragas = ['']; }],
    [daily, w => { w.dados.ky = -1; }], [daily, w => { w.dados.atendimento_hidrico = 1.01; }],
    [daily, w => { w.dados.fator_agua = Infinity; }], [daily, w => { w.dados.slot = 'inverno'; }],
    [daily, w => { w.cenario = null; }], [daily, w => { w.tipo = 'lacuna'; }],
    [models, w => { w.cenario = 'hoje'; }], [models, w => { w.cultura = 'soja'; }],
    [models, w => { w.dados.rank_min = 0; }], [models, w => { w.dados.rank_max = 0.5; }],
    [models, w => { w.dados.por_modelo = []; }], [models, w => { w.dados.por_modelo = {}; }],
    [models, w => { w.dados.por_modelo.MIROC6 = 11; }], [models, w => { w.dados.por_modelo.MIROC6 = 1.5; }],
    [models, w => { w.dados.por_modelo.MIROC6 = '1'; }], [models, w => { w.dados.limite = -1; }],
  ];
  for (const [original, mutate] of cases) {
    const item = structuredClone(original); mutate(item);
    assert.throws(() => show(withWarnings(item)), /engine contract: avisos/);
  }
  daily.dados.fator_agua = 1;
  models.dados.rank_max = 1;
  models.dados.por_modelo['ACCESS-CM2'] = 1;
  assert.equal(show(withWarnings(daily, models)).risks.length, 2);
});

test('dry-year warning context remains distinct from daily bad-year comparison', () => {
  const seq = withWarnings(
    warning('fator_limitante', 'risco', { fator: 'chuva', valor: 0.5, slot: 'safra' }, 'soja', 'seco'),
    warning('queda_no_ano_ruim', 'risco', { queda: 0.3, receita_mediano: 1000, receita_ruim: 700 }, null, 'futuro'),
  );
  seq.seco = {};
  const view = show(seq);
  assert.equal(view.risks[0].context, 'Soybean · Main season · dry year');
  assert.equal(view.risks[1].context, 'Whole sequence · future climate');
  assert.match(view.risks[1].description, /Daily-mode/);
  assert.match(view.risks[1].description, /separate from the fixed dry-year scenario/);
  assert.doesNotMatch(JSON.stringify(view), /1 em 5|probability/);
});

test('legacy omission is unavailable, while an empty list is a valid evaluated result', () => {
  const seq = { culturas: ['soja'] };
  assert.equal(validateSequenceWarnings(seq, ['hoje', 'futuro']), false);
  assert.equal(show(seq), null);
  seq.avisos = [];
  assert.equal(validateSequenceWarnings(seq, ['hoje', 'futuro']), true);
  assert.equal(show(seq).risks.length, 0);
  seq.avisos = null;
  assert.throws(() => show(seq), /engine contract: avisos.lista/);
});

test('unknown future codes preserve classification and raw input without leaking untranslated prose', () => {
  const seq = withWarnings(warning('nova_regra', 'risco', {
    intensidade: 12.35, observada: false, meses: [1, 2], detalhe: { origem: 'estação' }, fonte: null,
  }, 'feijao', 'hoje'));
  seq.avisos[0].texto = 'Aviso novo recebido do motor.';
  const original = structuredClone(seq);
  const view = show(seq);
  assert.equal(view.risks.length, 1);
  assert.equal(view.gaps.length, 0);
  assert.match(view.risks[0].description, /English explanation is not yet available/);
  assert.equal(view.risks[0].context, 'Common bean · today\'s climate');
  assert.equal(view.risks[0].evidence, 'Engine code: nova_regra.');
  assert.doesNotMatch(JSON.stringify(view), /Aviso novo|intensidade|estação/);
  assert.deepEqual(seq, original);
  seq.avisos[0].tipo = 'lacuna';
  assert.equal(show(seq).gaps.length, 1);
});

test('data-status evidence includes temperature units and preserves absent or new field values', () => {
  const check = dados => show(withWarnings(warning('valor_a_conferir', 'lacuna', dados, 'feijao'))).gaps[0];
  assert.equal(check({ campo: 'temp_calor_c', status: 'sem fonte', valor: 32 }).evidence,
    'Heat threshold: 32 °C. Status: no source.');
  assert.match(check({ campo: 'preco', status: 'memoria', valor: null }).evidence, /Price: not provided/);
  assert.match(check({ campo: 'produtividade_safrinha', status: 'a conferir', valor: 1.7 }).evidence, /1.7 t\/ha/);
  assert.equal(check({ campo: 'nova_fonte', status: 'provisório', valor: 'observação local' }).evidence,
    'Additional field (nova_fonte): Text value: English translation unavailable. Status: provisional.');
});

test('malformed envelopes, nonfinite evidence and incompatible scopes are rejected', () => {
  const original = warning('fator_limitante', 'risco', { fator: 'calor', valor: 0.5, slot: 'safrinha' }, 'feijao', 'hoje');
  const mutations = [
    w => { w.tipo = 'beneficio'; }, w => { w.codigo = ''; }, w => { delete w.texto; },
    w => { w.cultura = 'milho'; }, w => { delete w.cultura; }, w => { w.cultura = null; },
    w => { w.cenario = 'seco'; }, w => { delete w.cenario; }, w => { w.cenario = null; },
    w => { w.dados = null; }, w => { w.dados = []; }, w => { w.dados.valor = NaN; },
    w => { w.dados.valor = Infinity; }, w => { w.dados.valor = -0.1; }, w => { w.dados.valor = 1.01; },
    w => { w.dados.valor = '0.5'; }, w => { w.dados.slot = 'terceira'; }, w => { w.dados.fator = 'vento'; },
    w => { w.dados.extra = { infinito: Infinity }; }, w => { w.tipo = 'lacuna'; },
  ];
  for (const mutate of mutations) {
    const item = structuredClone(original); mutate(item);
    assert.throws(() => show(withWarnings(item)), /Response does not match the engine contract: avisos/);
  }
  assert.throws(() => show(withWarnings(null)), /avisos/);
  assert.throws(() => show({ culturas: ['soja'], avisos: {} }), /avisos/);
});

test('known numerical ranges reject malformed values without enforcing warning thresholds', () => {
  const invalid = [
    warning('queda_no_futuro', 'risco', { queda: 1.1, receita_hoje: 1, receita_futuro: 0 }, null, 'futuro'),
    warning('queda_no_futuro', 'risco', { queda: 0.2, receita_hoje: 1, receita_futuro: 0 }, null, 'hoje'),
    warning('queda_no_ano_ruim', 'risco', { queda: 0.2, receita_mediano: -1, receita_ruim: 0 }, null, 'hoje'),
    warning('solo_exposto', 'risco', { dias_expostos: 366, chuva_exposta_mm: 0 }),
    warning('solo_exposto', 'risco', { dias_expostos: 1.2, chuva_exposta_mm: 0 }),
    warning('solo_exposto', 'risco', { dias_expostos: 60, chuva_exposta_mm: -1 }),
    warning('repete_a_cultura', 'risco', { fator_sequencia: 1.1, slot: 'safra' }, 'soja'),
    warning('ky_padrao', 'lacuna', { ky: -1 }, 'soja'),
    warning('valor_a_conferir', 'lacuna', { campo: 'preco', status: 'memoria' }, 'soja'),
    warning('valor_a_conferir', 'lacuna', { campo: 'preco', status: '', valor: 5 }, 'soja'),
    warning('valor_a_conferir', 'lacuna', { campo: 'preco', status: 'memoria', valor: -1 }, 'soja'),
  ];
  for (const item of invalid) assert.throws(() => show(withWarnings(item)), /avisos/);
  // The front must retain a supplied warning even if the engine changes its trigger thresholds.
  assert.equal(show(withWarnings(warning('solo_exposto', 'risco', { dias_expostos: 0, chuva_exposta_mm: 0 }))).risks.length, 1);
  assert.equal(show(withWarnings(warning('fator_limitante', 'risco', { fator: 'temperatura', valor: 1, slot: 'safra' }, 'soja', 'hoje'))).risks.length, 1);
});

test('every pest or disease the engine emits is shown whole in English; other text keeps the fallback', () => {
  const pests = pragas => show(withWarnings(warning('hospedeiro_comum', 'risco', {
    penalidade: 0.75, fator_sequencia: 0.75, anterior: 'soja', pragas, slot: 'safrinha',
  }, 'feijao'))).risks[0].evidence.match(/Pests or diseases: (.*)\. Shared-host/)[1];
  // The two texts of HOSPEDEIRO_COMUM in motor/motor.py.
  assert.equal(pests(['mofo-branco (Sclerotinia sclerotiorum)', 'mosca-branca (Bemisia tabaci), vetora do mosaico-dourado do feijoeiro']),
    'white mold (Sclerotinia sclerotiorum); whitefly (Bemisia tabaci), vector of bean golden mosaic virus');
  assert.equal(pests(['mosca-branca']), 'whitefly');
  for (const unknown of ['mosca-branca (Bemisia tabaci), vetora de outro virus', 'ferrugem-asiatica (Phakopsora pachyrhizi)', 'mofo-branco, outra praga']) {
    assert.equal(pests([unknown]), 'Additional pest or disease: English name unavailable');
  }
});
