// Run with playwright-cli open http://127.0.0.1:4173 --headed, then
// playwright-cli run-code --filename=frontend/tests/browser-annual-income.js.
// Uses the real API and demo tables. No mocked responses or model-provider calls.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], analyses = [], chats = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const money = value => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const number = value => value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const normalized = value => value.replace(/\s/g, '');
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) analyses.push(request.postDataJSON());
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.url());
  });
  async function reveal(locator, top = 150) {
    for (let i = 0; i < 50; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      const height = page.viewportSize().height;
      if (box.y >= 78 && box.y + Math.min(box.height, 120) < height - 40) return box;
      await page.mouse.move(page.viewportSize().width - 22, height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(140);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    const box = await reveal(button(name));
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(140);
  }
  async function choose(name, option) {
    await click(name);
    await button(option).waitFor();
    const index = (await page.getByRole('button').allTextContents()).indexOf(option);
    if (index < 0) throw new Error('Missing option: ' + option);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Home');
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(180);
  }
  async function capture(name, locator) {
    const box = await reveal(locator);
    check(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, name + ': focused text fits viewport width');
    await page.screenshot({ path: `output/playwright/annual-${name}.png` });
  }
  try {
    const metadataResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/metadata'));
    await page.goto(originalPage.url());
    await waitText('Motor conectado');
    const response = await metadataResponse;
    check(response.status() === 200, 'Real metadata transport succeeds');
    const metadata = await response.json();
    check(metadata.climate_periods.futuro === 'por volta de 2060', 'API future period is centred around 2060');
    check(metadata.model_spread?.models.length === 3 && metadata.model_spread.scope === 'talhao_demo_2', 'Integrated D2 metadata provides the three models');
    await click('Usar área de exemplo');
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await waitText('Talhão de demonstração');
    // Restore the same history as the real February fixture without modifying
    // the user's draft; this entire flow has its own isolated browser context.
    await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('happy-farmers-draft-v1'));
      draft.history = [{ crop: 'soja', season: '2024', notes: '' }, { crop: 'milho', season: '2025', notes: '' }];
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify(draft));
    });
    await page.reload(); await waitText('Motor conectado');
    await choose('Mês em que o talhão fica livre', 'Fevereiro');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('happy-farmers-draft-v1')).settings.mes_plantio) === 2, 'The visible month control saves February');
    check((await text()).includes('Receita bruta por ano de ocupação, sem descontar custos'), 'Income priority explains annual field occupancy');
    check((await text()).includes('por volta de 2060') && !/2041[–-]2060|2050/.test(await text()), 'Setup shows the corrected future label without the old date');
    if (await button('Mostrar observações do talhão').count()) await click('Mostrar observações do talhão');
    check((await text()).includes('+1,34 a +2,31 °C; chuva anual de -79,6 a +32,7 mm.'), 'D2 range is visible from the integrated real metadata');
    await click('Entenda os termos · abrir');
    check((await text()).includes('reserva de água do solo usada pelo motor é de 60 mm') && !(await text()).includes('100 mm'), 'Glossary uses the new 60 mm soil reserve');
    check((await text()).includes('não uma medição deste talhão'), 'Soil reserve is distinguished from a field measurement');
    await capture('context-desktop', page.getByText(/^A reserva de água do solo usada pelo motor é de 60 mm/));
    const pendingAnalysis = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analisar fazenda →');
    const analysisResponse = await pendingAnalysis;
    check(analysisResponse.status() === 200, 'Real February analysis succeeds');
    const raw = await analysisResponse.json();
    await waitText('ANÁLISE DO MOTOR');
    check(raw.origem?.hoje === 'tabela_demo', 'Analysis uses demo tables without an external POWER query');
    check(raw.sequencias[0].id === 'sorgo>soja', 'New February winner is sorghum-soybean');
    const cards = page.getByRole('button', { name: /^[123]ª DE HOJE.*Abrir linha do tempo$/ });
    check(await cards.count() === 3, 'Three ranked cards remain visible');
    const labels = await cards.allTextContents();
    check(['Sorgo → Soja', 'Feijão → Soja', 'Crotalária → Soja'].every((crop, i) => labels[i].includes(crop)), 'Cards preserve the new engine top-three order');
    check((await text()).includes('receita dos cards soma toda a sequência; a prioridade renda considera a receita por ano'), 'Results distinguish sequence revenue from the annual ranking basis');
    check((await text()).includes('por volta de 2060') && !/2041[–-]2060|2050/.test(await text()), 'Results retain the corrected future date');
    await capture('cards-desktop', cards.first());
    await click(labels[0]);
    await waitText('Seu ciclo, etapa por etapa');
    const detail = normalized(await text());
    for (const [scenario, label] of [['hoje', 'HOJE'], ['futuro', 'FUTURO'], ['seco', 'ANO SECO']]) {
      const expected = raw.sequencias[0][scenario];
      check(detail.includes(normalized(`RECEITA / HA / ANO · ${label}${money(expected.receita_ano_ha)}`)), `Detail shows supplied annual revenue for ${scenario}`);
      check(detail.includes(normalized(`ANOS CONSIDERADOS · ${label}${number(expected.anos_ocupados)} ${expected.anos_ocupados === 1 ? 'ano' : 'anos'}`)), `Detail shows supplied occupied years for ${scenario}`);
      check(detail.includes(normalized(`RECEITA / HA · ${label}${money(expected.receita_ha)}`)), `Detail preserves full-sequence revenue for ${scenario}`);
    }
    check(money(raw.sequencias[0].hoje.receita_ha) !== money(raw.sequencias[0].hoje.receita_ano_ha), 'The tested February amounts distinguish annual and total revenue');
    check((await text()).includes('mínimo de 1 ano; uma sequência mais curta não é multiplicada'), 'Detail explains the annual occupancy floor');
    const annualHeading = () => page.getByText('RECEITA / HA / ANO · HOJE', { exact: true });
    await capture('detail-desktop', annualHeading());
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
    const annualLabels = await Promise.all((await page.getByText(/^RECEITA \/ HA \/ ANO ·/).all()).map(label => label.boundingBox()));
    check(annualLabels.length === 3 && annualLabels.every(box => box && box.x >= 0 && box.x + box.width <= 391), 'All three annual labels fit the mobile viewport');
    await capture('detail-mobile', annualHeading());
    await click('← Comparar estratégias');
    const mobileCards = await Promise.all((await cards.all()).map(card => card.boundingBox()));
    check(mobileCards.length === 3 && mobileCards.every((box, i) => box && box.x >= 0 && box.x + box.width <= 391 && (i === 0 || box.y > mobileCards[i - 1].y)), 'Mobile stacks all ranked cards within the viewport');
    await capture('cards-mobile', cards.first());
    check(analyses.length === 1 && analyses[0].mes_plantio === 2, 'Only one real demo analysis is sent');
    check(chats.length === 0, 'No chat or LLM request is sent');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, checks, first: raw.sequencias[0].id };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/annual-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors, screen: (await text().catch(() => '')).slice(-4500) }));
  } finally { await context.close(); }
}
