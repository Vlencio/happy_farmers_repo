// Run with playwright-cli run-code --filename=frontend/tests/browser-warnings.js.
// Real API checks come first. Legacy/empty responses are explicitly simulated.
// An isolated context preserves the user's saved farm and planning.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  let syntheticChecks = 0;
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name, synthetic = false) => {
    if (!ok) throw new Error(name);
    checks.push(name);
    if (synthetic) syntheticChecks++;
  };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Motor conectado|Conectado/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const warningsHeading = () => page.getByRole('heading', { name: 'Riscos e lacunas desta estratégia', exact: true });
  async function reveal(locator) {
    for (let i = 0; i < 36; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width * .78, height * .55);
      await page.mouse.wheel(0, box.y < 78 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(180);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    const box = await reveal(page.getByRole('button', { name, exact: true }));
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  async function align(locator, top = 120) {
    for (let i = 0; i < 18; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width * .78, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(180);
    }
  }
  async function openWithKeyboard(name) {
    // Rune keeps DOM focus on canvas while tracking button focus internally.
    // Start at a visible navigation control, then follow its exposed Tab order.
    await click('Seus caminhos');
    const enabled = await page.getByRole('button').evaluateAll(buttons => buttons.filter(button => !button.disabled).map(button => button.textContent));
    const start = enabled.indexOf('Seus caminhos');
    const target = enabled.indexOf(name);
    if (start < 0 || target <= start) throw new Error('Missing keyboard route to strategy: ' + name);
    for (let i = start; i < target; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(100);
    }
    await page.keyboard.press('Enter');
    await waitText('Riscos e lacunas desta estratégia');
  }
  async function analyze(crops = ['soja', 'milho']) {
    await page.goto(originalPage.url());
    await waitConnected();
    // Seed only input state; submission and navigation use real controls.
    await page.evaluate(async crops => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: crops.map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })),
        settings: { mes_plantio: 10, horizonte: 2 } }));
    }, crops);
    await page.reload();
    await waitConnected();
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analisar fazenda →');
    const raw = await (await response).json();
    await waitText('ANÁLISE DO MOTOR');
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      const farm = JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm;
      return mapMotorAnalysis(raw, farm);
    }, raw);
    return { raw, view };
  }
  async function verifyDetail(rec, source) {
    const screen = await text();
    const risks = source.avisos.filter(item => item.tipo === 'risco');
    const gaps = source.avisos.filter(item => item.tipo === 'lacuna');
    check(await warningsHeading().count() === 1, 'Strategy detail exposes a warning-section heading: ' + rec.sequence_id);
    check(await page.getByRole('heading', { name: 'Riscos para revisar · ' + risks.length, exact: true }).count() === 1 &&
      await page.getByRole('heading', { name: 'Lacunas de informação · ' + gaps.length, exact: true }).count() === 1,
    'Detail separates risks and gaps with counts from the real response: ' + rec.sequence_id);
    check([...rec.warnings.risks, ...rec.warnings.gaps].every(item =>
      [item.title, item.context, item.description, item.evidence].every(value => !value || screen.includes(value))),
    'Every returned warning keeps its context, explanation and evidence: ' + rec.sequence_id);
    check(screen.includes(rec.warnings.note), 'Warning limitations remain visible: ' + rec.sequence_id);
  }
  try {
    const first = await analyze();
    check(await cards().count() === 4, 'Warnings preserve the current reference and three ranked cards');
    const names = await cards().allTextContents();
    const recs = [first.view.current_rotation.strategy, ...first.view.recommendations];
    check(recs.every((rec, i) => names[i].includes(rec.warnings.summary)), 'All card accessible names include their own warning counts');
    check(recs.every((rec, i) => [rec.warnings.risks[0], rec.warnings.gaps[0]].filter(Boolean).every(item => names[i].includes(item.card_summary))),
      'Each card exposes its first risk and gap to assistive technology');
    const firstRanked = first.view.recommendations[0];
    const thirdRanked = first.view.recommendations[2];
    check(JSON.stringify(firstRanked.warnings) !== JSON.stringify(thirdRanked.warnings), 'Different strategies show distinct real warnings');
    const boxes = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(boxes.every(box => Math.abs(box.y - boxes[0].y) < 2), 'Desktop retains four cards side by side');
    await align(cards().first());
    await page.screenshot({ path: 'output/playwright/warnings-cards-desktop.png' });
    await openWithKeyboard(names[0]);
    check(true, 'Tab and Enter open current-rotation warning details');
    await verifyDetail(first.view.current_rotation.strategy, first.raw.sequencias.find(seq => seq.id === first.view.current_rotation.strategy.sequence_id));
    await click('← Comparar estratégias');
    await click(names[3]);
    await waitText('Riscos e lacunas desta estratégia');
    await verifyDetail(thirdRanked, first.raw.sequencias.find(seq => seq.id === thirdRanked.sequence_id));
    await align(warningsHeading());
    await page.screenshot({ path: 'output/playwright/warnings-soil-desktop.png' });

    const bean = await analyze(['soja', 'feijao']);
    const current = bean.view.current_rotation.strategy;
    const source = bean.raw.sequencias.find(seq => seq.id === 'soja>feijao');
    check(current.sequence_id === 'soja>feijao' && source.avisos.some(item => item.codigo === 'queda_no_futuro') && source.avisos.some(item => item.codigo === 'solo_exposto'),
      'The real soybean-bean reference supplies income loss and soil-exposure warnings');
    await click(await cards().first().textContent());
    await waitText('Riscos e lacunas desta estratégia');
    await verifyDetail(current, source);
    check((await text()).includes('Feijão') && !(await text()).includes('feijao'), 'Crop labels in warning copy retain Portuguese accents');
    const exposure = source.avisos.find(item => item.codigo === 'solo_exposto').dados;
    const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    check((await text()).includes(String(exposure.dias_expostos)) && (await text()).includes(number(exposure.chuva_exposta_mm)),
      'Real exposed days and rainfall reach the rendered warning evidence');
    await align(warningsHeading());
    await page.screenshot({ path: 'output/playwright/warnings-bean-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await align(warningsHeading());
    const headingBox = await warningsHeading().boundingBox();
    check(headingBox.x >= 0 && headingBox.x + headingBox.width <= 391, 'Mobile warning heading fits the viewport');
    check([...current.warnings.risks, ...current.warnings.gaps].every(item => item.evidence && item.context), 'Every bean warning has its own evidence and context');
    await page.screenshot({ path: 'output/playwright/warnings-bean-mobile.png' });
    await align(page.getByRole('heading', { name: 'Lacunas de informação · ' + current.warnings.gaps.length, exact: true }));
    await page.screenshot({ path: 'output/playwright/warnings-gaps-mobile.png' });
    check((await text()).includes('32 °C'), 'Mobile retains the actual heat-threshold information gap');
    await click('← Comparar estratégias');
    const mobileBoxes = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(mobileBoxes.every((box, i) => box.x >= 0 && box.x + box.width <= 391 && (i === 0 || box.y > mobileBoxes[i - 1].y)),
      'Mobile stacks warning cards without horizontal overflow');

    await page.setViewportSize({ width: 1440, height: 1100 });
    const noHistory = await analyze([]);
    check(await cards().count() === 3 && noHistory.raw.sequencias.every(seq => seq.avisos.some(item => item.codigo === 'sem_historico')),
      'Empty history preserves three ranked cards and real missing-history gaps');
    await click(await cards().first().textContent());
    await waitText('Riscos e lacunas desta estratégia');
    const noHistoryRec = noHistory.view.recommendations[0];
    await verifyDetail(noHistoryRec, noHistory.raw.sequencias.find(seq => seq.id === noHistoryRec.sequence_id));

    // SIMULATED legacy service: no avisos field. This is not a no-risk result.
    await page.route('**/api/analyze', async route => {
      const response = await route.fetch();
      const body = await response.json();
      for (const seq of body.sequencias) delete seq.avisos;
      await route.fulfill({ response, json: body });
    });
    await analyze();
    check((await text()).includes('Avisos indisponíveis nesta resposta do motor.'), 'SIMULATED legacy response marks warning data unavailable on cards', true);
    await click(await cards().first().textContent());
    await waitText('Riscos e lacunas desta estratégia');
    check((await text()).includes('Avisos indisponíveis nesta resposta do motor.') && !(await text()).includes('Nenhum aviso sinalizado pelo motor'),
      'SIMULATED legacy detail does not turn missing warnings into an empty result', true);
    await page.unroute('**/api/analyze');

    // SIMULATED complete service result with zero warnings, distinct from absent.
    await page.route('**/api/analyze', async route => {
      const response = await route.fetch();
      const body = await response.json();
      for (const seq of body.sequencias) seq.avisos = [];
      await route.fulfill({ response, json: body });
    });
    await analyze();
    check((await text()).includes('Nenhum aviso sinalizado pelo motor') && !(await text()).includes('Avisos indisponíveis nesta resposta do motor.'),
      'SIMULATED empty warning list renders as a supplied result on cards', true);
    await click(await cards().first().textContent());
    await waitText('Riscos e lacunas desta estratégia');
    check((await text()).includes('Nenhum aviso sinalizado pelo motor'), 'SIMULATED empty detail keeps the explicit no-warning state', true);
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, synthetic_checks: syntheticChecks, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/warnings-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-7000) }));
  } finally { await context.close(); }
}
