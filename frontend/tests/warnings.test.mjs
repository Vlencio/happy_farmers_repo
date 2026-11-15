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
  assert.deepEqual(corn.risks, []);
  assert.deepEqual(corn.gaps, []);
  assert.equal(corn.summary, 'Nenhum aviso sinalizado pelo motor nesta sequência.');
  assert.match(corn.note, /não garante ausência de risco/);

  const bean = show(find('soja>feijao'));
  assert.equal(bean.risks.length, 4);
  assert.equal(bean.gaps.length, 2); // 32 °C threshold and the bean price marked "memoria" in culturas.csv
  assert.equal(bean.risks[0].context, 'Feijão · safrinha · clima de hoje');
  assert.equal(bean.risks[1].context, 'Feijão · safrinha · clima futuro');
  assert.equal(bean.risks[0].evidence, 'Fator de calor: 77,6 / 100.');
  assert.equal(bean.risks[1].evidence, 'Fator de calor: 44,5 / 100.');
  assert.match(bean.risks[2].evidence, /11,6%.*10\.877.*9\.614/);
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
  assert.equal(corn.risks.length, 2); // The dry-year water limitations are absent from the two-climate fixture.
  assert.equal(corn.gaps.length, 0);
  assert.equal(cover.risks.length, 2);
  assert.equal(cover.gaps.length, 2);
  assert.ok(corn.risks.every(risk => risk.context.includes('ano seco')));
  assert.match(corn.risks[0].evidence, /77,8/);
  assert.match(corn.risks[1].evidence, /53/);

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

test('all eleven warning codes have specific labels, evidence and concise summaries', () => {
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
  );
  const view = show(seq);
  assert.equal(view.risks.length, 5);
  assert.equal(view.gaps.length, 6);
  assert.equal(new Set([...view.risks, ...view.gaps].map(item => item.title)).size, 11);
  assert.match(view.risks[0].evidence, /atendimento hídrico: 42 \/ 100/);
  assert.equal(view.risks[3].evidence, 'Fator de sequência aplicado: 0,85×.');
  assert.match(view.gaps[4].evidence, /1,05/);
  assert.match(view.gaps[5].evidence, /Preço: R\$\s*3\.400\/t. Situação: memória/);
  assert.ok(!JSON.stringify(view).includes('Texto de teste'));
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
