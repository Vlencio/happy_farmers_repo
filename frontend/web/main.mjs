import './style.css';
import { normalizeFarm, parseGeoJSON, MAX_FILE_BYTES } from './geometry.mjs';
import { createFarmMap, downloadGeoJSON } from './map.mjs';
import { buildRequest, requestAnalysis, requestMetadata, mapMotorAnalysis, DEFAULT_SETTINGS, ANALYSIS_TIMEOUT_MS, validateSettings, supportsAdjustment, assertAdjustmentApplied } from './api.mjs';
import { englishApiError } from './external-text.mjs';
import { buildFieldContext, getAnalysisSlope } from './field.mjs';
import { createFarmPreview } from './farm-preview.mjs';
import { restoreDraft } from './draft.mjs';
import { createChatSession } from './chat.mjs';
import { supportsSoil, requestSoilSuggestion, assertSoilApplied } from './soil.mjs';

const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api').trim();
const storageKey = 'happy-farmers-draft-v1';
let wasm, farm = null, history = [], settings = { ...DEFAULT_SETTINGS }, metadata = null, controller, requestId = 0;
let connectionId = 0, connectionController;
let soilId = 0, soilController;
let soilContext = { loading: false, suggestion: null, source: '', notice: '' };
const sendSoil = () => send({ type: 'soil', context: soilContext, texture: settings.solo_textura ?? null, use_default: settings.solo_padrao === true });
function cancelSoil() {
  soilId++; soilController?.abort(); soilController = undefined;
  soilContext = { ...soilContext, loading: false };
}
async function updateSoil() {
  cancelSoil();
  soilContext = { loading: false, suggestion: null, source: '', notice: '' };
  if (!farm || !supportsSoil(metadata)) { sendSoil(); return; }
  const id = soilId;
  soilController = new AbortController();
  soilContext.loading = true; sendSoil();
  try {
    const { lat, lon } = buildRequest(farm, [], DEFAULT_SETTINGS, [], metadata);
    const result = await requestSoilSuggestion(baseUrl, { lat, lon }, {
      signal: AbortSignal.any([soilController.signal, AbortSignal.timeout(10000)]),
    });
    if (id !== soilId) return;
    soilContext = { loading: false, suggestion: result?.textura_sugerida ?? null,
      source: result?.fonte ?? '', notice: result?.textura_sugerida ? '' : 'No suggestion is available for this point. Enter the texture if you know it.' };
    if (!settings.solo_textura && !settings.solo_padrao && result?.textura_sugerida) {
      invalidate();
      settings = { ...settings, solo_textura: result.textura_sugerida };
      saveDraft();
    }
  } catch (error) {
    if (id !== soilId) return;
    soilContext = { loading: false, suggestion: null, source: '', notice: 'Unable to get a soil suggestion for this point. Choose a texture or use the default reference.' };
  }
  if (id === soilId) sendSoil();
}
const send = (command) => wasm?.receive_command(JSON.stringify(command));
const chat = createChatSession({ baseUrl, onChange: send });
const farmPreview = createFarmPreview((frame) => {
  if (frame.rgba) wasm?.receive_farm_preview(frame.rgba, frame.width, frame.height, frame.note);
  else send({ type: 'preview_note', message: frame.note });
});
window.addEventListener('online', () => farmPreview.refresh());
function saveDraft() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 2, farm, history, settings }));
    send({ type: 'notice', message: 'Draft saved in this browser.' });
  } catch { send({ type: 'notice', message: 'Unable to save in this browser. Download your GeoJSON to keep the boundary.' }); }
}
function invalidate() { requestId++; controller?.abort(); chat.invalidate(); }
function updateFieldContext() {
  send({ type: 'field_context', context: buildFieldContext(farm, metadata) });
}
async function connect() {
  const id = ++connectionId;
  connectionController?.abort();
  connectionController = new AbortController();
  try {
    const result = await requestMetadata(baseUrl, { signal: AbortSignal.any([connectionController.signal, AbortSignal.timeout(10000)]) });
    if (id !== connectionId) return;
    metadata = result;
    chat.configure(metadata);
    send({ type: 'config', ready: true, cultures: metadata.cultures, data_notice: metadata.data_notice, scenario_available: supportsAdjustment(metadata), soil_available: supportsSoil(metadata) });
    updateFieldContext();
    void updateSoil();
  } catch (error) {
    if (id !== connectionId) return;
    metadata = null;
    cancelSoil();
    chat.configure(null);
    send({ type: 'field_context', context: null });
    send({ type: 'config', ready: false, cultures: [], data_notice: '', scenario_available: false });
    send({ type: 'error', message: `Unable to connect to the analysis service. Try Reconnect. ${englishApiError(error.message)}` });
  }
}
const farmMap = createFarmMap((value) => {
  invalidate(); cancelSoil();
  if (JSON.stringify(farm?.geojson.geometry) !== JSON.stringify(value.geojson.geometry)) {
    const { solo_textura, solo_padrao, ...rest } = settings; settings = rest;
  }
  farm = value; send({ type: 'farm', farm }); farmPreview.setFarm(farm); updateFieldContext(); saveDraft();
  void updateSoil();
});
document.getElementById('geojson-file').onchange = async (event) => {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  try {
    if (file.size > MAX_FILE_BYTES) throw new Error('The file exceeds 2 MB. Simplify the boundary before importing.');
    farmMap.open(parseGeoJSON(await file.text(), { name: file.name.replace(/\.(json|geojson)$/i, ''), source: 'import' }));
  } catch (error) { send({ type: 'error', message: error.message }); }
};

