// Run with playwright-cli run-code --filename=frontend/tests/browser-english.js.
// Real demo API; an isolated context leaves the user's draft untouched.
async originalPage => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage(), checks = [], errors = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value);
  const noPortuguese = /\b(Talhão|Sua fazenda|Seu próximo|Suas prioridades|Rotação atual|Benefícios|Riscos|Lacunas|Entenda os termos|Não foi possível|Nenhuma|Crotalária|Feijão|milímetros|plantio|disponível|comunidade)\b/i;
  page.on('pageerror', error => errors.push(error.message));
  async function reveal(locator) {
    for (let i = 0; i < 65; i++) {
      const b = await locator.boundingBox(), height = page.viewportSize().height;
      if (b && b.y >= 90 && b.y + Math.min(b.height, 120) < height - 40) return b;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, (b?.y || 0) - 150)));
      await page.waitForTimeout(140);
    }
    throw new Error('Unable to reveal an English UI element');
  }
  async function click(name) {
    const b = await reveal(button(name));
    await page.mouse.click(b.x + b.width / 2, Math.min(b.y + b.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(150);
  }
  async function capture(name, locator) {
    const b = await reveal(locator), width = page.viewportSize().width;
    check(b.x >= 0 && b.x + b.width <= width + 1, name + ': content fits viewport');
    await page.screenshot({ path: `output/playwright/english-${name}.png` });
  }
  try {
    await page.goto(originalPage.url()); await waitText('Engine connected');
    check(await page.locator('html').getAttribute('lang') === 'en-US', 'Document language is English for assistive technology');
    check(await page.locator('#rune-app').getAttribute('aria-label') === 'Happy Farmers, farm planning', 'Canvas accessibility label is English');
    check(!noPortuguese.test(await text()), 'Setup and metadata notices have English presentation text');
    check((await text()).includes('Demonstration in Minas Gerais, Brazil.') && (await text()).includes('Triângulo Mineiro region; crop prices reflect Brazilian conditions.'), 'Setup identifies the Brazilian demonstration and local calendar and prices');
    check((await text()).includes('hectares (ha), millimeters (mm), degrees Celsius (°C) and meters (m). Currency: Brazilian reais (BRL).'), 'Setup explains metric units and the Brazilian currency before analysis');
    await capture('setup-desktop', page.getByRole('heading', { name: 'What will your next crop cycle be?' }));
    await capture('context-desktop', page.getByText(/^Demonstration in Minas Gerais, Brazil\./));
    await click('Use sample field');
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    check(await page.locator('#farm-name').inputValue() === 'Demonstration field', 'Default demonstration field name is English');
    check(!noPortuguese.test(await page.locator('#map-dialog').innerText()), 'Map labels and instructions are English');
    await page.locator('#coordinates').fill('not coordinates');
    await page.locator('#coordinate-search button').click();
    check((await page.locator('#map-status').textContent()).includes('Enter latitude and longitude'), 'Coordinate validation is English');
    await page.locator('#coordinates').fill('-20.032, -48.526');
    await page.locator('#coordinate-search button').click();
    check((await page.locator('#map-status').textContent()).includes('Location found'), 'English coordinate input still locates the point');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'output/playwright/english-map-mobile.png' });
    check(await page.locator('#confirm-boundary').isEnabled(), 'Translated map preserves boundary confirmation');
    await page.locator('#confirm-boundary').click();
    if (await button('Soil texture · expand').count()) await click('Soil texture · expand');
    await waitText('Regional suggestion: clay');
    check((await text()).includes('GLDAS') && !(await text()).includes('Sugestão regional'), 'Real soil source is localized');
    await capture('context-mobile', page.getByText(/^Metric units: hectares/));
    await click('Understand the terms · expand');
    for (const term of ['Available soil water', 'Ky · response to water shortage', 'Frost risk', 'Bad year', 'Technical tie', 'Nitrogen-fixing crop', 'Cover crops / crop residue', 'Deep roots', 'Drought tolerance']) {
      check(await page.getByText(term, { exact: true }).count() === 1, 'English glossary: ' + term);
    }
    await capture('glossary-mobile', page.getByText('Ky · response to water shortage', { exact: true }));
    // Reproduce a draft saved before the English UI, including its default name.
    // The migration must preserve crop IDs, history and the selected settings.
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', value = JSON.parse(localStorage.getItem(key));
      value.farm.name = 'Talhão de demonstração';
      value.farm.geojson.properties.name = 'Talhão de demonstração';
      value.history = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload(); await waitText('Engine connected');
    check((await text()).includes('Demonstration field') && !(await text()).includes('Talhão de demonstração'), 'Legacy sample draft restores the English default field name');
    check((await text()).includes('Soybean') && (await text()).includes('Corn'), 'Saved wire IDs display as English crop names');
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    const response = await pending, raw = await response.json();
    check(response.status() === 200, 'Real English-interface analysis succeeds');
    check(response.request().postDataJSON().rotacao_atual.join('|') === 'soja|milho', 'Language does not change analysis wire IDs');
    await waitText('HAPPY FARMERS ANALYSIS');
    check(!noPortuguese.test(await text()), 'Cards, current reference and API source notices are in English');
    check((await text()).includes('BRL') && !(await text()).includes('R$'), 'Currency is explicitly BRL with no dollar conversion');
    check((await text()).includes('Brazilian reais (BRL)') && (await text()).includes('Revenue is gross, before costs. It is not profit.'), 'Results explain the currency and gross nature of revenue');
    const cards = page.getByRole('button', { name: /^[123].*TODAY.*Open timeline$/ });
    check(await cards.count() === 3, 'All three ranked cards remain accessible');
    check(raw.sequencias.slice(0,3).map(s => s.id).join('|') === 'soja>crotalaria|soja>milho|soja>sorgo', 'English UI preserves the real ranking');
    await capture('cards-desktop', cards.first());
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('cards-mobile', cards.first());
    await click(await cards.first().textContent());
    await waitText('Benefits considered by the engine');
    check(!noPortuguese.test(await text()), 'Timeline, facts, warnings and benefits are in English');
    check((await text()).includes('Full rotation covers all crops in the planned sequence.') && (await text()).includes('Per year means revenue per year of field occupancy'), 'Detail retains the full-rotation and annual revenue explanation');
    await capture('detail-mobile', page.getByRole('heading', { name: 'Benefits considered by the engine' }));
    await page.route('**/api/metadata*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Não foi possível ler os dados climáticos. Tente novamente.' }) }));
    await page.reload();
    await waitText('Unable to connect to the analysis service.');
    check((await text()).includes('Soybean') && (await text()).includes('Corn'), 'Known crop IDs keep English labels when metadata is unavailable');
    check(!noPortuguese.test(await text()), 'Restored draft and connection error remain English without metadata');
    check(errors.length === 0, 'No JavaScript errors');
    return { passed: checks.length, real_analyses: 1, simulated_metadata_failure: true, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/english-review-failure.png' });
    throw new Error(JSON.stringify({ failure: error.message, checks, errors }));
  } finally { await context.close(); }
}
