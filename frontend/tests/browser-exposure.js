// Run with playwright-cli run-code --filename=frontend/tests/browser-exposure.js.
// The local API supplies all numbers. A fresh context preserves the user's draft.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) requests.push(request.postDataJSON());
  });
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  const months = () => page.getByRole('button', { name: /^Soil in .+: \d+ days without crop, \d+ exposed days$/ });
  const monthName = (month, days, exposed) => `Soil in ${month}: ${days} days without crop, ${exposed} exposed days`;
  async function reveal(locator) {
    for (let i = 0; i < 32; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width * .78, height * .55);
      await page.mouse.wheel(0, box.y < 78 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(180);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function clickLocator(locator) {
    const box = await reveal(locator);
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  const click = name => clickLocator(page.getByRole('button', { name, exact: true }));
  async function clickMonth(name) {
    const locator = page.getByRole('button', { name, exact: true });
    await reveal(locator);
    for (let i = 0; i < 18; i++) {
      const box = await locator.boundingBox();
      const width = page.viewportSize().width;
      // Month tiles are inside a horizontal Rune scroll area; use real wheel events.
      if (box.x >= 18 && box.x + box.width <= width - 18) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(160);
        return;
      }
      await page.mouse.move(width * .55, Math.min(box.y + box.height / 2, page.viewportSize().height - 50));
      await page.mouse.wheel(Math.max(-650, Math.min(650, box.x + box.width / 2 - width / 2)), 0);
      await page.waitForTimeout(180);
    }
    throw new Error('Could not reveal month horizontally: ' + name);
  }
  async function align(locator, top = 120) {
    for (let i = 0; i < 8; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width * .78, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(180);
    }
  }
  async function analyze({ shiftedBoundary = false } = {}) {
    await page.goto(originalPage.url());
    await waitConnected();
    await page.evaluate(async shiftedBoundary => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      let farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      if (shiftedBoundary) {
        const shift = coordinates => typeof coordinates[0] === 'number'
          ? [coordinates[0] + .00001, ...coordinates.slice(1)] : coordinates.map(shift);
        farm.geojson.geometry.coordinates = shift(farm.geojson.geometry.coordinates);
        farm = normalizeFarm(farm.geojson, { source: 'sample' });
      }
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: [{ crop: 'soja', season: '2024', notes: '' }, { crop: 'milho', season: '2025', notes: '' }],
        settings: { mes_plantio: 10, horizonte: 2 } }));
    }, shiftedBoundary);
    await page.reload();
    await waitConnected();
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    const response = await pending, raw = await response.json();
    check(response.status() === 200, 'Exposure analysis succeeds');
    await waitText('HAPPY FARMERS ANALYSIS');
    return page.evaluate(async raw => (await import('/web/api.mjs')).mapMotorAnalysis(raw,
      JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm), raw);
  }
  try {
    const view = await analyze();
    const current = view.current_rotation.strategy;
    const cover = view.recommendations.find(rec => rec.sequence_id === 'soja>crotalaria');
    check(await cards().count() === 4, 'Exposure retains the current reference and three ranked cards');
    const names = await cards().allTextContents();
    const currentName = names.find(name => name.startsWith('CURRENT ROTATION:'));
    const soilName = names.find(name => name.startsWith('1ST TODAY:'));
    check(names.every(name => name.includes('Exposed days · 365 days') && name.includes('Rainfall on exposed soil · today')), 'All strategy cards expose soil figures to assistive technology');
    check(current.exposure.card_facts.every(fact => currentName.includes(fact.value)), 'Current reference shows its actual exposed days and rainfall');
    check(cover.exposure.card_facts.every(fact => soilName.includes(fact.value)), 'Top-ranked sunn hemp card shows its own exposure evidence');
    check(requests.length === 1 && requests[0].declividade_pct === 4.05, 'Current API receives the exact demo slope');
    await click(currentName);
    await waitText('Soil between crops');
    check(await months().count() === 12, 'Exposure calendar covers exactly the first twelve months');
    check((await text()).includes('First 365 days: Oct · year 1 → Sep · year 2.'), 'Exposure window and year crossing are explicit');
    check((await text()).includes('crop residue') && (await text()).includes('not the exact dates'), 'Coverage legend explains mulch and proportional month bars');
    check(!(await text()).includes('The erosion exposure index is unavailable'), 'The real API supplies the slope-based exposure index');
    await clickMonth(monthName('Jan · year 2', 8, 8));
    check(await page.getByRole('heading', { name: 'Soil in Jan · year 2', exact: true }).count() === 1, 'Selecting January opens the exposed gap details');
    check((await text()).includes(current.exposure.months[3].exposed_rain), 'Selected month compares actual today, future and dry-year exposed rainfall');
    check(await page.getByRole('button', { name: 'Stage 1: Soybean · Main season', exact: true }).count() === 1, 'Soil-month navigation retains the crop calendar');
    await clickMonth(monthName('Feb · year 2', 2, 2));
    check(await page.getByRole('heading', { name: 'Soil in Feb · year 2', exact: true }).count() === 1, 'Corn sequence has only two exposed February days');
    await align(page.getByText('Soil between crops', { exact: true }));
    await page.screenshot({ path: 'output/playwright/exposure-desktop.png' });
    await click('← Compare strategies');
    await click(soilName);
    await waitText('Soil between crops');
    check(await page.getByRole('heading', { name: 'Soil in Oct · year 1', exact: true }).count() === 1, 'Opening another strategy resets the selected soil month');
    const coverFebruary = cover.exposure.months[4];
    await clickMonth(monthName(coverFebruary.label, coverFebruary.days, coverFebruary.exposed_days));
    check(await page.getByRole('heading', { name: 'Soil in Feb · year 2', exact: true }).count() === 1, 'February sunn hemp planting uses its actual exposure interval');
    check((await text()).includes(coverFebruary.exposed_rain), 'Sunn hemp displays its own monthly exposed rainfall');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await clickMonth(monthName('Sep · year 2', 30, 0));
    check(await page.getByRole('heading', { name: 'Soil in Sep · year 2', exact: true }).count() === 1, 'Mobile horizontal scroll reaches the last month');
    await align(page.getByRole('heading', { name: 'Soil in Sep · year 2', exact: true }), 160);
    await page.screenshot({ path: 'output/playwright/exposure-mobile.png' });
    check((await text()).includes('0 / 0 / 0'), 'Protected months preserve genuine zero exposed rain');
    await clickMonth(monthName('Oct · year 1', 0, 0));
    check(await page.getByRole('heading', { name: 'Soil in Oct · year 1', exact: true }).count() === 1, 'Mobile can return to the first month with zero uncovered days');
    check(await months().count() === 12, 'Mobile preserves all twelve month controls');

    // SIMULATED RESPONSE: inject unmistakable sentinel indices to independently
    // test transport/rendering. The actual slope integration was checked above.
    const simulatedRequests = [];
    await page.route('**/api/metadata', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.capabilities = { ...body.capabilities, declividade_pct: true };
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/analyze', async route => {
      const incoming = route.request().postDataJSON();
      simulatedRequests.push(incoming);
      const upstream = { ...incoming };
      delete upstream.declividade_pct; // Sentinel response below owns the test-only indices.
      const response = await route.fetch({ postData: upstream });
      const body = await response.json();
      if (Object.hasOwn(incoming, 'declividade_pct')) {
        body.entrada.declividade_pct = incoming.declividade_pct;
        for (const seq of body.sequencias) {
          for (const [scenario, sentinel] of Object.entries({ hoje: 123.4, futuro: 234.5, seco: 345.6 })) {
            if (seq[scenario]?.descoberto) seq[scenario].descoberto.indice_erosao = sentinel;
          }
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await analyze();
    check(simulatedRequests.length === 1 && simulatedRequests[0].declividade_pct === 4.05, 'SIMULATED response: advertised capability sends exact demo slope 4.05');
    await click(await page.getByRole('button', { name: /^CURRENT ROTATION:.*Open timeline$/ }).textContent());
    await waitText('Soil between crops');
    check((await text()).includes('123.4 / 234.5 / 345.6'), 'SIMULATED response: sentinel erosion indices render for all three scenarios');
    check((await text()).includes('does not represent soil loss in t/ha') && !(await text()).includes('The erosion exposure index is unavailable'), 'SIMULATED response: available index retains its meaning and limits');
    await analyze({ shiftedBoundary: true });
    check(simulatedRequests.length === 2 && !Object.hasOwn(simulatedRequests[1], 'declividade_pct'), 'SIMULATED response: nearby but different boundary does not reuse demo slope');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, simulated_response_checks: 4, simulation: 'Sentinel erosion indices are synthetic; the actual backend remains unchanged.', checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/exposure-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, requests, screen: (await text().catch(() => '')).slice(-4000) }));
  } finally { await context.close(); }
}
