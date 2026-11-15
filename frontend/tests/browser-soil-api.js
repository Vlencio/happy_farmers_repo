// Run with playwright-cli run-code --filename=frontend/tests/browser-soil-api.js.
// Real HTTP metadata, soil suggestions, engine analyses and model ranges. No mocks,
// no LLM calls and no external climate download: all analyses use the demo field.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], analyses = [], chats = [], suggestions = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /^(?:1ST|2ND|3RD) TODAY.*Open timeline$/ });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  const labels = { arenoso: 'Sandy · 30 mm', medio: 'Medium · 45 mm', argiloso: 'Clay · 60 mm' };
  const reset = 'Use default reference · 60 mm';
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/metadata') && url.searchParams.has('lat')) suggestions.push(url.href);
    if (request.method() === 'POST' && url.pathname.endsWith('/analyze')) analyses.push(request.postDataJSON());
    if (request.method() === 'POST' && url.pathname.endsWith('/chat')) chats.push(request.postDataJSON());
  });
  async function reveal(locator, top = 120) {
    for (let i = 0; i < 55; i++) {
      const box = await locator.boundingBox(), height = page.viewportSize().height;
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
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
  async function analyze(texture, action) {
    const pending = page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/analyze')
      && response.request().postDataJSON().solo_textura === texture);
    await click(action);
    const response = await pending, raw = await response.json(), request = response.request().postDataJSON();
    check(response.status() === 200 && raw.origem.hoje === 'tabela_demo', `${texture ?? 'default'}: real demo analysis succeeds`);
    check(request.solo_textura === texture && raw.entrada.solo_textura === texture, `${texture ?? 'default'}: request and engine echo agree`);
    check(texture ? raw.entrada.cad_mm === { arenoso: 30, medio: 45, argiloso: 60 }[texture]
      : !Object.hasOwn(raw.entrada, 'cad_mm'), `${texture ?? 'default'}: supplied soil capacity matches the chosen reference`);
    await waitText('ENGINE ANALYSIS');
    const view = await page.evaluate(async raw => (await import('/web/api.mjs')).mapMotorAnalysis(raw,
      JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm), raw);
    await waitText(view.soil_note);
    check(raw.modelos?.chuva === 'razao' && raw.modelos.nomes.length === 3, `${texture ?? 'default'}: API supplies the three models with exact rain ratios`);
    const names = await cards().allTextContents();
    check(names.length === 3 && view.recommendations.every((rec, i) => rec.sequence_id === raw.sequencias[i].id
      && names[i].includes(rec.crop) && names[i].includes(rec.model_note)), `${texture ?? 'default'}: cards preserve real ranking and model ranges`);
    check(view.recommendations.every(rec => rec.model_note && !rec.model_note.includes('Rainfall is approximated.')),
      `${texture ?? 'default'}: exact model ratios do not show an approximation notice`);
    return raw;
  }
  try {
    await page.goto(originalPage.url()); await waitConnected();
    const metadata = await (await page.request.get(new URL('/api/metadata', originalPage.url()).href)).json();
    check(metadata.capabilities.solo_textura === true, 'Real API announces soil support');
    await page.evaluate(async () => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' })),
        settings: { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 } } }));
    });
    await page.reload(); await waitConnected();
    await waitText('Regional suggestion: clay');
    check((await draft()).settings.solo_textura === 'argiloso' && suggestions.length > 0, 'Real point suggestion selects clay and is saved locally');
    check((await text()).includes('GLDAS') && (await text()).includes('NASA'), 'Regional soil source is visible');
    const clay = await analyze('argiloso', 'Analyze farm →');
    check(clay.sequencias.slice(0, 3).map(seq => seq.id).join('|') === 'soja>crotalaria|soja>milho|soja>sorgo', 'New October ranking is delivered through the real API');
    const current = page.getByRole('button', { name: /^CURRENT ROTATION:.*Open timeline$/ });
    check(await current.count() === 1 && (await current.textContent()).includes('Soybean → Corn')
      && (await cards().nth(1).textContent()).includes('Soybean → Corn'), 'Reference remains separate when it also ranks second');
    const sand = await analyze('arenoso', labels.arenoso);
    check(JSON.stringify(sand.sequencias) !== JSON.stringify(clay.sequencias), 'Changing soil reruns the real engine and changes its result');
    await page.reload(); await waitConnected();
    check((await draft()).settings.solo_textura === 'arenoso' && await button(`${labels.arenoso} · selected`).count() === 1,
      'Manual sand choice survives reload and takes precedence over the regional suggestion');
    await analyze('arenoso', 'Analyze farm →');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const boxes = await Promise.all(Object.values(labels).map(label => page.getByRole('button', { name: new RegExp(`^${label}`) }).boundingBox()));
    check(boxes.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'All real soil choices fit the mobile viewport');
    await reveal(page.getByRole('heading', { name: 'Soil texture', exact: true }));
    await page.screenshot({ path: 'output/playwright/soil-api-mobile.png' });
    await analyze('medio', labels.medio);
    await analyze(undefined, reset);
    await page.reload(); await waitConnected();
    check((await draft()).settings.solo_padrao === true && (await draft()).settings.solo_textura === undefined,
      'Explicit default survives reload without a regional suggestion overriding it');
    await analyze(undefined, 'Analyze farm →');
    check(analyses.length === 6 && chats.length === 0 && errors.length === 0, 'Six real analyses finish without a provider call or JavaScript error');
    return { passed: checks.length, analyses: analyses.length, transport_simulated: false, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/soil-api-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-4500) }));
  } finally { await context.close(); }
}
