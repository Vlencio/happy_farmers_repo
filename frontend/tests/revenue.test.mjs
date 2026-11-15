import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapMotorAnalysis, validateMotorOutput } from '../web/api.mjs';
import { normalizeFarm } from '../web/geometry.mjs';

const load = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const october = load('motor');
const february = load('motor-fevereiro');
const dry = load('motor-seco');
const farm = normalizeFarm(load('metadata').demo_field.boundary);
const money = value => value.toLocaleString('en-US', {
  style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0,
});
const scenarios = seq => ['hoje', 'futuro', 'seco'].filter(key => seq[key]);
const current = raw => mapMotorAnalysis(raw, farm).current_rotation.strategy;

// Presentation-only envelopes, using actual crop records from the fixture.
// Scores are not recalculated: these deliberately isolate one crop's treatment,
// and remove exposure/model summaries belonging to the original full sequence.
function oneCrop(crop) {
  const raw = structuredClone(february);
  const seq = raw.sequencias.find(item => item.culturas[0] === crop);
  assert.ok(seq, `The February fixture must have ${crop} as a first crop`);
  seq.id = crop;
  seq.culturas = [crop];
  seq.atual = true;
  delete seq.modelos;
  delete seq.diario;
  for (const scenario of scenarios(seq)) {
    const result = seq[scenario];
    const record = result.culturas[0];
    result.culturas = [record];
    result.receita_ha = record.receita_ha;
    result.receita_ano_ha = record.receita_ha;
    result.anos_ocupados = 1;
    delete result.descoberto;
    seq[`rank_${scenario}`] = 1;
  }
  seq.avisos = seq.avisos.filter(item => item.cultura === crop);
  seq.beneficios = seq.beneficios.filter(item => item.cultura === crop);
  raw.sequencias = [seq];
  raw.descartadas = [];
  raw.slots = [raw.slots[0]];
  raw.entrada.horizonte = 1;
  raw.entrada.rotacao_atual = [crop];
  raw.atual = { id: crop, culturas: [crop], viavel: true, motivo: null };
  delete raw.modelos;
  return raw;
}

function zeroRevenue(raw, marketExcluded = false) {
  const seq = raw.sequencias[0];
  for (const scenario of scenarios(seq)) {
    seq[scenario].receita_ha = 0;
    seq[scenario].receita_ano_ha = 0;
    seq[scenario].culturas[0].receita_ha = 0;
  }
  seq.avisos = seq.avisos.filter(item => item.codigo !== 'sem_valor_de_mercado');
  if (marketExcluded) seq.avisos.push({
    codigo: 'sem_valor_de_mercado', tipo: 'lacuna', cultura: seq.culturas[0],
    cenario: null, dados: {}, texto: 'Valor de mercado não incluído nesta simulação.',
  });
  return raw;
}

test('real mixed rotations explain sunn hemp without changing the revenue of the whole rotation', () => {
  for (const fixture of [october, february, dry]) {
    const before = structuredClone(fixture);
    const view = mapMotorAnalysis(fixture, farm);
    assert.deepEqual(view.recommendations.map(card => card.sequence_id), fixture.sequencias.slice(0, 3).map(seq => seq.id));
    const card = view.recommendations.find(item => item.sequence_id.includes('crotalaria'));
    assert.ok(card, 'The real top three include a sunn-hemp rotation');
    const source = fixture.sequencias.find(seq => seq.id === card.sequence_id);
    assert.equal(card.comparison_facts[0].value, money(source.hoje.receita_ha));
    assert.match(card.revenue_note, /Sunn hemp/);
    assert.match(card.revenue_note, /soil|green manure/i);
    for (const scenario of scenarios(source)) {
      const label = { hoje: 'today', futuro: 'future', seco: 'dry year' }[scenario];
      assert.equal(card.facts.find(fact => fact.label === `Gross revenue / ha · full rotation · ${label}`).value,
        money(source[scenario].receita_ha));
    }
    const index = source.culturas.indexOf('crotalaria');
    const stage = card.timeline[index];
    assert.equal(stage.revenue_title, 'Green manure & soil cover');
    assert.match(stage.revenue_note, /without assigning a monetary value/i);
    assert.doesNotMatch(stage.description, /BRL\s*0\b/);
    assert.match(stage.description, /days in the crop cycle.*days waiting for planting/);
    const cashStage = card.timeline[source.culturas.findIndex(id => id !== 'crotalaria')];
    assert.match(cashStage.description, /Gross revenue.*BRL/);
    assert.deepEqual(fixture, before, 'The explanation must not modify source values, ranks or evidence');
  }
});

