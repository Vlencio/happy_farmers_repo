// Run with playwright-cli run-code --filename=frontend/tests/browser-exposure.js.
// The local API supplies all numbers. A fresh context preserves the user's draft.
async (originalPage) => {
  const context = await originalPage.context().browser().newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const checks = [], errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/analyze')) requests.push(request.postDataJSON());
  });
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const text = () => page.locator('[data-rune-a11y]').textContent();
  const waitText = value => page.waitForFunction(value => document.querySelector('[data-rune-a11y]')?.textContent.includes(value), value, { timeout: 20000 });
  const waitConnected = () => page.waitForFunction(() => /Motor conectado|Conectado/.test(document.querySelector('[data-rune-a11y]')?.textContent ?? ''), null, { timeout: 20000 });
  const cards = () => page.getByRole('button', { name: /Abrir linha do tempo$/ });
  const months = () => page.getByRole('button', { name: /^Solo em .+: \d+ dias sem cultura, \d+ dias expostos$/ });
  const monthName = (month, days, exposed) => `Solo em ${month}: ${days} dias sem cultura, ${exposed} dias expostos`;
  async function reveal(locator) {
    for (let i = 0; i < 32; i++) {
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
  async function clickLocator(locator) {
    const box = await reveal(locator);
    await page.mouse.click(box.x + box.width / 2, Math.min(box.y + box.height / 2, page.viewportSize().height - 40));
    await page.waitForTimeout(160);
  }
  const click = name => clickLocator(page.getByRole('button', { name, exact: true }));
  async function clickMonth(name) {
    const locator = page.getByRole('button', { name, exact: true });
    await reveal(locator);
    for (let i = 0; i < 18; i++) {
      const box = await locator.boundingBox();
      const width = page.viewportSize().width;
      // Month tiles are inside a horizontal Rune scroll area; use real wheel events.
      if (box.x >= 18 && box.x + box.width <= width - 18) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(160);
        return;
      }
      await page.mouse.move(width * .55, Math.min(box.y + box.height / 2, page.viewportSize().height - 50));
      await page.mouse.wheel(Math.max(-650, Math.min(650, box.x + box.width / 2 - width / 2)), 0);
      await page.waitForTimeout(180);
    }
    throw new Error('Could not reveal month horizontally: ' + name);
  }
  async function align(locator, top = 120) {
    for (let i = 0; i < 8; i++) {
      const box = await locator.boundingBox();
      if (!box || Math.abs(box.y - top) < 15) return;
      await page.mouse.move(page.viewportSize().width * .78, page.viewportSize().height * .55);
      await page.mouse.wheel(0, Math.max(-650, Math.min(650, box.y - top)));
      await page.waitForTimeout(180);
    }
  }
  async function analyze({ shiftedBoundary = false } = {}) {
    await page.goto(originalPage.url());
    await waitConnected();
    await page.evaluate(async shiftedBoundary => {
      const { normalizeFarm } = await import('/web/geometry.mjs');
      let farm = normalizeFarm(await (await fetch('/demo-farm.geojson')).json(), { source: 'sample' });
      if (shiftedBoundary) {
        const shift = coordinates => typeof coordinates[0] === 'number'
          ? [coordinates[0] + .00001, ...coordinates.slice(1)] : coordinates.map(shift);
        farm.geojson.geometry.coordinates = shift(farm.geojson.geometry.coordinates);
        farm = normalizeFarm(farm.geojson, { source: 'sample' });
      }
      localStorage.setItem('happy-farmers-draft-v1', JSON.stringify({ version: 2, farm,
        history: [{ crop: 'soja', season: '2024', notes: '' }, { crop: 'milho', season: '2025', notes: '' }],
        settings: { mes_plantio: 10, horizonte: 2 } }));
    }, shiftedBoundary);
    await page.reload();
    await waitConnected();
    await click('Analisar fazenda →');
    await waitText('ANÁLISE DO MOTOR');
  }
  try {
    await analyze();
    check(await cards().count() === 4, 'Exposure retains the current reference and three objective cards');
    const names = await cards().allTextContents();
    const currentName = names.find(name => name.startsWith('ROTAÇÃO ATUAL:'));
    const soilName = names.find(name => name.startsWith('SAÚDE DO SOLO:'));
    check(names.every(name => name.includes('Dias expostos · 365 dias') && name.includes('Chuva em solo exposto · hoje')), 'All strategy cards expose soil figures to assistive technology');
    check(/10 dias/.test(currentName) && /74,3 mm/.test(currentName), 'Current soybean-corn reference shows actual 10 days and 74.3 mm exposed');
    check(/36 dias/.test(soilName) && /237,3 mm/.test(soilName), 'Soil suggestion shows its distinct 36 days and 237.3 mm exposed');
    check(requests.length === 1 && !Object.hasOwn(requests[0], 'declividade_pct'), 'Current API receives no unsupported slope field');
    await click(currentName);
    await waitText('Solo entre as culturas');
    check(await months().count() === 12, 'Exposure calendar covers exactly the first twelve months');
    check((await text()).includes('Primeiros 365 dias: out · ano 1 → set · ano 2.'), 'Exposure window and year crossing are explicit');
    check((await text()).includes('palhada') && (await text()).includes('não as datas exatas'), 'Coverage legend explains mulch and proportional month bars');
    check((await text()).includes('Índice de exposição à erosão indisponível'), 'Missing slope index is explained rather than displayed as zero');
    await clickMonth(monthName('jan · ano 2', 8, 8));
    check(await page.getByRole('heading', { name: 'Solo em jan · ano 2', exact: true }).count() === 1, 'Selecting January opens the exposed gap details');
    check((await text()).includes('61,7 / 60,4 / 41,1'), 'Selected month compares actual today, future and dry-year exposed rainfall');
    check(await page.getByRole('button', { name: 'Etapa 1: Soja · safra', exact: true }).count() === 1, 'Soil-month navigation retains the crop calendar');
    await clickMonth(monthName('fev · ano 2', 2, 2));
    check(await page.getByRole('heading', { name: 'Solo em fev · ano 2', exact: true }).count() === 1, 'Corn sequence has only two exposed February days');
    await align(page.getByText('Solo entre as culturas', { exact: true }));
    await page.screenshot({ path: 'output/playwright/exposure-desktop.png' });
    await click('← Comparar estratégias');
    await click(soilName);
    await waitText('Solo entre as culturas');
    check(await page.getByRole('heading', { name: 'Solo em out · ano 1', exact: true }).count() === 1, 'Opening another strategy resets the selected soil month');
    await clickMonth(monthName('fev · ano 2', 28, 28));
    check(await page.getByRole('heading', { name: 'Solo em fev · ano 2', exact: true }).count() === 1, 'Crotalaria sequence exposes all twenty-eight February days');
    check((await text()).includes('175,6 / 179,1 / 142,7'), 'Crotalaria displays its own monthly exposed rainfall');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(350);
    await clickMonth(monthName('set · ano 2', 30, 0));
    check(await page.getByRole('heading', { name: 'Solo em set · ano 2', exact: true }).count() === 1, 'Mobile horizontal scroll reaches the last month');
    await align(page.getByRole('heading', { name: 'Solo em set · ano 2', exact: true }), 160);
    await page.screenshot({ path: 'output/playwright/exposure-mobile.png' });
    check((await text()).includes('0 / 0 / 0'), 'Protected months preserve genuine zero exposed rain');
    await clickMonth(monthName('out · ano 1', 0, 0));
    check(await page.getByRole('heading', { name: 'Solo em out · ano 1', exact: true }).count() === 1, 'Mobile can return to the first month with zero uncovered days');
    check(await months().count() === 12, 'Mobile preserves all twelve month controls');

    // SIMULATED FUTURE API SUPPORT: the real service still rejects declividade_pct.
    // Only this test advertises support, strips the field on forwarding, and injects
    // unmistakable sentinel indices. It tests transport/rendering, not the erosion formula.
    const simulatedRequests = [];
    await page.route('**/api/metadata', async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.capabilities = { ...body.capabilities, declividade_pct: true };
      await route.fulfill({ response, json: body });
    });
    await page.route('**/api/analyze', async route => {
      const incoming = route.request().postDataJSON();
      simulatedRequests.push(incoming);
      const upstream = { ...incoming };
      delete upstream.declividade_pct; // Test-only compatibility with the actual API.
      const response = await route.fetch({ postData: upstream });
      const body = await response.json();
      if (Object.hasOwn(incoming, 'declividade_pct')) {
        body.entrada.declividade_pct = incoming.declividade_pct;
        for (const seq of body.sequencias) {
          for (const [scenario, sentinel] of Object.entries({ hoje: 123.4, futuro: 234.5, seco: 345.6 })) {
            if (seq[scenario]?.descoberto) seq[scenario].descoberto.indice_erosao = sentinel;
          }
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await analyze();
    check(simulatedRequests.length === 1 && simulatedRequests[0].declividade_pct === 4.05, 'SIMULATED future API: advertised capability sends exact demo slope 4.05');
    await click(await page.getByRole('button', { name: /^ROTAÇÃO ATUAL:.*Abrir linha do tempo$/ }).textContent());
    await waitText('Solo entre as culturas');
    check((await text()).includes('123,4 / 234,5 / 345,6'), 'SIMULATED future API: sentinel erosion indices render for all three scenarios');
    check((await text()).includes('não representa perda de solo em t/ha') && !(await text()).includes('Índice de exposição à erosão indisponível'), 'SIMULATED future API: available index retains its meaning and limits');
    await analyze({ shiftedBoundary: true });
    check(simulatedRequests.length === 2 && !Object.hasOwn(simulatedRequests[1], 'declividade_pct'), 'SIMULATED future API: nearby but different boundary does not reuse demo slope');
    check(errors.length === 0, 'No uncaught JavaScript errors');
    return { passed: checks.length, simulated_future_api_checks: 4, simulation: 'Capability and erosion indices are synthetic; the actual backend remains unchanged.', checks };
  } catch (error) {
    await page.screenshot({ path: 'output/playwright/exposure-failure.png' });
    throw new Error(JSON.stringify({ checks, failure: error.message, errors, requests, screen: (await text().catch(() => '')).slice(-4000) }));
  } finally { await context.close(); }
}
