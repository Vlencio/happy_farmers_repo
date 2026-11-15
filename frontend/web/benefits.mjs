const number = (value, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const SCENARIOS = { hoje: 'clima de hoje', futuro: 'clima futuro', seco: 'ano seco' };
const CODES = ['fixa_nitrogenio', 'bonus_apos_fixadora', 'deixa_palhada', 'pouco_solo_exposto', 'estavel_no_futuro', 'clima_favoravel'];
const invalid = (path) => { throw new Error(`Resposta incompatível com o contrato do motor: beneficios.${path}.`); };
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

// Validate supplied benefits; deciding whether a sequence earns one stays in the engine.
export function validateSequenceBenefits(seq, scenarios) {
  if (!Object.hasOwn(seq, 'beneficios')) return false;
  if (!Array.isArray(seq.beneficios) || seq.beneficios.length > 2000) invalid('lista');
  for (const [i, benefit] of seq.beneficios.entries()) {
    const path = String(i);
    if (!object(benefit)) invalid(path);
    string(benefit.codigo, `${path}.codigo`, 100);
    string(benefit.texto, `${path}.texto`);
    if (benefit.cultura !== null && !seq.culturas.includes(benefit.cultura)) invalid(`${path}.cultura`);
    if (benefit.cenario !== null && !scenarios.includes(benefit.cenario)) invalid(`${path}.cenario`);
    if (!object(benefit.dados)) invalid(`${path}.dados`);
    jsonData(benefit.dados, `${path}.dados`);
    if (!CODES.includes(benefit.codigo)) continue;
    const cropRequired = ['fixa_nitrogenio', 'bonus_apos_fixadora', 'deixa_palhada'].includes(benefit.codigo);
    if (cropRequired !== (benefit.cultura !== null)) invalid(`${path}.cultura`);
    if (benefit.cenario !== (benefit.codigo === 'estavel_no_futuro' ? 'futuro' : null)) invalid(`${path}.cenario`);
    const d = benefit.dados;
    const amount = (key, min = 0, max = Infinity) => finite(d[key], `${path}.dados.${key}`, min, max);
    switch (benefit.codigo) {
      case 'bonus_apos_fixadora':
        if (!['safra', 'safrinha'].includes(d.slot)) invalid(`${path}.dados.slot`);
        amount('fator_sequencia');
        if (Object.hasOwn(d, 'dias_apos_anterior')) {
          amount('dias_apos_anterior');
          if (!Number.isInteger(d.dias_apos_anterior)) invalid(`${path}.dados.dias_apos_anterior`);
        }
        break;
      case 'pouco_solo_exposto':
        amount('dias_expostos', 0, 365);
        if (!Number.isInteger(d.dias_expostos)) invalid(`${path}.dados.dias_expostos`);
        amount('chuva_exposta_mm'); break;
      case 'estavel_no_futuro':
        amount('queda', -Infinity, 1); amount('receita_hoje'); amount('receita_futuro'); break;
      case 'clima_favoravel': amount('menor_fator', 0, 1); break;
    }
  }
  return true;
}

function readable(value) {
  if (value === null) return 'não informado';
  if (typeof value === 'number') return number(value, 3);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (Array.isArray(value)) return value.map(readable).join(', ');
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${key.replaceAll('_', ' ')}: ${readable(entry)}`).join('; ');
  return value;
}
function present(benefit, cropLabel) {
  const d = benefit.dados;
  const crop = benefit.cultura === null ? null : cropLabel(benefit.cultura);
  const scenario = benefit.codigo === 'clima_favoravel' ? 'clima de hoje e futuro'
    : benefit.cenario === null ? null : SCENARIOS[benefit.cenario];
  const context = [crop || 'Sequência inteira', typeof d.slot === 'string' ? d.slot : null, scenario].filter(Boolean).join(' · ');
  const item = (title, description, evidence, card_summary) => ({ title, context, description, evidence, card_summary });
  switch (benefit.codigo) {
    case 'fixa_nitrogenio':
      return item('Fixação de nitrogênio', 'A tabela classifica esta cultura como fixadora de nitrogênio. O motor usa esse atributo no índice de solo; não é uma medição no talhão.',
        'Fixação de nitrogênio: sim, segundo a tabela de culturas.', `${crop}: fixadora de nitrogênio na tabela do motor.`);
    case 'bonus_apos_fixadora':
      return item('Bônus após adubo verde',
        'Esta cultura não fixadora recebe um bônus após um adubo verde que fixa nitrogênio. A regra atual exige plantio até 60 dias após o fim do ciclo anterior; o prazo e o bônus são provisórios. O fator aplicado também pode incluir desconto por hospedeiro comum de pragas ou doenças.',
        `${d.dias_apos_anterior === undefined ? 'Intervalo entre culturas não informado nesta resposta.' : `Plantio ${d.dias_apos_anterior} dias após o fim do ciclo anterior.`} Fator de sequência aplicado: ${number(d.fator_sequencia, 3)}×.`,
        `${crop} · ${d.slot}: após adubo verde, fator ${number(d.fator_sequencia, 3)}×.`);
    case 'deixa_palhada':
      return item('Cobertura por palhada', 'Segundo a tabela, esta cultura deixa palhada. O motor supõe que ela cobre o solo do fim do ciclo até o próximo plantio, sem medir quantidade ou duração no talhão.',
        'Cobertura do solo: sim, segundo a tabela de culturas.', `${crop}: palhada considerada até o próximo plantio.`);
    case 'pouco_solo_exposto':
      return item('Pouco solo exposto', 'O motor sinaliza um período curto de solo sem cultura e sem palhada nos primeiros 365 dias. A chuva corresponde ao clima de hoje.',
        `${d.dias_expostos} dias expostos; ${number(d.chuva_exposta_mm)} mm de chuva sobre o solo exposto.`, `${d.dias_expostos} dias expostos nos primeiros 365 dias.`);
    case 'estavel_no_futuro': {
      const change = d.queda === 0 ? 'sem variação' : `${d.queda < 0 ? 'alta' : 'queda'} de ${number(Math.abs(d.queda) * 100)}%`;
      return item('Estabilidade de receita no futuro', 'O motor classifica a variação da receita bruta como estável ou em alta entre hoje e o futuro. Não é previsão de preço de venda nem de lucro.',
        `Variação informada: ${change}. Receita hoje: ${money(d.receita_hoje)}/ha; futuro: ${money(d.receita_futuro)}/ha.`, `Receita no futuro: ${change}.`);
    }
    case 'clima_favoravel':
      return item('Fatores favoráveis hoje e no futuro', 'Os fatores de temperatura, chuva, calor e atendimento hídrico das culturas são favoráveis na avaliação mensal de hoje e do futuro. Este benefício não inclui o ano seco nem comprova resistência a eventos extremos.',
        `Menor fator entre as culturas, hoje e no futuro: ${number(d.menor_fator * 100)} / 100.`, `Hoje e futuro: menor fator de clima ou água em ${number(d.menor_fator * 100)} / 100.`);
    default: {
      const evidence = Object.entries(d).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${readable(value)}`).join('; ');
      return item('Outro benefício informado', benefit.texto, evidence || 'Nenhum dado adicional informado.', `${context}: ${benefit.texto}`);
    }
  }
}

export function buildBenefits(seq, cropLabel) {
  if (!validateSequenceBenefits(seq, seq.seco ? ['hoje', 'futuro', 'seco'] : ['hoje', 'futuro'])) return null;
  return {
    items: seq.beneficios.map(benefit => present(benefit, cropLabel)),
    summary: seq.beneficios.length
      ? `${seq.beneficios.length} ${seq.beneficios.length === 1 ? 'benefício apontado' : 'benefícios apontados'} pelo motor.`
      : 'Nenhum benefício sinalizado pelo motor nesta sequência.',
    note: 'Os benefícios descrevem os atributos e cálculos usados pelo motor; não comprovam um resultado no talhão. Considere também os riscos e as lacunas desta estratégia.',
  };
}
