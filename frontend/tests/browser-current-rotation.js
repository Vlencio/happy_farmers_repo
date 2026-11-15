// Run with playwright-cli run-code --filename=frontend/tests/browser-current-rotation.js.
// Uses the local API and demo boundary. An isolated context preserves the user's draft.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  async function reveal(locator) {
    for (let i = 0; i < 22; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 72 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width * .72, height * .55);
      await page.mouse.wheel(0, box.y < 72 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(180);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    const box = await reveal(page.getByRole('button', { name, exact: true }));
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  async function analyze(crops, month = 10, horizon = 2) {
    await page.goto(originalPage.url());
    await waitConnected();
    // Seed only the setup state; submission and all navigation use visible controls.
    await page.evaluate(async ({ crops, month, horizon }) => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      farm.name = 'Demonstration field';
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: crops.map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })),
        settings: { mes_plantio: month, horizonte: horizon } }));
    }, { crops, month, horizon });
    await page.reload();
    await waitConnected();
    await click('Analyze farm →');
    await waitText('ENGINE ANALYSIS');
  }
  try {
    await analyze(['soja', 'milho']);
    check(await cards().count() === 4, 'Current reference plus three ranked cards from real API');
    const names = await cards().allTextContents();
    check(names[0].startsWith('CURRENT ROTATION: Soybean → Corn'), 'Current reference remains separate from ranked options');
    const screen = await text();
    for (const metric of ['Gross revenue / ha · full rotation · today', 'Soil · today', 'Suitability · future']) {
      check(screen.split(metric).length - 1 === 4, 'All four cards show ' + metric);
    }
    const boxes = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(boxes.every(box => Math.abs(box.y - boxes[0].y) < 2), 'Wide desktop shows four cards side by side');
    await reveal(cards().first());
    await page.screenshot({ path: 'output/playwright/current-rotation-desktop.png' });
    for (const name of names) {
      await click(name);
      await waitText('Your crop cycle, step by step');
      check(await page.getByRole('button', { name: /^Stage \d+:/ }).count() === 2, 'Two crop stages open for ' + name.split(':')[0]);
      check((await text()).includes('2020/21'), 'Dry-year context retained for ' + name.split(':')[0]);
      await click('← Compare strategies');
    }
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(350);
    const medium = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(Math.abs(medium[0].y - medium[1].y) < 2 && medium[2].y > medium[0].y, 'Medium desktop arranges strategies in two columns');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    const mobile = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(mobile.every((box, i) => box.x >= 0 && box.x + box.width <= 391 && (i === 0 || box.y > mobile[i - 1].y)), 'Mobile stacks all four cards without horizontal overflow');
    await reveal(cards().first());
    await page.screenshot({ path: 'output/playwright/current-rotation-mobile.png' });
    await click(names[0]);
    await waitText('Your crop cycle, step by step');
    check((await text()).includes('Your comparison reference'), 'Mobile opens current rotation details');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await analyze(['soja', 'milho'], 2);
    check(await cards().count() === 3, 'Discarded reference has no empty timeline link');
    check((await text()).includes('NOT FEASIBLE') && (await text()).includes('has no planting window in the second season'), 'Discarded reference shows actual reason');
    await reveal(page.getByRole('button', { name: 'Review history and options', exact: true }));
    await page.screenshot({ path: 'output/playwright/current-rotation-discarded.png' });
    await analyze([]);
    check(await cards().count() === 3 && (await text()).includes('NO HISTORY PROVIDED'), 'Optional empty history preserves three ranked options');
    await analyze(['algodao', 'soja', 'milho']);
    check(await cards().count() === 4 && (await cards().first().textContent()).startsWith('CURRENT ROTATION: Soybean → Corn'), 'Long history displays the corrected current rotation');
    check(!(await text()).includes('There are more seasons in the history'), 'Obsolete history-length warning is removed');
    await click(await cards().first().textContent());
    await waitText('Your crop cycle, step by step');
    check(await page.getByRole('button', { name: 'Stage 1: Soybean · Main season', exact: true }).count() === 1, 'Long-history current rotation opens the correct first crop');
    await page.setViewportSize({ width: 390, height: 844 });
    await analyze(['algodao', 'soja', 'milho'], 10, 1);
    check(await cards().count() === 4 && (await cards().first().textContent()).startsWith('CURRENT ROTATION: Soybean.'), 'One-crop horizon follows the engine equivalent slot on mobile');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await analyze(['soja', 'milho'], 4, 1);
    check(await cards().count() === 0 && (await text()).includes('No feasible sequence'), 'Empty result still explains missing reference');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/current-rotation-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-2500) }));
  } finally { await context.close(); }
}
