import './style.css';
import { normalizeFarm, parseGeoJSON, MAX_FILE_BYTES } from './geometry.mjs';
import { createFarmMap, downloadGeoJSON } from './map.mjs';
import { buildRequest, requestAnalysis, requestMetadata, mapMotorAnalysis, DEFAULT_SETTINGS, validateSettings } from './api.mjs';
import { buildFieldContext } from './field.mjs';
import { createFarmPreview } from './farm-preview.mjs';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
const storageKey = 'happy-farmers-draft-v1';
let wasm, farm = null, history = [], settings = { ...DEFAULT_SETTINGS }, metadata = null, controller, requestId = 0;
const send = (command) => wasm?.receive_command(JSON.stringify(command));
const farmPreview = createFarmPreview((frame) => {
  if (frame.rgba) wasm?.receive_farm_preview(frame.rgba, frame.width, frame.height, frame.note);
  else send({ type: 'preview_note', message: frame.note });
});
window.addEventListener('online', () => farmPreview.refresh());
function saveDraft() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 2, farm, history, settings }));
    send({ type: 'notice', message: 'Rascunho salvo neste navegador.' });
  } catch { send({ type: 'notice', message: 'Não foi possível salvar neste navegador. Baixe seu GeoJSON para guardar o contorno.' }); }
}
function invalidate() { requestId++; controller?.abort(); }
function updateFieldContext() {
  send({ type: 'field_context', context: buildFieldContext(farm, metadata) });
}
async function connect() {
  try {
    metadata = await requestMetadata(baseUrl, { signal: AbortSignal.timeout(10000) });
    send({ type: 'config', ready: true, cultures: metadata.cultures, data_notice: metadata.data_notice });
    updateFieldContext();
  } catch (error) {
    metadata = null;
    send({ type: 'field_context', context: null });
    send({ type: 'config', ready: false, cultures: [], data_notice: '' });
    send({ type: 'error', message: `Não foi possível conectar ao motor. Inicie a API e clique em Reconectar. ${error.message}` });
  }
}
const farmMap = createFarmMap((value) => {
  invalidate(); farm = value; send({ type: 'farm', farm }); farmPreview.setFarm(farm); updateFieldContext(); saveDraft();
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
    case 'preview_size': farmPreview.resize(action.width, action.height); break;
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
    case 'settings': invalidate(); settings = validateSettings(action.settings); saveDraft(); break;
    case 'connect': await connect(); break;
    case 'clear': {
      invalidate(); farm = null; history = []; settings = { ...DEFAULT_SETTINGS };
      farmPreview.setFarm(null);
      let stored = true;
      try { localStorage.removeItem(storageKey); } catch { stored = false; }
      send({ type: 'cleared' });
      if (!stored) send({ type: 'notice', message: 'Planejamento limpo. O navegador não permitiu acessar o rascunho salvo.' });
      break;
    }
    case 'cancel': invalidate(); send({ type: 'cancelled' }); break;
    case 'analyze': {
      if (!farm) throw new Error('Defina o limite da fazenda antes de analisar.');
      if (!metadata) throw new Error('Conecte ao motor antes de analisar.');
      invalidate(); const id = requestId; const pending = new AbortController(); controller = pending;
      const timer = setTimeout(() => pending.abort(), 45000);
      try {
        const raw = await requestAnalysis(baseUrl, buildRequest(farm, history, settings, metadata.cultures), { signal: pending.signal });
        const result = mapMotorAnalysis(raw, farm, { dataNotice: metadata.data_notice });
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
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if ([1, 2].includes(draft?.version)) {
        if (draft.farm) farm = normalizeFarm(draft.farm.geojson, { name: draft.farm.name, source: draft.farm.source });
        history = Array.isArray(draft.history) ? draft.history.filter((item) =>
          typeof item.crop === 'string' && item.crop.length <= 80 &&
          typeof item.season === 'string' && /^\d{4}(\/\d{2,4})?$/.test(item.season) &&
          typeof item.notes === 'string' && item.notes.length <= 500).slice(0, 12) : [];
        try { settings = validateSettings(draft.settings); } catch { settings = { ...DEFAULT_SETTINGS }; }
        send({ type: 'restore', farm, history, settings });
        farmPreview.setFarm(farm);
      }
    } catch { send({ type: 'notice', message: 'O rascunho anterior não pôde ser restaurado. Você pode iniciar uma nova área.' }); }
    document.getElementById('boot').hidden = true;
    await connect();
  } catch (error) {
    console.error(error);
    document.getElementById('boot-error').textContent = 'A interface não carregou. Execute npm run build:wasm e recarregue a página. ' + error.message;
  }
}
boot();
