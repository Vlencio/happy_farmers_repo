export const CHAT_TIMEOUT_MS = 300_000;
export const MAX_CHAT_QUESTION = 1000;
export const MAX_CHAT_HISTORY = 20;
export const MAX_CHAT_MESSAGE = 4000;
const length = value => [...value].length;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function questionText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Escreva uma pergunta sobre esta análise.');
  const text = value.trim();
  if (length(text) > MAX_CHAT_QUESTION) throw new Error('Resuma a pergunta em até 1000 caracteres.');
  return text;
}

// These are the objective cards, not the engine's first three ranked sequences.
export function buildChatFocus(analysis, view) {
  if (!object(analysis?.entrada) || !Array.isArray(analysis?.sequencias)) throw new Error('Faça uma análise antes de conversar.');
  const strategies = [...(view?.recommendations ?? [])];
  if (view?.current_rotation?.status === 'ready' && view.current_rotation.strategy) strategies.push(view.current_rotation.strategy);
  const ids = [...new Set(strategies.map(strategy => strategy.sequence_id))];
  const valid = new Set(analysis.sequencias.map(sequence => sequence.id));
  if (ids.length > 6 || ids.some(id => typeof id !== 'string' || !valid.has(id))) {
    throw new Error('As estratégias do chat não correspondem à análise atual. Faça a análise novamente.');
  }
  return ids;
}

function validateRequest(request) {
  if (!object(request?.analise?.entrada) || !Array.isArray(request?.analise?.sequencias)) throw new Error('Faça uma análise antes de conversar.');
  const valid = new Set(request.analise.sequencias.map(sequence => sequence.id));
  if (!Array.isArray(request.foco) || !request.foco.length || request.foco.length > 6 ||
    new Set(request.foco).size !== request.foco.length || request.foco.some(id => typeof id !== 'string' || !valid.has(id))) {
    throw new Error('Escolha uma análise com estratégias válidas para conversar.');
  }
  if (!Array.isArray(request.historico) || request.historico.length > MAX_CHAT_HISTORY || request.historico.length % 2 !== 0 ||
    request.historico.some((message, i) => message?.papel !== (i % 2 ? 'assistente' : 'produtor') ||
      typeof message.texto !== 'string' || !message.texto.trim() || length(message.texto) > MAX_CHAT_MESSAGE)) {
    throw new Error('Esta conversa atingiu o limite aceito pelo servidor. Use Nova conversa para continuar.');
  }
  return { ...request, pergunta: questionText(request.pergunta) };
}

export async function requestChat(baseUrl, request, { signal, fetcher = fetch } = {}) {
  const body = validateRequest(request);
  const response = await fetcher(`${baseUrl.replace(/\/+$/, '')}/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal,
  });
  let value;
  try { value = await response.json(); } catch {
    throw new Error(response.ok ? 'O chat retornou uma resposta inválida. Tente novamente.' : `Chat indisponível (HTTP ${response.status}). Tente novamente.`);
  }
  if (!response.ok) {
    const detail = typeof value?.detail === 'string' ? value.detail : Array.isArray(value?.detail)
      ? value.detail.filter(item => typeof item?.msg === 'string').map(item => item.msg).join('; ') : '';
    throw new Error(`Chat retornou HTTP ${response.status}. ${detail || 'Não foi possível obter a resposta. Tente novamente.'}`);
  }
  if (!object(value) || typeof value.resposta !== 'string' || !value.resposta.trim() ||
    typeof value.modelo !== 'string' || !value.modelo.trim() || typeof value.recusada !== 'boolean') {
    throw new Error('O chat retornou uma resposta incompatível. Tente novamente.');
  }
  // Text is preserved verbatim. The Rune view renders it as text, never HTML/Markdown.
  return value;
}

// This session lives only in memory. The server receives all accepted turns each time.
export function createChatSession({ baseUrl, onChange = () => {}, fetcher = fetch, timeoutMs = CHAT_TIMEOUT_MS }) {
  let available = false, analysis = null, view = null, focus = [], messages = [];
  let busy = false, pending = '', error = '', notice = '', contextError = '';
  let controller, timer, generation = 0;
  function limitation() {
    if (!analysis) return 'Faça uma análise para conversar sobre as estratégias.';
    if (contextError) return contextError;
    if (!focus.length) return 'O chat precisa de uma estratégia viável nesta análise. Revise o calendário e analise novamente.';
    if (messages.some(message => length(message.texto) > MAX_CHAT_MESSAGE)) {
      return 'A resposta excede o tamanho que o servidor aceita no histórico. Ela foi mantida inteira; use Nova conversa para continuar.';
    }
    if (messages.length >= MAX_CHAT_HISTORY) return 'Esta conversa chegou a 10 perguntas. Use Nova conversa para continuar com a mesma análise.';
    return '';
  }
  function state() {
    const limit = limitation();
    return { available, busy, messages: messages.map(message => ({ ...message })), pending, error,
      notice: available ? limit || notice : '', blocked: !available || Boolean(limit) };
  }
  const emit = (clearQuestion = false) => onChange({ type: 'chat', chat: state(), clear_question: clearQuestion });
  function abort() {
    generation++;
    controller?.abort(); controller = undefined;
    clearTimeout(timer); timer = undefined;
    busy = false; pending = '';
  }
  function resetMessages() {
    abort(); messages = []; error = ''; notice = '';
  }
  return {
    getState: state,
    configure(metadata) {
      const next = metadata?.capabilities?.chat === true;
      if (!next) resetMessages();
      available = next;
      emit(!next);
    },
    setAnalysis(raw, mapped) {
      resetMessages(); analysis = raw; view = mapped; contextError = '';
      try { focus = buildChatFocus(analysis, view); }
      catch (failure) { focus = []; contextError = failure.message; }
      emit(true);
    },
    invalidate() {
      resetMessages(); analysis = null; view = null; focus = []; contextError = '';
      emit(true);
    },
    clear() { resetMessages(); emit(true); },
    cancel() {
      if (!busy) return;
      abort(); error = ''; notice = 'Resposta cancelada. Sua pergunta continua no campo para tentar novamente.';
      emit();
    },
    async ask(question) {
      if (busy) return;
      error = ''; notice = '';
      if (!available || limitation()) { emit(); return; }
      let text;
      try { text = questionText(question); }
      catch (failure) { error = failure.message; emit(); return; }
      const token = ++generation;
      const requestController = new AbortController(); controller = requestController;
      busy = true; pending = text;
      let timedOut = false;
      timer = setTimeout(() => { timedOut = true; requestController.abort(); }, timeoutMs);
      emit();
      try {
        const result = await requestChat(baseUrl, {
          analise: analysis, foco: [...focus],
          historico: messages.map(({ papel, texto }) => ({ papel, texto })), pergunta: text,
        }, { signal: requestController.signal, fetcher });
        if (token !== generation) return;
        messages.push({ papel: 'produtor', texto: text, recusada: false },
          { papel: 'assistente', texto: result.resposta, recusada: result.recusada });
        busy = false; pending = '';
        emit(true);
      } catch (failure) {
        if (token !== generation) return;
        busy = false; pending = '';
        error = timedOut ? 'A resposta excedeu 5 minutos. Tente novamente.'
          : failure.name === 'AbortError' ? 'Resposta cancelada. Tente novamente.'
            : failure.message || 'Não foi possível obter a resposta. Tente novamente.';
        emit();
      } finally {
        if (token === generation) { clearTimeout(timer); timer = undefined; controller = undefined; }
      }
    },
  };
}
