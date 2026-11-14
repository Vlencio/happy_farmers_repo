// Pointer/touch drawing, edits, geolocation and responsive boundary checks.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, geolocation: { latitude: -20.032, longitude: -48.526 }, permissions: ['geolocation'] });
  const page = await context.newPage();
  const checks = [], errors = [], layouts = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.toLowerCase().includes(value.toLowerCase()), value, { timeout: 15000 });
  const activate = async name => { await page.getByRole('button', { name, exact: true }).evaluate(el => el.click()); await page.waitForTimeout(150); };
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  try {
    await page.goto(originalPage.url()); await waitText('conectado');
    await activate('Desenhar no mapa');
    await page.locator('#locate').click();
    await page.waitForFunction(() => document.querySelector('#map-status').textContent.includes('Localização aproximada'));
    check(true, 'Granted geolocation centers on the emulated device position');
    await page.locator('#draw-boundary').click();
    check(await page.locator('#confirm-boundary').isDisabled(), 'Drawing cannot be confirmed prematurely');
    check(await page.locator('#finish-draw').isEnabled(), 'Finish button becomes available during drawing');
    const mapBox = await page.locator('#satellite-map').boundingBox();
    for (const [x, y] of [[.35, .32], [.72, .38]]) await page.touchscreen.tap(mapBox.x + mapBox.width * x, mapBox.y + mapBox.height * y);
    await page.locator('#finish-draw').click();
    check(await page.locator('#confirm-boundary').isDisabled(), 'Two vertices do not define a valid field');
    await page.touchscreen.tap(mapBox.x + mapBox.width * .53, mapBox.y + mapBox.height * .72);
    await page.locator('#finish-draw').click();
    check(await page.locator('#confirm-boundary').isEnabled(), 'Three touch vertices form a valid boundary');
    await page.locator('#farm-name').fill('Fazenda QA com um nome bastante longo para conferir a quebra de texto nas menores telas disponíveis');
    await page.locator('#confirm-boundary').click();
    check((await draft()).farm.point_count === 3, 'Touch-drawn field is saved with three vertices');
    const original = (await draft()).farm.geojson;
    await activate('Ver e editar no mapa');
    await page.locator('#edit-boundary').click();
    const vertex = page.locator('.leaflet-marker-icon').first();
    await vertex.waitFor();
    const vertexBox = await vertex.boundingBox();
    await page.mouse.move(vertexBox.x + vertexBox.width / 2, vertexBox.y + vertexBox.height / 2);
    await page.mouse.down(); await page.mouse.move(vertexBox.x + vertexBox.width / 2 + 20, vertexBox.y + vertexBox.height / 2 + 12, { steps: 8 }); await page.mouse.up();
    check(await page.locator('#edit-boundary').getAttribute('aria-pressed') === 'true', 'Point editing exposes its active state');
    await page.locator('#confirm-boundary').click();
    check(JSON.stringify((await draft()).farm.geojson) !== JSON.stringify(original), 'Dragging a vertex changes the confirmed GeoJSON');
    const confirmed = (await draft()).farm.geojson;
    await activate('Ver e editar no mapa');
    await page.locator('#draw-boundary').click();
    await page.keyboard.press('Escape');
    check(JSON.stringify((await draft()).farm.geojson) === JSON.stringify(confirmed), 'Cancelling a replacement drawing preserves the previous field');
    await activate('Ver e editar no mapa');
    check(await page.locator('#finish-draw').isDisabled(), 'Reopening the map clears the unfinished drawing mode');
    await page.evaluate(() => { navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1, message: 'Permission denied for QA' }); });
    await page.locator('#locate').click();
    check((await page.locator('#map-status').textContent()).includes('Localização não disponível'), 'Denied geolocation offers coordinate navigation');
    await page.locator('#close-map').click();
    await page.evaluate(() => {
      const key = 'happy-farmers-draft-v1'; const value = JSON.parse(localStorage.getItem(key));
      value.history = Array.from({ length: 12 }, (_, i) => ({ crop: i % 2 ? 'milho' : 'soja', season: String(2013 + i), notes: 'Observação longa para verificar a leitura e a quebra do histórico em telas pequenas.' }));
      localStorage.setItem(key, JSON.stringify(value));
    });
    await page.reload(); await waitText('conectado');
    for (const width of [320, 360, 390, 768, 900, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(250);
      const overflow = await page.locator('[data-rune-a11y] button').evaluateAll((buttons, width) => buttons.filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > width + 1); }).map(el => el.textContent), width);
      check(overflow.length === 0, 'Setup controls fit at ' + width + 'px');
      layouts.push({ width, overflow });
      if ([320, 900, 1440].includes(width)) await page.screenshot({ path: `output/playwright/qa-layout-${width}.png` });
      await activate('Ver e editar no mapa');
      const fits = await page.locator('#map-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
      check(fits, 'Map dialog fits at ' + width + 'px');
      await page.locator('#close-map').click();
    }
    check(errors.length === 0, 'No uncaught exceptions in map and layout scenarios');
    return { passed: checks.length, checks, layouts };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/qa-map-layout-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, layouts }));
  } finally { await context.close(); }
}
