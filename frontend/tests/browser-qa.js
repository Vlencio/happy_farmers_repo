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
    await waitText('Motor conectado');
    check(await button('Analisar fazenda →').isDisabled(), 'Empty state prevents analysis');
    check(await page.getByRole('heading', { level: 1 }).count() === 1, 'Main heading exposed to assistive technology');
    await click('Usar área de exemplo');
    await page.locator('#map-dialog').waitFor();
    check(await page.locator('#finish-draw').isDisabled(), 'Finish drawing disabled until a drawing exists');
    await page.locator('#coordinates').fill('abc');
    await page.locator('#coordinate-search button').click();
    check(await page.locator('#coordinates').getAttribute('aria-invalid') === 'true', 'Invalid coordinates explain the problem');
    await page.locator('#coordinates').fill('-20,032; -48,526');
    await page.locator('#coordinate-search button').click();
    check((await page.locator('#map-status').textContent()).includes('Localização encontrada'), 'Brazilian decimal coordinates locate the map');
    await page.locator('#farm-name').fill('Não salvar esta edição');
    await page.keyboard.press('Escape');
    check(await draft() === null, 'Closing map discards unconfirmed changes');
    await click('Usar área de exemplo');
    await page.locator('#confirm-boundary').click();
    await waitText('Talhão de demonstração');
    check((await draft()).farm.area_ha > 219, 'Confirming the sample saves the real boundary');
    await click('Cultura anterior');
    check(await button('Soja').count() === 1, 'Open select keeps its options in the accessibility tree');
    await click('Soja');
    await fillField('SAFRA / ANO', '2025/99');
    check(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Safra ou ano', 'Season input has its own accessible name');
    await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.activeElement.getAttribute('aria-label')) === 'Observações da safra', 'Notes input has its own accessible name');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await waitText('Informe a safra');
    check(await page.getByRole('alert').count() === 1, 'Enter activates focused button and announces invalid season');
    await fillField('SAFRA / ANO', '2025/26');
    await fillField('OBSERVAÇÃO OPCIONAL', 'Safra de teste QA');
    await click('+ Adicionar ao histórico');
    check((await draft()).history[0].notes === 'Safra de teste QA', 'Adding history saves crop, season and notes');
    await fillField('SAFRA / ANO', '2025/26');
    await click('+ Adicionar ao histórico');
    await waitText('já estão no histórico');
    check((await draft()).history.length === 1, 'Duplicate history is rejected');
    await choose('Cultura anterior', 'Milho');
    await fillField('SAFRA / ANO', '2024');
    await click('+ Adicionar ao histórico');
    const down = page.getByRole('button', { name: 'Mover cultura para depois' }).first();
    const downBox = await reveal(down);
    await page.mouse.click(downBox.x + downBox.width / 2, downBox.y + downBox.height / 2);
    await page.waitForTimeout(160);
    check((await draft()).history.map(item => item.crop).join(',') === 'milho,soja', 'Reordering changes the saved crop order');
    await page.reload();
    await waitText('Motor conectado');
    check((await text()).includes('Seu rascunho foi restaurado'), 'Reload restores the saved planning');
    check((await draft()).history.length === 2, 'Reload preserves history');
    // Exercise removal using the visible controls, then analyze without history.
    for (let i = 0; i < 2; i++) {
      const remove = page.getByRole('button', { name: 'Remover', exact: true }).first();
      const box = await reveal(remove); await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(150);
    }
    check((await draft()).history.length === 0, 'Removing history leaves an optional empty history');
    await choose('Mês em que o talhão fica livre', 'Abril');
    await choose('Quantidade de culturas a planejar', 'Próxima cultura');
    await click('Analisar fazenda →');
    await waitText('Nenhuma sequência viável');
    check((await text()).includes('Vamos ajustar o calendário?'), 'Empty results guide the user to adjust the calendar');
    const discarded = await page.getByRole('button', { name: /^Ver \d+ sequências descartadas$/ }).textContent();
    await click(discarded);
    check((await text()).includes('Ocultar'), 'Discard reasons expand');
    await click('← Editar fazenda e histórico');
    await choose('Mês em que o talhão fica livre', 'Outubro');
    check((await draft()).settings.mes_plantio === 10, 'Keyboard selects October beyond the dropdown viewport');
    await choose('Quantidade de culturas a planejar', 'Próximas duas culturas');
    await click('Analisar fazenda →');
    await waitText('Três caminhos. A sua escolha.');
    const cards = page.getByRole('button', { name: /Abrir linha do tempo$/ });
    check(await cards.count() === 3, 'Real API returns the three objective cards');
    await reveal(cards.first());
    await page.screenshot({ path: 'output/playwright/qa-desktop-results.png' });
    const names = await cards.allTextContents();
    for (const name of names) {
      await click(name);
      await page.getByRole('button', { name: /^Etapa 1:/ }).waitFor();
      check((await text()).includes('2020/21'), 'Dry-year facts visible in ' + name.split(':')[0]);
      const stages = page.getByRole('button', { name: /^Etapa \d+:/ });
      check(await stages.count() >= 2, 'Two crop stages available in ' + name.split(':')[0]);
      await click(await stages.last().textContent());
      await click('Seus caminhos');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(450);
    await reveal(page.getByRole('button', { name: /Abrir linha do tempo$/ }).first());
    await page.screenshot({ path: 'output/playwright/qa-mobile-results.png' });
    check(await page.getByRole('button', { name: /Abrir linha do tempo$/ }).count() === 3, 'Mobile retains all three results');
    await click('← Editar fazenda e histórico');
    await click('Ver e editar no mapa');
    const dimensions = await page.locator('#map-dialog').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
    check(dimensions.scrollWidth <= dimensions.width + 1, 'Mobile map has no horizontal overflow');
    await page.screenshot({ path: 'output/playwright/qa-mobile-map.png' });
    await page.locator('#close-map').click();
    await click('Recomeçar planejamento');
    await click('Manter');
    check((await draft()).farm !== null, 'Keeping the draft cancels reset');
    await click('Recomeçar planejamento');
    await click('Apagar rascunho');
    check(await draft() === null, 'Confirmed reset removes the saved draft');
    check(await button('Analisar fazenda →').isDisabled(), 'Reset returns to an empty, disabled analysis');
    check(errors.length === 0, 'No uncaught JavaScript exceptions');
    return { passed: checks.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/qa-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(0, 1600) }));
  } finally { await context.close(); }
}
