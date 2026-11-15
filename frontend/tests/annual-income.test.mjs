import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapMotorAnalysis, validateMotorOutput } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const february = load('motor-fevereiro');
const dry = load('motor-seco');
const farm = normalizeFarm(load('metadata').demo_field.boundary);
const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });

test('annual income and occupied years come from each actual scenario while full-sequence revenue stays distinct', () => {
  for (const raw of [february, dry]) {
    const view = mapMotorAnalysis(raw, farm);
    const cards = [...view.recommendations, ...(view.current_rotation.strategy ? [view.current_rotation.strategy] : [])];
    assert.deepEqual(view.recommendations.map(card => card.sequence_id), raw.sequencias.slice(0, 3).map(seq => seq.id));
    for (const card of cards) {
      const seq = raw.sequencias.find(item => item.id === card.sequence_id);
      for (const [scenario, label] of [['hoje', 'today'], ['futuro', 'future'], ['seco', 'dry year']]) {
        if (!seq[scenario]) continue;
        const annual = card.facts.find(fact => fact.label === `Gross revenue / ha / year · ${label}`);
        const years = card.facts.find(fact => fact.label === `Years accounted for · ${label}`);
        assert.equal(annual.value, money(seq[scenario].receita_ano_ha));
        assert.equal(years.value, `${number(seq[scenario].anos_ocupados)} ${seq[scenario].anos_ocupados === 1 ? 'year' : 'years'}`);
        assert.equal(card.facts.find(fact => fact.label === `Gross revenue / ha · full rotation · ${label}`).value, money(seq[scenario].receita_ha));
        assert.equal(card.facts.find(fact => fact.label === `Gross field revenue · full rotation · ${label}`).value,
          money(seq[scenario].receita_ha * farm.area_ha));
      }
      assert.match(card.tradeoff, /Brazilian reais \(BRL\).*before costs, not profit/);
      assert.match(card.tradeoff, /cover the entire sequence.*revenue per year of field occupancy.*minimum of one year/);
    }
  }
  const winner = mapMotorAnalysis(february, farm).recommendations[0];
  assert.notEqual(winner.facts.find(fact => fact.label === 'Gross revenue / ha / year · today').value,
    winner.facts.find(fact => fact.label === 'Gross revenue / ha · full rotation · today').value);
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
    assert.equal(card.facts.length, 12);
    assert.ok(card.facts.every(fact => !fact.label.includes('/ year') && !fact.label.includes('Years accounted for')));
    assert.match(card.tradeoff, /does not include annual revenue or years of occupancy/);
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
  assert.equal(facts.find(fact => fact.label === 'Gross revenue / ha / year · today').value, money(0));
  assert.equal(facts.find(fact => fact.label === 'Years accounted for · today').value, '1 year');
});
