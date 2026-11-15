// Real local API: February/one crop (soil purpose) and October/two crops
// (mixed sales + cover). No mocked responses; isolated browser draft only.
async originalPage => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage(), checks = [], errors = [], requests = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const button = name => page.getByRole('button', { name, exact: true });
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value);
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') requests.push(new URL(request.url()).pathname); });
  async function reveal(locator, top = 130) {
    for (let i = 0; i < 60; i++) {
      const box = await locator.boundingBox(), height = page.viewportSize().height;
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 85 && box.y + Math.min(box.height, 100) < height - 30) return box;
      await page.mouse.move(page.viewportSize().width - 24, height / 2);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(140);
    }
    throw new Error('Cannot reveal ' + locator);
  }
  async function click(locator) {
    await reveal(locator); await page.waitForTimeout(150);
    const box = await locator.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 50));
    await page.waitForTimeout(180);
  }
  async function capture(name, locator) {
    await reveal(locator); await page.waitForTimeout(200);
    // Keep the explanation in view, not just the first visible pixels of a tall card.
    for (let i = 0; i < 8; i++) {
      const at = await locator.boundingBox();
      if (Math.abs(at.y - 130) < 12) break;
      await page.mouse.move(page.viewportSize().width - 24, page.viewportSize().height / 2);
      await page.mouse.wheel(0, at.y - 130); await page.waitForTimeout(220);
    }
    const box = await locator.boundingBox();
    check(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, `${name}: content fits viewport`);
    await page.screenshot({ path: `output/playwright/revenue-${name}.png` });
  }
  async function analyze() {
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/analyze'));
    await click(button('Analyze farm →'));
    const response = await pending;
    check(response.status() === 200, 'Real API analysis succeeds');
    await waitText('HAPPY FARMERS ANALYSIS'); await page.waitForTimeout(200);
    return { raw: await response.json(), input: response.request().postDataJSON() };
  }
  try {
    await page.goto(originalPage.url()); await waitText('Engine connected');
    await click(button('Use sample field'));
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    // Let the automatic soil suggestion settle before preparing the isolated case.
    await click(button('Soil texture · expand')); await waitText('Regional suggestion: clay');
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', draft = JSON.parse(localStorage.getItem(key));
      draft.history = []; draft.settings.mes_plantio = 2; draft.settings.horizonte = 1;
      localStorage.setItem(key, JSON.stringify(draft));
    });
    await page.reload(); await waitText('Engine connected');
    const feb = await analyze();
    check(feb.input.mes_plantio === 2 && feb.input.horizonte === 1, 'Reproducible February / Next crop input reaches API');
    check(feb.raw.sequencias[0].id === 'crotalaria' && feb.raw.sequencias[0].hoje.receita_ha === 0, 'Real winner is sunn hemp with zero modeled revenue');
    const card = page.getByRole('button', { name: /Sunn hemp.*Open timeline$/ });
    const label = await card.textContent();
    check(label.includes('Primary role: Green manure & soil cover') && label.includes('nitrogen fixation'), 'Cover card leads with purpose and explains its soil contribution');
    check(!/BRL\s*0(?:\D|$)/.test(label), 'Cover card does not headline zero money');
    check(label.includes('data gaps'), 'Card retains the data-gap summary');
    await capture('cover-card-desktop', card);
    await click(card);
    await waitText('← Compare strategies');
    check((await text()).includes('Missing heat threshold'), 'Existing heat-data caution remains in the detail');
    check((await text()).includes('Soil benefits are not monetized'), 'Detail replaces repeated empty revenue metrics with a clear treatment');
    check(!/BRL\s*0(?:\D|$)/.test(await text()), 'Cover-only detail explains zero without repetitive BRL 0 figures');
    const role = page.getByText('GREEN MANURE & SOIL COVER', { exact: true });
    await capture('cover-stage-desktop', role);
    check((await text()).includes('does not include sales revenue from this crop'), 'Selected stage explains the absence of crop sales');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
    await capture('cover-stage-mobile', role);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile has no horizontal overflow');
    await click(button('← Compare strategies'));
    await capture('cover-card-mobile', page.getByRole('button', { name: /Sunn hemp.*Open timeline$/ }));
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(200);
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', draft = JSON.parse(localStorage.getItem(key));
      draft.settings.mes_plantio = 10; draft.settings.horizonte = 2;
      localStorage.setItem(key, JSON.stringify(draft));
    });
    await page.reload(); await waitText('Engine connected');
    const october = await analyze(), winner = october.raw.sequencias[0];
    check(winner.id === 'soja>crotalaria' && winner.hoje.receita_ha > 0, 'Real mixed winner combines soybean income with sunn hemp');
    const mixed = page.getByRole('button', { name: /Soybean → Sunn hemp.*Open timeline$/ });
    const mixedLabel = await mixed.textContent();
    check(mixedLabel.includes(money(winner.hoje.receita_ha)), 'Mixed card preserves the full positive revenue from the API');
    check(mixedLabel.includes('Sunn hemp is modeled for'), 'Mixed card explains the non-monetized crop');
    await click(mixed); await waitText('← Compare strategies');
    const soybean = winner.hoje.culturas.find(crop => crop.cultura === 'soja');
    check((await text()).includes(money(soybean.receita_ha)), 'Commercial crop revenue remains visible in the detail');
    await click(page.getByRole('button', { name: /^Stage 2: Sunn hemp/ }));
    await capture('mixed-stage-desktop', page.getByText('GREEN MANURE & SOIL COVER', { exact: true }));
    check((await text()).includes('This analysis does not include sales revenue from this crop'), 'Mixed cover stage explains its purpose instead of zero sales');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    check(!requests.some(path => path.endsWith('/chat')), 'No chat or model-provider request');
    return { passed: checks.length, real_analyses: 2, checks };
  } finally { await context.close(); }
}
