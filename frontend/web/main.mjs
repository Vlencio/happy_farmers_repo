import './style.css';
import { normalizeFarm, parseGeoJSON, MAX_FILE_BYTES } from './geometry.mjs';
import { createFarmMap, downloadGeoJSON } from './map.mjs';
import { buildRequest, requestAnalysis, validateAnalysis } from './api.mjs';
import { demoAnalysis } from './demo.mjs';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const storageKey = 'happy-farmers-draft-v1';
let wasm, farm = null, history = [], controller, requestId = 0;
const send = (command) => wasm?.receive_command(JSON.stringify(command));
function saveDraft() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, farm, history }));
    send({ type: 'notice', message: 'Rascunho salvo neste navegador.' });
  } catch { send({ type: 'notice', message: 'Não foi possível salvar neste navegador. Baixe seu GeoJSON para guardar o contorno.' }); }
}
function invalidate() { requestId++; controller?.abort(); }
const farmMap = createFarmMap((value) => {
  invalidate(); farm = value; send({ type: 'farm', farm }); saveDraft();
});
document.getElementById('geojson-file').onchange = async (event) => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('O arquivo excede 2 MB. Simplifique o contorno antes de importar.');
    farmMap.open(parseGeoJSON(await file.text(), { name: file.name.replace(/\.(json|geojson)$/i, ''), source: 'import' }));
  } catch (error) { send({ type: 'error', message: error.message }); }
};

window.happyFarmersHost = {
  action(raw) {
    // Rune event handlers stay synchronous. All browser/network work lives here.
    void dispatch(JSON.parse(raw)).catch((error) => send({ type: 'error', message: error.message || 'Não foi possível concluir a ação.' }));
  },
};
async function dispatch(action) {
  switch (action.type) {
    case 'map': farmMap.open(farm); break;
    case 'import': document.getElementById('geojson-file').click(); break;
    case 'sample': {
      const response = await fetch('/demo-farm.geojson');
      if (!response.ok) throw new Error('Não foi possível abrir a área de exemplo.');
      const sample = normalizeFarm(await response.json(), { source: 'sample' });
      sample.name = 'Talhão de demonstração';
      farmMap.open(sample); break;
    }
    case 'download': if (farm) downloadGeoJSON(farm); break;
    case 'history': invalidate(); history = action.history; saveDraft(); break;
    case 'clear': {
      invalidate(); farm = null; history = [];
      let stored = true;
      try { localStorage.removeItem(storageKey); } catch { stored = false; }
      send({ type: 'cleared' });
      if (!stored) send({ type: 'notice', message: 'Planejamento limpo. O navegador não permitiu acessar o rascunho salvo.' });
      break;
    }
    case 'cancel': invalidate(); send({ type: 'cancelled' }); break;
    case 'analyze': {
      if (!farm) throw new Error('Defina o limite da fazenda antes de analisar.');
      invalidate(); const id = requestId; const pending = new AbortController(); controller = pending;
      const timer = setTimeout(() => pending.abort(), 45000);
      try {
        const result = baseUrl
          ? await requestAnalysis(baseUrl, buildRequest(farm, history), { signal: pending.signal })
          : validateAnalysis(demoAnalysis());
        if (id === requestId) send({ type: 'analysis', analysis: result });
      } catch (error) {
        if (id === requestId) send({ type: 'error', message: error.name === 'AbortError'
          ? 'A análise demorou mais que o esperado. Tente novamente.'
          : `Falha ao consultar o motor. ${error.message}` });
      } finally { clearTimeout(timer); }
      break;
    }
  }
}

async function boot() {
  try {
    const wasmUrl = new URL('/pkg/app.js', window.location.href).href;
    wasm = await import(/* @vite-ignore */ wasmUrl);
    await wasm.default();
    send({ type: 'config', api: Boolean(baseUrl) });
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (draft?.version === 1) {
        if (draft.farm) farm = normalizeFarm(draft.farm.geojson, { name: draft.farm.name, source: draft.farm.source });
        history = Array.isArray(draft.history) ? draft.history.filter((item) =>
          typeof item.crop === 'string' && item.crop.length <= 80 &&
          typeof item.season === 'string' && /^\d{4}(\/\d{2,4})?$/.test(item.season) &&
          typeof item.notes === 'string' && item.notes.length <= 500).slice(0, 12) : [];
        send({ type: 'restore', farm, history });
      }
    } catch { send({ type: 'notice', message: 'O rascunho anterior não pôde ser restaurado. Você pode iniciar uma nova área.' }); }
    document.getElementById('boot').hidden = true;
  } catch (error) {
    console.error(error);
    document.getElementById('boot-error').textContent = 'A interface não carregou. Execute npm run build:wasm e recarregue a página. ' + error.message;
  }
}
boot();
