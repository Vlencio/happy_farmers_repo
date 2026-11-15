import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildBenefits, validateSequenceBenefits } from '../web/benefits.mjs';
import { cropLabel } from '../web/api.mjs';

const fixtures = ['motor', 'motor-fevereiro', 'motor-seco'].map(name =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))));
const find = (id, fixture = fixtures[0]) => fixture.sequencias.find(seq => seq.id === id);
const show = seq => buildBenefits(seq, cropLabel);
const benefit = (codigo, dados = {}, cultura = null, cenario = null) =>
  ({ codigo, dados, cultura, cenario, texto: 'Texto de teste entregue pelo motor.' });
const withBenefits = (...beneficios) => ({ culturas: ['soja', 'feijao'], beneficios });

test('all real benefits validate and keep the supplied order and evidence unchanged', () => {
  for (const fixture of fixtures) {
    const before = structuredClone(fixture);
    const scenarios = fixture.clima.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'];
    for (const seq of fixture.sequencias) {
      assert.equal(validateSequenceBenefits(seq, scenarios), true);
      const view = show(seq);
      assert.equal(view.items.length, seq.beneficios.length);
      assert.ok(view.items.every(item =>
        ['title', 'context', 'description', 'evidence', 'card_summary'].every(key => typeof item[key] === 'string' && item[key])));
      assert.ok(view.items.every(item => item.title !== 'Outro benefício informado'));
    }
    assert.deepEqual(fixture, before);
  }
});

test('soybean-corn displays its four delivered benefits and exact source values without inventing favorable climate', () => {
  const corn = find('soja>milho');
  assert.deepEqual(corn.beneficios.map(item => item.codigo), [
    'fixa_nitrogenio', 'deixa_palhada', 'pouco_solo_exposto', 'estavel_no_futuro',
  ]); // the nitrogen bonus now follows only a green manure (engine rule 10), not soybean
  const view = show(corn);
  assert.equal(view.summary, '4 benefícios apontados pelo motor.');
  assert.equal(view.items[0].context, 'Soja');
  assert.equal(view.items[1].context, 'Milho');
  assert.equal(view.items[2].evidence, '10 dias expostos; 74,3 mm de chuva sobre o solo exposto.');
  assert.match(view.items[3].evidence, /queda de 1,5%.*13\.003.*12\.808/);
  assert.ok(view.items.every(item => item.title !== 'Fatores favoráveis hoje e no futuro'));
});

test('benefits remain strategy-specific and use accented crop names', () => {
  const bean = show(find('soja>feijao'));
  const cover = show(find('soja>crotalaria'));
  assert.equal(bean.items.length, 3);
  assert.equal(bean.items[1].context, 'Feijão');
  assert.ok(bean.items.slice(0, 2).every(item => item.title === 'Fixação de nitrogênio'));
  assert.equal(bean.items[2].title, 'Estabilidade de receita no futuro');
  assert.equal(cover.items[1].context, 'Crotalária');
  assert.equal(find('soja>crotalaria').hoje.culturas[1].mes_plantio, 2);
  assert.match(cover.items[3].evidence, /10 dias.*74,3 mm/);
  assert.ok(!JSON.stringify(bean).includes('feijao'));
  assert.ok(!JSON.stringify(cover).includes('crotalaria'));
});

test('fixation and mulch are explicitly table attributes and model assumptions', () => {
  const view = show(find('soja>milho'));
  assert.equal(find('soja>milho').hoje.culturas[0].fixa_n, true);
  assert.equal(find('soja>milho').hoje.culturas[1].cobre_solo, true);
  assert.match(view.items[0].description, /tabela.*atributo.*não é uma medição/);
  assert.match(view.items[1].description, /supõe.*próximo plantio.*sem medir quantidade ou duração/);
  assert.match(view.note, /não comprovam um resultado no talhão/);
});

