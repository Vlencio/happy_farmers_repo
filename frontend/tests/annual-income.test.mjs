import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapMotorAnalysis, validateMotorOutput } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const february = load('motor-fevereiro');
const dry = load('motor-seco');
const farm = normalizeFarm(load('metadata').demo_field.boundary);
const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

test('annual income and occupied years come from each actual scenario while full-sequence revenue stays distinct', () => {
  for (const raw of [february, dry]) {
    const view = mapMotorAnalysis(raw, farm);
    const cards = [...view.recommendations, ...(view.current_rotation.strategy ? [view.current_rotation.strategy] : [])];
    assert.deepEqual(view.recommendations.map(card => card.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id));
    for (const card of cards) {
      const seq = raw.sequencias.find(item => item.id === card.sequence_id);
      for (const [scenario, label] of [['hoje', 'hoje'], ['futuro', 'futuro'], ['seco', 'ano seco']]) {
        if (!seq[scenario]) continue;
        const annual = card.facts.find(fact => fact.label === `Receita / ha / ano · ${label}`);
        const years = card.facts.find(fact => fact.label === `Anos considerados · ${label}`);
        assert.equal(annual.value, money(seq[scenario].receita_ano_ha));
        assert.equal(years.value, `${number(seq[scenario].anos_ocupados)} ${seq[scenario].anos_ocupados === 1 ? 'ano' : 'anos'}`);
        assert.equal(card.facts.find(fact => fact.label === `Receita / ha · ${label}`).value, money(seq[scenario].receita_ha));
      }
      assert.match(card.tradeoff, /somam toda a sequência.*receita por ano de ocupação.*mínimo de 1 ano/);
    }
  }
  const winner = mapMotorAnalysis(february, farm).recommendations[0];
  assert.notEqual(winner.facts.find(fact => fact.label === 'Receita / ha / ano · hoje').value,
    winner.facts.find(fact => fact.label === 'Receita / ha · hoje').value);
});

test('legacy responses omit annual facts instead of deriving an annual amount in the front', () => {
  const raw = structuredClone(dry);
  for (const seq of raw.sequencias) {
    for (const scenario of ['hoje', 'futuro', 'seco']) {
      delete seq[scenario].anos_ocupados;
      delete seq[scenario].receita_ano_ha;
    }
  }
  const view = mapMotorAnalysis(raw, farm);
  for (const card of view.recommendations) {
    assert.equal(card.facts.length, 9);
    assert.ok(card.facts.every(fact => !fact.label.includes('/ ano') && !fact.label.includes('Anos considerados')));
    assert.match(card.tradeoff, /não informa receita anual nem anos de ocupação/);
  }
});

test('annual income accepts zero but rejects missing partners, nonfinite numbers and values outside the contract', () => {
  const invalid = [
    result => delete result.anos_ocupados,
    result => delete result.receita_ano_ha,
    ...[null, '1', 0, .999, NaN, Infinity].map(value => result => { result.anos_ocupados = value; }),
    ...[null, '0', -1, NaN, Infinity].map(value => result => { result.receita_ano_ha = value; }),
  ];
  for (const scenario of ['hoje', 'futuro', 'seco']) {
    for (const mutate of invalid) {
      const raw = structuredClone(dry);
      mutate(raw.sequencias[0][scenario]);
      assert.throws(() => validateMotorOutput(raw), /anos_ocupados|receita_ano_ha/);
    }
  }
  const raw = structuredClone(dry);
  raw.sequencias[0].hoje.receita_ano_ha = 0;
  raw.sequencias[0].hoje.anos_ocupados = 1;
  const facts = mapMotorAnalysis(raw, farm).recommendations[0].facts;
  assert.equal(facts.find(fact => fact.label === 'Receita / ha / ano · hoje').value, money(0));
  assert.equal(facts.find(fact => fact.label === 'Anos considerados · hoje').value, '1 ano');
});
