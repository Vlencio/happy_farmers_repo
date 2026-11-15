import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreDraft, validSeason } from '../web/draft.mjs';

const geojson = JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url)));
const entry = { crop: 'soja', season: '2025/26', notes: 'Plantio anterior' };
const draft = () => ({ version: 2, farm: { geojson, name: 'Talhão', source: 'sample' }, history: [entry], settings: { mes_plantio: 2, horizonte: 1, prioridades: { agua: 3, solo: 1, renda: 0 }, ajuste: { chuva_pct: 0, temp_c: 0 } } });
const restore = value => restoreDraft(JSON.stringify(value));

test('restores the field, ordered records and settings independently', () => {
  const value = draft();
  value.history = [null, entry, false, { ...entry, crop: 'milho', season: '2024' }, { ...entry, season: '2025/99' }];
  const restored = restore(value);
  assert.ok(restored.farm.area_ha > 219);
  assert.deepEqual(restored.history.map(item => item.crop), ['soja', 'milho']);
  assert.deepEqual(restored.settings, value.settings);
  assert.equal(restored.repaired, true);
});

test('a damaged boundary does not discard valid history or cycle options', () => {
  const value = draft(); value.farm.geojson = { type: 'Point', coordinates: [0, 0] };
  const restored = restore(value);
  assert.equal(restored.farm, null);
  assert.deepEqual(restored.history, [entry]);
  assert.deepEqual(restored.settings, value.settings);
  assert.equal(restored.repaired, true);
});

test('keeps unknown crops for explicit correction and limits malformed restored records', () => {
  const value = draft();
  value.history = [{ ...entry, crop: 'cultura antiga' }, { ...entry, crop: '' }, { ...entry, notes: 'a'.repeat(501) }, { ...entry, notes: '🌱'.repeat(500) }];
  assert.deepEqual(restore(value).history.map(item => item.crop), ['cultura antiga', 'soja']);
  value.history = Array.from({ length: 20 }, () => entry);
  assert.equal(restore(value).history.length, 12);
});

test('handles old drafts, invalid settings and corrupt or unknown formats', () => {
  assert.equal(restoreDraft(null), null);
  assert.equal(restore(draft()).repaired, false);
  const old = draft(); old.version = 1; delete old.settings;
  assert.deepEqual(restore(old).settings, { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { chuva_pct: 0, temp_c: 0 } });
  const bad = draft(); bad.settings.horizonte = 3;
  assert.equal(restore(bad).repaired, true);
  for (const text of ['{', 'null', '{}', '{"version":99}']) assert.throws(() => restoreDraft(text));
});

test('migrates legacy priority settings without losing the field, history or calendar', () => {
  for (const version of [1, 2]) {
    const value = draft(); value.version = version; delete value.settings.prioridades;
    const restored = restore(value);
    assert.deepEqual(restored.settings, { mes_plantio: 2, horizonte: 1, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { chuva_pct: 0, temp_c: 0 } });
    assert.deepEqual(restored.farm, restore(draft()).farm);
    assert.deepEqual(restored.history, [entry]);
    assert.equal(restored.repaired, false);
  }
});

test('retains all-zero priorities and repairs malformed priorities independently', () => {
  const value = draft(); value.settings.prioridades = { agua: 0, solo: 0, renda: 0 };
  assert.deepEqual(restore(value).settings, value.settings);
  assert.equal(restore(value).repaired, false);
  for (const prioridades of [null, { agua: 4, solo: 1, renda: 1 }, { agua: 1, solo: 1 }]) {
    value.settings.prioridades = prioridades;
    const restored = restore(value);
    assert.deepEqual(restored.settings, { mes_plantio: 2, horizonte: 1, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { chuva_pct: 0, temp_c: 0 } });
    assert.deepEqual(restored.history, [entry]);
    assert.deepEqual(restored.farm, restore(draft()).farm);
    assert.equal(restored.repaired, true);
  }
});

test('migrates drafts without scenario controls and preserves explicitly saved adjustments', () => {
  const old = draft(); delete old.settings.ajuste;
  const migrated = restore(old);
  assert.deepEqual(migrated.settings, draft().settings);
  assert.equal(migrated.repaired, false);
  assert.deepEqual(migrated.history, [entry]);
  const current = draft(); current.settings.ajuste = { chuva_pct: -20, temp_c: 1.5 };
  assert.deepEqual(restore(current).settings, current.settings);
  assert.equal(restore(current).repaired, false);
});

test('a damaged adjustment preserves the calendar, priorities, field and history', () => {
  for (const ajuste of [null, [], { chuva_pct: -60, temp_c: 2 }, { chuva_pct: -20 }, { chuva_pct: 0, temp_c: '2' }]) {
    const value = draft(); value.settings.ajuste = ajuste;
    const restored = restore(value);
    assert.deepEqual(restored.settings, draft().settings);
    assert.deepEqual(restored.farm, restore(draft()).farm);
    assert.deepEqual(restored.history, [entry]);
    assert.equal(restored.repaired, true);
  }
});

test('a damaged calendar or priority does not erase a valid saved adjustment', () => {
  for (const damage of [value => value.settings.mes_plantio = 13, value => value.settings.prioridades = null]) {
    const value = draft(); value.settings.ajuste = { chuva_pct: -20, temp_c: 2 }; damage(value);
    const restored = restore(value);
    assert.deepEqual(restored.settings.ajuste, value.settings.ajuste);
    assert.equal(restored.repaired, true);
  }
});

test('restored seasons follow the same year and consecutive-season rules as the form', () => {
  for (const value of ['2025', '2025/26', '2025/2026', '1999/00', '2025/25', '2100/01']) assert.equal(validSeason(value), true, value);
  for (const value of ['', '202', '2025/27', '2025/', '20xx', '2025/26/27', '1899', '2025/2020', '2025/026', null]) assert.equal(validSeason(value), false, String(value));
});