test('nitrogen benefit distinguishes green manure, elapsed days and the final factor after a host penalty', () => {
  // Synthetic combined factor: the front displays the supplied evidence without recreating the host table.
  const seq = { culturas: ['milho'], beneficios: [benefit('bonus_apos_fixadora', { fator_sequencia: 1.012, slot: 'safra', dias_apos_anterior: 37 }, 'milho')] };
  const before = structuredClone(seq);
  const item = show(seq).items[0];
  assert.equal(item.title, 'Bônus após adubo verde');
  assert.match(item.description, /não fixadora.*adubo verde.*60 dias.*provisórios.*desconto por hospedeiro comum/);
  assert.equal(item.evidence, 'Plantio 37 dias após o fim do ciclo anterior. Fator de sequência aplicado: 1,012×.');
  assert.equal(item.card_summary, 'Milho · safra: após adubo verde, fator 1,012×.');
  assert.deepEqual(seq, before);
  delete seq.beneficios[0].dados.dias_apos_anterior;
  assert.equal(show(seq).items[0].evidence, 'Intervalo entre culturas não informado nesta resposta. Fator de sequência aplicado: 1,012×.');
});

test('climate benefit covers today and future even when dry-year risks exist', () => {
  const sorghum = find('soja>sorgo', fixtures[2]);
  assert.ok(sorghum.avisos.some(item => item.codigo === 'fator_limitante' && item.cenario === 'seco'));
  const climate = show(sorghum).items[sorghum.beneficios.findIndex(item => item.codigo === 'clima_favoravel')];
  assert.equal(climate.title, 'Fatores favoráveis hoje e no futuro');
  assert.equal(climate.context, 'Sequência inteira · clima de hoje e futuro');
  assert.equal(climate.evidence, 'Menor fator entre as culturas, hoje e no futuro: 90,2 / 100.');
  assert.match(climate.description, /avaliação mensal.*não inclui o ano seco.*nem comprova resistência/);
  assert.ok(!climate.card_summary.includes('ano seco'));
});

test('negative decline is displayed as revenue growth without recalculating source evidence', () => {
  const seq = withBenefits(benefit('estavel_no_futuro', { queda: -0.125, receita_hoje: 8000, receita_futuro: 9000 }, null, 'futuro'));
  const item = show(seq).items[0];
  assert.match(item.evidence, /alta de 12,5%.*8\.000.*9\.000/);
  assert.equal(item.card_summary, 'Receita no futuro: alta de 12,5%.');
  assert.match(item.description, /Não é previsão de preço.*nem de lucro/);
  seq.beneficios[0].dados.queda = 0;
  assert.match(show(seq).items[0].card_summary, /sem variação/);
});

test('zero exposed days are preserved and repeated crop benefits are not duplicated', () => {
  const zero = withBenefits(benefit('pouco_solo_exposto', { dias_expostos: 0, chuva_exposta_mm: 0 }));
  assert.equal(show(zero).items[0].evidence, '0 dias expostos; 0 mm de chuva sobre o solo exposto.');
  const repeated = find('feijao>feijao');
  assert.ok(repeated);
  assert.equal(repeated.beneficios.filter(item => item.codigo === 'fixa_nitrogenio').length, 1);
  assert.equal(show(repeated).items.filter(item => item.title === 'Fixação de nitrogênio').length, 1);
});

test('absent benefits remain unavailable rather than an empty result', () => {
  assert.equal(show({ culturas: ['soja'] }), null);
  assert.equal(validateSequenceBenefits({ culturas: ['soja'] }, ['hoje', 'futuro']), false);
  const empty = show(withBenefits());
  assert.deepEqual(empty.items, []);
  assert.equal(empty.summary, 'Nenhum benefício sinalizado pelo motor nesta sequência.');
  assert.match(empty.note, /Considere também os riscos e as lacunas/);
});

