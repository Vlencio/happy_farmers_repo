import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { normalizeFarm } from '../web/geometry.mjs';
import { planPreview, previewDimensions, projectCoordinate } from '../web/preview-layout.mjs';
import { createFarmPreview } from '../web/farm-preview.mjs';

const demo = normalizeFarm(JSON.parse(readFileSync(new URL('../public/demo-farm.geojson', import.meta.url))));

test('satellite preview keeps the whole demo boundary in desktop/mobile frames without changing GeoJSON', () => {
  const before = JSON.stringify(demo.geojson);
  assert.deepEqual(projectCoordinate([0, 0]), [0.5, 0.5]);
  assert.ok(Math.abs(projectCoordinate([0, 85.0511287798066])[1]) < 1e-10);
  for (const [width, height, ratio] of [[744, 240, 1], [294, 220, 2], [1600, 240, 3]]) {
    const dimensions = previewDimensions(width, height, ratio);
    assert.ok(dimensions.width <= 1024 && dimensions.height <= 512);
    const plan = planPreview(demo.geojson, dimensions.width, dimensions.height, dimensions.scale);
    for (const [x, y] of plan.rings.flat(2)) {
      assert.ok(x >= 27 * dimensions.scale && x <= plan.width - 27 * dimensions.scale);
      assert.ok(y >= 27 * dimensions.scale && y <= plan.height - 27 * dimensions.scale);
      // Every contour point lies over an actual requested satellite tile.
      assert.ok(plan.tiles.some((tile) => x >= tile.left && x <= tile.left + 256 && y >= tile.top && y <= tile.top + 256));
    }
    assert.ok(plan.tiles.length > 0 && plan.tiles.length <= 15);
  }
  assert.equal(JSON.stringify(demo.geojson), before);
  assert.throws(() => previewDimensions(0, 240));
  assert.throws(() => previewDimensions(500, NaN));
});

test('preview retains disconnected parcels and inner exclusions in the same map projection', () => {
  const outer = [[-48, -20], [-47.99, -20], [-47.99, -19.99], [-48, -19.99], [-48, -20]];
  const hole = [[-47.998, -19.998], [-47.994, -19.998], [-47.994, -19.994], [-47.998, -19.994], [-47.998, -19.998]];
  const second = outer.map(([x, y]) => [x + .02, y]);
  const farm = normalizeFarm({ type: 'MultiPolygon', coordinates: [[outer, hole], [second]] });
  const plan = planPreview(farm.geojson, 700, 240);
  assert.deepEqual(plan.rings.map((rings) => rings.length), [2, 1]);
  const [a, b] = plan.rings;
  assert.ok(a[1][0][0] > a[0][0][0] && a[1][0][1] < a[0][0][1]);
  assert.ok(b[0][0][0] > a[0][1][0]);
  assert.equal(plan.rings.flat(1).reduce((sum, ring) => sum + ring.length - 1, 0), farm.point_count);
});

test('slow imagery cannot replace a newer field or return after clearing; unchanged size does not reload', async () => {
  const pending = [], frames = [];
  const preview = createFarmPreview((frame) => frames.push(frame), {
    debounce: 0, pixelRatio: () => 1,
    render: (farm, size, signal) => new Promise((resolve) => pending.push({ farm, size, signal, resolve })),
  });
  preview.resize(500, 240); preview.setFarm(demo);
  await delay(10);
  assert.equal(pending.length, 1);
  preview.resize(500, 240);
  await delay(10);
  assert.equal(pending.length, 1);
  const updated = { ...demo, name: 'Área editada' };
  preview.setFarm(updated);
  await delay(10);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve({ note: 'old' }); pending[1].resolve({ note: 'current' });
  await delay(0);
  assert.deepEqual(frames, [{ note: 'current' }]);
  preview.resize(294, 220);
  await delay(10);
  preview.setFarm(null);
  pending[2].resolve({ note: 'cleared' });
  await delay(0);
  assert.equal(pending[2].signal.aborted, true);
  assert.deepEqual(frames, [{ note: 'current' }]);
});
