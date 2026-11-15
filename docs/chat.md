# Chat com o produtor (`POST /chat`)

O produtor tira dúvidas sobre a análise que está na tela. O LLM (Claude) só explica a saída do motor: todo número que ele cita vem de `/analyze`. Ele não calcula score, ranking, preço nem probabilidade, e não acrescenta benefícios que o motor não usa.

Código: `backend/chat.py` (contexto e prompt) e `backend/app.py` (rota). Testes: `backend/tests/test_chat.py`, com o cliente do Claude simulado.

## Quando está ligado

`/metadata` traz `capabilities.chat`:

- `true` quando o servidor tem `ANTHROPIC_API_KEY` (ou `ANTHROPIC_AUTH_TOKEN`). `HAPPY_FARMERS_CHAT=1` força o chat ligado com um perfil do `ant auth login`.
- `false` sem credencial. Nesse caso `/chat` responde 503, e a tela deve esconder o chat. Os cards continuam com os textos prontos de `avisos` e `beneficios`.

Modelo: `claude-opus-5-5`, com esforço baixo (é uma conversa curta). `HAPPY_FARMERS_CHAT_MODEL` troca o modelo. Se o modelo recusar a pergunta, a API tenta um modelo de reserva (`fallbacks: "default"`); se todos recusarem, a resposta é um texto fixo com `recusada: true`.

## Entrada

```json
{
  "analise": { "...": "a resposta de /analyze, como a tela recebeu" },
  "foco": ["soja>milho", "soja>crotalaria"],
  "historico": [
    {"papel": "produtor", "texto": "Por que soja e milho?"},
    {"papel": "assistente", "texto": "..."}
  ],
  "pergunta": "E no clima de 2050?"
}
```

| Campo | Regra |
|---|---|
| `analise` | Obrigatório. Precisa ter `entrada` e `sequencias` |
| `foco` | Até 6 ids de `sequencias`: os cards e a rotação atual na tela. Vazio = as três primeiras de hoje e a atual. Id fora da análise = 422 |
| `historico` | Até 20 mensagens de até 16.000 caracteres, começando pelo produtor. O servidor não guarda conversa: a tela manda o histórico a cada pergunta |
| `pergunta` | 1 a 1000 caracteres |

O servidor tira das sequências as séries mês a mês (`meses`) antes de mandar ao modelo; os totais, `avisos` e `beneficios` vão inteiros. Instruções e análise vão no início do prompt e ficam em cache entre as perguntas da mesma conversa.

## Saída

```json
{"resposta": "A soja fixa nitrogênio...", "modelo": "claude-opus-5-5", "recusada": false}
```

`resposta` é texto simples, sem markdown, em português.

## Erros

| Status | Quando |
|---|---|
| 422 | Entrada inválida (pergunta vazia, foco desconhecido, histórico começando pelo assistente) |
| 503 | Chat desligado, sem credencial válida, limite de uso ou falha de rede/servidor do modelo |
| 502 | O modelo rejeitou a requisição (erro 4xx da API do Claude) ou não devolveu texto |

## Dados que saem do servidor

Cada pergunta manda à API da Anthropic a pergunta, o histórico e a parte da análise em foco: coordenadas, histórico de culturas, clima mensal e os números das sequências. O README deve dizer isso.

## Integração da tela

O painel está implementado no front em `web/chat.mjs`, `web/main.mjs` e na UI Rune.
Aparece nos resultados e no detalhe somente com a capability booleana `true`.
Envia a análise original, os IDs únicos dos três cards por objetivo e da referência
atual viável, sem substituir pelos primeiros do ranking. Sem estratégia viável,
o envio fica indisponível.

A conversa fica só em memória e é reenviada inteira a cada pergunta. Nova análise,
mudança de área, histórico ou opções limpa a conversa e cancela a resposta pendente.
Trocar entre os detalhes dos cards mantém a conversa da mesma análise. Falha,
cancelamento ou resposta inválida preserva a pergunta para nova tentativa.
O painel permite no máximo dez pares de pergunta/resposta e oferece “Nova conversa”;
não corta o histórico silenciosamente. Texto é exibido sem interpretar HTML ou Markdown.

Validação do front: 13 testes de cliente/sessão e 38 verificações no navegador,
sendo 33 com respostas de chat simuladas. Foco, histórico, cancelamento, erros,
limites e tela móvel simulada foram conferidos. A API local sem credencial anuncia
`chat: false`; nenhuma resposta real da Anthropic foi validada nessa rodada.

## O que falta

- Testar uma resposta da Anthropic real: os testes do provedor usam um cliente simulado.
- Front (Gabriel): subir `MAX_CHAT_MESSAGE` em `web/chat.mjs` de 4.000 para 16.000.
  O servidor já aceita mensagens de até 16.000 caracteres no histórico e responde 502
  quando o modelo não devolve texto.
- Perguntas do tipo "e se eu plantar X?" ficam fora: exigiriam o motor como ferramenta do LLM.
