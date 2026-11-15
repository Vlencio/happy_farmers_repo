import { normalizeFarm } from './geometry.mjs';
import { DEFAULT_SETTINGS, validateSettings } from './api.mjs';

export function validSeason(value) {
  if (typeof value !== 'string' || !/^\d{4}(\/\d{2}|\/\d{4})?$/.test(value)) return false;
  const [start, end] = value.split('/');
  const year = Number(start);
  if (year < 1900 || year > 2100) return false;
  return end === undefined || [year, year + 1].some(y => Number(end) === (end.length === 2 ? y % 100 : y));
}

// Restore each part independently: one damaged record must not discard the farm.
// Unknown crops stay visible, so the catalog check can ask the user to correct them.
export function restoreDraft(text) {
  if (!text) return null;
  const draft = JSON.parse(text);
  if (!draft || ![1, 2].includes(draft.version)) throw new Error('Versão de rascunho não reconhecida.');
  let farm = null, settings = validateSettings(DEFAULT_SETTINGS), repaired = false;
  if (draft.farm) {
    try {
      farm = normalizeFarm(draft.farm.geojson, {
        name: typeof draft.farm.name === 'string' ? draft.farm.name : 'Minha fazenda',
        source: ['draw', 'sample', 'import'].includes(draft.farm.source) ? draft.farm.source : 'import',
      });
    } catch { repaired = true; }
  }
  const items = Array.isArray(draft.history) ? draft.history : [];
  if (!Array.isArray(draft.history)) repaired = true;
  const history = items.filter(item => item && typeof item.crop === 'string' && item.crop.trim() && item.crop.length <= 80 &&
    validSeason(item.season) && typeof item.notes === 'string' && [...item.notes].length <= 500).slice(0, 12);
  repaired ||= history.length !== items.length;
  try { settings = validateSettings(draft.settings); } catch {
    repaired ||= draft.version !== 1;
    // Recover each setting group independently, preserving other valid choices.
    const partial = draft.settings ?? {};
    try { Object.assign(settings, validateSettings({ mes_plantio: partial.mes_plantio, horizonte: partial.horizonte })); } catch { /* Keep the default calendar. */ }
    try { settings.prioridades = validateSettings({ ...DEFAULT_SETTINGS, prioridades: partial.prioridades }).prioridades; } catch { /* Keep equal priorities. */ }
    try { settings.ajuste = validateSettings({ ...DEFAULT_SETTINGS, ajuste: partial.ajuste }).ajuste; } catch { /* Keep the unadjusted climate. */ }
  }
  return { farm, history, settings, repaired };
}
