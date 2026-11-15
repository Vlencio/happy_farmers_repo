// Run with playwright-cli open http://127.0.0.1:4173 --headed, then
// playwright-cli run-code --filename=frontend/tests/browser-annual-income.js.
// Uses the real API and demo tables. No mocked responses or model-provider calls.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], analyses = [], chats = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const normalized = value => value.replace(/\s/g, '');
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) analyses.push(request.postDataJSON());
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.url());
  });
  async function reveal(locator, top = 150) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y + Math.min(box.height, 120) < height - 40) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(140);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    const box = await reveal(button(name));
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(140);
  }
  async function choose(name, option) {
    await click(name);
    await button(option).waitFor();
    const index = (await page.getByRole('button').allTextContents()).indexOf(option);
    if (index < 0) throw new Error('Missing option: ' + option);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(180);
  }
  async function capture(name, locator) {
    const box = await reveal(locator);
    check(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, name + ': focused text fits viewport width');
    await page.screenshot({ path: `output/playwright/annual-${name}.png` });
  }
  try {
    const metadataResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/metadata'));
    await page.goto(originalPage.url());
    await waitText('Engine connected');
    const response = await metadataResponse;
    check(response.status() === 200, 'Real metadata transport succeeds');
    const metadata = await response.json();
    // The wire contract is unchanged; the frontend translates its displayed period.
    check(metadata.climate_periods.futuro === 'por volta de 2060', 'API future period is centred around 2060');
    check(metadata.model_spread?.models.length === 3 && metadata.model_spread.scope === 'talhao_demo_2', 'Integrated D2 metadata provides the three models');
    await click('Use sample field');
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await waitText('Demonstration field');
    // Let the asynchronous suggestion save its state before seeding the draft.
    // A direct localStorage edit does not update the running host's history.
    if (await button('Soil texture · expand').count()) await click('Soil texture · expand');
    await waitText('Regional suggestion: clay');
    // Restore the same history as the real February fixture without modifying
    // the user's draft; this entire flow has its own isolated browser context.
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('happy-farmers-draft-v1'));
      draft.history = [{ crop: 'soja', season: '2024', notes: '' }, { crop: 'milho', season: '2025', notes: '' }];
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify(draft));
    });
    await page.reload(); await waitText('Engine connected');
    await choose('Month when the field becomes available', 'February');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).settings.mes_plantio) === 2, 'The visible month control saves February');
    check((await text()).includes('gross revenue per hectare and per year of field occupancy. Costs are not deducted.'), 'Income priority explains annual field occupancy');
    check((await text()).includes('around 2060') && !/2041[–-]2060|2050/.test(await text()), 'Setup shows the corrected future label without the old date');
    await click('Understand the terms · expand');
    const glossaryText = await text();
    check(['30 mm for sandy soil', '45 mm for medium texture', '60 mm for clay soil', 'With no texture specified, the reference is 60 mm', 'not measurements of this field']
      .every(value => glossaryText.includes(value)), 'Glossary uses soil texture references and preserves the default');
    check(glossaryText.includes('These are class references, not measurements of this field'), 'Soil reserve is distinguished from a field measurement');
    await capture('context-desktop', page.getByText(/^The calculation uses a water reserve of 30 mm/));
    const pendingAnalysis = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    const analysisResponse = await pendingAnalysis;
    check(analysisResponse.status() === 200, 'Real February analysis succeeds');
    const raw = await analysisResponse.json();
    check(raw.entrada.rotacao_atual.join('|') === 'soja|milho', 'Analysis retains the seeded crop history after the soil suggestion completes');
    await waitText('HAPPY FARMERS ANALYSIS');
    if (await button('Show field observations').count()) await click('Show field observations');
    check((await text()).includes('+1.34 to +2.31 °C; annual rainfall from -79.6 to +32.7 mm.'), 'D2 range is visible in results from the integrated real metadata');
    check(raw.origem?.hoje === 'tabela_demo', 'Analysis uses demo tables without an external POWER query');
    check(raw.sequencias[0].id === 'crotalaria>soja', 'New February winner is crotalaria-soybean: ' + JSON.stringify({ entry: raw.entrada, first: raw.sequencias[0].id }));
    const cards = page.getByRole('button', { name: /^(?:1ST|2ND|3RD) TODAY.*Open timeline$/ });
    check(await cards.count() === 3, 'Three ranked cards remain visible');
    const labels = await cards.allTextContents();
    check(['Sunn hemp → Soybean', 'Sorghum → Soybean', 'Common bean → Soybean'].every((crop, i) => labels[i].includes(crop)), 'Cards preserve the new engine top-three order');
    check((await text()).includes('Full rotation covers all crops in the planned sequence. Per year means revenue per year of field occupancy and is used by the income priority.'), 'Results distinguish sequence revenue from the annual ranking basis');
    check((await text()).includes('Currency: Brazilian reais (BRL).') && (await text()).includes('Revenue is gross, before costs. It is not profit.'), 'Results identify the original currency and gross revenue');
    check(labels.every(label => label.includes('Gross revenue / ha · full rotation · today')), 'Each ranked card identifies the full rotation and per-hectare basis');
    check((await text()).includes('around 2060') && !/2041[–-]2060|2050/.test(await text()), 'Results retain the corrected future date');
    await capture('revenue-guide-desktop', page.getByText(/^Full rotation covers all crops/));
    await capture('cards-desktop', cards.first());
    await click(labels[0]);
    await waitText('Your crop cycle, step by step');
    const detail = normalized(await text());
    for (const [scenario, label] of [['hoje', 'TODAY'], ['futuro', 'FUTURE'], ['seco', 'DRY YEAR']]) {
      const expected = raw.sequencias[0][scenario];
      check(detail.includes(normalized(`GROSS REVENUE / HA / YEAR · ${label}${money(expected.receita_ano_ha)}`)), `Detail shows supplied annual revenue for ${scenario}`);
      check(detail.includes(normalized(`YEARS ACCOUNTED FOR · ${label}${number(expected.anos_ocupados)} ${expected.anos_ocupados === 1 ? 'year' : 'years'}`)), `Detail shows supplied occupied years for ${scenario}`);
      check(detail.includes(normalized(`GROSS REVENUE / HA · FULL ROTATION · ${label}${money(expected.receita_ha)}`)), `Detail preserves full-sequence revenue for ${scenario}`);
    }
    check(money(raw.sequencias[0].hoje.receita_ha) !== money(raw.sequencias[0].hoje.receita_ano_ha), 'The tested February amounts distinguish annual and total revenue');
    check((await text()).includes('minimum of one year; a shorter sequence is not multiplied'), 'Detail explains the annual occupancy floor');
    const annualHeading = () => page.getByText('GROSS REVENUE / HA / YEAR · TODAY', { exact: true });
    await capture('detail-desktop', annualHeading());
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    // The API now adds a fourth annual-revenue fact for the model range; this
    // assertion compares only the three complete climate scenarios above.
    const annualLabels = await Promise.all((await page.getByText(/^GROSS REVENUE \/ HA \/ YEAR · (TODAY|FUTURE|DRY YEAR)$/).all()).map(label => label.boundingBox()));
    check(annualLabels.length === 3 && annualLabels.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'All three annual labels fit the mobile viewport');
    const rotationLabels = await Promise.all((await page.getByText(/^GROSS REVENUE \/ HA · FULL ROTATION · (TODAY|FUTURE|DRY YEAR)$/).all()).map(label => label.boundingBox()));
    check(rotationLabels.length === 3 && rotationLabels.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'All three full-rotation labels fit the mobile viewport');
    await capture('detail-mobile', annualHeading());
    await capture('revenue-guide-mobile', page.getByText(/^Full rotation covers all crops/));
    await click('← Compare strategies');
    const mobileCards = await Promise.all((await cards.all()).map(card => card.boundingBox()));
    check(mobileCards.length === 3 && mobileCards.every((box, i) => box && box.x >= 0 && box.x + box.width <= 391 && (i === 0 || box.y > mobileCards[i - 1].y)), 'Mobile stacks all ranked cards within the viewport');
    await capture('cards-mobile', cards.first());
    check(analyses.length === 1 && analyses[0].mes_plantio === 2, 'Only one real demo analysis is sent');
    check(chats.length === 0, 'No chat or LLM request is sent');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, checks, first: raw.sequencias[0].id };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/annual-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-4500) }));
  } finally { await context.close(); }
}
