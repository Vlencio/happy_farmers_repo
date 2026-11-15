# Interface em inglês · mensagem para Pedro

Pedro, o front está traduzido para inglês para a apresentação à NASA: telas,
mapa, culturas, glossário, avisos, erros, acessibilidade e estados do chat.
Números usam formato en-US e moeda BRL, sem mudar valores nem converter moeda.
IDs, payloads de análise, foco e histórico do chat continuam no contrato atual.

Falta o idioma da resposta livre da IA, que é responsabilidade do backend:

- `backend/chat.py`, `INSTRUCOES`: termina com “Responda em português do Brasil”.
  Trocar para responder em inglês e alinhar exemplos/nomes de cultura em inglês,
  sem mudar as regras de usar apenas números do motor.
- Traduzir também `RESPOSTA_RECUSADA`. O front reconhece a recusa fixa atual na
  apresentação, mas preserva o texto original reenviado no histórico.
- Se quiser suportar mais idiomas depois, definir e anunciar um campo de idioma
  no contrato primeiro. O front não envia campo novo, nem acrescenta instruções
  escondidas à pergunta do produtor.
- Conferir uma resposta real em inglês com a credencial do servidor. Nesta
  validação local `capabilities.chat` continua falso; o fluxo do chat foi
  exercitado com transporte simulado, sem chamadas ao provedor de IA.

As mensagens conhecidas de fonte/cobertura/erro da API são traduzidas pelo
adaptador `frontend/web/external-text.mjs`. Novos avisos devem ter código
estruturado ou tradução correspondente; mensagens desconhecidas em português
têm explicação genérica em inglês, sem inventar o significado.

Nomes próprios, como Triângulo Mineiro e Conceição das Alagoas, permanecem na
forma original. Campos e notas escritos pelo usuário também são preservados.