test('an entirely nonmarket cover crop gets its role instead of repeated zero currency facts', () => {
  for (const [crop, title] of [
    ['crotalaria', 'Green manure & soil cover'],
    ['milheto', 'Soil cover & residue'],
    ['braquiaria', 'Soil cover & residue'],
  ]) {
    const raw = oneCrop(crop), before = structuredClone(raw);
    const view = mapMotorAnalysis(raw, farm), card = view.recommendations[0];
    assert.equal(card.timeline[0].revenue_title, title);
    assert.match(card.timeline[0].revenue_note, /without assigning a monetary value/i);
    assert.match(card.comparison_facts[0].label, /role|purpose/i);
    assert.match(card.comparison_facts[0].value, /soil|green manure/i);
    assert.ok(card.facts.some(fact => /revenue treatment/i.test(fact.label)));
    assert.ok(card.facts.every(fact => !/^Gross (?:field )?revenue/.test(fact.label)), 'Do not repeat zero amounts for each period or area');
    assert.deepEqual(view.current_rotation.strategy.comparison_facts, card.comparison_facts);
    assert.deepEqual(view.current_rotation.strategy.timeline, card.timeline);
    assert.deepEqual(raw, before);
  }
});

test('an edited zero maize price is a market-data limit, not proof of a dedicated cover crop', () => {
  const raw = zeroRevenue(oneCrop('milho'), true);
  assert.equal(raw.sequencias[0].hoje.culturas[0].cobre_solo, true, 'Maize also covers the soil');
  const card = current(raw);
  assert.equal(card.comparison_facts[0].value, 'Market revenue not included');
  assert.doesNotMatch(card.comparison_facts[0].label, /role|purpose/i);
  assert.doesNotMatch(card.timeline[0].revenue_title, /Green manure|Soil cover/);
  assert.match(card.timeline[0].revenue_note, /price|market/i);
  assert.doesNotMatch(card.revenue_note, /modeled as.*(?:cover|green manure)/i);
});

test('zero from a scenario is explained neutrally and real zero water and score remain numbers', () => {
  const raw = zeroRevenue(oneCrop('milho'));
  const seq = raw.sequencias[0];
  seq.hoje.score = 0;
  seq.hoje.atendimento_hidrico = 0;
  seq.hoje.culturas[0].atendimento_hidrico = 0;
  seq.hoje.culturas[0].meses[0].deficit_mm = 0;
  const card = current(raw);
  assert.equal(card.comparison_facts[0].value, 'No revenue estimated');
  assert.match(card.timeline[0].revenue_note, /scenario|climate|price/i);
  assert.doesNotMatch(card.timeline[0].revenue_title, /Green manure|Soil cover/);
  assert.equal(card.rank_facts.find(fact => fact.label === 'Score · today').value, '0 / 100');
  assert.equal(card.facts.find(fact => fact.label === 'Water demand met · today').value, '0% of demand');
  assert.match(card.timeline[0].water, /0 \/ /);
  assert.match(card.timeline[0].monthly[0].deficit, /^0 \/ /);
});

test('cover IDs alone do not turn absent warning evidence into a soil-purpose claim', () => {
  const raw = oneCrop('crotalaria');
  delete raw.sequencias[0].avisos;
  const card = current(raw);
  assert.equal(card.comparison_facts[0].value, 'No revenue estimated');
  assert.notEqual(card.timeline[0].revenue_title, 'Green manure & soil cover');
});

