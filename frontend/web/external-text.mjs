// Translate the current server's presentation strings at the front-end boundary.
// Never apply this to user-authored names, notes, questions or chat history.
const notices = new Map([
  ['Talhão de demonstração', 'Demonstration field'],
  ['POWER fora do ar.', 'POWER is unavailable.'],
  ['O ponto do talhão está fora de Minas Gerais.', 'The field point is outside Minas Gerais.'],
  ['Ponto fora da cobertura da grade de Minas Gerais.', 'Point outside the Minas Gerais grid coverage.'],
  ['GLDAS · NASA, grade 0,25°', 'GLDAS · NASA, 0.25° grid'],
  ['Clima de hoje: POWER 2005–2024; futuro: por volta de 2060, com deltas regionais.', 'Today’s climate: POWER 2005–2024; future: around 2060, using regional changes.'],
  ['Perto do talhão de demonstração usamos tabelas prontas. Confira os avisos de origem no resultado.', 'Near the demonstration field, we use prepared climate tables. Check the source notices in the results.'],
  ['O calendário de plantio é do Triângulo Mineiro; valide a adequação local.', 'The planting calendar is for the Triângulo Mineiro region; check local suitability.'],
  ['O ponto do talhão está fora de Minas Gerais na malha simplificada do IBGE.', 'The field point is outside Minas Gerais according to the simplified IBGE boundary.'],
  ['O calendário de culturas é do Triângulo Mineiro; este resultado é exploratório.', 'The crop calendar is for the Triângulo Mineiro region; this result is exploratory.'],
  ['Este ponto está a até 25 km do talhão de demonstração. Usamos o clima desse talhão, com a correção da estação A520, sem nova consulta ao POWER.', 'This point is within 25 km of the demonstration field. We use that field’s climate with the A520 station correction, without a new POWER request.'],
  ['POWER do ponto e projeção NEX-GDDP regional, sem correção da estação A520.', 'POWER data for this point and regional NEX-GDDP projections, without the A520 station correction.'],
  ['Os meses de plantio ainda são os do Triângulo Mineiro; valide a adequação local.', 'Planting months still follow the Triângulo Mineiro calendar; check local suitability.'],
  ['No norte da grade, há extremos de chuva conhecidos nos dados NEX-GDDP que podem afetar a receita futura e a ordem de opções próximas.', 'In the northern part of the grid, known rainfall extremes in NEX-GDDP data may affect future revenue and the order of closely ranked options.'],
  ['NDVI: MOD13Q1, 250 m, série 2014–2024; relevo: SRTM, 30 m; clima: POWER e correção local da INMET A520. Escopo: um talhão. As resoluções são diferentes.', 'NDVI: MOD13Q1, 250 m, 2014–2024 series; terrain: SRTM, 30 m; climate: POWER with a local INMET A520 correction. Scope: one field. The sources have different resolutions.'],
  ['Sugestão regional por célula de 0,25°; confirme com o que você conhece do talhão.', 'Regional suggestion from a 0.25° grid cell; confirm it using your knowledge of the field.'],
  ['GLDAS2/Noah (NASA LDAS), 0,25 grau.', 'GLDAS2/Noah (NASA LDAS), 0.25° grid.'],
  ['GLDAS2/Noah (NASA), camada 0–30 cm, grade de 0,25°. Sugestão regional.', 'GLDAS2/Noah (NASA), 0–30 cm layer, 0.25° grid. Regional suggestion.'],
]);

const errors = new Map([
  ['Envie lat e lon juntos para a sugestão de solo.', 'Provide both latitude and longitude for the soil suggestion.'],
  ['Não foi possível ler os dados climáticos. Tente novamente.', 'Unable to read the climate data. Please try again.'],
  ['O chat não está disponível neste servidor.', 'Chat is not available on this server.'],
  ['O modelo não devolveu resposta. Tente de novo.', 'The AI did not return a response. Please try again.'],
  ['O chat está muito usado agora. Tente de novo em instantes.', 'Chat is busy right now. Please try again shortly.'],
  ['O chat está sem credencial válida neste servidor.', 'Chat is not configured with valid credentials on this server.'],
  ['Não foi possível falar com o modelo. Tente de novo.', 'Unable to reach the AI service. Please try again.'],
  ['O modelo recusou a requisição do chat.', 'The AI service rejected the chat request.'],
  ['O histórico começa por uma mensagem do produtor.', 'Chat history must start with a user message.'],
  ["A análise precisa ter 'entrada' e 'sequencias', como sai de /analyze.", 'Chat needs a valid analysis. Run the analysis again before asking a question.'],
  ['O ponto do talhão está fora da cobertura climática disponível para Minas Gerais e entorno. Selecione uma área dentro da cobertura ou use o talhão de demonstração.', 'The field point is outside the available climate coverage for Minas Gerais and nearby areas. Select an area within coverage or use the demonstration field.'],
]);

const portuguese = /\b(talh[aã]o|n[aã]o|clima|dados|chuva|plantio|calend[aá]rio|dispon[ií]vel|origem|aviso|inv[aá]lid[oa]s?|sequ[eê]ncias?|cultura[s]?|resposta|consulta|regi[aã]o|corre[cç][aã]o|sugest[aã]o|área|m[eê]s|limite|proje[cç][aã]o|est[aá]|fora|usando|sem|conex[aã]o|an[aá]lise|escreva|resuma|falha|tente|cobertura|esgotado)\b/i;
export function englishSourceNotice(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let text = value.trim();
  for (const [pt, en] of notices) text = text.replaceAll(pt, en);
  // Distances are supplied by the server, never recalculated here. Internal
  // diagnostic text may itself be untranslated, so the fallback names its cause.
  text = text.replace(/Sem clima do POWER para este ponto \([\s\S]*?\)\. Usando as tabelas do talhao de demonstracao, a (\d+) km\./g,
    'POWER climate data is unavailable for this point. Using demonstration-field tables from $1 km away.');
  text = text.replace(/A mudanca do clima \(([^)]+)\) e a do talhao de demonstracao, a (\d+) km, aplicada ao clima de hoje deste ponto\./g,
    'The climate change for $1 comes from the demonstration field, $2 km away, and is applied to this point’s current climate.');
  return portuguese.test(text)
    ? 'The server supplied an additional data-source notice without an English translation. Check the data coverage and source before relying on this result.'
    : text;
}

export function englishApiError(detail, fallback = 'The server could not complete this request.') {
  if (Array.isArray(detail)) return 'The request contains invalid values. Check your field, crop history and scenario settings.';
  if (typeof detail !== 'string' || !detail.trim()) return fallback;
  const text = detail.trim();
  if (errors.has(text)) return errors.get(text);
  if (/^Culturas fora da tabela:/.test(text)) return 'One or more crops are not supported by this server. Check your crop history.';
  if (/^Sequências fora da análise:/.test(text)) return 'Some selected rotations are missing from this analysis. Run the analysis again.';
  return portuguese.test(text) ? fallback : text;
}
