// Run with playwright-cli run-code --filename=frontend/tests/browser-hover.js.
// Actual pointer hit tests on the Rune canvas and HTML map; one real analysis.
// Separate browser contexts preserve the user's saved draft.
async originalPage => {
  const browser = originalPage.context().browser();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), checks = [], errors = [], posts = [];
  const extraContexts = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const button = name => page.getByRole('button', { name, exact: true });
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const draft = () => page.evaluate(() => localStorage.getItem('happy-farmers-draft-v1'));
  const connected = p => p.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''));
  const canvasCursor = p => p.locator('#rune-app').evaluate(el => getComputedStyle(el).cursor);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(new URL(request.url()).pathname); });
  async function reveal(locator, p = page) {
    for (let i = 0; i < 75; i++) {
      const b = await locator.boundingBox(), height = p.viewportSize().height;
      if (!b) throw new Error('Missing control: ' + locator);
      if (b.y >= 78 && b.y + Math.min(b.height, 100) < height - 35) return b;
      await p.mouse.move(p.viewportSize().width - 24, height * .55);
      await p.mouse.wheel(0, Math.max(-650, Math.min(650, b.y - 135)));
      await p.waitForTimeout(160);
    }
    throw new Error('Unable to reveal control: ' + locator);
  }
  const point = b => ({ x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 50) });
  async function click(locator) {
    await reveal(locator); await page.waitForTimeout(150);
    const p = point(await locator.boundingBox());
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(180);
  }
  async function hover(locator, name, { disabled = false, paint = false } = {}) {
    await reveal(locator); await page.waitForTimeout(200);
    await page.mouse.move(240, 20); await page.waitForTimeout(250);
    const beforeBox = await locator.boundingBox();
    const clip = { x: Math.ceil(beforeBox.x + 2), y: Math.ceil(beforeBox.y + 2), width: Math.floor(beforeBox.width - 4), height: Math.floor(Math.min(beforeBox.height - 4, 85)) };
    const before = paint ? await page.screenshot({ clip }) : null;
    const p = point(beforeBox);
    await page.mouse.move(p.x, p.y); await page.waitForTimeout(240);
    const cursor = await canvasCursor(page);
    check(disabled ? cursor !== 'pointer' : cursor === 'pointer', `${name}: ${disabled ? 'disabled control has no clickable cursor' : 'native hand cursor'} (received ${cursor})`);
    const afterBox = await locator.boundingBox();
    check(['x', 'y', 'width', 'height'].every(k => Math.abs(beforeBox[k] - afterBox[k]) < .1), `${name}: hover does not shift the layout or hit area`);
    if (paint) check(!before.equals(await page.screenshot({ clip })), `${name}: visible hover feedback`);
  }
  try {
    await page.goto(originalPage.url()); await connected(page);
    const emptyDraft = await draft();
    await hover(button('Your farm'), 'Enabled navigation', { paint: true });
    await hover(button('Your options'), 'Unavailable navigation', { disabled: true });
    await click(button('Your options'));
    check((await text()).includes('FARM PLANNING'), 'Clicking disabled navigation keeps the setup page');
    await hover(button('Draw on map'), 'Primary button', { paint: true });
    await hover(button('Import GeoJSON'), 'Outline button', { paint: true });
    await hover(button('About this analysis · expand'), 'About toggle', { paint: true });
    await hover(button('Understand the terms · expand'), 'Disclosure', { paint: true });
    await hover(button('Previous crop'), 'Select trigger', { paint: true });
    // Rune exposes the field's labels in its accessibility mirror, not a second
    // editable DOM input. Hit the rendered input between its two visible labels.
    await reveal(page.getByText('SEASON / YEAR', { exact: true }));
    const season = await page.getByText('SEASON / YEAR', { exact: true }).boundingBox();
    const notes = await page.getByText('OPTIONAL NOTE', { exact: true }).boundingBox();
    await page.mouse.move(season.x + 80, (season.y + season.height + notes.y) / 2);
    await page.waitForTimeout(180);
    check(await canvasCursor(page) === 'text', 'The crop-history input keeps the text-editing cursor');
    await click(button('Previous crop'));
    const option = button('Soybean');
    await option.waitFor();
    await hover(option, 'Select option');
    await page.keyboard.press('Escape');
    await hover(button('Water: priority 3 (high)'), 'Priority choice', { paint: true });
    await hover(button('Analyze farm →'), 'Analyze without a field', { disabled: true });
    await click(button('Analyze farm →'));
    check(posts.length === 0 && await draft() === emptyDraft, 'Hovering and clicking unavailable actions neither saves changes nor requests analysis');
    await reveal(page.getByRole('heading', { level: 1 }));
    const heading = point(await page.getByRole('heading', { level: 1 }).boundingBox());
    await page.mouse.move(heading.x, heading.y); await page.waitForTimeout(150);
    check(['default', 'auto'].includes(await canvasCursor(page)), 'Noninteractive heading keeps the normal arrow');
    await click(button('About this analysis · expand'));
    check(await button('About this analysis · collapse').count() === 1, 'Pointer activation still expands the information');
    await page.keyboard.press('Space'); await page.waitForTimeout(180);
    check(await button('About this analysis · expand').count() === 1, 'Keyboard Space still activates the focused control');
    await click(button('Draw on map'));
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#draw-boundary').hover();
    check(await page.locator('#draw-boundary').evaluate(el => getComputedStyle(el).cursor) === 'pointer', 'HTML map buttons retain the hand cursor');
    await page.locator('#confirm-boundary').hover();
    check(await page.locator('#confirm-boundary').evaluate(el => getComputedStyle(el).cursor) === 'not-allowed', 'Unavailable map confirmation retains its disabled cursor');
    check(await page.locator('#satellite-map').evaluate(el => getComputedStyle(el).cursor) === 'grab', 'The map retains its pan cursor');
    await page.locator('#draw-boundary').click();
    check(await page.locator('#satellite-map').evaluate(el => getComputedStyle(el).cursor) === 'crosshair', 'Drawing retains the map crosshair');
    await page.locator('#close-map').click();
    await click(button('Use sample field'));
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await click(button('Soil texture · expand'));
    await page.waitForFunction(() => document.querySelector('[data-rune-a11y]')?.textContent.includes('Regional suggestion: clay'));
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1', value = JSON.parse(localStorage.getItem(key));
      value.history = ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2024 + i), notes: '' }));
      value.settings.mes_plantio = 10; value.settings.horizonte = 2;
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload(); await connected(page);
    const savedDraft = await draft();
    const pending = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/analyze'));
    await click(button('Analyze farm →'));
    check((await pending).status() === 200, 'The real sample-field analysis still succeeds');
    const ranked = page.getByRole('button', { name: /^[123].*TODAY.*Open timeline$/ });
    const current = page.getByRole('button', { name: /^CURRENT ROTATION:.*Open timeline$/ });
    await ranked.first().waitFor();
    await hover(ranked.first(), 'Ranked rotation card', { paint: true });
    await page.screenshot({ path: 'output/playwright/hover-ranked-card.png' });
    await hover(current, 'Current rotation reference', { paint: true });
    await click(ranked.first());
    await hover(page.getByRole('button', { name: /^Stage 2:/ }), 'Crop stage', { paint: true });
    await click(page.getByRole('button', { name: /^Stage 2:/ }));
    check((await text()).includes('GREEN MANURE & SOIL COVER'), 'Clicking a crop stage still updates its details');
    await hover(page.getByRole('button', { name: /^Soil in / }).first(), 'Exposure-calendar month', { paint: true });
    check(await draft() === savedDraft && posts.filter(p => p.endsWith('/analyze')).length === 1 && !posts.some(p => p.endsWith('/chat')), 'Result hover and navigation preserve the draft with one analysis and no AI request');

    const reduced = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    extraContexts.push(reduced);
    const rp = await reduced.newPage(); rp.on('pageerror', error => errors.push(error.message));
    await rp.goto(originalPage.url()); await connected(rp);
    check(await rp.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Reduced-motion preference is active');
    const about = rp.getByRole('button', { name: 'About this analysis · expand', exact: true });
    const rb = await reveal(about, rp), rpoint = point(rb);
    await rp.mouse.move(240, 20); await rp.waitForTimeout(300);
    await rp.mouse.move(rpoint.x, rpoint.y); await rp.waitForTimeout(80);
    const rclip = { x: Math.ceil(rb.x + 2), y: Math.ceil(rb.y + 2), width: Math.floor(rb.width - 4), height: Math.floor(rb.height - 4) };
    const immediate = await rp.screenshot({ clip: rclip });
    await rp.waitForTimeout(250);
    check(immediate.equals(await rp.screenshot({ clip: rclip })), 'Reduced-motion hover reaches a stable visual state without a lingering fade');
    check(await canvasCursor(rp) === 'pointer', 'Reduced motion keeps the informative hand cursor');
    await rp.mouse.move(240, 20); await rp.waitForTimeout(80);
    const exit = await rp.screenshot({ clip: rclip });
    await rp.waitForTimeout(250);
    check(exit.equals(await rp.screenshot({ clip: rclip })) && !exit.equals(immediate), 'Reduced-motion hover also clears immediately when the pointer leaves');
    check(await rp.locator('#draw-boundary').evaluate(el => getComputedStyle(el).transitionDuration) === '0s', 'HTML map controls disable transitions with reduced motion');
    await rp.mouse.click(rpoint.x, rpoint.y); await rp.waitForTimeout(180);
    check(await rp.getByRole('button', { name: 'About this analysis · collapse', exact: true }).count() === 1, 'Reduced-motion controls remain actionable');

    const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    extraContexts.push(touch);
    const tp = await touch.newPage(); tp.on('pageerror', error => errors.push(error.message));
    await tp.goto(originalPage.url()); await connected(tp);
    const tb = await tp.getByRole('button', { name: 'About this analysis · expand', exact: true }).boundingBox();
    const tpoint = point(tb);
    await tp.touchscreen.tap(tpoint.x, tpoint.y); await tp.waitForTimeout(220);
    check(await tp.getByRole('button', { name: 'About this analysis · collapse', exact: true }).count() === 1, 'Touch activation does not require a prior hover');
    const touched = await tp.getByRole('button', { name: 'About this analysis · collapse', exact: true }).boundingBox();
    check(touched.x >= 0 && touched.x + touched.width <= 390, 'Touch control stays within the mobile viewport');
    await tp.screenshot({ path: 'output/playwright/hover-touch.png' });
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, real_analyses: 1, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/hover-failure.png' });
    throw new Error(JSON.stringify({ failure: error.message, checks, errors, screen: (await text().catch(() => '')).slice(-2000) }));
  } finally {
    for (const extra of extraContexts) await extra.close();
    await context.close();
  }
}
