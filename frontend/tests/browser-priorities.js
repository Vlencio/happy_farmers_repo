// Run with playwright-cli run-code --filename=frontend/tests/browser-priorities.js.
// Rankings, scores, and analyses use the real local engine and demo tables.
// Chat capability/replies are explicitly SIMULATED; no model provider is called.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], posts = [], deferred = [], analyzePosts = [];
  let syntheticChecks = 0, holdChat = false;
  let reply = { resposta: 'SIMULAÇÃO: resposta para verificar o contexto.', modelo: 'qa-simulado', recusada: false };
  let priorities = { agua: 1, solo: 1, renda: 1 };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) analyzePosts.push(request.postDataJSON());
  });
  const check = (ok, name, synthetic = false) => {
    if (!ok) throw new Error(name);
    checks.push(name);
    if (synthetic) syntheticChecks++;
  };
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
  const labels = { agua: 'Água', solo: 'Solo', renda: 'Renda' };
  const levels = ['nada', 'pouco', 'médio', 'muito'];
  const priorityName = (field, value) => new RegExp(`^${labels[field]}: prioridade ${value} \\(${levels[value]}\\)(?:, selecionada)?$`);
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const rankedCards = () => page.getByRole('button', { name: /^[123]ª DE HOJE.*Abrir linha do tempo$/ });
  const priorityHeading = () => page.getByRole('heading', { name: 'Suas prioridades', exact: true });
  const chatHeading = () => page.getByRole('heading', { name: 'Converse sobre esta análise', exact: true });
  const input = () => page.getByRole('textbox', { name: 'Sua pergunta sobre a análise', exact: true });
  const counter = () => page.getByText(/^\d+\/1\.000 caracteres · Ctrl\+Enter para enviar$/);
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
    const box = await reveal(button(name));
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
  const analysisResponse = expected => page.waitForResponse(response => {
    if (response.request().method() !== 'POST' || !new URL(response.url()).pathname.endsWith('/analyze')) return false;
    return !expected || same(response.request().postDataJSON().prioridades, expected);
  }, { timeout: 30000 });
  async function result(response) {
    check(response.status() === 200, 'Real analyze succeeds with ' + JSON.stringify(response.request().postDataJSON().prioridades));
    const raw = await response.json();
    await waitText('ANÁLISE DO MOTOR');
    await page.waitForTimeout(220);
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      return mapMotorAnalysis(raw, JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm);
    }, raw);
    return { raw, view, request: response.request().postDataJSON() };
  }
  async function submit() {
    const pending = analysisResponse();
    await click('Analisar fazenda →');
    return result(await pending);
  }
  async function seed(month = 10, horizon = 2, values, crops = ['soja', 'milho']) {
    await page.goto(originalPage.url());
    await waitConnected();
    await page.evaluate(async ({ month, horizon, values, crops }) => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      const settings = { mes_plantio: month, horizonte: horizon };
      if (values) settings.prioridades = values;
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: crops.map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })), settings }));
    }, { month, horizon, values, crops });
    await page.reload();
    await waitConnected();
    priorities = values || { agua: 1, solo: 1, renda: 1 };
  }
  async function analyze(month = 10, horizon = 2, values, crops) {
    await seed(month, horizon, values, crops);
    return submit();
  }
  async function setPriority(field, value) {
    priorities = { ...priorities, [field]: value };
    const pending = analysisResponse(priorities);
    await click(priorityName(field, value));
    return result(await pending);
  }
  async function verifyRanking(analysis, ids, name) {
    check(same(analysis.raw.sequencias.slice(0, 3).map(seq => seq.id), ids), name + ': engine returns the expected ranking');
    const names = await rankedCards().allTextContents();
    check(names.length === ids.length && analysis.view.recommendations.every((rec, i) => rec.sequence_id === ids[i]
      && names[i].includes(`${i + 1}ª DE HOJE`) && names[i].includes(rec.crop)), name + ': visible cards retain engine order');
    const hasCurrent = analysis.view.current_rotation.status === 'ready';
    check(await cards().count() === ids.length + (hasCurrent ? 1 : 0), name + ': reference is separate and no cards are fabricated');
    const namesById = analysis.view.recommendations.map((rec, i) => [rec, names[i]]);
    if (hasCurrent) namesById.push([analysis.view.current_rotation.strategy, await cards().first().textContent()]);
    check(namesById.every(([rec, name]) => {
      const seq = analysis.raw.sequencias.find(seq => seq.id === rec.sequence_id);
      const facts = [ ['Posição · hoje', '#' + seq.rank_hoje], ['Score · hoje', number(seq.hoje.score) + ' / 100'],
        ['Posição · futuro', '#' + seq.rank_futuro], ['Score · futuro', number(seq.futuro.score) + ' / 100'] ];
      return facts.every(([label, value]) => name.includes(`${label}: ${value}`))
        && rec.comparison_facts.every(fact => name.includes(`${fact.label}: ${fact.value}`));
    }), name + ': every card exposes actual current/future rank, score, and comparison values');
    if (hasCurrent) check((await cards().first().textContent()).includes('ROTAÇÃO ATUAL'), name + ': current rotation remains the comparison reference');
  }
  async function openChat() {
    if (await button('Abrir chat com IA').count()) await click('Abrir chat com IA');
    await counter().waitFor();
  }
  async function send(question, keyboard = false) {
    const box = await reveal(counter());
    await page.mouse.click(box.x + 45, box.y - 30);
    await page.waitForTimeout(100);
    await input().waitFor();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(question);
    await page.waitForTimeout(120);
    if (keyboard) await page.keyboard.press('ControlOrMeta+Enter');
    else await click('Enviar pergunta');
  }
  async function releaseChat() {
    for (const route of deferred.splice(0)) await route.fulfill({ status: 200,
      json: { resposta: 'RESPOSTA ANTIGA SIMULADA', modelo: 'qa-simulado', recusada: false } }).catch(() => {});
    await page.waitForTimeout(250);
  }
  const expectedFocus = analysis => [...new Set([...analysis.raw.sequencias.slice(0, 3).map(seq => seq.id),
    ...(analysis.view.current_rotation.status === 'ready' ? [analysis.view.current_rotation.strategy.sequence_id] : [])])];
  await page.route('**/api/chat', async route => {
    posts.push(route.request().postDataJSON());
    if (holdChat) { deferred.push(route); return; }
    await route.fulfill({ status: 200, json: reply });
  });
  try {
    await seed();
    check(await priorityHeading().count() === 1, 'Setup exposes the priorities panel');
    const controls = await Promise.all(Object.keys(labels).flatMap(field => levels.map((_, value) => button(priorityName(field, value)).count())));
    check(controls.every(count => count === 1), 'All twelve priority buttons have specific accessible names');
    check(await page.getByRole('button', { name: /: prioridade 1 \(pouco\), selecionada$/ }).count() === 3,
      'Each initial priority exposes its selected state in the accessible label');
    await click(priorityName('agua', 2));
    const setupDraft = await page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
    check(analyzePosts.length === 0 && setupDraft.settings.prioridades.agua === 2,
      'Setup priority edits save the choice without submitting an analysis before the producer is ready');
    await click(priorityName('agua', 1));
    const first = await submit();
    check(same(first.request.prioridades, { agua: 1, solo: 1, renda: 1 }), 'Legacy draft migrates to equal 1/1/1 priorities');
    check(first.request.rotacao_atual.join('|') === 'soja|milho' && first.request.mes_plantio === 10 && first.request.horizonte === 2,
      'Migration preserves history, month, horizon, and usable farm');
    check(await priorityHeading().count() === 1, 'Results keeps the editable priorities panel');
    await verifyRanking(first, ['soja>milho', 'soja>sorgo', 'soja>feijao'], 'Equal weights in October');
    await align(priorityHeading());
    await page.screenshot({ path: 'output/playwright/priorities-desktop.png' });

    await setPriority('agua', 0);
    const income = await setPriority('solo', 0);
    await verifyRanking(income, ['soja>milho', 'soja>trigo', 'soja>girassol'], 'Only income in October');
    check(same(income.request.prioridades, { agua: 0, solo: 0, renda: 1 }) && income.view.current_rotation.strategy.sequence_id === 'soja>milho',
      'Priority clicks rerun the API automatically and preserve the current rotation');
    await setPriority('solo', 1);
    const soil = await setPriority('renda', 0);
    await verifyRanking(soil, ['soja>crotalaria', 'sorgo>crotalaria', 'feijao>crotalaria'], 'Only soil in October');
    const zeros = await setPriority('solo', 0);
    await verifyRanking(zeros, ['soja>milho', 'soja>sorgo', 'soja>feijao'], 'All zero priorities in October');
    check(same(zeros.request.prioridades, { agua: 0, solo: 0, renda: 0 }) && same(zeros.raw.entrada.prioridades, first.raw.entrada.prioridades),
      'Zero values reach the engine, which applies equal normalized weights');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')));
    check(same(saved.settings.prioridades, { agua: 0, solo: 0, renda: 0 }), 'Draft stores the producer zero choices rather than normalized engine weights');
    await page.reload(); await waitConnected();
    const reloaded = await submit();
    check(same(reloaded.request, zeros.request), 'Reload preserves selected priorities and the full farm analysis request');
    const strong = await setPriority('renda', 3);
    await verifyRanking(strong, ['soja>milho', 'soja>trigo', 'soja>girassol'], 'Priority level three');
    check(same(strong.request.prioridades, { agua: 0, solo: 0, renda: 3 }), 'The maximum priority value is sent without frontend normalization');

    const february = await analyze(2);
    check(february.raw.sequencias[0].id === 'sorgo>soja' && february.raw.sequencias[0].rank_futuro === 1,
      'Real February winner is sorghum-soybean with annual income scoring');
    check(february.raw.sequencias[1].id === 'feijao>soja' && february.raw.sequencias[1].rank_futuro === 7,
      'Real February runner-up moves from second today to seventh in the future');
    await verifyRanking(february, february.raw.sequencias.slice(0, 3).map(seq => seq.id), 'February future comparison');
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/priorities-future-rank-desktop.png' });
    await click(await rankedCards().first().textContent());
    await waitText('Seu ciclo, etapa por etapa');
    const detail = await text();
    check(['POSIÇÃO · HOJE', 'SCORE · HOJE', 'POSIÇÃO · FUTURO', 'SCORE · FUTURO', '#1', '76 / 100', '75,1 / 100'].every(value => detail.includes(value)),
      'February detail retains the real current and future ranks and scores');
    await click('← Comparar estratégias');
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    await align(priorityHeading());
    const mobileControls = await Promise.all(Object.keys(labels).flatMap(field => levels.map((_, value) => button(priorityName(field, value)).boundingBox())));
    check(mobileControls.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'All mobile priority controls fit the viewport');
    await page.screenshot({ path: 'output/playwright/priorities-mobile.png' });
    const mobileCards = await Promise.all((await rankedCards().all()).map(card => card.boundingBox()));
    check(mobileCards.length === 3 && mobileCards.every((box, i) => box && box.x >= 0 && box.x + box.width <= 391
      && (i === 0 || box.y > mobileCards[i - 1].y)), 'Mobile stacks all three real ranked cards within the viewport');
    await align(rankedCards().first());
    await page.screenshot({ path: 'output/playwright/priorities-future-rank-mobile.png' });
    await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(350);
    const two = await analyze(3, 1);
    await verifyRanking(two, ['crotalaria', 'trigo'], 'March one-crop horizon has only two viable choices');
    const one = await analyze(12, 1);
    await verifyRanking(one, ['algodao'], 'December one-crop horizon has only one viable choice');
    const empty = await analyze(4);
    await verifyRanking(empty, [], 'April has zero viable choices');
    check((await text()).includes('Vamos ajustar o calendário?'), 'Zero results explain the calendar constraint');

    // Only the provider capability and replies below are simulated. /analyze remains real.
    await page.route('**/api/metadata', async route => {
      const response = await route.fetch(), body = await response.json();
      body.capabilities = { ...body.capabilities, chat: true };
      await route.fulfill({ response, json: body });
    });
    const chatFirst = await analyze();
    check(await chatHeading().count() === 1, 'SIMULATED provider capability exposes the chat', true);
    await openChat();
    const firstQuestion = 'Quais sequências estão visíveis agora?';
    await send(firstQuestion, true); await waitText(reply.resposta);
    check(same(posts.at(-1).foco, expectedFocus(chatFirst)) && posts.at(-1).foco.length === 3,
      'SIMULATED chat focuses the three ranked cards and deduplicates the current rotation', true);
    check(same(posts.at(-1).analise, chatFirst.raw) && posts.at(-1).historico.length === 0,
      'SIMULATED first question uses the exact raw analysis and no history', true);
    await setPriority('agua', 0);
    const chatIncome = await setPriority('solo', 0);
    check(await button('Abrir chat com IA').count() === 1 && !(await text()).includes(firstQuestion),
      'SIMULATED priority recalculation clears and collapses the previous conversation', true);
    await openChat();
    reply = { resposta: 'SIMULAÇÃO: agora as prioridades favorecem a renda.', modelo: 'qa-simulado', recusada: false };
    await send('O que mudou com a renda?'); await waitText(reply.resposta);
    check(same(posts.at(-1).foco, expectedFocus(chatIncome)) && !posts.at(-1).foco.includes('soja>sorgo')
      && posts.at(-1).foco.includes('soja>trigo') && posts.at(-1).historico.length === 0,
      'SIMULATED next question uses only newly visible cards and starts a clean history', true);
    holdChat = true;
    const pendingQuestion = 'Pergunta pendente antes de mudar a prioridade.';
    await send(pendingQuestion); await button('Cancelar resposta').waitFor();
    const chatChanged = await setPriority('renda', 3);
    await releaseChat(); holdChat = false;
    await openChat();
    check(!(await text()).includes('RESPOSTA ANTIGA SIMULADA') && !(await text()).includes(pendingQuestion),
      'SIMULATED pending reply cannot contaminate an analysis after priority changes', true);
    reply = { resposta: 'SIMULAÇÃO: conversa nova após cancelamento.', modelo: 'qa-simulado', recusada: false };
    await send('Quais são as prioridades novas?'); await waitText(reply.resposta);
    check(posts.at(-1).historico.length === 0 && same(posts.at(-1).analise, chatChanged.raw),
      'SIMULATED conversation after cancellation sends the new full analysis without stale history', true);
    const distinct = await analyze(10, 2, undefined, ['soja', 'feijao']);
    await openChat(); await send('Compare com a minha rotação atual.'); await waitText(reply.resposta);
    check(same(posts.at(-1).foco, expectedFocus(distinct)) && posts.at(-1).foco.length === 4 && posts.at(-1).foco.includes('soja>feijao'),
      'SIMULATED distinct current rotation joins the three ranked cards in focus', true);
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, synthetic_checks: syntheticChecks, chat_requests_simulated: posts.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/priorities-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, chat_posts: posts.length, screen: (await text().catch(() => '')).slice(-6500) }));
  } finally {
    await releaseChat();
    await context.close();
  }
}
