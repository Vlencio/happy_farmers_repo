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
  ({ codigo, tipo, dados, cultura, cenario, texto: 'Texto de teste entregue pelo motor.' });
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
  assert.deepEqual(corn.risks.map(risk => risk.context), ['Milho · safrinha · clima de hoje', 'Milho · safrinha · clima futuro']);
  assert.deepEqual(corn.risks.map(risk => risk.evidence), ['Fator de atendimento hídrico: 72,4 / 100.', 'Fator de atendimento hídrico: 72,1 / 100.']);
  assert.deepEqual(corn.gaps, []);
  assert.equal(corn.summary, '2 riscos sinalizados e 0 lacunas de informação.');
  assert.match(corn.note, /não garante ausência de risco/);

  const bean = show(find('soja>feijao'));
  assert.equal(bean.risks.length, 4);
  assert.equal(bean.gaps.length, 2); // 32 °C threshold and the bean price marked "memoria" in culturas.csv
  assert.equal(bean.risks[0].context, 'Feijão · safrinha · clima de hoje');
  assert.equal(bean.risks[1].context, 'Feijão · safrinha · clima futuro');
  assert.equal(bean.risks[0].evidence, 'Fator de calor: 77,6 / 100.');
  assert.equal(bean.risks[1].evidence, 'Fator de calor: 46,1 / 100.');
  assert.equal(bean.risks[2].title, 'Praga ou doença em comum com a cultura anterior');
  assert.match(bean.risks[2].evidence, /Cultura anterior: Soja.*mosca-branca.*Fator por hospedeiro comum: 0,75×; fator de sequência aplicado: 0,75×/);
  assert.equal(bean.risks[3].evidence, '160 dias expostos; 190,1 mm de chuva sobre o solo exposto.');
  assert.equal(bean.gaps[0].evidence, 'Limiar usado: 32 °C.');
  assert.ok(!JSON.stringify(bean).includes('feijao'));
});

test('adapter preserves engine ranking and gives current rotation the same sequence warnings', () => {
  const raw = structuredClone(fixtures[2]);
  const view = mapMotorAnalysis(raw, { area_ha: 2 });
  assert.deepEqual(view.recommendations.map(rec => rec.sequence_id), ['soja>milho', 'soja>sorgo', 'soja>crotalaria']);
  for (const rec of [...view.recommendations, view.current_rotation.strategy]) {
    assert.deepEqual(rec.warnings, show(find(rec.sequence_id, raw)));
  }
  const corn = view.current_rotation.strategy.warnings;
  const cover = view.recommendations.find(rec => rec.sequence_id === 'soja>crotalaria').warnings;
  assert.equal(corn.risks.length, 4); // Two water limitations today/future and two in the dry year.
  assert.equal(corn.gaps.length, 0);
  assert.equal(cover.risks.length, 2);
  assert.equal(cover.gaps.length, 2);
  const dryRisks = corn.risks.filter(risk => risk.context.includes('ano seco'));
  assert.equal(dryRisks.length, 2);
  assert.match(dryRisks[0].evidence, /77,8/);
  assert.match(dryRisks[1].evidence, /44,7/);

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
  assert.equal(view.gaps[0].context, 'Crotalária');
  assert.match(view.gaps[0].description, /não comprova tolerância/);
  assert.match(view.gaps[1].description, /não significa que a cultura não tenha valor/);
  assert.match(view.gaps[1].evidence, /R\$\s*0\/t/);
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
  assert.match(view.risks[0].evidence, /atendimento hídrico: 42 \/ 100/);
  assert.equal(view.risks[3].evidence, 'Fator de sequência aplicado: 0,85×.');
  assert.match(view.gaps[4].evidence, /1,05/);
  assert.match(view.gaps[5].evidence, /Preço: R\$\s*3\.400\/t. Situação: memória/);
  assert.ok(!JSON.stringify(view).includes('Texto de teste'));
});

test('common hosts retain previous-crop evidence and distinguish pest penalty from the combined factor', () => {
  const original = withWarnings(warning('hospedeiro_comum', 'risco', {
    penalidade: 0.92, fator_sequencia: 1.012, anterior: 'crotalaria',
    pragas: ['mofo-branco (Sclerotinia sclerotiorum)'], slot: 'safra',
  }, 'feijao'));
  const before = structuredClone(original);
  const item = show(original).risks[0];
  assert.equal(item.context, 'Feijão · safra');
  assert.match(item.description, /Crotalária.*provisória.*não indica uma ocorrência medida/);
  assert.match(item.evidence, /Cultura anterior: Crotalária.*mofo-branco.*0,92×.*1,012×/);
  assert.match(item.card_summary, /Feijão após Crotalária/);
  assert.doesNotMatch(JSON.stringify(item), /feijao|crotalaria|Outro risco informado/);
  assert.deepEqual(original, before);
});