window.happyFarmersHost = {
  action(raw) {
    // Rune event handlers stay synchronous. All browser/network work lives here.
    void dispatch(JSON.parse(raw)).catch((error) => send({ type: 'error', message: error.message || 'Unable to complete this action.' }));
  },
};
async function dispatch(action) {
  switch (action.type) {
    case 'preview_size': farmPreview.resize(action.width, action.height); break;
    case 'map': farmMap.open(farm); break;
    case 'import': document.getElementById('geojson-file').click(); break;
    case 'sample': {
      const response = await fetch('/demo-farm.geojson');
      if (!response.ok) throw new Error('Unable to open the example field.');
      const sample = normalizeFarm(await response.json(), { source: 'sample' });
      sample.name = 'Demonstration field';
      farmMap.open(sample); break;
    }
    case 'download': if (farm) downloadGeoJSON(farm); break;
    case 'history': invalidate(); history = action.history; saveDraft(); break;
    case 'settings': invalidate(); settings = validateSettings(action.settings); saveDraft(); break;
    case 'scenario': invalidate(); settings = validateSettings(action.settings); saveDraft(); break;
    case 'soil': {
      cancelSoil(); invalidate(); settings = validateSettings(action.settings); saveDraft(); sendSoil();
      if (action.analyze) await dispatch({ type: 'analyze' });
      break;
    }
    case 'priorities': {
      invalidate(); settings = validateSettings(action.settings); saveDraft();
      if (action.analyze) await dispatch({ type: 'analyze' });
      break;
    }
    case 'connect': await connect(); break;
    case 'chat_send': await chat.ask(action.pergunta); break;
    case 'chat_cancel': chat.cancel(); break;
    case 'chat_clear': chat.clear(); break;
    case 'clear': {
      cancelSoil(); soilContext = { loading: false, suggestion: null, source: '', notice: '' };
      invalidate(); farm = null; history = []; settings = { ...DEFAULT_SETTINGS };
      farmPreview.setFarm(null);
      let stored = true;
      try { localStorage.removeItem(storageKey); } catch { stored = false; }
      send({ type: 'cleared' });
      if (!stored) send({ type: 'notice', message: 'Plan cleared. The browser did not allow access to the saved draft.' });
      break;
    }
    case 'cancel': invalidate(); send({ type: 'cancelled' }); break;
    case 'analyze': {
      if (!farm) throw new Error('Define your farm boundary before analyzing.');
      if (!metadata) throw new Error('Connect to the analysis service first.');
      cancelSoil(); sendSoil();
      invalidate(); const id = requestId; const pending = new AbortController(); controller = pending;
      const timer = setTimeout(() => pending.abort(), ANALYSIS_TIMEOUT_MS);
      try {
        const request = buildRequest(farm, history, settings, metadata.cultures, metadata);
        const slope = getAnalysisSlope(farm, metadata);
        if (slope !== null) request.declividade_pct = slope;
        const raw = await requestAnalysis(baseUrl, request, { signal: pending.signal });
        if (id !== requestId) return;
        assertAdjustmentApplied(raw, request);
        assertSoilApplied(raw, request);
        const result = mapMotorAnalysis(raw, farm, { dataNotice: metadata.data_notice });
        send({ type: 'analysis', analysis: result });
        chat.setAnalysis(raw, result);
      } catch (error) {
        if (id === requestId) send({ type: 'error', message: error.name === 'AbortError'
          ? 'The climate request exceeded 6 minutes. Try again; POWER may be slow or unavailable.'
          : `Unable to request an analysis. ${error.message}` });
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
      const draft = restoreDraft(localStorage.getItem(storageKey));
      if (draft) {
        ({ farm, history, settings } = draft);
        send({ type: 'restore', farm, history, settings });
        farmPreview.setFarm(farm);
        if (draft.repaired) send({ type: 'notice', message: 'We recovered the valid parts of your draft. Check the area, history and settings before analyzing.' });
      }
    } catch { send({ type: 'notice', message: 'Your previous draft could not be restored. You can start a new field.' }); }
    document.getElementById('boot').hidden = true;
    await connect();
  } catch (error) {
    console.error(error);
    document.getElementById('boot-error').textContent = 'Unable to open your plan. Check your connection and try reloading the page.';
    document.getElementById('boot-retry').hidden = false;
  }
}
document.getElementById('boot-retry').onclick = () => window.location.reload();
boot();
