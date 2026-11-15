// Run with playwright-cli run-code --filename=frontend/tests/browser-reviewed-models.js.
// Prepare cases with .venv/Scripts/python.exe frontend/scripts/export-reviewed-models.py.
// /analyze transport is SIMULATED to isolate per-model and optional daily cases.
// Daily mode is not yet exposed by the API. Every result in output/playwright/reviewed-models.json must
// come unmodified from the real local engine and delivered tables. No LLM calls.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [], chats = [];
  let cases, selected = 'october';
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 });
  const money = value => value.toLocaleString('en-US', { style: 'currency', currency: 'BRL', currencyDisplay: 'code', maximumFractionDigits: 0 });
  const normalized = value => value.replace(/\s/g, '');
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  const rankedCards = () => page.getByRole('button', { name: /^(?:1ST|2ND|3RD) TODAY.*Open timeline$/ });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname.endsWith('/analyze')) requests.push(request.postDataJSON());
    if (new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.postDataJSON());
  });
  await page.route('**/qa-reviewed-models', route => route.fulfill({ path: 'output/playwright/reviewed-models.json', contentType: 'application/json' }));
  // Isolate these legacy input fixtures from the independent regional soil selector.
  await page.route('**/api/metadata', async route => {
    const response = await route.fetch(), body = await response.json();
    body.capabilities = { ...body.capabilities, solo_textura: false };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/analyze', async route => {
    const expected = cases[selected];
    const request = route.request().postDataJSON();
    if (request.mes_plantio !== expected.request.mes_plantio || request.horizonte !== expected.request.horizonte
      || !same(request.rotacao_atual, expected.request.rotacao_atual) || !same(request.prioridades, expected.request.prioridades)) {
      await route.fulfill({ status: 422, json: { detail: 'The browser input does not match this real-engine QA case.' } });
      return;
    }
    await route.fulfill({ status: 200, json: expected.result });
  });
  async function reveal(locator, top = 120) {
    for (let i = 0; i < 60; i++) {
      const box = await locator.boundingBox(), height = page.viewportSize().height;
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(150);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    await reveal(button(name));
    await page.waitForTimeout(120);
    const box = await button(name).boundingBox();
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  async function align(locator, top = 120) {
    for (let i = 0; i < 30; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width - 22, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(150);
    }
  }
  async function analyze(key) {
    selected = key;
    await page.goto(originalPage.url());
    await waitConnected();
    const expected = cases[key];
    await page.evaluate(async request => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: request.rotacao_atual.map((crop, i) => ({ crop, season: String(2024 + i), notes: '' })),
        settings: { mes_plantio: request.mes_plantio, horizonte: request.horizonte, prioridades: request.prioridades } }));
    }, expected.request);
    await page.reload(); await waitConnected();
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    const response = await pending;
    check(response.status() === 200, key + ': simulated transport accepts the actual UI inputs');
    const raw = await response.json();
    check(same(raw, expected.result), key + ': transport preserves the complete real-engine response');
    await waitText('ENGINE ANALYSIS');
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      return mapMotorAnalysis(raw, JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm);
    }, raw);
    return { raw, view };
  }
  async function verifyCards(analysis, tiedCount, name) {
    const labels = await rankedCards().allTextContents();
    check(labels.length === 3 && analysis.view.recommendations.every((rec, i) => rec.sequence_id === analysis.raw.sequencias[i].id
      && labels[i].startsWith(`${['1ST', '2ND', '3RD'][i]} TODAY`) && labels[i].includes(rec.crop)), name + ': real engine order and rank numbers remain intact');
    check(analysis.view.recommendations.filter(rec => rec.tie_note).length === tiedCount, name + ': only close leaders receive the technical-tie note');
    // Rune exposes each rendered card as one accessible button, not its individual badges.
    check(labels.filter(label => label.includes('Technical tie · today')).length === tiedCount, name + ': accessible tie labels match the ranked cards');
    check(analysis.view.ranking_note && (await text()).includes(analysis.view.ranking_note), name + ': the approximate tie criterion is explained');
    check(analysis.view.recommendations.every((rec, i) => {
      const source = analysis.raw.sequencias[i];
      return labels[i].includes(`Rank · today: #${source.rank_hoje}`)
        && labels[i].includes(`Score · today: ${number(source.hoje.score)} / 100`)
        && labels[i].includes(`Rank · future: #${source.rank_futuro}`)
        && labels[i].includes(rec.tie_note) && labels[i].includes(rec.model_note);
    }), name + ': accessible cards retain actual scores, ranks and model/tie explanations');
    const reference = analysis.view.current_rotation.strategy;
    if (reference) {
      const original = analysis.view.recommendations.find(rec => rec.sequence_id === reference.sequence_id);
      check(!original || (reference.tie_note === original.tie_note && reference.model_note === original.model_note), name + ': duplicated current rotation retains the same comparison evidence');
    }
  }
  async function openCurrent(analysis) {
    const current = analysis.view.current_rotation.strategy;
    check(current && (await cards().first().textContent()).includes('CURRENT ROTATION'), 'Current reference is visible before opening its new warnings');
    await click(await cards().first().textContent()); await waitText('Risks and data gaps for this strategy');
    const screen = await text();
    check([...current.warnings.risks, ...current.warnings.gaps].every(item =>
      [item.title, item.context, item.description, item.evidence].every(value => !value || screen.includes(value))), 'Every current-reference warning retains its actual context and evidence');
    check(!screen.includes('Additional engine risk'), 'The new delivered warning codes receive specific English labels');
    return current;
  }
  try {
    await page.goto(originalPage.url()); await waitConnected();
    cases = await page.evaluate(async () => (await fetch('/qa-reviewed-models')).json());
    const october = await analyze('october');
    await verifyCards(october, 3, 'October with three nearby scores');
    check(october.raw.sequencias.slice(0, 3).map(seq => seq.id).join('|') === 'soja>crotalaria|soja>milho|soja>sorgo', 'October uses the delivered reviewed ranking');
    check(october.raw.modelos.chuva === 'razao' && october.view.recommendations.every(rec => /Min–max range, not a confidence interval/.test(rec.model_note)
      && !rec.model_note.includes('Rainfall is approximated.')), 'Exact model rain ratios retain range limits without the approximate-rain notice');
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/reviewed-models-cards-desktop.png' });
    const corn = october.raw.sequencias[1];
    check(corn.id === 'soja>milho' && corn.modelos.rank_min === 1 && corn.modelos.rank_max === 2, 'The real corn case exercises a nonzero model rank range');
    await click(await rankedCards().nth(1).textContent()); await waitText('Your crop cycle, step by step');
    let screen = await text();
    check(screen.includes(october.view.recommendations[1].model_note) && screen.includes('#1–#2'), 'Detail exposes the same real model rank range as the card');
    check(normalized(screen).includes(normalized(`RANK · FUTURE ACROSS MODELS#${corn.modelos.rank_min}–#${corn.modelos.rank_max}`)), 'Model rank fact preserves both supplied endpoints');
    check(normalized(screen).includes(normalized(`GROSS REVENUE / HA / YEAR · FUTURE ACROSS MODELS${money(corn.modelos.receita_ano_ha_min)} to ${money(corn.modelos.receita_ano_ha_max)}`)), 'Annual revenue range uses the supplied per-model endpoints');
    await align(page.getByText(october.view.recommendations[1].model_note, { exact: true }));
    await page.screenshot({ path: 'output/playwright/reviewed-models-detail-desktop.png' });
    await click('← Compare strategies');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await align(rankedCards().first());
    const boxes = await Promise.all((await rankedCards().all()).map(card => card.boundingBox()));
    check(boxes.every((box, i) => box && box.x >= 0 && box.x + box.width <= 391 && (!i || box.y > boxes[i - 1].y)), 'Mobile stacks all model-range cards within the viewport: ' + JSON.stringify(boxes));
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/reviewed-models-cards-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
    const february = await analyze('february');
    await verifyCards(february, 2, 'February with only the first two close');
    check(february.view.recommendations[2].tie_note === '', 'The third February sequence does not inherit the leaders tie');
    const daily = await analyze('daily_hosts');
    const current = await openCurrent(daily);
    screen = await text();
    check(screen.includes('Shared pest or disease with the previous crop') && screen.includes('Water limitation in daily mode'), 'Host-sharing and daily-water warnings have specific headings');
    check(screen.includes('Common bean') && !screen.includes('feijao'), 'Warning presentation uses English names instead of exposing raw engine crop IDs');
    const source = daily.raw.sequencias.find(seq => seq.id === current.sequence_id);
    check(source.avisos.some(warning => warning.codigo === 'hospedeiro_comum') && source.avisos.some(warning => warning.codigo === 'fator_agua_diario'), 'Both new warnings were actually generated by the engine');
    await align(page.getByRole('heading', { name: 'Shared pest or disease with the previous crop', exact: true }).first());
    await page.screenshot({ path: 'output/playwright/reviewed-host-warnings-desktop.png' });
    const rankWarning = await analyze('rank_warning');
    await openCurrent(rankWarning);
    screen = await text();
    check(screen.includes('Rank varies across climate models') && screen.includes('#13 to #22'), 'A real 13–22 model range receives the dedicated warning');
    check(screen.includes('ACCESS-CM2: #21') && screen.includes('MIROC6: #22') && screen.includes('MRI-ESM2-0: #13'), 'Rank warning keeps every model and its real position');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const warningHeading = page.getByRole('heading', { name: 'Rank varies across climate models', exact: true });
    await align(warningHeading);
    const warningBox = await warningHeading.boundingBox();
    check(warningBox && warningBox.x >= 0 && warningBox.x + warningBox.width <= 391, 'The model-warning heading fits mobile width');
    await page.screenshot({ path: 'output/playwright/reviewed-models-warning-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
    const legacy = await analyze('without_models');
    await verifyCards(legacy, 3, 'Legacy API without per-model results');
    check(legacy.view.recommendations.every(rec => rec.model_note === '') && !(await text()).includes('Future across models:'), 'Missing per-model results do not create an invented card range');
    check(requests.length === 5 && chats.length === 0, 'Five isolated analyses exercise all cases without any chat/provider call');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, transport_simulated: true, real_engine_cases: Object.keys(cases), checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/reviewed-models-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-5500) }));
  } finally { await context.close(); }
}
