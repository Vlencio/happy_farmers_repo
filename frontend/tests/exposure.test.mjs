import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildExposure, validateSequenceExposure } from '../web/exposure.mjs';
import { mapMotorAnalysis, validateMotorOutput } from '../web/api.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/motor.json', import.meta.url)));
const february = JSON.parse(readFileSync(new URL('./fixtures/motor-fevereiro.json', import.meta.url)));
const dryYear = JSON.parse(readFileSync(new URL('./fixtures/motor-seco.json', import.meta.url)));
const find = (data, id) => data.sequencias.find((seq) => seq.id === id);
const clone = () => structuredClone(find(fixture, 'soja>milho'));

test('actual exposure distinguishes no standing crop from exposed soil for different strategies', () => {
  const income = buildExposure(find(fixture, 'soja>milho'), 10);
  const soil = buildExposure(find(fixture, 'soja>crotalaria'), 10);
  assert.deepEqual(income.card_facts, [
    { label: 'Dias expostos · 365 dias', value: '10 dias' },
    { label: 'Chuva em solo exposto · hoje', value: '74,3 mm' },
  ]);
  assert.equal(soil.card_facts[0].value, '36 dias');
  assert.equal(soil.card_facts[1].value, '237,3 mm');
  assert.equal(income.facts[0].value, '115 dias');
  assert.equal(soil.facts[0].value, '150 dias');
  assert.match(income.note, /palhada dura até o próximo plantio/);
  assert.match(income.note, /proporções.*não as datas exatas/);
});

test('fills only omitted months in the first 365 days, keeping month boundaries and years', () => {
  const exposure = buildExposure(find(fixture, 'soja>milho'), 10);
  assert.equal(exposure.months.length, 12);
  assert.match(exposure.period, /Primeiros 365 dias: out · ano 1 → set · ano 2/);
  assert.deepEqual(exposure.months.slice(0, 4).map((m) => m.label), ['out · ano 1', 'nov · ano 1', 'dez · ano 1', 'jan · ano 2']);
  assert.deepEqual(exposure.months[0], { label: 'out · ano 1', month_days: 31, days: 0, exposed_days: 0, rain: '0 / 0', exposed_rain: '0 / 0' });
  assert.equal(exposure.months[3].days, 8);
  assert.equal(exposure.months[3].exposed_days, 8);
  assert.equal(exposure.months[4].month_days, 28);
  assert.equal(exposure.months[8].days, 13);
  assert.equal(exposure.months[8].exposed_days, 0);
  assert.equal(exposure.months.reduce((total, m) => total + m.days, 0), 115);
});

test('February starts a new exposure window and calendars over 12 months do not extend it', () => {
  const exposure = buildExposure(find(february, 'milho>soja'), 2);
  assert.equal(exposure.months[0].label, 'fev · ano 1');
  assert.equal(exposure.months[11].label, 'jan · ano 2');
  assert.equal(exposure.months[11].exposed_days, 8);
  const view = mapMotorAnalysis(february, { area_ha: 2 });
  const extended = view.recommendations.find((rec) => rec.month_labels.length > 12);
  assert.ok(extended, 'Fixture must exercise a calendar longer than 12 months');
  assert.equal(extended.exposure.months.length, 12);
  assert.match(extended.exposure.caption, /somente os primeiros 12 meses/);
});

test('real dry-year exposure keeps all supplied rainfall scenarios and the same day counts', () => {
  const exposure = buildExposure(find(dryYear, 'soja>milho'), 10);
  assert.equal(exposure.facts[3].value, '74,3 / 73,2 / 51,3 mm');
  assert.equal(exposure.months[3].exposed_rain, '61,7 / 60,4 / 41,1');
  assert.equal(exposure.months[4].exposed_rain, '12,5 / 12,8 / 10,2');
  assert.match(exposure.caption, /hoje \/ futuro \/ ano seco, em milímetros/);
  assert.equal(exposure.months[3].exposed_days, 8);
});

test('zero exposure is a real result while a missing erosion index remains unavailable', () => {
  const exposure = buildExposure(find(fixture, 'milho>crotalaria'), 10);
  assert.equal(exposure.card_facts[0].value, '0 dias');
  assert.equal(exposure.card_facts[1].value, '0 mm');
  assert.ok(exposure.months.every((month) => month.exposed_days === 0));
  assert.ok(exposure.months.some((month) => month.days > 0));
  assert.equal(exposure.facts.length, 4);
  assert.match(exposure.erosion_note, /indisponível.*declividade/);
});

