// Run with playwright-cli run-code --filename=frontend/tests/browser-document.js.
// Uses the real local API for every analysis. Chat capability/replies and three
// exceptional provenance envelopes are SIMULATED; no model provider is called.
async originalPage => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), checks = [], errors = [], analyses = [], chats = [];
  let sourceMode = 'normal';
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value);
  const connected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''));
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  const parameters = 'Adjust priorities, soil and climate';
  const climate = 'What if the climate changes in your region?';
  page.on('pageerror', error => errors.push(error.message));
  async function reveal(locator) {
    for (let i = 0; i < 70; i++) {
      const b = await locator.boundingBox(), height = page.viewportSize().height;
      if (!b) throw new Error('Missing visible control: ' + locator);
      if (b.y >= 80 && b.y + Math.min(b.height, 120) < height - 40) return b;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, b.y - 130)));
      await page.waitForTimeout(120);
    }
    throw new Error('Unable to reveal control: ' + locator);
  }
  async function click(name, last = false) {
    const locator = last ? button(name).last() : button(name);
    await reveal(locator);
    await page.waitForTimeout(120);
    const b = await locator.boundingBox();
    await page.mouse.click(b.x + b.width / 2, Math.min(b.y + b.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(140);
  }
  async function capture(name, locator) {
    const b = await reveal(locator), width = page.viewportSize().width;
    check(b.x >= 0 && b.x + b.width <= width + 1, name + ': content fits viewport');
    await page.screenshot({ path: `output/playwright/document-${name}.png` });
  }
  async function analyze(action = 'Analyze farm →') {
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/analyze'));
    await click(action);
    const response = await pending;
    check(response.status() === 200, 'Real analysis succeeds: ' + action);
    const raw = await response.json();
    await waitText('HAPPY FARMERS ANALYSIS');
    await page.waitForTimeout(150);
    return { raw, request: response.request().postDataJSON() };
  }
  async function openParameters() {
    if (await button(parameters + ' · expand').count()) await click(parameters + ' · expand');
  }
  await page.route('**/api/metadata', async route => {
    const response = await route.fetch(), body = await response.json();
    body.capabilities = { ...body.capabilities, chat: true };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/chat', async route => {
    chats.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: { resposta: 'SIMULATED: conversation before resetting parameters.', modelo: 'qa-simulated', recusada: false } });
  });
  await page.route('**/api/analyze', async route => {
    analyses.push(route.request().postDataJSON());
    const response = await route.fetch(), body = await response.json();
    if (sourceMode === 'fallback') body.origem = { ...body.origem, hoje: 'fallback_tabela_demo', dentro_mg: true,
      aviso: 'Sem clima do POWER para este ponto (ValueError: dados inválidos). Usando as tabelas do talhao de demonstracao, a 72 km.' };
    if (sourceMode === 'outside') body.origem = { ...body.origem, hoje: 'power_ponto', dentro_mg: false,
      aviso: 'O ponto do talhão está fora de Minas Gerais.' };
    if (sourceMode === 'north') body.origem = { ...body.origem, hoje: 'power_ponto', dentro_mg: true,
      aviso: 'POWER do ponto e projeção NEX-GDDP regional, sem correção da estação A520. No norte da grade, há extremos de chuva conhecidos nos dados NEX-GDDP que podem afetar a receita futura e a ordem de opções próximas.' };
    await route.fulfill({ response, json: body });
  });
  try {
    await page.goto(originalPage.url()); await connected();
    const initial = await text();
    check(initial.includes('01  Select your field') && initial.includes("02  Your field's history: what has been planted?")
      && initial.includes('03  Plan your next planting') && initial.includes('04  Tell us more about your field'), 'Setup exposes all four named input steps');
    check(initial.includes('Tell us about your field') && initial.includes('Explore your options'), 'Five-step guide includes local information and results');
    check(await button('Your priorities · collapse').getAttribute('aria-expanded') === 'true', 'Priorities start expanded with accessible disclosure state');
    check(await button('Soil texture · expand').getAttribute('aria-expanded') === 'false'
      && await button(climate + ' · expand').getAttribute('aria-expanded') === 'false', 'Soil and climate start collapsed');
    check(await button('Sandy · 30 mm').count() === 0 && await button('Decrease rainfall by 5%').count() === 0, 'Collapsed optional controls are absent from keyboard and accessibility order');
    check(!initial.includes('CLIMATE BASELINE FOR THIS ANALYSIS') && initial.includes('POWER 2005–2024'), 'Climate baseline stays accessible in top information instead of planting controls');
    const glossary = await button('Understand the terms · expand').boundingBox();
    const fieldTitle = await page.getByText('01  Select your field', { exact: true }).boundingBox();
    check(glossary.y < fieldTitle.y, 'Glossary is in the top information block');
    const cta = await button('Analyze farm →').boundingBox();
    check(cta.width > 900 && cta.height >= 56, 'Analyze action has its own prominent full-width desktop row');
    await capture('setup-desktop', page.getByRole('heading', { level: 1 }));
    await click('Use sample field');
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await click('Soil texture · expand'); await waitText('Regional suggestion: clay');
    check(await page.getByRole('button', { name: /^(Show|Hide) field observations$/ }).count() === 0, 'Field observations are absent from setup even for the demo');
    await click('Sandy · 30 mm');
    await click('Water: priority 3 (high)');
    await click('Soil: priority 0 (no weight)');
    await click(climate + ' · expand');
    await click('Decrease rainfall by 5%');
    await click('Increase temperature by 0.5 °C');
    const before = await draft();
    check(before.settings.solo_textura === 'arenoso' && before.settings.prioridades.agua === 3 && before.settings.ajuste.temp_c === .5,
      'Input disclosures retain real saved selections');
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', value = JSON.parse(localStorage.getItem(key));
      value.history = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload(); await connected();
    const adjusted = await analyze();
    check(adjusted.request.solo_textura === 'arenoso' && adjusted.request.ajuste.chuva_pct === -5 && adjusted.request.ajuste.temp_c === .5,
      'Collapsed restored controls still send the selected values');
    check(await button(parameters + ' · expand').getAttribute('aria-expanded') === 'false'
      && await button('Water: priority 3 (high), selected').count() === 0, 'Result parameters start collapsed');
    const positions = await Promise.all([
      button('Understand the terms · expand'), page.getByText('HAPPY FARMERS ANALYSIS', { exact: true }),
      page.getByText('WHAT-IF SCENARIO', { exact: true }), cards().first(), button(parameters + ' · expand'),
      page.getByRole('heading', { name: 'Chat about this analysis', exact: true }), page.getByRole('button', { name: /^(Show|Hide) field observations$/ }),
      button('Analyze another field').last(),
    ].map(locator => locator.boundingBox()));
    check(positions.every((b, i) => b && (i === 0 || b.y > positions[i - 1].y)), 'Result order is information, analysis, adjustment warning, cards, parameters, chat, field and restart');
    check(!(await text()).includes('CLIMATE SOURCES AND LIMITS') && (await text()).includes('DATA SOURCES'), 'Normal demo provenance is neutral under DATA SOURCES');
    check(!(await text()).includes('day by day'), 'Analysis explanation does not promise an unavailable daily mode');
    check(await page.getByRole('button', { name: /^Show \d+ discarded sequences$/ }).count() === 0, 'Successful recommendations hide discarded sequences');
    await capture('results-desktop', cards().first());
    await openParameters();
    check(await button('Water: priority 3 (high), selected').count() === 1 && await button('Sandy · 30 mm · selected').count() === 1
      && await button('Decrease rainfall by 5%').count() === 1, 'Expanded results expose all three existing parameter panels');
    await click('Open AI chat');
    const counter = page.getByText(/^\d+\/1,000 characters · Ctrl\+Enter to send$/);
    const b = await reveal(counter);
    await page.mouse.click(b.x + 45, b.y - 30);
    await page.keyboard.insertText('Explain these results.');
    await click('Send question');
    await waitText('SIMULATED: conversation before resetting parameters.');
    const beforeReset = analyses.length;
    const reset = await analyze('Reset parameters');
    await page.waitForTimeout(200);
    check(analyses.length === beforeReset + 1, 'Reset parameters triggers exactly one analysis');
    check(JSON.stringify(reset.request.prioridades) === JSON.stringify({ agua: 1, solo: 1, renda: 1 })
      && !Object.hasOwn(reset.request, 'solo_textura') && !Object.hasOwn(reset.request, 'ajuste'), 'Reset restores equal priorities, default soil and unadjusted climate in the actual request');
    const saved = await draft();
    check(saved.settings.solo_padrao === true && saved.settings.solo_textura === undefined && saved.settings.ajuste.chuva_pct === 0
      && saved.settings.ajuste.temp_c === 0, 'Reset persists the default-soil override and zero adjustment');
    check(reset.request.rotacao_atual.join('|') === 'soja|milho' && saved.settings.mes_plantio === before.settings.mes_plantio
      && saved.settings.horizonte === before.settings.horizonte && JSON.stringify(saved.farm.geojson.geometry) === JSON.stringify(before.farm.geojson.geometry),
      'Reset preserves the field, crop history and planting plan');
    check(await button('Open AI chat').count() === 1 && !(await text()).includes('SIMULATED: conversation before resetting parameters.'), 'Reset clears and closes the previous conversation');
    check(!(await text()).includes('WHAT-IF SCENARIO'), 'Reset removes the hypothetical-scenario warning');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
    await capture('results-mobile', cards().first());
    await capture('parameters-mobile', button('Reset parameters'));
    await click('Analyze another field', true); await click('Keep draft');
    check((await draft()).farm !== null, 'Analyze another field still requires confirmation and can be canceled');
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(250);
    for (const [mode, expected] of [['fallback', '72 km'], ['outside', 'outside Minas Gerais'], ['north', 'rainfall extremes']]) {
      sourceMode = mode;
      await click('← Edit farm and history');
      await analyze();
      check((await text()).includes('CLIMATE SOURCES AND LIMITS') && (await text()).includes(expected), 'SIMULATED ' + mode + ': exceptional climate warning remains visible');
    }
    sourceMode = 'normal';
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', value = JSON.parse(localStorage.getItem(key));
      value.settings.mes_plantio = 4; value.settings.horizonte = 1;
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload(); await connected();
    const empty = await analyze();
    check(empty.raw.sequencias.length === 0 && await cards().count() === 0, 'A real empty result does not invent recommendation cards');
    const discarded = page.getByRole('button', { name: /^Show \d+ discarded sequences$/ });
    await click(await discarded.textContent());
    check(await page.getByRole('button', { name: /^Hide \d+ discarded sequences$/ }).count() === 1, 'Discard reasons remain available for a real empty result');
    await click('Analyze another field', true); await click('Delete draft');
    check(await draft() === null && await button('Analyze farm →').isDisabled(), 'Confirmed field reset returns to the empty setup');
    check(chats.length === 1 && errors.length === 0, 'One simulated chat exchange and no uncaught JavaScript errors');
    return { passed: checks.length, analyses: analyses.length, simulated_chat_requests: chats.length, simulated_provenance_cases: 3, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/document-failure.png' });
    throw new Error(JSON.stringify({ failure: error.message, checks, errors, analyses, screen: (await text().catch(() => '')).slice(-3000) }));
  } finally { await context.close(); }
}
