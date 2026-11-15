// Run with playwright-cli run-code --filename=frontend/tests/browser-ux.js.
// Real local API and sample boundary. This isolated context leaves the user's
// draft untouched; no responses or model-provider calls are simulated.
async originalPage => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), checks = [], errors = [], posts = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  const ranked = () => page.getByRole('button', { name: /^[123].*TODAY.*Open timeline$/ });
  const current = () => page.getByRole('button', { name: /^CURRENT ROTATION:.*Open timeline$/ });
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const draft = () => page.evaluate(() => localStorage.getItem('happy-farmers-draft-v1'));
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value);
  const connected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''));
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
  async function reveal(locator) {
    for (let i = 0; i < 75; i++) {
      const b = await locator.boundingBox(), height = page.viewportSize().height;
      if (!b) throw new Error('Missing control: ' + locator);
      if (b.y >= 78 && b.y + Math.min(b.height, 100) < height - 35) return b;
      await page.mouse.move(page.viewportSize().width - 24, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, b.y - 135)));
      await page.waitForTimeout(140);
    }
    throw new Error('Unable to reveal control: ' + locator);
  }
  async function click(locator) {
    await reveal(locator); await page.waitForTimeout(130);
    const b = await locator.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 50));
    await page.waitForTimeout(160);
  }
  async function capture(name, locator) {
    await reveal(locator);
    for (let i = 0; i < 12; i++) {
      const b = await locator.boundingBox();
      if (Math.abs(b.y - 130) < 12) break;
      await page.mouse.move(page.viewportSize().width - 24, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, b.y - 130)));
      await page.waitForTimeout(160);
    }
    await page.screenshot({ path: `output/playwright/ux-${name}.png` });
  }
  async function fits(locators, label) {
    const boxes = await Promise.all(locators.map(locator => locator.boundingBox()));
    check(boxes.every(b => b && b.width > 0 && b.x >= -1 && b.x + b.width <= page.viewportSize().width + 1), label);
  }
  async function keyboardOpen(name) {
    // Rune tracks control focus internally while its DOM mirror provides Tab order.
    await click(button('Your options'));
    const controls = await page.getByRole('button').evaluateAll(nodes => nodes
      .filter(node => !node.disabled && node.getAttribute('aria-disabled') !== 'true')
      .map(node => node.textContent));
    const start = controls.indexOf('Your options'), target = controls.indexOf(name);
    if (start < 0 || target <= start) throw new Error('Missing keyboard route to ranked card');
    for (let i = start; i < target; i++) { await page.keyboard.press('Tab'); await page.waitForTimeout(80); }
    await page.keyboard.press('Enter');
    await waitText('Your crop cycle, step by step');
  }
  try {
    await page.goto(originalPage.url()); await connected();
    check(await button('Analyze farm →').isDisabled(), 'Empty setup still prevents analysis');
    check(await page.getByRole('heading', { level: 1 }).count() === 1, 'Setup exposes one main heading');
    const compact = await text();
    check(compact.includes('Brazil') && compact.includes('BRL') && compact.includes('2005–2024'), 'Compact context keeps location, currency and climate period visible');
    check(await button('Understand the terms · expand').count() === 1, 'Glossary remains directly accessible');
    check(await button('About this analysis · expand').getAttribute('aria-expanded') === 'false', 'Detailed context starts collapsed with an accessible state');
    const draw = await button('Draw on map').boundingBox();
    check(draw.y + draw.height < 1000, 'The first field action is visible in the desktop opening screen');
    await capture('setup-desktop', page.getByRole('heading', { level: 1 }));
    const emptyDraft = await draft();
    await click(button('About this analysis · expand'));
    check((await text()).includes('Triângulo Mineiro') && (await text()).includes('millimeters'), 'Expanded context retains the regional scope and metric-unit explanation');
    await click(button('About this analysis · collapse'));
    check(await draft() === emptyDraft && posts.length === 0, 'Reading context neither changes the draft nor starts analysis');
    await click(button('Use sample field'));
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await click(button('Soil texture · expand')); await waitText('Regional suggestion: clay');
    // Seed only history/planning after exercising the actual sample-field flow.
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', value = JSON.parse(localStorage.getItem(key));
      value.history = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
      value.settings.mes_plantio = 10; value.settings.horizonte = 2;
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload(); await connected();
    const inputDraft = await draft();
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/analyze'));
    await click(button('Analyze farm →'));
    const response = await pending, raw = await response.json();
    check(response.status() === 200, 'Real analysis succeeds');
    check(response.request().postDataJSON().rotacao_atual.join('|') === 'soja|milho', 'Redesigned flow preserves crop-history wire IDs');
    await waitText('HAPPY FARMERS ANALYSIS');
    check(await ranked().count() === Math.min(3, raw.sequencias.length) && await current().count() === 1, 'Ranked suggestions and the actual current reference remain accessible');
    const names = await cards().allTextContents(), firstName = await ranked().first().textContent();
    check(names[0] === firstName && names.at(-1).startsWith('CURRENT ROTATION:'), 'Suggested options precede the clearly separated current reference');
    const desktop = await Promise.all([0, 1, 2].map(i => ranked().nth(i).boundingBox()));
    check(desktop.every(b => Math.abs(b.y - desktop[0].y) < 2 && b.width >= 330), 'Desktop gives all three suggestions equal, readable columns');
    const referenceBox = await current().boundingBox();
    check(referenceBox.y > desktop[0].y + desktop[0].height, 'Current reference follows the recommendation row');
    check(firstName.includes(money(raw.sequencias[0].hoje.receita_ha)), 'The leading card preserves the API revenue in BRL');
    check(names.every(name => /\d+ flagged risks and \d+ data gaps/.test(name)), 'Every comparison card retains its risk and data-gap summary');
    await capture('results-desktop', ranked().first());
    await click(button('About this analysis · expand'));
    check((await text()).includes('Full rotation covers all crops') && (await text()).includes('Per year means revenue'), 'Revenue period guidance remains one click away');
    await click(button('About this analysis · collapse'));
    check(await draft() === inputDraft && posts.filter(p => p.endsWith('/analyze')).length === 1, 'Result disclosures preserve planning and do not repeat the analysis');
    await keyboardOpen(firstName);
    check(await page.getByRole('button', { name: /^Stage \d+:/ }).count() === 2, 'Keyboard activation opens the real two-crop timeline');
    const cycle = page.getByText('Your crop cycle, step by step', { exact: true });
    const benefits = page.getByRole('heading', { name: 'Benefits considered by the engine', exact: true });
    const warnings = page.getByRole('heading', { name: 'Risks and data gaps for this strategy', exact: true });
    const details = await Promise.all([cycle, benefits, warnings].map(locator => locator.boundingBox()));
    check(details[0].y < details[1].y && details[0].y < details[2].y, 'Crop navigation appears before the long technical explanations');
    check((await text()).includes('Water, month by month') && (await text()).includes('WHAT TO CONSIDER IN THIS CHOICE'), 'Detailed water data and trade-offs remain available');
    await capture('timeline-desktop', cycle);
    await click(page.getByRole('button', { name: /^Stage 2:/ }));
    check((await text()).includes('GREEN MANURE & SOIL COVER'), 'Selecting the cover crop still explains its zero-revenue role');
    await click(button('← Compare strategies'));
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(250);
      await fits([ranked().first(), ranked().nth(1), ranked().nth(2), current(), button('About this analysis · expand')], `${width}px comparison controls fit the viewport`);
      const boxes = await Promise.all([0, 1, 2].map(i => ranked().nth(i).boundingBox()));
      check(width === 1024 ? Math.abs(boxes[0].y - boxes[1].y) < 2 : boxes.every((b, i) => !i || b.y > boxes[i - 1].y), `${width}px comparison follows its responsive layout`);
      await capture(`results-${width}`, ranked().first());
      await click(ranked().first()); await waitText('Your crop cycle, step by step');
      await fits([button('← Compare strategies'), page.getByRole('button', { name: /^Stage 1:/ }), page.getByRole('button', { name: /^Stage 2:/ })], `${width}px timeline controls fit the viewport`);
      await capture(`timeline-${width}`, cycle);
      await click(page.getByRole('button', { name: /^Stage 2:/ }));
      check((await text()).includes('GREEN MANURE & SOIL COVER'), `${width}px crop selection remains functional`);
      await click(button('← Compare strategies'));
    }
    await click(button('← Edit farm and history'));
    await fits([button('View and edit on map'), button('Your priorities · collapse'), button('Analyze farm →')], '320px setup actions and priorities fit the viewport');
    await capture('setup-mobile', page.getByRole('heading', { level: 1 }));
    check(await draft() === inputDraft, 'Comparison, resizing and timeline navigation preserve the draft');
    // Reproduce the return to the empty field card after a completed analysis.
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.waitForTimeout(250);
    const restart = async () => {
      // The fixed sidebar action is already visible at the viewport bottom;
      // scrolling the content cannot move it into reveal()'s inner safe area.
      const b = await button('Analyze another field').boundingBox();
      if (!b || b.y < 0 || b.y + b.height > page.viewportSize().height) throw new Error('Restart action is outside the viewport');
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await button('Delete draft').waitFor();
    };
    await restart();
    await click(button('Keep draft'));
    check(await draft() === inputDraft, 'Canceling Analyze another field preserves the complete draft');
    await restart();
    await click(button('Delete draft'));
    await waitText('Just exploring? Start here.');
    check(await draft() === null && await button('Analyze farm →').isDisabled(), 'Confirmed restart returns to an empty field with analysis disabled');
    check(await button('View and edit on map').count() === 0 && await button('Use sample field').count() === 1, 'Restart restores the field-selection and sample controls');
    const fieldHeading = page.getByText('01 Select your field', { exact: true });
    // Rune preserves the two spaces in this label; use whitespace normalization.
    await capture('reset-desktop', fieldHeading);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(250);
      await fits([button('Draw on map'), button('Import GeoJSON'), button('Use sample field')], `${width}px empty-field controls fit after restarting`);
      await capture(`reset-${width}`, fieldHeading);
    }
    check(posts.filter(p => p.endsWith('/analyze')).length === 1 && !posts.some(p => p.endsWith('/chat')), 'One real analysis and no chat/provider requests');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, real_analyses: 1, viewports: [1440, 1024, 390, 320], checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/ux-failure.png' });
    throw new Error(JSON.stringify({ failure: error.message, checks, errors, screen: (await text().catch(() => '')).slice(-2500) }));
  } finally { await context.close(); }
}
