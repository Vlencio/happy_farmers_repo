export const CATEGORIES = ['income', 'soil', 'climate'];

function string(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`Resposta inválida da API: ${name}.`);
}
export function validateAnalysis(value) {
  if (value?.schema_version !== '1.0' || typeof value.demo !== 'boolean') throw new Error('Versão de resposta não suportada pela interface.');
  string(value.analysis_id, 'analysis_id', 120);
  string(value.summary, 'summary');
  if (!Array.isArray(value.recommendations) || value.recommendations.length !== 3) throw new Error('A API deve retornar as três alternativas: renda, solo e clima.');
  const categories = new Set();
  for (const item of value.recommendations) {
    if (!CATEGORIES.includes(item.category) || categories.has(item.category)) throw new Error('As categorias da análise estão ausentes ou repetidas.');
    categories.add(item.category);
    for (const key of ['crop', 'metric', 'metric_label', 'reason', 'tradeoff']) string(item[key], key);
    if (!Array.isArray(item.facts) || item.facts.length < 1 || item.facts.length > 6) throw new Error('Indicadores ausentes na análise.');
    item.facts.forEach((fact) => { string(fact.label, 'fact.label'); string(fact.value, 'fact.value'); });
    if (!Array.isArray(item.timeline) || !item.timeline.length || item.timeline.length > 12) throw new Error('A alternativa precisa de uma linha do tempo de até 12 etapas.');
    for (const stage of item.timeline) {
      for (const key of ['id', 'title', 'period', 'description', 'water', 'soil', 'risk']) string(stage[key], `timeline.${key}`);
      if (!Number.isInteger(stage.start_month) || !Number.isInteger(stage.end_month) || stage.start_month < 1 || stage.end_month > 12 || stage.end_month < stage.start_month) {
        throw new Error('A linha do tempo deve usar meses relativos de 1 a 12.');
      }
    }
  }
  return value;
}

export function buildRequest(farm, history) {
  return { schema_version: '1.0', farm: { name: farm.name, boundary: farm.geojson, area_ha: farm.area_ha },
    history: history.map(({ crop, season, notes }) => ({ crop, season, notes })),
    requested_objectives: CATEGORIES, horizon_months: 12 };
}

export async function requestAnalysis(baseUrl, request, { signal, fetcher = fetch } = {}) {
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/analyze`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal,
  });
  if (!response.ok) throw new Error(`A análise não foi concluída (HTTP ${response.status}). Tente novamente.`);
  let value;
  try { value = await response.json(); } catch { throw new Error('A API retornou uma resposta que não é JSON.'); }
  return validateAnalysis(value);
}