test('optional erosion values are displayed unchanged, including zero, without a front-end formula', () => {
  // Synthetic contract extension: these values test presentation, not erosion calculations.
  const seq = clone();
  seq.hoje.descoberto.indice_erosao = 0;
  seq.futuro.descoberto.indice_erosao = 123.45;
  const exposure = buildExposure(seq, 10);
  assert.equal(exposure.facts.at(-1).value, '0 / 123,5');
  assert.match(exposure.facts.at(-1).label, /Índice de exposição à erosão/);
  assert.match(exposure.erosion_note, /mesmo talhão/);
  assert.match(exposure.erosion_note, /não representa perda de solo em t\/ha/);
  assert.match(exposure.erosion_note, /não altera o score nem o ranking/);
});

test('legacy responses without exposure retain winners, current reference and all existing facts', () => {
  const legacy = structuredClone(fixture);
  for (const seq of legacy.sequencias) {
    delete seq.hoje.descoberto;
    delete seq.futuro.descoberto;
  }
  const current = mapMotorAnalysis(fixture, { area_ha: 2 });
  const old = mapMotorAnalysis(legacy, { area_ha: 2 });
  const withoutExposure = ({ exposure, ...rest }) => rest;
  assert.deepEqual(old.recommendations.map(withoutExposure), current.recommendations.map(withoutExposure));
  assert.deepEqual(withoutExposure(old.current_rotation.strategy), withoutExposure(current.current_rotation.strategy));
  assert.ok(old.recommendations.every((rec) => rec.exposure === null));
  assert.equal(old.current_rotation.strategy.exposure, null);
  assert.deepEqual(current.current_rotation.strategy.exposure, current.recommendations[0].exposure);
});

test('zero-day synthetic window differs from missing data and has twelve explicitly empty months', () => {
  const seq = clone();
  for (const scenario of ['hoje', 'futuro']) seq[scenario].descoberto = {
    dias: 0, dias_expostos: 0, chuva_mm: 0, chuva_exposta_mm: 0, meses: [],
  };
  const exposure = buildExposure(seq, 10);
  assert.equal(exposure.facts[0].value, '0 dias');
  assert.equal(exposure.months.length, 12);
  assert.ok(exposure.months.every((month) => month.days === 0 && month.exposed_days === 0));
});

test('rejects incomplete scenarios, invalid counts, rain, chronology and aggregate mismatches', () => {
  for (const change of [
    (seq) => delete seq.futuro.descoberto,
    (seq) => seq.hoje.descoberto = null,
    (seq) => seq.hoje.descoberto.dias = 366,
    (seq) => seq.hoje.descoberto.dias_expostos = -1,
    (seq) => seq.hoje.descoberto.dias_expostos = 116,
    (seq) => seq.hoje.descoberto.chuva_mm = NaN,
    (seq) => seq.hoje.descoberto.chuva_mm = '145.106',
    (seq) => seq.hoje.descoberto.chuva_exposta_mm = 146,
    (seq) => seq.hoje.descoberto.meses[0].mes = 0,
    (seq) => seq.hoje.descoberto.meses[0].dias = 1.5,
    (seq) => seq.hoje.descoberto.meses[0].dias = 32,
    (seq) => seq.hoje.descoberto.meses[0].dias_expostos = 9,
    (seq) => seq.hoje.descoberto.meses.push(seq.hoje.descoberto.meses[0]),
    (seq) => seq.hoje.descoberto.meses.reverse(),
    (seq) => seq.hoje.descoberto.meses[0] = null,
    (seq) => seq.hoje.descoberto.meses = [],
    (seq) => seq.hoje.descoberto.chuva_mm += 0.1,
    (seq) => seq.hoje.descoberto.meses[2].chuva_exposta_mm = 1,
    (seq) => seq.hoje.descoberto.indice_erosao = 1,
    (seq) => { seq.hoje.descoberto.indice_erosao = -1; seq.futuro.descoberto.indice_erosao = 1; },
  ]) {
    const seq = clone(); change(seq);
    assert.throws(() => validateSequenceExposure(seq, ['hoje', 'futuro'], 10), /contrato.*descoberto/);
  }
});

test('accepts independent three-decimal rounding but rejects differing days across scenarios', () => {
  const seq = clone(); seq.hoje.descoberto.chuva_mm += 0.004;
  assert.equal(validateSequenceExposure(seq, ['hoje', 'futuro'], 10), true);
  const other = clone();
  other.futuro.descoberto.dias--;
  other.futuro.descoberto.dias_expostos--;
  other.futuro.descoberto.meses[0].dias--;
  other.futuro.descoberto.meses[0].dias_expostos--;
  assert.throws(() => validateSequenceExposure(other, ['hoje', 'futuro'], 10), /dias diferentes entre cenários/);
});

test('the API rejects malformed exposure before it reaches a displayed strategy', () => {
  const raw = structuredClone(fixture);
  raw.sequencias[0].hoje.descoberto.dias_expostos = 999;
  assert.throws(() => validateMotorOutput(raw), /descoberto/);
  const incompleteDry = structuredClone(dryYear);
  delete incompleteDry.sequencias[0].seco.descoberto;
  assert.throws(() => validateMotorOutput(incompleteDry), /cenários incompletos/);
});
