import { englishApiError } from './external-text.mjs';

export const CHAT_TIMEOUT_MS = 300_000;
export const MAX_CHAT_QUESTION = 1000;
export const MAX_CHAT_HISTORY = 20;
export const MAX_CHAT_MESSAGE = 4000;
const length = value => [...value].length;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const serverRefusal = 'Não consigo responder essa pergunta por aqui. Posso explicar os cards, o calendário, os avisos e os benefícios desta análise.';
const englishRefusal = 'I cannot answer that question here. I can explain the cards, calendar, warnings and benefits in this analysis.';

function displayMessage(message) {
  // This fixed server notice is UI copy. Keep the stored message untouched so
  // the next request resends exactly the conversation received from the API.
  return { ...message, texto: message.papel === 'assistente' && message.recusada === true && message.texto === serverRefusal
    ? englishRefusal : message.texto };
}

function questionText(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Enter a question about this analysis.');
  const text = value.trim();
  if (length(text) > MAX_CHAT_QUESTION) throw new Error('Keep your question within 1,000 characters.');
  return text;
}

// Use the three ranked cards visible on screen and the current rotation, without duplicates.
export function buildChatFocus(analysis, view) {
  if (!object(analysis?.entrada) || !Array.isArray(analysis?.sequencias)) throw new Error('Run an analysis before starting a conversation.');
  const strategies = [...(view?.recommendations ?? [])];
  if (view?.current_rotation?.status === 'ready' && view.current_rotation.strategy) strategies.push(view.current_rotation.strategy);
  const ids = [...new Set(strategies.map(strategy => strategy.sequence_id))];
  const valid = new Set(analysis.sequencias.map(sequence => sequence.id));
  if (ids.length > 6 || ids.some(id => typeof id !== 'string' || !valid.has(id))) {
    throw new Error('The chat strategies do not match the current analysis. Run the analysis again.');
  }
  return ids;
}

function validateRequest(request) {
  if (!object(request?.analise?.entrada) || !Array.isArray(request?.analise?.sequencias)) throw new Error('Run an analysis before starting a conversation.');
  const valid = new Set(request.analise.sequencias.map(sequence => sequence.id));
  if (!Array.isArray(request.foco) || !request.foco.length || request.foco.length > 6 ||
    new Set(request.foco).size !== request.foco.length || request.foco.some(id => typeof id !== 'string' || !valid.has(id))) {
    throw new Error('Choose an analysis with valid strategies to start a conversation.');
  }
  if (!Array.isArray(request.historico) || request.historico.length > MAX_CHAT_HISTORY || request.historico.length % 2 !== 0 ||
    request.historico.some((message, i) => message?.papel !== (i % 2 ? 'assistente' : 'produtor') ||
      typeof message.texto !== 'string' || !message.texto.trim() || length(message.texto) > MAX_CHAT_MESSAGE)) {
    throw new Error('This conversation has reached this interface’s conversation history limit. Select New conversation to continue.');
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
    throw new Error(response.ok ? 'The chat returned an invalid response. Try again.' : `Chat unavailable (HTTP ${response.status}). Try again.`);
  }
  if (!response.ok) {
    const detail = typeof value?.detail === 'string' ? value.detail : Array.isArray(value?.detail)
      ? value.detail.filter(item => typeof item?.msg === 'string').map(item => item.msg).join('; ') : '';
    throw new Error(`Chat returned HTTP ${response.status}. ${englishApiError(detail, 'Unable to get a response. Try again.')}`);
  }
  if (!object(value) || typeof value.resposta !== 'string' || !value.resposta.trim() ||
    typeof value.modelo !== 'string' || !value.modelo.trim() || typeof value.recusada !== 'boolean') {
    throw new Error('The chat returned an incompatible response. Try again.');
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
    if (!analysis) return 'Run an analysis to discuss its strategies.';
    if (contextError) return contextError;
    if (!focus.length) return 'Chat requires a viable strategy in this analysis. Review the calendar and analyze again.';
    if (messages.some(message => length(message.texto) > MAX_CHAT_MESSAGE)) {
      return 'The response exceeds this interface’s conversation history limit. It has been kept in full; select New conversation to continue.';
    }
    if (messages.length >= MAX_CHAT_HISTORY) return 'This conversation has reached 10 questions. Select New conversation to continue with the same analysis.';
    return '';
  }
  function state() {
    const limit = limitation();
    return { available, busy, messages: messages.map(displayMessage), pending, error,
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
      abort(); error = ''; notice = 'Response canceled. Your question is still in the input so you can try again.';
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
        error = timedOut ? 'The response took more than 5 minutes. Try again.'
          : failure.name === 'AbortError' ? 'Response canceled. Try again.'
            : englishApiError(failure.message, 'Unable to get a response. Try again.');
        emit();
      } finally {
        if (token === generation) { clearTimeout(timer); timer = undefined; controller = undefined; }
      }
    },
  };
}
