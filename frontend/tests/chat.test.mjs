import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapMotorAnalysis } from '../web/api.mjs';
import { buildChatFocus, createChatSession, requestChat } from '../web/chat.mjs';

const raw = JSON.parse(readFileSync(new URL('./fixtures/motor-seco.json', import.meta.url)));
const view = mapMotorAnalysis(raw, { area_ha: 2 });
const reply = (resposta = 'Explicação dos dados do motor.', recusada = false) => ({ resposta, modelo: 'modelo-de-teste', recusada });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const request = () => ({ analise: raw, foco: buildChatFocus(raw, view), historico: [], pergunta: 'Por que esta rotação?' });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function session(fetcher = async () => response(reply()), options = {}) {
  const commands = [];
  const chat = createChatSession({ baseUrl: '/api', fetcher, onChange: command => commands.push(command), ...options });
  chat.configure({ capabilities: { chat: true } });
  chat.setAnalysis(raw, view);
  return { chat, commands };
}

test('focus follows visible ranked cards and viable reference, deduplicating shared sequences', () => {
  assert.equal(view.current_rotation.strategy.sequence_id, view.recommendations[1].sequence_id);
  assert.deepEqual(buildChatFocus(raw, view), ['soja>crotalaria', 'soja>milho', 'soja>sorgo']);
  const distinct = { ...view, current_rotation: { status: 'ready', strategy: { sequence_id: 'soja>feijao' } } };
  assert.deepEqual(buildChatFocus(raw, distinct), ['soja>crotalaria', 'soja>milho', 'soja>sorgo', 'soja>feijao']);
  for (const status of ['discarded', 'no_history', 'unavailable']) {
    assert.deepEqual(buildChatFocus(raw, { ...distinct, current_rotation: { ...distinct.current_rotation, status } }), buildChatFocus(raw, view));
  }
  assert.deepEqual(buildChatFocus(raw, { recommendations: [], current_rotation: { status: 'discarded' } }), []);
  assert.throws(() => buildChatFocus(raw, { recommendations: [{ sequence_id: 'missing' }] }), /do not match/);
  assert.throws(() => buildChatFocus(raw, { recommendations: raw.sequencias.slice(0, 7).map(seq => ({ sequence_id: seq.id })) }), /do not match/);
});

test('transport sends the unmodified engine analysis, explicit focus and plain-text response', async () => {
  const input = request(); input.pergunta = '  E o clima futuro?  ';
  const original = structuredClone(raw);
  const answer = reply('<b>Texto simples</b>\nSem renderização de HTML.');
  const value = await requestChat('/api///', input, { fetcher: async (url, options) => {
    assert.equal(url, '/api/chat');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { ...input, pergunta: 'E o clima futuro?' });
    return response(answer);
  } });
  assert.deepEqual(value, answer);
  assert.deepEqual(raw, original);
});

test('chat requires literal capability true, an analysis and at least one visible sequence', async () => {
  let requests = 0;
  const chat = createChatSession({ baseUrl: '/api', fetcher: async () => { requests++; return response(reply()); } });
  for (const metadata of [null, {}, { capabilities: { chat: false } }, { capabilities: { chat: 'true' } }]) {
    chat.configure(metadata); chat.setAnalysis(raw, view);
    await chat.ask('Pergunta');
    assert.equal(chat.getState().available, false);
    assert.equal(chat.getState().blocked, true);
  }
  chat.configure({ capabilities: { chat: true } });
  chat.invalidate();
  await chat.ask('Pergunta');
  assert.match(chat.getState().notice, /Run an analysis/);
  chat.setAnalysis(raw, { recommendations: [] });
  await chat.ask('Pergunta');
  assert.match(chat.getState().notice, /viable strategy/);
  assert.equal(requests, 0);
  chat.setAnalysis(raw, view);
  await chat.ask('Pergunta');
  assert.equal(requests, 1);
});

test('two turns resend only completed pairs with the same full analysis and visible-card focus', async () => {
  const sent = [];
  const { chat, commands } = session(async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(reply(`Resposta ${sent.length}`));
  });
  await chat.ask('Primeira pergunta');
  await chat.ask('Segunda pergunta');
  assert.deepEqual(sent[0].historico, []);
  assert.deepEqual(sent[1].historico, [
    { papel: 'produtor', texto: 'Primeira pergunta' }, { papel: 'assistente', texto: 'Resposta 1' },
  ]);
  assert.deepEqual(sent[1].analise, raw);
  assert.deepEqual(sent[0].foco, sent[1].foco);
  assert.equal(chat.getState().messages.length, 4);
  assert.equal(chat.getState().pending, '');
  assert.equal(chat.getState().busy, false);
  assert.equal(commands.at(-1).clear_question, true);
  const snapshot = chat.getState(); snapshot.messages[0].texto = 'Mutação externa';
  assert.equal(chat.getState().messages[0].texto, 'Primeira pergunta');
});