test('future benefit codes retain supplied plain text, context and nested evidence', () => {
  const unknown = benefit('beneficio_novo', { valor_medido: 12.345, observacoes: { verificado: false, referencia: null }, amostras: [1, 2] }, 'feijao', 'hoje');
  unknown.texto = '<b>Texto simples do motor, sem executar HTML.</b>';
  const item = show(withBenefits(unknown)).items[0];
  assert.equal(item.title, 'Outro benefício informado');
  assert.equal(item.description, unknown.texto);
  assert.equal(item.context, 'Feijão · clima de hoje');
  assert.match(item.evidence, /valor medido: 12,345.*verificado: não.*referencia: não informado.*amostras: 1, 2/);
  assert.match(item.card_summary, /Feijão/);
});

test('malformed envelopes and invalid crop or scenario scope are rejected', () => {
  const cases = [
    { culturas: ['soja'], beneficios: null },
    withBenefits(null),
    withBenefits({}),
    withBenefits(benefit('fixa_nitrogenio')),
    withBenefits(benefit('fixa_nitrogenio', {}, 'milho')),
    withBenefits(benefit('fixa_nitrogenio', {}, 'soja', 'hoje')),
    withBenefits(benefit('pouco_solo_exposto', { dias_expostos: 1, chuva_exposta_mm: 1 }, 'soja')),
    withBenefits(benefit('estavel_no_futuro', { queda: 0, receita_hoje: 1, receita_futuro: 1 }, null, 'hoje')),
    withBenefits(benefit('novo', {}, null, 'desconhecido')),
    withBenefits({ ...benefit('novo'), texto: '' }),
    withBenefits({ ...benefit('novo'), dados: [] }),
  ];
  for (const seq of cases) assert.throws(() => validateSequenceBenefits(seq, ['hoje', 'futuro']), /contrato do motor: beneficios\./);
});

test('nonfinite evidence and invalid numerical ranges cannot enter the UI', () => {
  const examples = [
    benefit('novo', { nested: { valor: NaN } }),
    benefit('bonus_apos_fixadora', { fator_sequencia: -1, slot: 'safra' }, 'soja'),
    benefit('bonus_apos_fixadora', { fator_sequencia: 1.1, slot: 'inverno' }, 'soja'),
    benefit('bonus_apos_fixadora', { fator_sequencia: 1.1, slot: 'safra', dias_apos_anterior: -1 }, 'soja'),
    benefit('bonus_apos_fixadora', { fator_sequencia: 1.1, slot: 'safra', dias_apos_anterior: 0.5 }, 'soja'),
    benefit('bonus_apos_fixadora', { fator_sequencia: 1.1, slot: 'safra', dias_apos_anterior: '10' }, 'soja'),
    benefit('pouco_solo_exposto', { dias_expostos: 1.5, chuva_exposta_mm: 0 }),
    benefit('pouco_solo_exposto', { dias_expostos: 366, chuva_exposta_mm: 0 }),
    benefit('pouco_solo_exposto', { dias_expostos: 0, chuva_exposta_mm: -1 }),
    benefit('estavel_no_futuro', { queda: Infinity, receita_hoje: 1, receita_futuro: 1 }, null, 'futuro'),
    benefit('estavel_no_futuro', { queda: 0, receita_hoje: -1, receita_futuro: 1 }, null, 'futuro'),
    benefit('clima_favoravel', { menor_fator: 1.1 }),
    benefit('clima_favoravel', { menor_fator: '0.8' }),
  ];
  for (const item of examples) assert.throws(() => show(withBenefits(item)), /beneficios/);
});

test('front validation does not recreate the engine benefit thresholds', () => {
  // Synthetically outside today's selection rules but structurally valid: the front does not reclassify them.
  const seq = withBenefits(
    benefit('pouco_solo_exposto', { dias_expostos: 80, chuva_exposta_mm: 250 }),
    benefit('estavel_no_futuro', { queda: 0.2, receita_hoje: 100, receita_futuro: 80 }, null, 'futuro'),
    benefit('clima_favoravel', { menor_fator: 0.7 }),
  );
  assert.equal(validateSequenceBenefits(seq, ['hoje', 'futuro']), true);
  assert.equal(show(seq).items.length, 3);
});
