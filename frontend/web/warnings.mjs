const number = (value, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const percent = (value) => `${number(value * 100)}%`;
const SCENARIOS = { hoje: 'clima de hoje', futuro: 'clima futuro', seco: 'ano seco' };
const FACTORS = { temperatura: 'temperatura', chuva: 'chuva', calor: 'calor', agua: 'atendimento hídrico' };
const TYPES = {
  fator_limitante: 'risco', queda_no_futuro: 'risco', queda_no_ano_ruim: 'risco',
  repete_a_cultura: 'risco', solo_exposto: 'risco', sem_historico: 'lacuna',
  sem_limiar_de_calor: 'lacuna', limiar_de_calor_pouco_confiavel: 'lacuna',
  sem_valor_de_mercado: 'lacuna', ky_padrao: 'lacuna', valor_a_conferir: 'lacuna',
  hospedeiro_comum: 'risco', fator_agua_diario: 'risco', rank_varia_entre_modelos: 'risco',
};
const FIELDS = { preco: 'Preço', temp_calor_c: 'Limiar de calor', produtividade: 'Produtividade da safra',
  produtividade_safrinha: 'Produtividade da safrinha', ky: 'Resposta à falta de água (Ky)' };
const STATUSES = { memoria: 'memória', 'sem fonte': 'sem fonte' };
const invalid = (path) => { throw new Error(`Resposta incompatível com o contrato do motor: avisos.${path}.`); };
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
function string(value, path, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(path);
}
function finite(value, path, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(path);
}
function jsonData(value, path, depth = 0) {
  if (depth > 5) invalid(path);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') return finite(value, path);
  if (typeof value === 'string') { if (value.length > 2000) invalid(path); return; }
  if (!value || typeof value !== 'object' || Object.keys(value).length > 100) invalid(path);
  for (const [key, entry] of Object.entries(value)) jsonData(entry, `${path}.${key}`, depth + 1);
}

// Validate the delivered evidence, without recreating the engine's warning thresholds.
export function validateSequenceWarnings(seq, scenarios) {
  if (!Object.hasOwn(seq, 'avisos')) return false;
  if (!Array.isArray(seq.avisos) || seq.avisos.length > 2000) invalid('lista');
  for (const [i, warning] of seq.avisos.entries()) {
    const path = String(i);
    if (!object(warning)) invalid(path);
    if (!['risco', 'lacuna'].includes(warning.tipo)) invalid(`${path}.tipo`);
    string(warning.codigo, `${path}.codigo`, 100);
    string(warning.texto, `${path}.texto`);
    if (warning.cultura !== null && !seq.culturas.includes(warning.cultura)) invalid(`${path}.cultura`);
    if (warning.cenario !== null && !scenarios.includes(warning.cenario)) invalid(`${path}.cenario`);
    if (!object(warning.dados)) invalid(`${path}.dados`);
    jsonData(warning.dados, `${path}.dados`);
    const type = Object.hasOwn(TYPES, warning.codigo) ? TYPES[warning.codigo] : null;
    if (!type) continue; // Future codes remain visible through their supplied text and data.
    if (warning.tipo !== type) invalid(`${path}.tipo`);
    const d = warning.dados;
    const amount = (key, min = 0, max = Infinity) => finite(d[key], `${path}.dados.${key}`, min, max);
    const needsCrop = ['fator_limitante', 'fator_agua_diario', 'repete_a_cultura', 'hospedeiro_comum', 'sem_limiar_de_calor',
      'limiar_de_calor_pouco_confiavel', 'sem_valor_de_mercado', 'ky_padrao', 'valor_a_conferir'].includes(warning.codigo);
    if (needsCrop !== (warning.cultura !== null)) invalid(`${path}.cultura`);
    const needsScenario = ['fator_limitante', 'fator_agua_diario', 'queda_no_futuro', 'queda_no_ano_ruim', 'rank_varia_entre_modelos'].includes(warning.codigo);
    if (needsScenario !== (warning.cenario !== null)) invalid(`${path}.cenario`);
    if (['fator_limitante', 'fator_agua_diario', 'repete_a_cultura', 'hospedeiro_comum'].includes(warning.codigo) && !['safra', 'safrinha'].includes(d.slot)) invalid(`${path}.dados.slot`);
    switch (warning.codigo) {
      case 'fator_limitante':
        if (!Object.hasOwn(FACTORS, d.fator)) invalid(`${path}.dados.fator`);
        amount('valor', 0, 1); break;
      case 'fator_agua_diario':
        amount('fator_agua', 0, 1); amount('atendimento_hidrico', 0, 1); amount('ky'); break;
      case 'hospedeiro_comum':
        amount('penalidade', 0, 1); amount('fator_sequencia');
        string(d.anterior, `${path}.dados.anterior`, 100);
        if (!Array.isArray(d.pragas) || !d.pragas.length) invalid(`${path}.dados.pragas`);
        for (const [index, pest] of d.pragas.entries()) string(pest, `${path}.dados.pragas.${index}`);
        break;
      case 'rank_varia_entre_modelos': {
        if (warning.cenario !== 'futuro') invalid(`${path}.cenario`);
        amount('rank_min', 1); amount('rank_max', d.rank_min); amount('limite');
        for (const key of ['rank_min', 'rank_max', 'limite']) {
          if (!Number.isInteger(d[key])) invalid(`${path}.dados.${key}`);
        }
        if (!object(d.por_modelo) || !Object.keys(d.por_modelo).length) invalid(`${path}.dados.por_modelo`);
        for (const [model, rank] of Object.entries(d.por_modelo)) {
          string(model, `${path}.dados.por_modelo`, 100);
          finite(rank, `${path}.dados.por_modelo.${model}`, d.rank_min, d.rank_max);
          if (!Number.isInteger(rank)) invalid(`${path}.dados.por_modelo.${model}`);
        }
        break;
      }
      case 'queda_no_futuro':
        if (warning.cenario !== 'futuro') invalid(`${path}.cenario`);
        amount('queda', 0, 1); amount('receita_hoje'); amount('receita_futuro'); break;
      case 'queda_no_ano_ruim':
        amount('queda', 0, 1); amount('receita_mediano'); amount('receita_ruim'); break;
      case 'repete_a_cultura': amount('fator_sequencia', 0, 1); break;
      case 'solo_exposto':
        amount('dias_expostos', 0, 365);
        if (!Number.isInteger(d.dias_expostos)) invalid(`${path}.dados.dias_expostos`);
        amount('chuva_exposta_mm'); break;
      case 'limiar_de_calor_pouco_confiavel': amount('temp_calor_c', -Infinity); break;
      case 'ky_padrao': amount('ky'); break;
      case 'valor_a_conferir':
        string(d.campo, `${path}.dados.campo`, 100); string(d.status, `${path}.dados.status`, 200);
        if (!Object.hasOwn(d, 'valor')) invalid(`${path}.dados.valor`);
        // Unknown field names and null values are valid in the extensible status contract.
        if (d.valor !== null && ['preco', 'temp_calor_c', 'produtividade', 'produtividade_safrinha', 'ky'].includes(d.campo)) {
          amount('valor', d.campo === 'temp_calor_c' ? -Infinity : 0);
        }
        break;
    }
  }
  return true;
}

function fieldLabel(field) {
  return Object.hasOwn(FIELDS, field) ? FIELDS[field] : field.replaceAll('_', ' ');
}
function fieldValue(field, value) {
  if (value === null) return 'não informado';
  if (typeof value !== 'number') return readable(value);
  if (field === 'preco') return `${money(value)}/t`;
  if (field === 'temp_calor_c') return `${number(value)} °C`;
  if (['produtividade', 'produtividade_safrinha'].includes(field)) return `${number(value)} t/ha`;
  return number(value, 3);
}
function readable(value) {
  if (value === null) return 'não informado';
  if (typeof value === 'number') return number(value, 3);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (Array.isArray(value)) return value.map(readable).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${fieldLabel(key)}: ${readable(entry)}`).join('; ');
  return value;
}

function present(warning, cropLabel) {
  const d = warning.dados;
  const crop = warning.cultura === null ? null : cropLabel(warning.cultura);
  const scenario = warning.cenario === null ? null : SCENARIOS[warning.cenario];
  const context = [crop || 'Sequência inteira', typeof d.slot === 'string' ? d.slot : null, scenario,
    warning.codigo === 'fator_agua_diario' ? 'modo diário · ano mediano' : null].filter(Boolean).join(' · ');
  const item = (title, description, evidence, card_summary) => ({ title, context, description, evidence, card_summary });
  switch (warning.codigo) {
    case 'fator_limitante': {
      const factor = FACTORS[d.fator];
      return item(`Limitação por ${factor}`,
        `É o menor fator entre temperatura, chuva, calor e atendimento hídrico desta cultura. Este aviso usa a avaliação mensal.`,
        `Fator de ${factor}: ${number(d.valor * 100)} / 100.`,
        `${crop} · ${scenario}: ${factor} em ${number(d.valor * 100)} / 100.`);
    }
    case 'queda_no_futuro':
      return item('Queda de receita no futuro', 'A receita bruta estimada para a sequência diminui do clima de hoje para o futuro. Custos de produção não entram na comparação.',
        `Queda: ${percent(d.queda)}. Receita hoje: ${money(d.receita_hoje)}/ha; futuro: ${money(d.receita_futuro)}/ha.`,
        `Receita no futuro ${percent(d.queda)} menor.`);
    case 'queda_no_ano_ruim':
      return item('Queda de receita no ano ruim', 'Comparação do modo diário entre o ano mediano e o ano ruim informado pelo motor. Esse ano ruim não é o cenário fixo de ano seco.',
        `Queda: ${percent(d.queda)}. Ano mediano: ${money(d.receita_mediano)}/ha; ano ruim: ${money(d.receita_ruim)}/ha.`,
        `${scenario}: receita ${percent(d.queda)} menor no ano ruim.`);
    case 'repete_a_cultura':
      return item('Repetição de cultura', 'A cultura repete a anterior. O motor aplica uma penalidade provisória associada a pragas e doenças; a ocorrência local não foi medida.',
        `Fator de sequência aplicado: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} · ${d.slot}: repetição, fator ${number(d.fator_sequencia, 3)}×.`);
    case 'hospedeiro_comum':
      return item('Praga ou doença em comum com a cultura anterior',
        `Esta cultura e ${cropLabel(d.anterior)} são hospedeiras de pragas ou doenças em comum consideradas pelo motor. A penalidade é provisória; não indica uma ocorrência medida no talhão. O fator de sequência também pode incluir um bônus após adubo verde.`,
        `Cultura anterior: ${cropLabel(d.anterior)}. Pragas ou doenças: ${d.pragas.join('; ')}. Fator por hospedeiro comum: ${number(d.penalidade, 3)}×; fator de sequência aplicado: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} após ${cropLabel(d.anterior)}: praga ou doença em comum; fator ${number(d.penalidade, 3)}×.`);
    case 'fator_agua_diario':
      return item('Limitação por água no modo diário',
        'No ano mediano do modo diário, a falta de água reduz a produtividade pelo fator informado. O cálculo considera Ky, a sensibilidade da cultura à falta de água. Esta avaliação é diferente do balanço mensal.',
        `Fator por falta de água: ${number(d.fator_agua * 100)} / 100. Atendimento hídrico: ${number(d.atendimento_hidrico * 100)} / 100. Ky: ${number(d.ky, 3)}.`,
        `${crop} · ${scenario}, modo diário: fator por falta de água em ${number(d.fator_agua * 100)} / 100 no ano mediano.`);
    case 'rank_varia_entre_modelos':
      return item('Posição varia entre modelos climáticos',
        'A posição desta sequência no futuro muda conforme o modelo climático. A faixa compara os modelos disponíveis; não é um intervalo de confiança nem uma probabilidade.',
        `Posição no futuro: ${d.rank_min}ª a ${d.rank_max}ª. ${Object.entries(d.por_modelo).map(([model, rank]) => `${model}: ${rank}ª`).join('; ')}. Limite de variação usado no aviso: ${d.limite} posições.`,
        `No futuro, posição de ${d.rank_min}ª a ${d.rank_max}ª entre modelos.`);
    case 'solo_exposto':
      return item('Solo exposto', 'Dias sem cultura em pé e sem palhada nos primeiros 365 dias. A chuva corresponde ao clima de hoje.',
        `${d.dias_expostos} dias expostos; ${number(d.chuva_exposta_mm)} mm de chuva sobre o solo exposto.`,
        `${d.dias_expostos} dias expostos, com ${number(d.chuva_exposta_mm)} mm de chuva hoje.`);
    case 'sem_historico':
      return item('Histórico não informado', 'Sem histórico, a primeira cultura não recebe a penalidade por repetição, a de hospedeiro comum de pragas ou doenças, nem o bônus após adubo verde que fixa nitrogênio.',
        'Histórico de plantio ausente nesta análise.', 'Histórico ausente: efeito da cultura anterior não avaliado.');
    case 'sem_limiar_de_calor':
      return item('Limiar de calor ausente', 'O motor não desconta o efeito do calor desta cultura. A ausência de desconto não comprova tolerância ao calor.',
        'Limiar de calor não informado na tabela de culturas.', `${crop}: calor sem limiar para avaliação.`);
    case 'limiar_de_calor_pouco_confiavel':
      return item('Limiar de calor pouco confiável', 'O motor sinaliza menor confiança na contagem de dias quentes acima deste limiar, devido à diferença entre POWER e NEX. O limite precisa de revisão local.',
        `Limiar usado: ${number(d.temp_calor_c)} °C.`, `${crop}: limiar de ${number(d.temp_calor_c)} °C pouco confiável.`);
    case 'sem_valor_de_mercado':
      return item('Valor de mercado não contabilizado', 'Forragem, semente e benefício ao solo não entram na receita desta cultura. Isso não significa que a cultura não tenha valor para a fazenda.',
        `Preço usado: ${money(0)}/t.`, `${crop}: preço zero no cálculo de receita.`);
    case 'ky_padrao':
      return item('Resposta à falta de água sem valor específico', 'No modo diário, o motor usa um valor padrão de Ky (sensibilidade da produtividade à falta de água), pois não há valor específico desta cultura na tabela da FAO.',
        `Ky usado: ${number(d.ky, 3)}.`, `${crop}: Ky padrão de ${number(d.ky, 3)}.`);
    case 'valor_a_conferir': {
      const field = fieldLabel(d.campo);
      const status = Object.hasOwn(STATUSES, d.status) ? STATUSES[d.status] : d.status;
      const value = fieldValue(d.campo, d.valor);
      return item(`${field} a conferir`, 'O valor está marcado para conferência na tabela de culturas. Confira a fonte e a adequação às condições locais.',
        `${field}: ${value}. Situação: ${status}.`, `${crop}: ${field.toLowerCase()} ${value} a conferir (${status}).`);
    }
    default: {
      const evidence = Object.entries(d).map(([key, value]) => `${fieldLabel(key)}: ${readable(value)}`).join('; ');
      return item(warning.tipo === 'risco' ? 'Outro risco informado' : 'Outra lacuna informada', warning.texto,
        evidence || 'Nenhum dado adicional informado.', `${context}: ${warning.texto}`);
    }
  }
}

export function buildWarnings(seq, cropLabel) {
  if (!validateSequenceWarnings(seq, seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'])) return null;
  const risks = [], gaps = [];
  for (const warning of seq.avisos) (warning.tipo === 'risco' ? risks : gaps).push(present(warning, cropLabel));
  return {
    risks, gaps,
    summary: seq.avisos.length
      ? `${risks.length} ${risks.length === 1 ? 'risco sinalizado' : 'riscos sinalizados'} e ${gaps.length} ${gaps.length === 1 ? 'lacuna de informação' : 'lacunas de informação'}.`
      : 'Nenhum aviso sinalizado pelo motor nesta sequência.',
    note: 'Os avisos ajudam na revisão local e não alteram a pontuação nem a ordem das estratégias. A ausência de avisos não garante ausência de risco ou de lacunas nos dados.',
  };
}