test('HTTP failures preserve the question and accepted history without changing analysis', async () => {
  for (const status of [422, 502, 503]) {
    let count = 0;
    const { chat, commands } = session(async () => ++count === 2 ? response({ detail: 'O chat está muito usado agora. Tente de novo em instantes.' }, status) : response(reply()));
    await chat.ask('Pergunta aceita');
    await chat.ask('Pergunta para tentar novamente');
    assert.equal(chat.getState().messages.length, 2);
    assert.equal(chat.getState().blocked, false);
    assert.match(chat.getState().error, new RegExp(`HTTP ${status}.*Chat is busy right now`));
    assert.doesNotMatch(chat.getState().error, /muito usado|instantes/);
    assert.equal(commands.at(-1).clear_question, false);
    await chat.ask('Pergunta para tentar novamente');
    assert.equal(chat.getState().messages.length, 4);
    assert.equal(chat.getState().error, '');
  }
});

test('invalid questions are local, unicode counts use code points, and invalid payloads never send', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return response(reply()); };
  for (const pergunta of ['', '   ', 'a'.repeat(1001), null]) {
    await assert.rejects(requestChat('/api', { ...request(), pergunta }, { fetcher }));
  }
  for (const change of [
    { foco: [] }, { foco: ['missing'] }, { foco: ['soja>milho', 'soja>milho'] },
    { historico: [{ papel: 'assistente', texto: 'Sem produtor' }] },
    { historico: [{ papel: 'produtor', texto: 'a' }, { papel: 'assistente', texto: 'b'.repeat(4001) }] },
    { historico: Array.from({ length: 22 }, (_, i) => ({ papel: i % 2 ? 'assistente' : 'produtor', texto: 'x' })) },
  ]) await assert.rejects(requestChat('/api', { ...request(), ...change }, { fetcher }));
  assert.equal(calls, 0);
  await requestChat('/api', { ...request(), pergunta: '🌱'.repeat(1000) }, { fetcher });
  assert.equal(calls, 1);
  const { chat, commands } = session(fetcher);
  await chat.ask(' ');
  assert.match(chat.getState().error, /Enter a question/);
  assert.equal(commands.at(-1).clear_question, false);
  assert.equal(calls, 1);
});

test('bad JSON, malformed output and network failure remain chat-only errors', async () => {
  const fetchers = [
    async () => new Response('not json'),
    async () => response({ resposta: '', modelo: 'x', recusada: false }),
    async () => response({ resposta: 'x', modelo: 'x', recusada: 'false' }),
    async () => response({ resposta: 'x', recusada: false }),
    async () => { throw new TypeError('Falha de conexão'); },
  ];
  for (const fetcher of fetchers) {
    const { chat, commands } = session(fetcher);
    await chat.ask('Pergunta');
    assert.ok(chat.getState().error);
    assert.equal(chat.getState().messages.length, 0);
    assert.equal(chat.getState().blocked, false);
    assert.equal(commands.at(-1).clear_question, false);
    assert.ok(commands.every(command => command.type === 'chat'));
  }
});

test('refusal is preserved as an assistant response and included in the next history', async () => {
  const sent = [];
  const { chat } = session(async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(reply('Posso explicar somente esta análise.', true));
  });
  await chat.ask('Outra recomendação?');
  assert.equal(chat.getState().messages[1].recusada, true);
  assert.equal(chat.getState().messages[1].texto, 'Posso explicar somente esta análise.');
  await chat.ask('Então explique estes dados.');
  assert.equal(sent[1].historico[1].texto, 'Posso explicar somente esta análise.');
  assert.deepEqual(Object.keys(sent[1].historico[1]).sort(), ['papel', 'texto']);
});

