// Run with playwright-cli run-code --filename=frontend/tests/browser-qa.js.
// A fresh browser context isolates these tests from the user's saved draft.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 15000 });
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  const button = name => page.getByRole('button', { name, exact: true });
  // Rune draws the controls on canvas. Its semantic mirror supplies their current
  // rectangles; real pointer/keyboard events exercise the visible controls.
  async function reveal(locator) {
    for (let i = 0; i < 18; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Control missing: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 72 && box.y < height - 50) return box;
      await page.mouse.move(page.viewportSize().width * .72, height * .55);
      await page.mouse.wheel(0, box.y < 72 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(200);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    const box = await reveal(button(name));
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 30));
    await page.waitForTimeout(130);
  }
  async function choose(name, option) {
    await click(name);
    await button(option).waitFor();
    const options = await page.getByRole('button').allTextContents();
    const index = options.indexOf(option);
    if (index < 0) throw new Error('Missing option: ' + option);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(180);
  }
  async function fillField(label, value) {
    const box = await reveal(page.getByText(label, { exact: true }));
    await page.mouse.click(box.x + 50, box.y + box.height + 25);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(value);
  }
  try {
    await page.goto(originalPage.url());
    await waitText('Engine connected');
    check(await button('Analyze farm →').isDisabled(), 'Empty state prevents analysis');
    check(await page.getByRole('heading', { level: 1 }).count() === 1, 'Main heading exposed to assistive technology');
    await click('Use sample field');
    await page.locator('#map-dialog').waitFor();
    check(await page.locator('#finish-draw').isDisabled(), 'Finish drawing disabled until a drawing exists');
    await page.locator('#coordinates').fill('abc');
    await page.locator('#coordinate-search button').click();
    check(await page.locator('#coordinates').getAttribute('aria-invalid') === 'true', 'Invalid coordinates explain the problem');
    await page.locator('#coordinates').fill('-20,032; -48,526');
    await page.locator('#coordinate-search button').click();
    check((await page.locator('#map-status').textContent()).includes('Location found'), 'Brazilian decimal coordinates locate the map');
    await page.locator('#farm-name').fill('Do not save this edit');
    await page.keyboard.press('Escape');
    check(await draft() === null, 'Closing map discards unconfirmed changes');
    await click('Use sample field');
    await page.locator('#confirm-boundary').click();
    await waitText('Demonstration field');
    check((await draft()).farm.area_ha > 219, 'Confirming the sample saves the real boundary');
    await click('Previous crop');
    check(await button('Soybean').count() === 1, 'Open select keeps its options in the accessibility tree');
    await click('Soybean');
    await fillField('SEASON / YEAR', '2025/99');
    check(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Season or year', 'Season input has its own accessible name');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Season notes', 'Notes input has its own accessible name');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await waitText('Enter a season');
    check(await page.getByRole('alert').count() === 1, 'Enter activates focused button and announces invalid season');
    await fillField('SEASON / YEAR', '2025/26');
    await fillField('OPTIONAL NOTE', 'QA test season');
    await click('+ Add to history');
    check((await draft()).history[0].notes === 'QA test season', 'Adding history saves crop, season and notes');
    await fillField('SEASON / YEAR', '2025/26');
    await click('+ Add to history');
    await waitText('are already in the history');
    check((await draft()).history.length === 1, 'Duplicate history is rejected');
    await choose('Previous crop', 'Corn');
    await fillField('SEASON / YEAR', '2024');
    await click('+ Add to history');
    const down = page.getByRole('button', { name: 'Move crop later' }).first();
    const downBox = await reveal(down);
    await page.mouse.click(downBox.x + downBox.width / 2, downBox.y + downBox.height / 2);
    await page.waitForTimeout(160);
    check((await draft()).history.map(item => item.crop).join(',') === 'milho,soja', 'Reordering changes the saved crop order');
    await page.reload();
    await waitText('Engine connected');
    check((await text()).includes('Your draft was restored'), 'Reload restores the saved planning');
    check((await draft()).history.length === 2, 'Reload preserves history');
    // Exercise removal using the visible controls, then analyze without history.
    for (let i = 0; i < 2; i++) {
      const remove = page.getByRole('button', { name: 'Remove', exact: true }).first();
      const box = await reveal(remove); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(150);
    }
    check((await draft()).history.length === 0, 'Removing history leaves an optional empty history');
    await choose('Month when the field becomes available', 'April');
    await choose('Number of crops to plan', 'Next crop');
    await click('Analyze farm →');
    await waitText('No feasible sequence');
    check((await text()).includes('Let\'s review your planting options.'), 'Empty results guide the user to adjust the calendar');
    const discarded = await page.getByRole('button', { name: /^Show \d+ discarded sequences$/ }).textContent();
    await click(discarded);
    check((await text()).includes('Hide'), 'Discard reasons expand');
    await click('← Edit farm and history');
    await choose('Month when the field becomes available', 'October');
    check((await draft()).settings.mes_plantio === 10, 'Keyboard selects October beyond the dropdown viewport');
    await choose('Number of crops to plan', 'Next two crops');
    await click('Analyze farm →');
    await waitText('Today\'s highest scores.');
    const cards = page.getByRole('button', { name: /Open timeline$/ });
    check(await cards.count() === 3, 'Real API returns three ranked cards');
    await reveal(cards.first());
    await page.screenshot({ path: 'output/playwright/qa-desktop-results.png' });
    const names = await cards.allTextContents();
    for (const name of names) {
      await click(name);
      await page.getByRole('button', { name: /^Stage 1:/ }).waitFor();
      check((await text()).includes('2020/21'), 'Dry-year facts visible in ' + name.split(':')[0]);
      const stages = page.getByRole('button', { name: /^Stage \d+:/ });
      check(await stages.count() >= 2, 'Two crop stages available in ' + name.split(':')[0]);
      await click(await stages.last().textContent());
      await click('Your options');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(450);
    await reveal(page.getByRole('button', { name: /Open timeline$/ }).first());
    await page.screenshot({ path: 'output/playwright/qa-mobile-results.png' });
    check(await page.getByRole('button', { name: /Open timeline$/ }).count() === 3, 'Mobile retains all three results');
    await click('← Edit farm and history');
    await click('View and edit on map');
    const dimensions = await page.locator('#map-dialog').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    check(dimensions.scrollWidth <= dimensions.width + 1, 'Mobile map has no horizontal overflow');
    await page.screenshot({ path: 'output/playwright/qa-mobile-map.png' });
    await page.locator('#close-map').click();
    await click('Analyze farm →');
    await waitText('HAPPY FARMERS ANALYSIS');
    await click('Analyze another field');
    await click('Keep draft');
    check((await draft()).farm !== null, 'Keeping the draft cancels reset');
    await click('Analyze another field');
    await click('Delete draft');
    check(await draft() === null, 'Confirmed reset removes the saved draft');
    check(await button('Analyze farm →').isDisabled(), 'Reset returns to an empty, disabled analysis');
    check(errors.length === 0, 'No uncaught JavaScript exceptions');
    return { passed: checks.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/qa-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(0, 1600) }));
  } finally { await context.close(); }
}
