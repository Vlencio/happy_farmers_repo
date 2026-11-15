// Playwright CLI scenario: simulated failures use isolated browser contexts.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 15000 });
  // Accessible activation is also tested; pointer and keyboard paths are in browser-qa.js.
  const activate = async name => {
    await page.getByRole('button', { name, exact: true }).evaluate(el => el.click());
    await page.waitForTimeout(150);
  };
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  const analyze = () => activate('Analyze farm →');
  const analysisRoute = '**/api/analyze';
  try {
    await context.route('**/api/metadata', route => route.fulfill({ status: 503, json: { detail: 'Unavailable for the test' } }));
    await page.goto(originalPage.url());
    await waitText('Unable to connect');
    check(await page.getByRole('button', { name: 'Analyze farm →', exact: true }).isDisabled(), 'Unavailable metadata disables analysis');
    await activate('Use sample field');
    await page.locator('#confirm-boundary').click();
    check((await draft()).farm.area_ha > 219, 'Mapping and saving still work when the analysis API is unavailable');
    await context.unroute('**/api/metadata');
    let releaseConnection, connectionCount = 0;
    await context.route('**/api/metadata', async route => {
      if (++connectionCount !== 1) return route.continue();
      await new Promise(resolve => { releaseConnection = resolve; });
      await route.fulfill({ status: 503, json: { detail: 'Old response' } }).catch(() => {});
    });
    await activate('Reconnect to engine');
    for (let i = 0; i < 100 && !releaseConnection; i++) await page.waitForTimeout(20);
    await activate('Reconnect to engine');
    await waitText('Engine connected');
    releaseConnection(); await page.waitForTimeout(200);
    check((await page.locator('[data-rune-a11y]').textContent()).includes('Engine connected'), 'A stale connection failure cannot replace a successful reconnection');
    await context.unroute('**/api/metadata');
    check((await draft()).farm !== null, 'Reconnection preserves the planning');

    await context.route(analysisRoute, route => route.fulfill({ status: 503, json: { detail: 'Service temporarily unavailable' } }));
    await analyze(); await waitText('HTTP 503');
    check((await draft()).farm !== null, 'Server error preserves the saved boundary');
    check(await page.getByRole('button', { name: /Open timeline$/ }).count() === 0, 'Server error never fabricates recommendation cards');
    await context.unroute(analysisRoute);
    await context.route(analysisRoute, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Not JSON</html>' }));
    await analyze(); await waitText('is not JSON');
    check(true, 'Non-JSON response gives a readable error');
    await context.unroute(analysisRoute);
    await context.route(analysisRoute, route => route.fulfill({ status: 200, json: { sequencias: [] } }));
    await analyze(); await waitText('Response does not match');
    check(true, 'Invalid engine contract is rejected before displaying results');
    await context.unroute(analysisRoute);

    let release, entered = false;
    await context.route(analysisRoute, async route => {
      entered = true;
      const response = await route.fetch();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ response }).catch(() => {});
    });
    await analyze(); await waitText('Cancel analysis');
    check(await page.getByRole('button', { name: 'Analyzing…', exact: true }).isDisabled(), 'Pending analysis prevents duplicate submissions');
    for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(50);
    check(entered && Boolean(release), 'Delayed real response reaches the cancellation test');
    await activate('Cancel analysis');
    await waitText('Analysis canceled');
    release(); await context.unroute(analysisRoute);
    await page.waitForTimeout(400);
    check(await page.getByRole('button', { name: /Open timeline$/ }).count() === 0, 'A late response cannot restore cancelled results');
    await analyze(); await waitText('Today\'s highest scores.');
    check(true, 'A fresh analysis succeeds after cancellation');
    await activate('← Edit farm and history');

    // Shorten only the analysis deadline in this isolated test, not application code.
    await page.evaluate(() => { window.qaOriginalTimeout = window.setTimeout; window.setTimeout = (callback, delay, ...args) => window.qaOriginalTimeout(callback, delay === 360000 ? 60 : delay, ...args); });
    let releaseTimeout;
    await context.route(analysisRoute, async route => { await new Promise(resolve => { releaseTimeout = resolve; }); await route.abort().catch(() => {}); });
    await analyze(); await waitText('exceeded 6 minutes');
    check(true, 'Analysis deadline explains the timeout and enables another attempt');
    releaseTimeout?.(); await context.unroute(analysisRoute);
    await page.evaluate(() => { window.setTimeout = window.qaOriginalTimeout; delete window.qaOriginalTimeout; });

    await page.locator('#geojson-file').setInputFiles({ name: 'invalid.geojson', mimeType: 'application/json', buffer: Buffer.from('{broken') });
    await waitText('Unable to read the JSON');
    check((await draft()).farm.area_ha > 219, 'Invalid GeoJSON does not overwrite the confirmed farm');
    await page.locator('#geojson-file').setInputFiles({ name: 'large.geojson', mimeType: 'application/json', buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 32) });
    await waitText('exceeds 2 MB');
    check(true, 'Oversized import is rejected before parsing');
    await page.locator('#geojson-file').setInputFiles('frontend/public/demo-farm.geojson');
    await page.locator('#map-dialog').waitFor();
    const downloading = page.waitForEvent('download');
    await page.locator('#download-map').click();
    const download = await downloading;
    await download.saveAs('output/playwright/qa-roundtrip.geojson');
    check(download.suggestedFilename().endsWith('.geojson'), 'Map exports a GeoJSON file');
    await page.locator('#close-map').click();
    await page.locator('#geojson-file').setInputFiles('output/playwright/qa-roundtrip.geojson');
    await page.locator('#confirm-boundary').click();
    check((await draft()).farm.point_count === 15, 'Exported GeoJSON reimports with all 15 boundary vertices');

    await page.evaluate(() => { window.qaStorageSet = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'happy-farmers-draft-v1') throw new DOMException('QA quota', 'QuotaExceededError'); return window.qaStorageSet.call(this, key, value); }; });
    await activate('View and edit on map');
    await page.locator('#farm-name').fill('Edit not saved because storage is full');
    await page.locator('#confirm-boundary').click();
    await waitText('Unable to save');
    check((await draft()).farm.name !== 'Edit not saved because storage is full', 'Storage failure is visible and never claims the edited draft was saved');
    await page.evaluate(() => { Storage.prototype.setItem = window.qaStorageSet; delete window.qaStorageSet; });

    await page.evaluate(() => { const key = 'happy-farmers-draft-v1'; const value = JSON.parse(localStorage.getItem(key)); value.history = [null, { crop: 'soja', season: '2025/26', notes: 'Preservar' }]; localStorage.setItem(key, JSON.stringify(value)); });
    await page.reload(); await waitText('Engine connected'); await waitText('We recovered the valid parts');
    check((await page.locator('[data-rune-a11y]').textContent()).includes('Preservar'), 'Corrupt history restores the valid records and the field');
    await context.route('**/World_Imagery/MapServer/tile/**', route => route.abort());
    await page.reload(); await waitText('Satellite imagery unavailable');
    check(true, 'Missing satellite imagery keeps the outline with an explicit warning');
    await context.unroute('**/World_Imagery/MapServer/tile/**');
    await context.setOffline(true);
    await analyze(); await waitText('Unable to request an analysis');
    check((await draft()).farm !== null, 'Offline analysis keeps the draft');
    await context.setOffline(false);
    await analyze(); await waitText('Today\'s highest scores.');
    check(true, 'Analysis recovers after the network returns');

    await context.route('**/pkg/app_bg.wasm', route => route.abort());
    await page.reload();
    await page.locator('#boot-retry').waitFor();
    check(!(await page.locator('#boot-error').textContent()).includes('npm'), 'Boot failure offers user-facing recovery instead of developer commands');
    await context.unroute('**/pkg/app_bg.wasm');
    await page.locator('#boot-retry').click();
    await waitText('Engine connected');
    check(true, 'Reload button recovers from a failed WASM download');
    check(errors.length === 0, 'No uncaught exceptions during the error scenarios');
    return { passed: checks.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/qa-resilience-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors }));
  } finally { await context.close(); }
}
