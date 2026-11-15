// Run with playwright-cli run-code --filename=frontend/tests/browser-benefits.js.
// Every number comes from the real local API; the isolated context preserves the user's draft.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Motor conectado|Conectado/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const benefitsHeading = () => page.getByRole('heading', { name: 'Benefícios considerados pelo motor', exact: true });
  async function reveal(locator) {
    for (let i = 0; i < 45; i++) {
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
    for (let i = 0; i < 22; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width * .78, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(180);
    }
  }
  async function analyze(crops = ['soja', 'milho']) {
    await page.goto(originalPage.url());
    await waitConnected();
    // Seed only input state. Submission and navigation use Rune's actual controls.
    await page.evaluate(async crops => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      const farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: crops.map((crop, i) => ({ crop, season: String(2022 + i), notes: '' })),
        settings: { mes_plantio: 10, horizonte: 2 } }));
    }, crops);
    await page.reload();
    await waitConnected();
    const pending = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analisar fazenda →');
    const response = await pending;
    check(response.status() === 200, 'Real analyze request succeeds for ' + crops.join(' → '));
    const raw = await response.json();
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
    check(await benefitsHeading().count() === 1 && screen.includes(rec.benefits.summary), 'Detail exposes benefit heading and count for ' + rec.category);
    check(rec.benefits.items.length === source.beneficios.length, 'No returned benefit is lost for ' + rec.category);
    check(rec.benefits.items.every(item => [item.title, item.context, item.description, item.evidence].every(value => screen.includes(value))),
      'Every benefit retains its context, explanation and evidence for ' + rec.category);
    check(screen.includes(rec.benefits.note) && screen.includes('Riscos e lacunas desta estratégia'),
      'Benefits retain limitations and existing warnings for ' + rec.category);
  }
  try {
    const first = await analyze();
    const recs = [first.view.current_rotation.strategy, ...first.view.recommendations];
    const names = await cards().allTextContents();
    check(names.length === 4, 'The reference and all three ranked cards remain available');
    check(recs.every((rec, i) => names[i].includes(rec.benefits.summary) && names[i].includes(rec.benefits.items[0].card_summary)),
      'All four accessible card names include their own benefit summaries');
    check(recs[0].sequence_id === recs[1].sequence_id && names[0] !== names[1],
      'A duplicated winning sequence keeps both reference and first-ranked cards');
    check(first.view.recommendations.map(rec => rec.sequence_id).join('|') === 'soja>milho|soja>sorgo|soja>feijao',
      'Benefit presentation preserves the three weighted winners');
    await align(cards().first());
    await page.screenshot({ path: 'output/playwright/benefits-cards-desktop.png' });
    for (const [i, rec] of recs.entries()) {
      await click(names[i]);
      await waitText('Benefícios considerados pelo motor');
      await verifyDetail(rec, first.raw.sequencias.find(seq => seq.id === rec.sequence_id));
      if (i === 0) {
        const source = first.raw.sequencias.find(seq => seq.id === rec.sequence_id);
        check(new Set(source.beneficios.map(item => item.codigo)).size === 5, 'The real current rotation has five benefits after the soil-capacity revision');
        check((await text()).includes('queda de 1,5%') && (await text()).includes('13.481') && (await text()).includes('13.284'),
          'The real future-revenue decline and both revenues reach the detail');
        check(!(await text()).includes('Fatores favoráveis hoje e no futuro'),
          'The UI does not invent the favorable-climate benefit removed by the engine');
        await align(benefitsHeading());
        await page.screenshot({ path: 'output/playwright/benefits-current-desktop.png' });
        await align(page.getByRole('heading', { name: 'Estabilidade de receita no futuro', exact: true }));
        await page.screenshot({ path: 'output/playwright/benefits-evidence-desktop.png' });
      }
      if (i === 2) {
        const source = first.raw.sequencias.find(seq => seq.id === rec.sequence_id);
        check(rec.sequence_id === 'soja>sorgo' && source.beneficios.some(item => item.codigo === 'clima_favoravel')
          && (await text()).includes('não inclui o ano seco') && source.avisos.some(item => item.cenario === 'seco'),
          'Favorable climate benefit for soybean-sorghum excludes its dry-year risks');
      }
      if (i === 3) {
        check((await text()).includes('Feijão') && !(await text()).includes('feijao'), 'Bean benefit labels preserve Portuguese accents');
      }
      await click('← Comparar estratégias');
    }
    const bean = await analyze(['soja', 'feijao']);
    const current = bean.view.current_rotation.strategy;
    check(current.sequence_id === 'soja>feijao' && current.benefits.items.length === 2 && recs[0].benefits.items.length === 5,
      'Changing the real current rotation changes five benefits to two');
    await click(await cards().first().textContent());
    await waitText('Benefícios considerados pelo motor');
    await verifyDetail(current, bean.raw.sequencias.find(seq => seq.id === current.sequence_id));
    check((await text()).includes('Feijão: fixadora de nitrogênio') || current.benefits.items.some(item => item.context === 'Feijão'),
      'Bean fixation retains its own accented culture context');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await align(benefitsHeading());
    const headingBox = await benefitsHeading().boundingBox();
    const itemBoxes = await page.getByRole('heading', { name: 'Fixação de nitrogênio', exact: true }).all();
    check(headingBox.x >= 0 && headingBox.x + headingBox.width <= 391, 'Mobile benefit heading fits the viewport');
    const boxes = await Promise.all(itemBoxes.map(item => item.boundingBox()));
    check(boxes.length === 2 && boxes.every(box => box.x >= 0 && box.x + box.width <= 391),
      'Mobile renders both individual benefit headings without horizontal overflow');
    await page.screenshot({ path: 'output/playwright/benefits-bean-mobile.png' });
    await align(page.getByRole('heading', { name: 'Riscos e lacunas desta estratégia', exact: true }), 400);
    await page.screenshot({ path: 'output/playwright/benefits-warnings-mobile.png' });
    await click('← Comparar estratégias');
    const mobileCards = await Promise.all([0, 1, 2, 3].map(i => cards().nth(i).boundingBox()));
    check(mobileCards.every((box, i) => box.x >= 0 && box.x + box.width <= 391 && (i === 0 || box.y > mobileCards[i - 1].y)),
      'Mobile stacks all four benefit cards without horizontal overflow');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, synthetic_checks: 0, checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/benefits-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-3500) }));
  } finally { await context.close(); }
}
