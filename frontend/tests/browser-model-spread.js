// Run against the current front and an API containing the D2 CSV:
// playwright-cli open http://127.0.0.1:4174 --headed
// playwright-cli run-code --filename=frontend/tests/browser-model-spread.js
// Uses actual /metadata and /analyze responses. No model/provider calls or mocks.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], analyses = [], chats = [];
  const expected = '3 modelos: mudança na temperatura máxima média de +1,34 a +2,31 °C; chuva anual de -79,6 a +32,7 mm.';
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const button = name => page.getByRole('button', { name, exact: true });
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) analyses.push(request.postDataJSON());
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/chat')) chats.push(request.url());
  });
  async function reveal(locator, top = 170) {
    for (let i = 0; i < 40; i++) {
      const box = await locator.boundingBox();
      if (!box) throw new Error('Missing control: ' + locator);
      if (box.y >= 78 && box.y + box.height < page.viewportSize().height - 40) return box;
      await page.mouse.move(page.viewportSize().width - 22, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(140);
    }
    throw new Error('Could not reveal: ' + locator);
  }
  async function click(name) {
    await reveal(button(name));
    const box = await button(name).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(150);
  }
  async function observations() {
    if (await button('Mostrar observações do talhão').count()) await click('Mostrar observações do talhão');
    await waitText(expected);
  }
  async function capture(name) {
    const locator = page.getByText(expected, { exact: false });
    const box = await reveal(locator);
    check(box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, name + ': model text fits viewport width');
    check(box.y >= 78 && box.y + box.height < page.viewportSize().height, name + ': full model text is visible');
    await page.screenshot({ path: `output/playwright/d2-${name}.png` });
  }
  async function importBoundary(boundary, name) {
    await page.locator('#geojson-file').setInputFiles({ name: `${name}.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(boundary)) });
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#farm-name').fill(name);
    await page.locator('#confirm-boundary').click();
    await waitText(name);
  }
  try {
    const metadataResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/metadata'));
    await page.goto(originalPage.url());
    await waitText('Motor conectado');
    const response = await metadataResponse;
    check(response.status() === 200, 'Real metadata transport succeeds');
    const metadata = await response.json();
    check(metadata.model_spread?.scope === 'talhao_demo_2', 'Real D2 metadata is scoped to the demo field');
    check(metadata.model_spread.models.map(model => model.model).sort().join(',') === 'ACCESS-CM2,MIROC6,MRI-ESM2-0', 'Real metadata contains all three delivered models');
    const derived = await page.evaluate(async spread => (await import('/web/field.mjs')).modelSpreadText(spread), metadata.model_spread);
    check(derived.startsWith(expected), 'Display values are derived from actual API aggregates');
    await click('Usar área de exemplo');
    await page.locator('#map-dialog').waitFor({ state: 'visible' });
    await page.locator('#confirm-boundary').click();
    await waitText('Talhão de demonstração');
    await observations();
    check((await text()).includes('Na chuva, os modelos discordam do sinal da mudança.'), 'Rain sign disagreement is visible');
    check((await text()).includes('Faixa entre modelos, não intervalo de confiança. Futuro menos histórico.'), 'Model range is distinguished from confidence interval');
    check(!(await text()).includes('A faixa entre modelos ainda não foi disponibilizada'), 'D2 replaces the missing-data notice');
    await capture('desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await capture('mobile');
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.waitForTimeout(250);
    const pendingAnalysis = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/analyze'));
    await click('Analisar fazenda →');
    const analysisResponse = await pendingAnalysis;
    check(analysisResponse.status() === 200, 'Real demo analysis succeeds with the D2 API');
    const analysis = await analysisResponse.json();
    check(analysis.origem?.hoje === 'tabela_demo', 'Demo analysis uses delivered tables without a POWER point query');
    await waitText('ANÁLISE DO MOTOR');
    const cards = page.getByRole('button', { name: /^[123]ª DE HOJE.*Abrir linha do tempo$/ });
    check(await cards.count() === Math.min(3, analysis.sequencias.length), 'Existing strategy cards still render the actual ranked analysis');
    await click('← Editar fazenda e histórico');
    const imported = structuredClone(metadata.demo_field.boundary);
    const geometry = imported.type === 'FeatureCollection' ? imported.features[0].geometry : imported.type === 'Feature' ? imported.geometry : imported;
    const ring = geometry.coordinates[0].slice(0, -1).reverse();
    geometry.coordinates[0] = [...ring, ring[0]];
    await importBoundary(imported, 'Mesmo contorno importado');
    await observations();
    check((await text()).includes(expected), 'Imported equivalent boundary retains the model range');
    const other = structuredClone(imported);
    const otherGeometry = other.type === 'FeatureCollection' ? other.features[0].geometry : other.type === 'Feature' ? other.geometry : other;
    otherGeometry.coordinates[0][1][0] += 0.00001;
    await importBoundary(other, 'Contorno alterado');
    await waitText('Ainda não há esses dados para esta área.');
    check(!(await text()).includes(expected), 'Changing one vertex hides the demo model range');
    check(await button('Mostrar observações do talhão').count() === 0 && await button('Ocultar observações do talhão').count() === 0, 'Another boundary cannot open the demo observations');
    check(analyses.length === 1, 'Only the demo is analyzed; no outside-point POWER query is triggered');
    check(chats.length === 0, 'No chat or LLM provider call is requested');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, checks, metadataUrl: response.url(), models: metadata.model_spread.models };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/d2-failure.png' });
    throw new Error(JSON.stringify({ passed: checks.length, checks, failure: error.message, errors }));
  } finally { await context.close(); }
}