test('a zero in one climate does not replace positive revenue in the other climates', () => {
  const raw = oneCrop('milho'), seq = raw.sequencias[0];
  seq.futuro.receita_ha = 0;
  seq.futuro.receita_ano_ha = 0;
  seq.futuro.culturas[0].receita_ha = 0;
  const card = current(raw);
  assert.equal(card.comparison_facts[0].value, money(seq.hoje.receita_ha));
  assert.equal(card.facts.find(fact => fact.label === 'Gross revenue / ha · full rotation · future').value, 'No revenue estimated');
  assert.match(card.timeline[0].description, /BRL.*No revenue estimated/);
  assert.match(card.timeline[0].revenue_note, /one or more scenarios/);
  assert.doesNotMatch(card.timeline[0].revenue_title, /Green manure|Soil cover/);
});

test('small positive revenue remains a positive monetary amount instead of a zero or soil-purpose note', () => {
  for (const [value, expected] of [[.1, 'BRL 0.10'], [.001, '< BRL 0.01']]) {
    const raw = oneCrop('milho'), seq = raw.sequencias[0];
    for (const scenario of scenarios(seq)) {
      seq[scenario].receita_ha = value;
      seq[scenario].receita_ano_ha = value;
      seq[scenario].culturas[0].receita_ha = value;
    }
    const card = current(raw);
    assert.equal(card.comparison_facts[0].value, expected);
    assert.equal(card.facts.find(fact => fact.label === 'Gross revenue / ha / year · today').value, expected);
    assert.equal(card.revenue_note, '');
    assert.equal(card.timeline[0].revenue_note, '');
    assert.match(card.timeline[0].description, /Gross revenue.*BRL/);
  }
});

test('classification requires the delivered soil attributes and zero revenue in all supplied climates', () => {
  for (const mutate of [
    seq => { seq.hoje.culturas[0].cobre_solo = false; },
    seq => { seq.hoje.culturas[0].fixa_n = false; },
    seq => { seq.futuro.culturas[0].receita_ha = 12; seq.futuro.receita_ha = 12; seq.futuro.receita_ano_ha = 12; },
  ]) {
    const raw = oneCrop('crotalaria');
    mutate(raw.sequencias[0]);
    // Attribute benefits are optional; exclude old evidence after the synthetic change.
    delete raw.sequencias[0].beneficios;
    const card = current(raw);
    assert.notEqual(card.timeline[0].revenue_title, 'Green manure & soil cover');
    assert.doesNotMatch(card.comparison_facts[0].label, /role|purpose/i);
  }
});

test('an unknown future crop remains neutral even with zero price and soil attributes', () => {
  const raw = oneCrop('crotalaria'), seq = raw.sequencias[0], id = 'new_crop';
  seq.id = id;
  seq.culturas = [id];
  for (const scenario of scenarios(seq)) seq[scenario].culturas[0].cultura = id;
  for (const warning of seq.avisos) warning.cultura = id;
  delete seq.beneficios;
  raw.entrada.rotacao_atual = [id];
  raw.atual = { id, culturas: [id], viavel: true, motivo: null };
  const card = current(raw);
  assert.equal(card.comparison_facts[0].value, 'Market revenue not included');
  assert.doesNotMatch(card.comparison_facts[0].label, /role|purpose/i);
  assert.doesNotMatch(card.timeline[0].revenue_title, /Green manure|Soil cover/);
});

test('missing or null revenue still violates the contract instead of becoming a cover explanation', () => {
  for (const mutate of [
    seq => { delete seq.hoje.receita_ha; },
    seq => { seq.hoje.receita_ha = null; },
    seq => { delete seq.hoje.culturas[0].receita_ha; },
    seq => { seq.hoje.culturas[0].receita_ha = null; },
    seq => { seq.hoje.receita_ano_ha = null; },
  ]) {
    const raw = oneCrop('crotalaria');
    mutate(raw.sequencias[0]);
    assert.throws(() => validateMotorOutput(raw), /receita/);
    assert.throws(() => mapMotorAnalysis(raw, farm), /receita/);
  }
});
