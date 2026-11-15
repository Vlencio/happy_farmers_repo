// Run with playwright-cli run-code --filename=frontend/tests/browser-soil.js.
// Prepare fixtures: .venv/Scripts/python.exe frontend/scripts/export-soil-fixtures.py
// Requires output/playwright/soil-fixtures.json generated OFFLINE by the current
// motor for the demo polygon center, October, soybean-corn history, equal weights,
// horizon 2, dry climate and declividade_pct 4.05: baseline plus each solo_textura.
// Each fixture is {request: the complete /analyze request including lon, result}.
// The soil metadata capability, suggestion envelope and analysis transport are
// SIMULATED to exercise unavailable/error/late-response cases independently.
// Scores are actual local-engine results; browser-soil-api.js checks real transport.
// No cloud model or external climate data provider is called.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [], chats = [], suggestions = [], pendingSuggestions = [];
  let support = true, suggestionMode = 'normal', echoMode = 'correct', holdSuggestions = false, fixtures;
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const sameRequest = (a, b) => same(Object.keys(a).sort(), Object.keys(b).sort())
    && Object.entries(a).every(([key, value]) => same(value, b[key]));
  const text = () => page.locator('[data-rune-a11y]').evaluate(root => root.textContent
    + [...root.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.getAttribute('aria-label') || '').join(' '));
  const waitText = value => page.waitForFunction(value => {
    const root = document.querySelector('[data-rune-a11y]');
    return (root?.textContent + [...(root?.querySelectorAll('[role="alert"], [role="status"]') || [])]
      .map(node => node.getAttribute('aria-label') || '').join(' ')).includes(value);
  }, value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  const heading = () => page.getByRole('heading', { name: 'Soil texture', exact: true }).or(page.getByRole('button', { name: /^Soil texture · (expand|collapse)$/ }));
  const button = name => page.getByRole('button', { name, exact: true });
  const labels = { arenoso: 'Sandy · 30 mm', medio: 'Medium · 45 mm', argiloso: 'Clay · 60 mm' };
  const soilName = texture => new RegExp(`^${labels[texture]}(?: · selected)?$`);
  const cards = () => page.getByRole('button', { name: /^(?:1ST|2ND|3RD) TODAY.*Open timeline$/ });
  const reset = 'Use default reference · 60 mm';
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.postDataJSON());
  });
  // Parameter tests open the new disclosure before exercising its controls.
  // Default collapsed states and ordering are covered in browser-document.js.
  async function openControls() {
    const outer = 'Adjust priorities, soil and climate · expand';
    if (await button(outer).count()) await click(outer);
    const setup = 'Soil texture · expand';
    if (await button(setup).count()) await click(setup);
  }
  async function reveal(locator) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox(), height = page.viewportSize().height;
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, box.y < 78 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(150);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    await reveal(button(name)); await page.waitForTimeout(100);
    const box = await button(name).boundingBox();
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(180);
  }
  async function align(locator, top = 115) {
    for (let i = 0; i < 25; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width - 22, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(150);
    }
  }
  const bodyForPoint = (url, texture = 'argiloso', source = 'SIMULATED: GLDAS · NASA, 0.25° grid') => ({
    solo: { lat: Number(url.searchParams.get('lat')), lon: Number(url.searchParams.get('lon')), textura_sugerida: texture, fonte: source },
  });
  async function releaseSuggestions(texture = 'argiloso') {
    for (const { route, url } of pendingSuggestions.splice(0)) {
      await route.fulfill({ status: 200, json: bodyForPoint(url, texture) }).catch(() => {});
    }
  }
  async function seed(texture) {
    await releaseSuggestions();
    await page.evaluate(async texture => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      const settings = { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { chuva_pct: 0, temp_c: 0 } };
      if (texture) settings.solo_textura = texture;
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })), settings }));
    }, texture);
    await page.reload(); await waitConnected(); await openControls();
  }
  async function expectTexture(texture) {
    await page.waitForFunction(texture => JSON.parse(localStorage.getItem('happy-farmers-draft-v1'))?.settings.solo_textura === texture, texture);
    if (texture) check(await button(`${labels[texture]} · selected`).count() === 1, `SIMULATED soil ${texture}: selection is visible`);
  }
  const responseFor = texture => page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/analyze')
    && response.request().postDataJSON().solo_textura === texture, { timeout: 30000 });
  async function analyze(texture, action = 'Analyze farm →') {
    const pending = responseFor(texture);
    await click(action);
    const response = await pending, raw = await response.json(), request = response.request().postDataJSON();
    check(response.status() === 200 && request.solo_textura === texture, `SIMULATED transport submits texture ${texture ?? 'omitted'}`);
    await waitText('HAPPY FARMERS ANALYSIS'); await openControls(); await page.waitForTimeout(180);
    check(raw.entrada.solo_textura === texture, 'The actual-engine fixture echoes the requested texture');
    const view = await page.evaluate(async raw => (await import('/web/api.mjs')).mapMotorAnalysis(raw,
      JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm), raw);
    check((await text()).includes(view.soil_note), 'The UI explains the capacity actually returned by the engine');
    const names = await cards().allTextContents();
    check(names.length === view.recommendations.length && view.recommendations.every((rec, index) => names[index].includes(rec.crop)), 'Soil result cards keep the actual engine ranking');
    return raw;
  }
  await page.route('**/qa-soil-fixtures', route => route.fulfill({ path: 'output/playwright/soil-fixtures.json', contentType: 'application/json' }));
  await page.route('**/api/metadata*', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.has('lat')) {
      suggestions.push(url.href);
      if (holdSuggestions) { pendingSuggestions.push({ route, url }); return; }
      if (suggestionMode === 'error') { await route.fulfill({ status: 503, json: { detail: 'SIMULATED lookup failure' } }); return; }
      const body = bodyForPoint(url, suggestionMode === 'none' ? null : 'argiloso');
      if (suggestionMode === 'wrong-point') body.solo.lat += .25;
      await route.fulfill({ status: 200, json: body }); return;
    }
    const response = await route.fetch(), body = await response.json();
    body.capabilities = { ...body.capabilities, solo_textura: support, chat: false };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/analyze', async route => {
    const request = route.request().postDataJSON(); requests.push(request);
    const fixture = fixtures[request.solo_textura ?? 'baseline'];
    if (!fixture || !sameRequest(request, fixture.request)) {
      await route.fulfill({ status: 422, json: { detail: 'No exact local-engine fixture for this request; test will not invent a response.' } }); return;
    }
    const raw = JSON.parse(JSON.stringify(fixture.result));
    if (echoMode === 'missing') { delete raw.entrada.solo_textura; delete raw.entrada.cad_mm; }
    if (echoMode === 'wrong') { raw.entrada.solo_textura = 'argiloso'; raw.entrada.cad_mm = 60; }
    await route.fulfill({ status: 200, json: raw });
  });
  try {
    await page.goto(originalPage.url()); await waitConnected(); await openControls();
    fixtures = await page.evaluate(async () => (await fetch('/qa-soil-fixtures')).json());
    await seed(); await expectTexture('argiloso');
    check(await heading().count() === 1 && suggestions.length > 0, 'SIMULATED capability exposes the selector and requests a point suggestion');
    check((await text()).includes('Regional suggestion: clay') && (await text()).includes('GLDAS · NASA'), 'Suggestion and its source are shown without claiming a field measurement');
    check(requests.length === 0, 'Suggestion does not submit an analysis by itself');
    const clay = await analyze('argiloso');
    check(clay.entrada.cad_mm === 60, 'Clay fixture comes from the engine with 60 mm');
    const sandy = await analyze('arenoso', soilName('arenoso'));
    check(sandy.entrada.cad_mm === 30 && !same(sandy.sequencias, clay.sequencias), 'Selecting sandy soil reruns the analysis and the actual engine output changes');
    await expectTexture('arenoso');
    await page.reload(); await waitConnected(); await openControls(); await waitText('Regional suggestion: clay');
    check((await draft()).settings.solo_textura === 'arenoso' && await button(`${labels.arenoso} · selected`).count() === 1, 'Reload preserves the manual texture despite a different regional suggestion');
    await analyze('arenoso');
    const baseline = await analyze(undefined, reset);
    check(!Object.hasOwn(requests.at(-1), 'solo_textura') && !Object.hasOwn(requests.at(-1), 'solo_padrao'), 'Reset omits both soil and local-only reset preference from the API request');
    check(same(baseline, fixtures.baseline.result), 'Reset restores the exact baseline engine output');
    await page.reload(); await waitConnected(); await openControls(); await waitText('Regional suggestion: clay');
    check((await draft()).settings.solo_textura === undefined, 'Explicit default survives reload and is not replaced by automatic suggestion');
    await analyze(undefined);

    await analyze('medio', soilName('medio'));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    await align(heading());
    const boxes = await Promise.all([...Object.values(labels).map(name => new RegExp(`^${name}(?: · selected)?$`)), reset].map(name => button(name).boundingBox()));
    check(boxes.every(box => box && box.x >= 0 && box.x + box.width <= 391 && box.height >= 44), 'Soil controls fit a 390 px viewport with 44 px tap targets');
    await page.screenshot({ path: 'output/playwright/soil-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(250);
    await align(heading()); await page.screenshot({ path: 'output/playwright/soil-desktop.png' });

    support = false; await seed();
    check(await heading().count() === 0 && !(await button('Analyze farm →').isDisabled()), 'Legacy server without capability keeps normal analysis available and hides soil controls');
    const beforeLegacy = suggestions.length;
    await analyze(undefined);
    check(suggestions.length === beforeLegacy, 'Legacy server receives no proposed soil metadata queries');
    await seed('arenoso');
    check(await button('Analyze farm →').isDisabled() && (await text()).includes('The saved soil texture is unavailable'), 'Saved soil on a legacy server blocks silent fallback');
    await click(reset);
    check(!await button('Analyze farm →').isDisabled() && (await draft()).settings.solo_textura === undefined, 'Explicit reset unblocks analysis on a legacy server');
    await analyze(undefined);

    support = true;
    for (const mode of ['missing', 'wrong']) {
      suggestionMode = 'none'; echoMode = mode; await seed('arenoso');
      const pending = responseFor('arenoso'); await click('Analyze farm →'); await pending;
      await waitText('did not confirm the selected soil texture');
      check(await cards().count() === 0, `SIMULATED ${mode} soil echo is rejected instead of displaying misleading cards`);
    }
    echoMode = 'correct';
    for (const mode of ['wrong-point', 'error', 'none']) {
      suggestionMode = mode; await seed();
      await waitText(mode === 'none' ? 'No suggestion is available for this point' : 'Unable to get a soil suggestion for this point');
      check((await draft()).settings.solo_textura === undefined && !await button('Analyze farm →').isDisabled(), `SIMULATED ${mode} lookup leaves manual/default choice usable`);
    }

    suggestionMode = 'normal'; holdSuggestions = true; await seed();
    await waitText('Looking up the regional soil suggestion');
    check(pendingSuggestions.length === 1, 'A delayed point suggestion is pending for the current farm');
    await click(soilName('arenoso')); await releaseSuggestions(); await page.waitForTimeout(200);
    check((await draft()).settings.solo_textura === 'arenoso', 'Late regional suggestion cannot replace a manual soil choice');
    await seed(); await waitText('Looking up the regional soil suggestion');
    await analyze(undefined); await releaseSuggestions(); await page.waitForTimeout(200);
    check((await draft()).settings.solo_textura === undefined && await cards().count() === 3, 'Late suggestion after Analyze cannot change the texture or invalidate the displayed baseline');

    await seed(); await waitText('Looking up the regional soil suggestion');
    const oldPoint = pendingSuggestions[0].url.href;
    const boundary = await page.evaluate(() => {
      const geo = JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm.geojson;
      const shift = value => typeof value[0] === 'number' ? [value[0] + .1, value[1] + .1] : value.map(shift);
      geo.geometry.coordinates = shift(geo.geometry.coordinates); return geo;
    });
    await page.locator('#geojson-file').setInputFiles({ name: 'different-soil-field.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(boundary)) });
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#farm-name').fill('Another field for soil testing');
    await page.locator('#confirm-boundary').click();
    await waitText('Another field for soil testing'); await page.waitForTimeout(200);
    check(pendingSuggestions.length === 2 && pendingSuggestions[1].url.href !== oldPoint, 'Changing the boundary requests soil for the new point');
    const newest = pendingSuggestions.pop();
    await newest.route.fulfill({ status: 200, json: bodyForPoint(newest.url, 'medio', 'SIMULATED: suggestion for the new point') });
    await expectTexture('medio');
    await releaseSuggestions('argiloso'); await page.waitForTimeout(200);
    check((await draft()).settings.solo_textura === 'medio' && (await text()).includes('suggestion for the new point'), 'The old farm reply cannot overwrite the new point soil or source');
    check(chats.length === 0 && errors.length === 0, 'No LLM requests or uncaught JavaScript errors');
    return { passed: checks.length, simulated_transport: true, real_engine_fixture_cases: Object.keys(fixtures), analyses: requests.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/soil-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, failure: error.message, checks, errors, requests: requests.map(request => request.solo_textura ?? null) }));
  } finally { await releaseSuggestions(); await context.close(); }
}
