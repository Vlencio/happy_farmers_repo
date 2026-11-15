// Run with playwright-cli run-code --filename=frontend/tests/browser-chat.js.
// /analyze uses the real local engine and demo tables. Every enabled-chat reply
// is explicitly SIMULATED here; no Anthropic request is made by this test.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], posts = [], deferred = [];
  let syntheticChecks = 0, reply = { resposta: 'Simulated response.', modelo: 'qa-simulated', recusada: false }, status = 200, hold = false;
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name, synthetic = true) => {
    if (!ok) throw new Error(name);
    checks.push(name);
    if (synthetic) syntheticChecks++;
  };
  const text = () => page.locator('[data-rune-a11y]').evaluate(root => root.textContent + [...root.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.getAttribute('aria-label') || '').join(' '));
  const waitText = value => page.waitForFunction(value => {
    const root = document.querySelector('[data-rune-a11y]');
    const content = root?.textContent + [...(root?.querySelectorAll('[role="alert"], [role="status"]') || [])].map(node => node.getAttribute('aria-label') || '').join(' ');
    return content.includes(value);
  }, value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Engine connected|Connected/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const button = name => page.getByRole('button', { name, exact: true });
  const cards = () => page.getByRole('button', { name: /Open timeline$/ });
  const heading = () => page.getByRole('heading', { name: 'Chat about this analysis', exact: true });
  const input = () => page.getByRole('textbox', { name: 'Your question about the analysis', exact: true });
  const counter = () => page.getByText(/^\d+\/1,000 characters · Ctrl\+Enter to send$/);
  async function reveal(locator) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y < height - 90) return box;
      // Keep the wheel near the outer content edge to avoid the chat's own scroller.
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
  async function focusQuestion() {
    // Rune hides the inactive native input proxy from accessibility. Its counter
    // sits immediately below the visible canvas field; activate that field first.
    const box = await reveal(counter());
    await page.mouse.click(box.x + 45, box.y - 30);
    await page.waitForTimeout(100);
    await input().waitFor();
  }
  async function fill(question) {
    await focusQuestion();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText(question);
    await page.waitForTimeout(120);
  }
  const currentInput = async () => {
    await focusQuestion();
    return page.evaluate(() => document.activeElement.value);
  };
  async function openChat() {
    if (await button('Open AI chat').count()) await click('Open AI chat');
    await counter().waitFor();
  }
  async function send(question, keyboard = false) {
    await fill(question);
    if (keyboard) {
      await page.keyboard.press('ControlOrMeta+Enter');
    } else await click('Send question');
  }
  async function analyze(crops = ['soja', 'milho'], month = 10) {
    await page.goto(originalPage.url());
    await waitConnected();
    await page.evaluate(async ({ crops, month }) => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: crops.map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })),
        settings: { mes_plantio: month, horizonte: 2 } }));
    }, { crops, month });
    await page.reload();
    await waitConnected();
    const response = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    const raw = await (await response).json();
    await waitText('HAPPY FARMERS ANALYSIS');
    const view = await page.evaluate(async raw => {
      const { mapMotorAnalysis } = await import('/web/api.mjs');
      return mapMotorAnalysis(raw, JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).farm);
    }, raw);
    return { raw, view };
  }
  async function release(textValue = 'SIMULATED OLD RESPONSE') {
    for (const route of deferred.splice(0)) {
      await route.fulfill({ status: 200, json: { resposta: textValue, modelo: 'qa-simulated', recusada: false } }).catch(() => {});
    }
    await page.waitForTimeout(250);
  }
  const expectedFocus = view => [...new Set([
    ...view.recommendations.map(item => item.sequence_id),
    ...(view.current_rotation.status === 'ready' ? [view.current_rotation.strategy.sequence_id] : []),
  ])];
  // This interception is installed even during capability=false checks so a bug
  // can never send a test message to an actual model provider.
  await page.route('**/api/chat', async route => {
    posts.push(route.request().postDataJSON());
    if (hold) { deferred.push(route); return; }
    await route.fulfill({ status, json: reply });
  });
  try {
    const real = await analyze();
    const metadata = await (await page.request.get(new URL('/api/metadata', originalPage.url()).href)).json();
    check(metadata.capabilities.chat === false, 'Real local service reports chat disabled without credentials', false);
    check(await heading().count() === 0 && await button('Open AI chat').count() === 0,
      'Real capability=false hides the chat while analysis remains available', false);
    check(real.raw.sequencias.every(sequence => Array.isArray(sequence.beneficios)) && await cards().count() === 4,
      'Real engine delivers benefits and retains current rotation plus three cards', false);
    await click(await cards().first().textContent());
    await waitText('Benefits considered by the engine');
    const benefits = real.view.current_rotation.strategy.benefits.items;
    check(benefits.every(item => (item.title && item.evidence)) && (await text()).includes(benefits[0].title),
      'Real benefits are readable in the current-rotation detail without chat', false);

    // SIMULATED enabled deployment; only capability and model responses differ.
    await page.route('**/api/metadata', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.capabilities = { ...body.capabilities, chat: true };
      await route.fulfill({ response, json: body });
    });
    const first = await analyze();
    check(await heading().count() === 1, 'SIMULATED capability=true exposes one chat panel');
    await openChat();
    check((await text()).includes('Anthropic'), 'SIMULATED chat explains where the question and analysis are sent');
    const question1 = 'Why was this rotation suggested?';
    const answer1 = 'SIMULATED: Soybean fixes nitrogen. <b>This is plain text.</b>';
    reply = { resposta: answer1, modelo: 'qa-simulado', recusada: false };
    await send(question1, true);
    await waitText(answer1);
    check(posts.length === 1 && posts[0].pergunta === question1, 'SIMULATED keyboard Ctrl/Enter submits the question');
    check(JSON.stringify(posts[0].analise) === JSON.stringify(first.raw), 'SIMULATED request sends the full unmodified engine response');
    check(JSON.stringify(posts[0].foco) === JSON.stringify(expectedFocus(first.view)) && posts[0].foco.length === 3,
      'SIMULATED focus uses ranked cards and deduplicates the current rotation');
    check(posts[0].historico.length === 0, 'SIMULATED first question has no fabricated conversation history');
    check(await page.locator('[data-rune-a11y] b').count() === 0 && (await text()).includes('<b>This is plain text.</b>'),
      'SIMULATED model text is displayed literally instead of interpreted as HTML');
    const question2 = 'Which risks need local review?';
    const answer2 = 'SIMULATED: Check water-supply warnings for the dry year.';
    reply = { resposta: answer2, modelo: 'qa-simulado', recusada: false };
    await send(question2);
    await waitText(answer2);
    check(JSON.stringify(posts[1].historico) === JSON.stringify([{ papel: 'produtor', texto: question1 }, { papel: 'assistente', texto: answer1 }]),
      'SIMULATED second question resends the exact producer/assistant pair');
    check(JSON.stringify(posts[1].analise) === JSON.stringify(first.raw) && JSON.stringify(posts[1].foco) === JSON.stringify(posts[0].foco),
      'SIMULATED subsequent questions retain the same analysis and focus');
    check(!(await page.evaluate(() => localStorage.getItem('happy-farmers-draft-v1'))).includes(answer1),
      'SIMULATED conversation remains out of the saved farm draft');
    await align(heading());
    await page.screenshot({ path: 'output/playwright/chat-desktop.png' });

    await fill('   ');
    const beforeEmpty = posts.length;
    await click('Send question');
    await page.waitForTimeout(200);
    check(posts.length === beforeEmpty, 'SIMULATED blank input cannot create a network request');
    await fill('x'.repeat(1001));
    check(await button('Send question').isDisabled() && posts.length === beforeEmpty,
      'SIMULATED question over 1000 characters is blocked before submission');
    status = 503; reply = { detail: 'Simulated temporary failure.' };
    const retryQuestion = 'Explain the crop residue for this sequence.';
    await send(retryQuestion);
    await waitText('HTTP 503');
    check(await page.getByRole('alert', { name: /HTTP 503/ }).count() === 1,
      'SIMULATED chat error exposes its message to assistive technology');
    check(await currentInput() === retryQuestion, 'SIMULATED HTTP failure preserves the question for retry');
    const failedHistory = structuredClone(posts.at(-1).historico);
    status = 200; reply = { resposta: '', modelo: 'qa-simulado', recusada: false };
    await click('Send question');
    await waitText('incompatible response');
    check(await currentInput() === retryQuestion && JSON.stringify(posts.at(-1).historico) === JSON.stringify(failedHistory),
      'SIMULATED empty model response is an error and never enters conversation history');
    reply = { resposta: 'SIMULATED: I can only explain this analysis.', modelo: 'qa-simulado', recusada: true };
    await click('Send question');
    await waitText(reply.resposta);
    check((await text()).includes(reply.resposta) && (await text()).includes('The AI did not answer this question.'),
      'SIMULATED refusal appears with its explanation instead of being treated as a normal answer');

    hold = true;
    const cancelled = 'Simulated question to cancel.';
    await send(cancelled);
    await button('Cancel response').waitFor();
    check(await page.getByRole('status', { name: /The AI is preparing an answer/ }).count() === 1,
      'SIMULATED pending status exposes its text to assistive technology');
    check(await button('Send question').isDisabled(), 'SIMULATED pending request prevents duplicate submission');
    await click('Cancel response');
    await waitText('Response canceled');
    check(await page.getByRole('status', { name: /Response canceled/ }).count() === 1,
      'SIMULATED cancellation status exposes its text to assistive technology');
    check(await currentInput() === cancelled, 'SIMULATED cancel keeps the typed question');
    await release();
    check(!(await text()).includes('SIMULATED OLD RESPONSE'), 'SIMULATED late cancelled response cannot reappear in the conversation');
    hold = false;
    await click('New conversation');
    check(!(await text()).includes(answer1) && !(await text()).includes(answer2), 'SIMULATED new conversation clears previous messages');
    reply = { resposta: 'SIMULATED: Conversation restarted.', modelo: 'qa-simulated', recusada: false };
    await send('What does the soil index mean?');
    await waitText(reply.resposta);
    check(posts.at(-1).historico.length === 0, 'SIMULATED new conversation begins with an empty history');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    await align(heading());
    const boxes = await Promise.all([heading(), counter(), button('Send question')].map(locator => locator.boundingBox()));
    check(boxes.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'SIMULATED mobile chat and input fit the viewport');
    await page.screenshot({ path: 'output/playwright/chat-mobile.png' });
    await align(counter(), 600);
    await page.screenshot({ path: 'output/playwright/chat-mobile-input.png' });
    reply = { resposta: 'SIMULATED: Reply sent on mobile.', modelo: 'qa-simulated', recusada: false };
    await send('What about the dry year?');
    await waitText(reply.resposta);
    check(posts.at(-1).historico.length === 2, 'SIMULATED mobile question preserves the current conversation');

    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForTimeout(300);
    await click('New conversation');
    const longAnswer = 'SIMULATED: ' + 'long simulated answer '.repeat(250);
    reply = { resposta: longAnswer, modelo: 'qa-simulado', recusada: false };
    await send('Explain in more detail.');
    await waitText('The response exceeds this interface’s conversation history limit');
    check((await text()).includes(longAnswer) && await button('Send question').isDisabled(),
      'SIMULATED oversized reply remains whole and explains why a new conversation is required');
    await click('New conversation');
    for (let i = 1; i <= 10; i++) {
      reply = { resposta: `SIMULATED: Short response ${i}.`, modelo: 'qa-simulated', recusada: false };
      await send(`Limit question ${i}?`);
      await waitText(reply.resposta);
    }
    check(posts.at(-1).historico.length === 18 && (await text()).includes('10 questions') && await button('Send question').isDisabled(),
      'SIMULATED tenth complete pair reaches the limit without silently truncating history');

    await click('New conversation');
    hold = true;
    await send('Question pending before reanalysis.');
    await button('Cancel response').waitFor();
    await click('← Edit farm and history');
    const nextAnalysis = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analyze farm →');
    await nextAnalysis;
    await waitText('HAPPY FARMERS ANALYSIS');
    await release('RESPONSE FROM PREVIOUS ANALYSIS');
    hold = false;
    check(await button('Open AI chat').count() === 1, 'SIMULATED reanalysis on the same page resets and collapses the chat');
    await openChat();
    check(!(await text()).includes('RESPONSE FROM PREVIOUS ANALYSIS') && !(await text()).includes('Question pending before'),
      'SIMULATED late reply from the previous analysis cannot contaminate the new conversation');

    const distinct = await analyze(['soja', 'feijao']);
    await openChat();
    check(!(await text()).includes('SIMULATED: Short response'), 'SIMULATED new analysis clears the previous conversation');
    reply = { resposta: 'SIMULATED: New analysis received.', modelo: 'qa-simulado', recusada: false };
    await send('Explain my current rotation.');
    await waitText(reply.resposta);
    check(posts.at(-1).foco.length === 4 && posts.at(-1).foco.includes('soja>feijao') && posts.at(-1).historico.length === 0,
      'SIMULATED distinct current rotation joins all three ranked cards in focus');
    check(JSON.stringify(posts.at(-1).analise) === JSON.stringify(distinct.raw), 'SIMULATED new analysis replaces the raw context sent to chat');
    const discarded = await analyze(['soja', 'milho'], 2);
    await openChat();
    reply = { resposta: 'SIMULATED: Reference outside the planting calendar.', modelo: 'qa-simulado', recusada: false };
    await send('Which strategies are available?');
    await waitText(reply.resposta);
    check(discarded.view.current_rotation.status === 'discarded' && !posts.at(-1).foco.includes(discarded.raw.atual.id),
      'SIMULATED discarded current rotation is not sent as a viable focused sequence');
    check(errors.length === 0, 'No uncaught JavaScript errors during real or simulated checks', false);
    return { passed: checks.length, synthetic_checks: syntheticChecks, chat_requests_simulated: posts.length, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/chat-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, posts: posts.length, screen: (await text().catch(() => '')).slice(-6500) }));
  } finally {
    await release();
    await context.close();
  }
}
