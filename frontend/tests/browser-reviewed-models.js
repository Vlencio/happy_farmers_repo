// Run with playwright-cli run-code --filename=frontend/tests/browser-reviewed-models.js.
// Prepare cases with .venv/Scripts/python.exe frontend/scripts/export-reviewed-models.py.
// /analyze transport is SIMULATED: API integration of per-model and daily results
// is still pending. Every result in output/playwright/reviewed-models.json must
// come unmodified from the real local engine and delivered tables. No LLM calls.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [], chats = [];
  let cases, selected = 'october';
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const normalized = value => value.replace(/\s/g, '');
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const rankedCards = () => page.getByRole('button', { name: /^[123]ª DE HOJE.*Abrir linha do tempo$/ });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Motor conectado|Conectado/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    if (new URL(request.url()).pathname.endsWith('/analyze')) requests.push(request.postDataJSON());
    if (new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.postDataJSON());
  });
  await page.route('**/qa-reviewed-models', route => route.fulfill({ path: 'output/playwright/reviewed-models.json', contentType: 'application/json' }));
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
    await click('Analisar fazenda →');
    const response = await pending;
    check(response.status() === 200, key + ': simulated transport accepts the actual UI inputs');
    const raw = await response.json();
    check(same(raw, expected.result), key + ': transport preserves the complete real-engine response');
    await waitText('ANÁLISE DO MOTOR');
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      return mapMotorAnalysis(raw, JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm);
    }, raw);
    return { raw, view };
  }
  async function verifyCards(analysis, tiedCount, name) {
    const labels = await rankedCards().allTextContents();
    check(labels.length === 3 && analysis.view.recommendations.every((rec, i) => rec.sequence_id === analysis.raw.sequencias[i].id
      && labels[i].startsWith(`${i + 1}ª DE HOJE`) && labels[i].includes(rec.crop)), name + ': real engine order and rank numbers remain intact');
    check(analysis.view.recommendations.filter(rec => rec.tie_note).length === tiedCount, name + ': only close leaders receive the technical-tie note');
    // Rune exposes each rendered card as one accessible button, not its individual badges.
    check(labels.filter(label => label.includes('Empate técnico · hoje')).length === tiedCount, name + ': accessible tie labels match the ranked cards');
    check(analysis.view.ranking_note && (await text()).includes(analysis.view.ranking_note), name + ': the approximate tie criterion is explained');
    check(analysis.view.recommendations.every((rec, i) => {
      const source = analysis.raw.sequencias[i];
      return labels[i].includes(`Posição · hoje: #${source.rank_hoje}`)
        && labels[i].includes(`Score · hoje: ${number(source.hoje.score)} / 100`)
        && labels[i].includes(`Posição · futuro: #${source.rank_futuro}`)
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
    check(current && (await cards().first().textContent()).includes('ROTAÇÃO ATUAL'), 'Current reference is visible before opening its new warnings');
    await click(await cards().first().textContent()); await waitText('Riscos e lacunas desta estratégia');
    const screen = await text();
    check([...current.warnings.risks, ...current.warnings.gaps].every(item =>
      [item.title, item.context, item.description, item.evidence].every(value => !value || screen.includes(value))), 'Every current-reference warning retains its actual context and evidence');
    check(!screen.includes('Outro risco informado'), 'The new delivered warning codes receive specific Portuguese labels');
    return current;
  }
  try {
    await page.goto(originalPage.url()); await waitConnected();
    cases = await page.evaluate(async () => (await fetch('/qa-reviewed-models')).json());
    const october = await analyze('october');
    await verifyCards(october, 3, 'October with three nearby scores');
    check(october.raw.sequencias.slice(0, 3).map(seq => seq.id).join('|') === 'soja>milho|soja>sorgo|soja>crotalaria', 'October uses the delivered reviewed ranking');
    check(october.view.recommendations.every(rec => /Faixa mín–máx, não intervalo de confiança/.test(rec.model_note)
      && rec.model_note.includes('Chuva por aproximação.')), 'Model limits distinguish a range from confidence and identify approximate rain');
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/reviewed-models-cards-desktop.png' });
    const sorghum = october.raw.sequencias[1];
    check(sorghum.modelos.rank_min === 2 && sorghum.modelos.rank_max === 3, 'The real sorghum case exercises a nonzero model rank range');
    await click(await rankedCards().nth(1).textContent()); await waitText('Seu ciclo, etapa por etapa');
    let screen = await text();
    check(screen.includes(october.view.recommendations[1].model_note) && screen.includes('2ª–3ª posição'), 'Detail exposes the same real model rank range as the card');
    check(normalized(screen).includes(normalized(`POSIÇÃO · FUTURO ENTRE MODELOS#${sorghum.modelos.rank_min}–#${sorghum.modelos.rank_max}`)), 'Model rank fact preserves both supplied endpoints');
    check(normalized(screen).includes(normalized(`RECEITA / HA / ANO · FUTURO ENTRE MODELOS${money(sorghum.modelos.receita_ano_ha_min)} a ${money(sorghum.modelos.receita_ano_ha_max)}`)), 'Annual revenue range uses the supplied per-model endpoints');
    await align(page.getByText(october.view.recommendations[1].model_note, { exact: true }));
    await page.screenshot({ path: 'output/playwright/reviewed-models-detail-desktop.png' });
    await click('← Comparar estratégias');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    const boxes = await Promise.all((await rankedCards().all()).map(card => card.boundingBox()));
    check(boxes.every((box, i) => box && box.x >= 0 && box.x + box.width <= 391 && (!i || box.y > boxes[i - 1].y)), 'Mobile stacks all model-range cards within the viewport');
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/reviewed-models-cards-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
    const february = await analyze('february');
    await verifyCards(february, 2, 'February with only the first two close');
    check(february.view.recommendations[2].tie_note === '', 'The third February sequence does not inherit the leaders tie');
    const daily = await analyze('daily_hosts');
    const current = await openCurrent(daily);
    screen = await text();
    check(screen.includes('Praga ou doença em comum com a cultura anterior') && screen.includes('Limitação por água no modo diário'), 'Host-sharing and daily-water warnings have specific headings');
    check(screen.includes('Feijão') && !screen.includes('feijao'), 'Warning presentation restores accents instead of exposing raw engine crop IDs');
    const source = daily.raw.sequencias.find(seq => seq.id === current.sequence_id);
    check(source.avisos.some(warning => warning.codigo === 'hospedeiro_comum') && source.avisos.some(warning => warning.codigo === 'fator_agua_diario'), 'Both new warnings were actually generated by the engine');
    await align(page.getByRole('heading', { name: 'Praga ou doença em comum com a cultura anterior', exact: true }).first());
    await page.screenshot({ path: 'output/playwright/reviewed-host-warnings-desktop.png' });
    const rankWarning = await analyze('rank_warning');
    await openCurrent(rankWarning);
    screen = await text();
    check(screen.includes('Posição varia entre modelos climáticos') && screen.includes('14ª a 21ª'), 'A real 14–21 model range receives the dedicated warning');
    check(screen.includes('ACCESS-CM2: 21ª') && screen.includes('MIROC6: 21ª') && screen.includes('MRI-ESM2-0: 14ª'), 'Rank warning keeps every model and its real position');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
    const warningHeading = page.getByRole('heading', { name: 'Posição varia entre modelos climáticos', exact: true });
    await align(warningHeading);
    const warningBox = await warningHeading.boundingBox();
    check(warningBox && warningBox.x >= 0 && warningBox.x + warningBox.width <= 391, 'The model-warning heading fits mobile width');
    await page.screenshot({ path: 'output/playwright/reviewed-models-warning-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
    const legacy = await analyze('without_models');
    await verifyCards(legacy, 3, 'Legacy API without per-model results');
    check(legacy.view.recommendations.every(rec => rec.model_note === '') && !(await text()).includes('Futuro entre modelos:'), 'Missing per-model results do not create an invented card range');
    check(requests.length === 5 && chats.length === 0, 'Five isolated analyses exercise all cases without any chat/provider call');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, transport_simulated: true, real_engine_cases: Object.keys(cases), checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/reviewed-models-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-5500) }));
  } finally { await context.close(); }
}
