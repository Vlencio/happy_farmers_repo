// Run with playwright-cli run-code --filename=frontend/tests/browser-scenarios.js.
// Prepare fixtures from the repository root with:
// .venv/Scripts/python.exe frontend/scripts/export-scenario-fixtures.py
// Resilience/legacy checks: the advertised capability is SIMULATED on/off.
// Baseline analyses use the live API; adjusted transport uses local-engine fixtures
// from output/playwright/scenario-fixtures.json. Echo errors, delayed replies and
// chat replies are SIMULATED. No model provider is called. The current API already
// supports adjustments; browser-scenario-api.js verifies that real end-to-end flow.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], analyzePosts = [], chatPosts = [], pendingAnalyses = [], pendingChats = [];
  let support = false, chatSupport = false, holdAnalysis = false, holdChat = false, echoMode = 'correct';
  let fixtureCases;
  const reply = { resposta: 'SIMULAÇÃO: resposta sobre o cenário em foco.', modelo: 'qa-simulado', recusada: false };
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => {
    if (!ok) throw new Error(name);
    checks.push(name);
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const rankedCards = () => page.getByRole('button', { name: /^[123]ª DE HOJE.*Abrir linha do tempo$/ });
  const scenarioHeading = () => page.getByRole('heading', { name: 'Simule outro clima', exact: true });
  const controlNames = ['Diminuir chuva em 5%', 'Aumentar chuva em 5%',
    'Diminuir temperatura em 0,5 °C', 'Aumentar temperatura em 0,5 °C'];
  const text = () => page.locator('[data-rune-a11y]').evaluate(root => root.textContent
    + [...root.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.getAttribute('aria-label') || '').join(' '));
  const waitText = value => page.waitForFunction(value => {
    const root = document.querySelector('[data-rune-a11y]');
    const content = root?.textContent + [...(root?.querySelectorAll('[role="alert"], [role="status"]') || [])]
      .map(node => node.getAttribute('aria-label') || '').join(' ');
    return content.includes(value);
  }, value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Motor conectado|Conectado/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  async function reveal(locator) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y < height - 90) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, box.y < 78 ? -Math.min(650, 120 - box.y) : Math.min(650, box.y - height / 2));
      await page.waitForTimeout(160);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    await reveal(button(name));
    await page.waitForTimeout(100);
    const box = await button(name).boundingBox();
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  async function align(locator, top = 115) {
    for (let i = 0; i < 25; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width - 22, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(160);
    }
  }
  const responseFor = expected => page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/analyze')
    && (expected === undefined || same(response.request().postDataJSON().ajuste, expected)), { timeout: 30000 });
  async function result(response) {
    check(response.status() === 200, 'Analysis transport succeeds: ' + JSON.stringify(response.request().postDataJSON().ajuste ?? null));
    const raw = await response.json();
    await waitText('ANÁLISE DO MOTOR');
    await page.waitForTimeout(200);
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      return mapMotorAnalysis(raw, JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm);
    }, raw);
    return { raw, view, request: response.request().postDataJSON() };
  }
  async function submit() {
    const pending = responseFor();
    await click('Analisar fazenda →');
    return result(await pending);
  }
  async function apply() {
    const pending = responseFor();
    await click('Aplicar cenário');
    return result(await pending);
  }
  async function changeRain(steps) {
    for (let i = 0; i < Math.abs(steps); i++) {
      const before = (await draft()).settings.ajuste?.chuva_pct ?? 0;
      await click(steps < 0 ? controlNames[0] : controlNames[1]);
      await page.waitForFunction(expected => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).settings.ajuste.chuva_pct === expected,
        before + Math.sign(steps) * 5, { timeout: 5000 });
    }
  }
  async function changeTemperature(steps) {
    for (let i = 0; i < Math.abs(steps); i++) {
      const before = (await draft()).settings.ajuste?.temp_c ?? 0;
      await click(steps < 0 ? controlNames[2] : controlNames[3]);
      await page.waitForFunction(expected => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).settings.ajuste.temp_c === expected,
        before + Math.sign(steps) * .5, { timeout: 5000 });
    }
  }
  async function seed(ajuste) {
    await page.goto(originalPage.url());
    await waitConnected();
    await page.evaluate(async ajuste => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      const settings = { mes_plantio: 10, horizonte: 2, prioridades: { agua: 1, solo: 1, renda: 1 } };
      if (ajuste) settings.ajuste = ajuste;
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: ['soja', 'milho'].map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })), settings }));
    }, ajuste);
    await page.reload(); await waitConnected();
  }
  const draft = () => page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
  async function verifyCards(analysis, ids, name) {
    const names = await rankedCards().allTextContents();
    check(same(analysis.raw.sequencias.slice(0, 3).map(seq => seq.id), ids), name + ': real engine order');
    check(names.length === ids.length && analysis.view.recommendations.every((rec, i) => rec.sequence_id === ids[i]
      && names[i].includes(`${i + 1}ª DE HOJE`) && names[i].includes(rec.crop)), name + ': visible card order');
    check(analysis.view.recommendations.every((rec, i) => {
      const seq = analysis.raw.sequencias.find(seq => seq.id === rec.sequence_id);
      return [`Posição · hoje: #${seq.rank_hoje}`, `Score · hoje: ${number(seq.hoje.score)} / 100`,
        `Posição · futuro: #${seq.rank_futuro}`, `Score · futuro: ${number(seq.futuro.score)} / 100`]
        .every(value => names[i].includes(value));
    }), name + ': actual ranks and scores, not client-side calculations');
    check(analysis.view.current_rotation.status === 'ready' && analysis.view.current_rotation.strategy.sequence_id === 'soja>milho'
      && await cards().count() === 4, name + ': current rotation remains separate');
  }
  const counter = () => page.getByText(/^\d+\/1\.000 caracteres · Ctrl\+Enter para enviar$/);
  async function openChat() {
    if (await button('Abrir chat com IA').count()) await click('Abrir chat com IA');
    await counter().waitFor();
  }
  async function send(question) {
    const box = await reveal(counter());
    await page.mouse.click(box.x + 45, box.y - 30);
    await page.waitForTimeout(100);
    await page.getByRole('textbox', { name: 'Sua pergunta sobre a análise', exact: true }).waitFor();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(question);
    await page.waitForTimeout(120);
    await click('Enviar pergunta');
  }
  async function releaseChats() {
    for (const route of pendingChats.splice(0)) await route.fulfill({ status: 200,
      json: { ...reply, resposta: 'RESPOSTA ANTIGA SIMULADA' } }).catch(() => {});
  }
  async function releaseAnalyses() {
    for (const { route, body } of pendingAnalyses.splice(0)) await route.fulfill({ status: 200, json: body }).catch(() => {});
  }
  const expectedFocus = analysis => [...new Set([...analysis.raw.sequencias.slice(0, 3).map(seq => seq.id),
    ...(analysis.view.current_rotation.status === 'ready' ? [analysis.view.current_rotation.strategy.sequence_id] : [])])];
  await page.route('**/qa-scenario-fixtures', route => route.fulfill({ path: 'output/playwright/scenario-fixtures.json', contentType: 'application/json' }));
  await page.route('**/api/metadata', async route => {
    const response = await route.fetch(), body = await response.json();
    body.capabilities = { ...body.capabilities, ajuste: support, chat: chatSupport };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/analyze', async route => {
    const request = route.request().postDataJSON();
    analyzePosts.push(request);
    if (!support || !request.ajuste) { await route.continue(); return; }
    const match = Object.values(fixtureCases).find(item => same(item.request.ajuste, request.ajuste));
    if (!match) { await route.fulfill({ status: 422, json: { detail: 'No real-engine test fixture for the requested scenario.' } }); return; }
    const body = JSON.parse(JSON.stringify(match.result));
    if (echoMode === 'missing') delete body.entrada.ajuste;
    if (echoMode === 'mismatch') body.entrada.ajuste = { chuva_pct: 0, temp_c: 0 };
    if (holdAnalysis) { pendingAnalyses.push({ route, body }); return; }
    await route.fulfill({ status: 200, json: body });
  });
  await page.route('**/api/chat', async route => {
    chatPosts.push(route.request().postDataJSON());
    if (holdChat) { pendingChats.push(route); return; }
    await route.fulfill({ status: 200, json: reply });
  });
  try {
    await page.goto(originalPage.url()); await waitConnected();
    fixtureCases = await page.evaluate(async () => (await fetch('/qa-scenario-fixtures')).json());
    const realMetadata = await (await page.request.get(new URL('/api/metadata', originalPage.url()).href)).json();
    check(typeof realMetadata.capabilities?.ajuste === 'boolean', 'Actual API capability is read separately from simulated legacy support');
    await seed();
    check(await scenarioHeading().count() === 1, 'Scenario controls have an accessible heading');
    check((await text()).includes('Os ajustes de cenário ainda não estão disponíveis neste servidor.'),
      'SIMULATED legacy server: unavailable support has a clear explanation');
    check((await Promise.all(controlNames.map(name => button(name).isDisabled()))).every(Boolean),
      'Unsupported scenario controls are disabled');
    const baseline = await submit();
    check(!Object.hasOwn(baseline.request, 'ajuste'), 'Legacy draft uses baseline and sends no unsupported adjustment field');
    await verifyCards(baseline, fixtureCases.baseline.result.sequencias.slice(0, 3).map(seq => seq.id), 'Real baseline');
    check(!baseline.view.adjustment_note, 'Baseline is not labeled as an adjusted scenario');

    await seed({ chuva_pct: -20, temp_c: 0 });
    check(await button('Analisar fazenda →').isDisabled(), 'Saved nonzero adjustment blocks unsupported analysis rather than silently discarding it');
    const unsupportedCount = analyzePosts.length;
    await click('Voltar ao clima sem ajuste');
    check(same((await draft()).settings.ajuste, { chuva_pct: 0, temp_c: 0 }) && analyzePosts.length === unsupportedCount,
      'Reset clears saved adjustment even without support and does not send a request');
    const resetUnsupported = await submit();
    check(!Object.hasOwn(resetUnsupported.request, 'ajuste'), 'Reset restores compatibility with the real API');

    support = true;
    await seed();
    const setupCount = analyzePosts.length;
    await changeRain(-4);
    check(same((await draft()).settings.ajuste, { chuva_pct: -20, temp_c: 0 }) && analyzePosts.length === setupCount,
      'SIMULATED support: Setup controls save -20% rain without analyzing before the producer submits');
    const rain = await submit();
    check(same(rain.request.ajuste, { chuva_pct: -20, temp_c: 0 }), 'SIMULATED support: exact selected adjustment reaches the API');
    await verifyCards(rain, fixtureCases['rain-20'].result.sequencias.slice(0, 3).map(seq => seq.id), 'Real engine fixture with 20% less rain');
    check(rain.raw.sequencias.find(seq => seq.id === 'soja>milho').hoje.receita_ha
      < baseline.raw.sequencias.find(seq => seq.id === 'soja>milho').hoje.receita_ha,
      'Real engine rainfall fixture reduces soybean-corn income');
    check(rain.view.adjustment_note && (await text()).includes(rain.view.adjustment_note), 'Adjusted result has a visible scenario note');
    check(/não.*previsão/i.test(rain.view.adjustment_note) && /hoje|todos/i.test(rain.view.adjustment_note),
      'Scenario note identifies the what-if and its scope');
    await align(scenarioHeading());
    await page.screenshot({ path: 'output/playwright/scenarios-desktop.png' });
    await click(await rankedCards().first().textContent()); await waitText('Seu ciclo, etapa por etapa');
    check((await text()).includes(rain.view.adjustment_note), 'Scenario warning remains visible in the detail view');
    await click('← Comparar estratégias');

    const resultTrack = await reveal(page.getByRole('group', { name: /^Chuva do cenário:/ }));
    await page.mouse.click(resultTrack.x + 11 + (resultTrack.width - 22) * 30 / 80, resultTrack.y + resultTrack.height / 2);
    const beforeKeyboard = analyzePosts.length;
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(150);
    check((await draft()).settings.ajuste.chuva_pct === -15 && await cards().count() === 0,
      'Keyboard arrow invalidates the prior result and saves the new rain value');
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(150);
    check((await draft()).settings.ajuste.chuva_pct === -20 && analyzePosts.length === beforeKeyboard,
      'Slider retains keyboard focus after switching to the Apply screen');
    await apply();

    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await align(scenarioHeading());
    const mobileControls = await Promise.all(controlNames.map(name => button(name).boundingBox()));
    check(mobileControls.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'Mobile adjustment buttons fit the viewport');
    await page.screenshot({ path: 'output/playwright/scenarios-mobile.png' });
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/scenarios-cards-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(350);

    const beforeEdit = analyzePosts.length;
    await changeTemperature(4);
    check(analyzePosts.length === beforeEdit && await cards().count() === 0,
      'Changing a result clears stale cards and waits for Apply instead of repeated analysis requests');
    check(same((await draft()).settings.ajuste, { chuva_pct: -20, temp_c: 2 }), 'Combined draft preserves rain while editing temperature');
    const combined = await apply();
    check(same(combined.request.ajuste, { chuva_pct: -20, temp_c: 2 }), 'Combined values are sent without browser climate calculations');
    check(same(combined.raw, fixtureCases.combined.result),
      'Combined scenario displays the actual engine response');
    check(/estimad|aproxima|interpol/i.test(combined.view.adjustment_note), 'Temperature what-if explains estimated heat-day counts');
    check(!combined.view.scenario_note.includes('Ano seco: observações de 2020/21'), 'Adjusted dry year is not mislabeled as unchanged observed weather');
    await click('Voltar ao clima sem ajuste');
    check(await cards().count() === 0, 'Reset invalidates adjusted cards before the next analysis');
    const reset = await apply();
    check(!Object.hasOwn(reset.request, 'ajuste') && !reset.view.adjustment_note, 'Reset returns to unadjusted data and clears scenario labeling');
    await verifyCards(reset, fixtureCases.baseline.result.sequencias.slice(0, 3).map(seq => seq.id), 'Reset baseline');
    await changeTemperature(4);
    const hot = await apply();
    await verifyCards(hot, hot.raw.sequencias.slice(0, 3).map(seq => seq.id), 'Real engine fixture with 2 degrees warming');
    check(same(hot.raw, fixtureCases.temp2.result),
      'Warming preserves the complete supplied engine result and future ranking');
    await page.reload(); await waitConnected();
    const reloaded = await submit();
    check(same(reloaded.request.ajuste, { chuva_pct: 0, temp_c: 2 }), 'Scenario survives reload through the existing local draft');

    await seed();
    const rainTrack = page.getByRole('group', { name: /^Chuva do cenário:/ });
    const rainBox = await reveal(rainTrack), rainY = rainBox.y + rainBox.height / 2;
    const pointForRain = value => rainBox.x + 11 + (rainBox.width - 22) * ((value + 50) / 80);
    const preDragCount = analyzePosts.length;
    const preDragAdjustment = (await draft()).settings.ajuste ?? { chuva_pct: 0, temp_c: 0 };
    await page.mouse.move(pointForRain(0), rainY); await page.mouse.down();
    await page.mouse.move(pointForRain(-20), rainY, { steps: 4 }); await page.waitForTimeout(150);
    check(same((await draft()).settings.ajuste ?? { chuva_pct: 0, temp_c: 0 }, preDragAdjustment) && analyzePosts.length === preDragCount,
      'Slider drag previews without saving or making requests before release');
    await page.mouse.up(); await page.waitForTimeout(150);
    check(same((await draft()).settings.ajuste, { chuva_pct: -20, temp_c: 0 }), 'Slider release commits the snapped -20% value');
    await page.keyboard.press('End'); await page.waitForTimeout(120);
    check((await draft()).settings.ajuste.chuva_pct === 30 && await button(controlNames[1]).isDisabled(),
      'Rain slider keyboard End selects the upper bound and disables increment');
    await page.keyboard.press('Home'); await page.waitForTimeout(120);
    check((await draft()).settings.ajuste.chuva_pct === -50 && await button(controlNames[0]).isDisabled(),
      'Rain slider keyboard Home selects the lower bound and disables decrement');
    const tempBox = await reveal(page.getByRole('group', { name: /^Temperatura do cenário:/ }));
    await page.mouse.click(tempBox.x + tempBox.width / 2, tempBox.y + tempBox.height / 2);
    await page.keyboard.press('End'); await page.waitForTimeout(120);
    check((await draft()).settings.ajuste.temp_c === 4 && await button(controlNames[3]).isDisabled(),
      'Temperature slider keyboard End selects four degrees and disables increment');
    const bounds = await submit();
    check(same(bounds.request.ajuste, { chuva_pct: -50, temp_c: 4 }), 'Both supported extreme values reach the engine unchanged');
    await verifyCards(bounds, bounds.raw.sequencias.slice(0, 3).map(seq => seq.id), 'Real engine fixture at supported boundaries');

    for (const mode of ['missing', 'mismatch']) {
      echoMode = mode;
      await seed({ chuva_pct: -20, temp_c: 0 });
      const pending = responseFor(); await click('Analisar fazenda →'); await pending;
      await waitText('Falha ao consultar o motor.');
      check(await cards().count() === 0 && (await text()).includes('Falha ao consultar o motor.'),
        `SIMULATED incompatible API: ${mode} adjustment echo is rejected before displaying cards`);
    }
    echoMode = 'correct';
    await seed(); const beforeRace = await submit();
    await changeRain(-4); holdAnalysis = true;
    await click('Aplicar cenário');
    check(pendingAnalyses.length === 1 && await cards().count() === 0, 'Pending scenario analysis does not leave old cards visible');
    await changeTemperature(4); holdAnalysis = false;
    const latest = await apply();
    await releaseAnalyses(); await page.waitForTimeout(250);
    check((await rankedCards().allTextContents()).every((name, i) => name.includes(latest.view.recommendations[i].crop))
      && (await text()).includes(latest.view.adjustment_note), 'Delayed old analysis cannot replace the newer scenario');
    check(!same(beforeRace.raw.entrada.ajuste, latest.raw.entrada.ajuste), 'Race check used genuinely different scenario requests');

    chatSupport = true;
    await seed(); const chatBase = await submit();
    await openChat(); await send('Explique o cenário original.'); await waitText(reply.resposta);
    check(same(chatPosts.at(-1).analise, chatBase.raw) && same(chatPosts.at(-1).foco, expectedFocus(chatBase)),
      'SIMULATED chat sends the exact baseline and visible-card focus');
    holdChat = true;
    await send('Pergunta antes de mudar o clima.'); await button('Cancelar resposta').waitFor();
    await changeRain(-4);
    check(!(await text()).includes('Explique o cenário original.') && await cards().count() === 0,
      'Changing scenario immediately clears the previous chat and analysis');
    const chatRain = await apply();
    await releaseChats(); holdChat = false;
    await openChat();
    check(!(await text()).includes('RESPOSTA ANTIGA SIMULADA'), 'Late chat reply cannot leak into another scenario');
    await send('Explique o cenário com menos chuva.'); await waitText(reply.resposta);
    check(same(chatPosts.at(-1).analise, chatRain.raw) && same(chatPosts.at(-1).analise.entrada.ajuste, { chuva_pct: -20, temp_c: 0 })
      && chatPosts.at(-1).historico.length === 0 && same(chatPosts.at(-1).foco, expectedFocus(chatRain)),
      'New chat sends adjusted raw analysis, new focus, and an empty history');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, actual_api_scenario_capability: realMetadata.capabilities.ajuste,
      scenario_transport: 'simulated with real engine fixtures', chat_requests_simulated: chatPosts.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/scenarios-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, requests: analyzePosts.map(item => item.ajuste ?? null),
      screen: (await text().catch(() => '')).slice(-8000) }));
  } finally {
    await releaseChats(); await releaseAnalyses();
    await context.close();
  }
}
