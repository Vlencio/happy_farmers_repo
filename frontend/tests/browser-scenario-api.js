// Run with playwright-cli on the dev server connected to an API with ajuste:true:
// playwright-cli run-code --filename=frontend/tests/browser-scenario-api.js
// All metadata and analyses come from the actual API. No routes, response mocks,
// local engine fixtures or chat/provider requests are used in this test.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [], chats = [], results = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const normalized = value => value.replace(/\s/g, '');
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /^(?:1ST|2ND|3RD) TODAY.*Open timeline$/ });
  const heading = () => page.getByRole('heading', { name: 'Simulate another climate', exact: true });
  const controls = ['Decrease rainfall by 5%', 'Increase rainfall by 5%', 'Decrease temperature by 0.5 °C', 'Increase temperature by 0.5 °C'];
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname.endsWith('/analyze')) requests.push(request.postDataJSON());
    if (new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.postDataJSON());
  });
  async function reveal(locator) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox(), height = page.viewportSize().height;
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, box.y < 78 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(140);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    await reveal(button(name)); await page.waitForTimeout(100);
    const box = await button(name).boundingBox();
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(150);
  }
  async function align(locator, top = 115) {
    for (let i = 0; i < 25; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width - 22, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(140);
    }
  }
  async function change(field, steps) {
    for (let i = 0; i < Math.abs(steps); i++) {
      const before = (await draft()).settings.ajuste[field];
      await click(controls[(field === 'temp_c' ? 2 : 0) + (steps > 0 ? 1 : 0)]);
      await page.waitForFunction(({ field, value }) => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).settings.ajuste[field] === value,
        { field, value: before + Math.sign(steps) * (field === 'temp_c' ? .5 : 5) });
    }
  }
  async function analyze(label, expected, action = 'Apply scenario') {
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'), { timeout: 30000 });
    await click(action);
    const response = await pending;
    check(response.status() === 200, label + ': real HTTP analysis succeeds');
    const raw = await response.json(), request = response.request().postDataJSON();
    check(same(request.ajuste, expected), label + ': request preserves selected adjustment');
    check(expected ? same(raw.entrada.ajuste, expected) : !Object.hasOwn(raw.entrada, 'ajuste'), label + ': engine confirms the effective adjustment');
    check(raw.origem?.hoje === 'tabela_demo', label + ': demo climate needs no external POWER query');
    await waitText('ENGINE ANALYSIS'); await page.waitForTimeout(180);
    const view = await page.evaluate(async raw => (await import('/web/api.mjs')).mapMotorAnalysis(raw,
      JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm), raw);
    const labels = await cards().allTextContents();
    check(labels.length === Math.min(3, raw.sequencias.length) && view.recommendations.every((rec, i) => labels[i].includes(rec.crop)), label + ': cards preserve the engine order');
    check(view.recommendations.every((rec, i) => {
      const seq = raw.sequencias.find(seq => seq.id === rec.sequence_id);
      return [`Rank · today: #${seq.rank_hoje}`, `Score · today: ${number(seq.hoje.score)} / 100`,
        `Rank · future: #${seq.rank_futuro}`, `Score · future: ${number(seq.futuro.score)} / 100`].every(value => labels[i].includes(value));
    }), label + ': visible ranks and scores match the API');
    check(expected ? (await text()).includes(view.adjustment_note) && /simulation, not a forecast/.test(view.adjustment_note)
      : !view.adjustment_note && !(await text()).includes('WHAT-IF SCENARIO'), label + ': scenario labeling matches the result');
    results.push({ label, raw });
    return { raw, view };
  }
  async function verifyDetail(analysis) {
    await click(await cards().first().textContent()); await waitText('Your crop cycle, step by step');
    const screen = normalized(await text()), first = analysis.raw.sequencias[0];
    for (const [key, label] of [['hoje', 'TODAY'], ['futuro', 'FUTURE'], ['seco', 'DRY YEAR']]) {
      check(screen.includes(normalized(`REVENUE / HA · ${label}${money(first[key].receita_ha)}`)), 'Adjusted detail uses actual total revenue for ' + key);
      check(screen.includes(normalized(`REVENUE / HA / YEAR · ${label}${money(first[key].receita_ano_ha)}`)), 'Adjusted detail uses actual annual revenue for ' + key);
    }
    check((await text()).includes(analysis.view.adjustment_note), 'Hypothetical warning remains in the detail');
    check((await text()).includes('not the original observations'), 'Adjusted dry year is explicitly distinguished from observations');
    await click('← Compare strategies');
  }
  try {
    const metadataPending = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/metadata'));
    await page.goto(originalPage.url()); await waitConnected();
    const metadata = await (await metadataPending).json();
    check(metadata.capabilities?.ajuste === true, 'Actual API advertises scenario support');
    await page.evaluate(async () => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })),
        settings: { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 }, ajuste: { chuva_pct: 0, temp_c: 0 } } }));
    });
    await page.reload(); await waitConnected();
    check(!(await button(controls[0]).isDisabled()) && !(await button(controls[3]).isDisabled()), 'Actual capability enables rain and heat controls');
    check(!(await text()).includes('Scenario adjustments are not yet available on this server.'), 'Connected server is not mislabeled as unsupported');
    const baseline = await analyze('Baseline', undefined, 'Analyze farm →');
    const beforeRain = requests.length;
    await change('chuva_pct', -4);
    check(requests.length === beforeRain && await cards().count() === 0, 'Editing clears old cards and waits for explicit Apply');
    const rain = await analyze('Rain -20%', { chuva_pct: -20, temp_c: 0 });
    check(rain.raw.sequencias.find(seq => seq.id === 'soja>milho').hoje.receita_ha < baseline.raw.sequencias.find(seq => seq.id === 'soja>milho').hoje.receita_ha, 'Real reduced rainfall changes soybean-corn revenue');
    for (const scenario of ['hoje', 'futuro', 'seco']) {
      check(rain.raw.clima[scenario].every((month, i) => Math.abs(month.chuva_mm - baseline.raw.clima[scenario][i].chuva_mm * .8) < .01), 'Real rainfall adjustment reaches every month of ' + scenario);
    }
    await change('temp_c', 4);
    const combined = await analyze('Rain -20%, heat +2', { chuva_pct: -20, temp_c: 2 });
    for (const scenario of ['hoje', 'futuro', 'seco']) {
      check(combined.raw.clima[scenario].every((month, i) => ['tmin_c', 'tmax_c'].every(key => Math.abs(month[key] - baseline.raw.clima[scenario][i][key] - 2) < .01)), 'Real temperature adjustment reaches both temperatures in every month of ' + scenario);
    }
    await verifyDetail(combined);
    await align(heading()); await page.screenshot({ path: 'output/playwright/real-scenarios-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await align(heading());
    const boxes = await Promise.all(controls.map(name => button(name).boundingBox()));
    check(boxes.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'Live scenario controls fit the mobile viewport');
    await page.screenshot({ path: 'output/playwright/real-scenarios-mobile.png' });
    await align(cards().first()); await page.screenshot({ path: 'output/playwright/real-scenarios-cards-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
    await click('Reset climate adjustments');
    check(await cards().count() === 0 && same((await draft()).settings.ajuste, { chuva_pct: 0, temp_c: 0 }), 'Reset clears adjusted cards and stored controls');
    const reset = await analyze('Reset', undefined);
    check(same(reset.raw, baseline.raw), 'Reset restores the exact unadjusted API result');
    await change('temp_c', 4);
    const warm = await analyze('Heat +2', { chuva_pct: 0, temp_c: 2 });
    check(!same(warm.raw.sequencias, baseline.raw.sequencias), 'Temperature alone changes the real engine output');
    await page.reload(); await waitConnected();
    const restored = await analyze('Restored heat +2', { chuva_pct: 0, temp_c: 2 }, 'Analyze farm →');
    check(same(restored.raw, warm.raw), 'Reload keeps the adjustment and reproduces its real result');
    const rainTrack = await reveal(page.getByRole('group', { name: /^Scenario Rainfall:/ }));
    await page.mouse.click(rainTrack.x + rainTrack.width / 2, rainTrack.y + rainTrack.height / 2);
    await page.keyboard.press('Home'); await page.waitForTimeout(150);
    const temperatureTrack = await reveal(page.getByRole('group', { name: /^Scenario Temperature:/ }));
    await page.mouse.click(temperatureTrack.x + temperatureTrack.width / 2, temperatureTrack.y + temperatureTrack.height / 2);
    await page.keyboard.press('End'); await page.waitForTimeout(150);
    check((await button(controls[0]).isDisabled()) && (await button(controls[3]).isDisabled()), 'The UI enforces lower rain and upper heat bounds');
    await analyze('Bounds -50/+4', { chuva_pct: -50, temp_c: 4 });
    const upperRain = await reveal(page.getByRole('group', { name: /^Scenario Rainfall:/ }));
    await page.mouse.click(upperRain.x + upperRain.width / 2, upperRain.y + upperRain.height / 2);
    await page.keyboard.press('End'); await page.waitForTimeout(150);
    const lowerHeat = await reveal(page.getByRole('group', { name: /^Scenario Temperature:/ }));
    await page.mouse.click(lowerHeat.x + lowerHeat.width / 2, lowerHeat.y + lowerHeat.height / 2);
    await page.keyboard.press('Home'); await page.waitForTimeout(150);
    check((await button(controls[1]).isDisabled()) && (await button(controls[2]).isDisabled()), 'The UI enforces upper rain and lower heat bounds');
    await analyze('Bounds +30/0', { chuva_pct: 30, temp_c: 0 });
    check(requests.length === 8, 'Eight explicit analyses cover baseline, scenarios, reset, persistence and both bounds');
    check(chats.length === 0, 'No chat or LLM request is sent');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, actual_api: true, analyses: requests.length,
      cases: results.map(({ label, raw }) => ({ label, adjustment: raw.entrada.ajuste ?? null, first: raw.sequencias[0].id })), checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/real-scenarios-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, requests: requests.map(request => request.ajuste ?? null) }));
  } finally { await context.close(); }
}