test('only the exact fixed server refusal is translated for display while history stays verbatim', async () => {
  const original = 'Não consigo responder essa pergunta por aqui. Posso explicar os cards, o calendário, os avisos e os benefícios desta análise.';
  const translated = 'I cannot answer that question here. I can explain the cards, calendar, warnings and benefits in this analysis.';
  const sent = [];
  const { chat } = session(async (_, options) => {
    sent.push(JSON.parse(options.body));
    return response(reply(original, sent.length === 1));
  });
  await chat.ask(original);
  assert.equal(chat.getState().messages[0].texto, original, 'user-authored text is never translated');
  assert.equal(chat.getState().messages[1].texto, translated);
  await chat.ask('Explain these cards.');
  assert.deepEqual(sent[1].historico, [
    { papel: 'produtor', texto: original }, { papel: 'assistente', texto: original },
  ]);
  assert.equal(chat.getState().messages[3].texto, original, 'a normal assistant answer is preserved');
  const wire = reply(original, true);
  assert.deepEqual(await requestChat('/api', request(), { fetcher: async () => response(wire) }), wire);
});

test('duplicate sends are ignored and cancel discards late answers while keeping input', async () => {
  const waiting = deferred(); let requests = 0, signal;
  const { chat, commands } = session(async (_, options) => { requests++; signal = options.signal; return waiting.promise; });
  const pending = chat.ask('Pergunta pendente');
  assert.equal(chat.getState().pending, 'Pergunta pendente');
  assert.equal(chat.getState().busy, true);
  await chat.ask('Clique duplicado');
  assert.equal(requests, 1);
  chat.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(commands.at(-1).clear_question, false);
  waiting.resolve(response(reply('Resposta atrasada')));
  await pending;
  assert.equal(chat.getState().messages.length, 0);
  assert.equal(chat.getState().busy, false);
  assert.match(chat.getState().notice, /canceled/);
});

test('new analyses, field changes, cleared conversation and capability removal abort stale requests', async () => {
  for (const reset of [
    chat => chat.setAnalysis(raw, view),
    chat => chat.invalidate(),
    chat => chat.clear(),
    chat => chat.configure({ capabilities: { chat: false } }),
  ]) {
    const waiting = deferred(); let signal;
    const { chat, commands } = session(async (_, options) => { signal = options.signal; return waiting.promise; });
    const pending = chat.ask('Pergunta da análise antiga');
    reset(chat);
    assert.equal(signal.aborted, true);
    assert.equal(commands.at(-1).clear_question, true);
    waiting.resolve(response(reply('Resposta da análise antiga')));
    await pending;
    assert.equal(chat.getState().messages.length, 0);
    assert.equal(chat.getState().pending, '');
    assert.equal(chat.getState().error, '');
  }
});

test('timeout aborts transport, reports an actionable message and preserves input', async () => {
  const { chat, commands } = session(async (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }), { timeoutMs: 5 });
  await chat.ask('Pergunta');
  assert.match(chat.getState().error, /more than 5 minutes/);
  assert.equal(chat.getState().busy, false);
  assert.equal(chat.getState().messages.length, 0);
  assert.equal(commands.at(-1).clear_question, false);
});

test('ten completed turns retain every message and require explicit new conversation', async () => {
  const sent = [];
  const { chat } = session(async (_, options) => { sent.push(JSON.parse(options.body)); return response(reply()); });
  for (let i = 0; i < 10; i++) await chat.ask(`Pergunta ${i + 1}`);
  assert.deepEqual(sent.map(item => item.historico.length), [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  assert.equal(chat.getState().messages.length, 20);
  assert.equal(chat.getState().blocked, true);
  assert.match(chat.getState().notice, /10 questions.*New conversation/);
  await chat.ask('Décima primeira');
  assert.equal(sent.length, 10);
  chat.clear();
  assert.equal(chat.getState().blocked, false);
  await chat.ask('Nova pergunta');
  assert.deepEqual(sent.at(-1).historico, []);
  assert.deepEqual(sent.at(-1).analise, raw);
});

test('an answer beyond the interface history limit is shown whole and not silently truncated', async () => {
  const long = '🌱'.repeat(4001); let requests = 0;
  const { chat } = session(async () => { requests++; return response(reply(long)); });
  await chat.ask('Pergunta');
  assert.equal(chat.getState().messages[1].texto, long);
  assert.equal(chat.getState().blocked, true);
  assert.match(chat.getState().notice, /this interface’s conversation history limit/);
  assert.match(chat.getState().notice, /kept in full.*New conversation/);
  await chat.ask('Continuação');
  assert.equal(requests, 1);
});