test('daily water warns with the median-year factor, raw water attendance and Ky without merging monthly evidence', () => {
  const seq = withWarnings(
    warning('fator_limitante', 'risco', { fator: 'agua', valor: 0.75, slot: 'safrinha' }, 'feijao', 'hoje'),
    warning('fator_agua_diario', 'risco', { fator_agua: 0.696, atendimento_hidrico: 0.757, ky: 1.25, slot: 'safrinha' }, 'feijao', 'hoje'),
  );
  const [monthly, daily] = show(seq).risks;
  assert.equal(daily.title, 'Limitação por água no modo diário');
  assert.equal(daily.context, 'Feijão · safrinha · clima de hoje · modo diário · ano mediano');
  assert.equal(daily.evidence, 'Fator por falta de água: 69,6 / 100. Atendimento hídrico: 75,7 / 100. Ky: 1,25.');
  assert.match(monthly.description, /avaliação mensal/);
  assert.match(daily.description, /ano mediano.*Ky.*diferente do balanço mensal/);
  assert.doesNotMatch(daily.card_summary, /75,7|probabilidade/);
});

test('model rank warnings show source positions and model names without treating the range as probability', () => {
  const seq = withWarnings(warning('rank_varia_entre_modelos', 'risco', {
    rank_min: 1, rank_max: 12, por_modelo: { MIROC6: 1, 'ACCESS-CM2': 12, 'MRI-ESM2-0': 4 }, limite: 5,
  }, null, 'futuro'));
  const before = structuredClone(seq);
  const item = show(seq).risks[0];
  assert.equal(item.context, 'Sequência inteira · clima futuro');
  assert.equal(item.card_summary, 'No futuro, posição de 1ª a 12ª entre modelos.');
  assert.match(item.evidence, /1ª a 12ª.*MIROC6: 1ª; ACCESS-CM2: 12ª; MRI-ESM2-0: 4ª.*5 posições/);
  assert.match(item.description, /não é um intervalo de confiança nem uma probabilidade/);
  assert.deepEqual(seq, before);
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
    assert.throws(() => show(withWarnings(item)), /contrato do motor: avisos/);
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
  assert.equal(view.risks[0].context, 'Soja · safra · ano seco');
  assert.equal(view.risks[1].context, 'Sequência inteira · clima futuro');
  assert.match(view.risks[1].description, /modo diário/);
  assert.match(view.risks[1].description, /não é o cenário fixo de ano seco/);
  assert.doesNotMatch(JSON.stringify(view), /1 em 5|probabilidade/);
});

test('legacy omission is unavailable, while an empty list is a valid evaluated result', () => {
  const seq = { culturas: ['soja'] };
  assert.equal(validateSequenceWarnings(seq, ['hoje', 'futuro']), false);
  assert.equal(show(seq), null);
  seq.avisos = [];
  assert.equal(validateSequenceWarnings(seq, ['hoje', 'futuro']), true);
  assert.equal(show(seq).risks.length, 0);
  seq.avisos = null;
  assert.throws(() => show(seq), /contrato do motor: avisos.lista/);
});

test('unknown future codes preserve classification, supplied text and JSON evidence', () => {
  const seq = withWarnings(warning('nova_regra', 'risco', {
    intensidade: 12.35, observada: false, meses: [1, 2], detalhe: { origem: 'estação' }, fonte: null,
  }, 'feijao', 'hoje'));
  seq.avisos[0].texto = 'Aviso novo recebido do motor.';
  const view = show(seq);
  assert.equal(view.risks.length, 1);
  assert.equal(view.gaps.length, 0);
  assert.equal(view.risks[0].description, 'Aviso novo recebido do motor.');
  assert.equal(view.risks[0].context, 'Feijão · clima de hoje');
  assert.match(view.risks[0].evidence, /intensidade: 12,35.*observada: não.*meses: 1, 2.*origem: estação.*fonte: não informado/);
  seq.avisos[0].tipo = 'lacuna';
  assert.equal(show(seq).gaps.length, 1);
});

test('data-status evidence includes temperature units and preserves absent or new field values', () => {
  const check = dados => show(withWarnings(warning('valor_a_conferir', 'lacuna', dados, 'feijao'))).gaps[0];
  assert.equal(check({ campo: 'temp_calor_c', status: 'sem fonte', valor: 32 }).evidence,
    'Limiar de calor: 32 °C. Situação: sem fonte.');
  assert.match(check({ campo: 'preco', status: 'memoria', valor: null }).evidence, /Preço: não informado/);
  assert.match(check({ campo: 'produtividade_safrinha', status: 'a conferir', valor: 1.7 }).evidence, /1,7 t\/ha/);
  assert.equal(check({ campo: 'nova_fonte', status: 'provisório', valor: 'observação local' }).evidence,
    'nova fonte: observação local. Situação: provisório.');
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
    assert.throws(() => show(withWarnings(item)), /Resposta incompatível com o contrato do motor: avisos/);
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
