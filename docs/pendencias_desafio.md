# Pendências contra o texto do desafio

> Escrito em 14/11/2026, a partir do texto oficial do desafio "Field Shift" colado pelo Pedro. Compara o texto com o código da `main` em `56a0bab` mais a branch `motor-diario` (modo diário e Ky, ainda sem commit). A lista de recursos do desafio ("Resources") não foi consultada.

Este arquivo lista só o que **falta** ou está **incompleto**. O que já atende não aparece. A ideia é atacar uma parte de cada vez e marcar aqui.

O texto do desafio usa "may" em todos os itens: nada é obrigatório. A decisão de atender tudo é do time.

## Como ler

- **Falta:** não existe no motor, na API nem na tela.
- **Incompleto:** existe em parte, ou existe no motor e não chega à tela.
- **Dono:** Pedro (motor), Gabriel (tela e API), Brenno (dados). Mudança na área de outro passa pelo dono.
- **Dado novo:** precisa baixar algo que não está no repositório. Os scripts de download só rodam com o aval de quem cuida dos dados.
- **Reabre escopo:** o item está em "Out of scope" no `CLAUDE.md` ou foi fechado pelo time em 14/11. Precisa dos três.

## Resumo

| Parte | Assunto | Situação | Dono | Dado novo | Reabre escopo |
|---|---|---|---|---|---|
| 1 | Rotação atual como estratégia comparada | Motor feito; falta a tela | Gabriel | Não | Não |
| 2 | Solo descoberto e erosão por sequência | Motor, API e tela feitos; índice real conferido na demonstração | Gabriel | Não na demonstração | Não |
| 3 | Lacunas e riscos por estratégia | Avisos e benefícios na tela; faltam status de origem | Brenno | Não | Não |
| 4 | Geada e chuva extrema | Motor feito (modo diário); faltam API e tela (Parte 8) | Pedro, Gabriel | Não | Não |
| 5 | Prioridades e restrições do agricultor | Prioridades e ranking integrados na tela; restrições em aberto | Pedro, Gabriel | Não | Reaberto (15/11) |
| 6 | Controles de cenário | Motor, API e front feitos; falta testar a tela contra a API real | Gabriel | Não | Não |
| 7 | Incerteza entre os modelos climáticos | Motor, API e tela integrados na demonstração; falta faixa regional | Brenno, Pedro, Gabriel | Não na demonstração | Não |
| 8 | Modo diário na API e na tela | Incompleto | Gabriel, Brenno | Não | Sim (probabilidades) |
| 9 | Informação local de solo | Textura GLDAS sugerida por ponto, API e seletor integrados; produtor pode trocar | Brenno, Gabriel | GLDAS entregue | Não |
| 10 | Atributos de cultura que faltam | Falta | Brenno, Pedro | Fontes a levantar | Não |
| 11 | Umidade do solo e vegetação observadas | Falta e incompleto | Brenno, Pedro | Sim (SMAP) | Sim (SMAP) |
| 12 | Tendência de água de longo prazo | Falta | Brenno | Talvez (GRACE) | Não |
| 13 | Comparar abordagens estatísticas ou de IA | Mensal × diário e texto do pitch feitos; falta conferir contra a PAM de vários anos | Pedro, Brenno | Sim (PAM) | Não |
| 14 | Mapa com camadas, tempo e zonas do talhão | Falta | Gabriel, Brenno | Em parte | Não |
| 15 | Explicações para o agricultor | Incompleto | Gabriel | Não | Não |
| 16 | Dados de resoluções diferentes | Falta | Brenno | Não | Não |
| 17 | Outros satélites citados pelo desafio | Falta | Time | Sim | Sim (GPM) |
| 18 | Entrega: README, licença, acessibilidade | Incompleto | Gabriel, time | Não | Não |

Ordem sugerida: 1 a 4 primeiro (só motor, sem dado novo), depois 5 a 8 (dependem de decisão ou de outra área), depois 9 a 17 (dado novo ou trabalho de tela), e 18 antes da entrega.

---

## Parte 1 — Rotação atual como estratégia comparada

**Texto:** "compare at least three rotation strategies, including the existing rotation".

**Hoje (14/11, branch `motor-diario`):** o motor está pronto; falta a tela.

- O motor define a rotação atual pelas culturas mais recentes do histórico: `[algodao, soja, milho]` com o talhão livre em outubro dá `soja>milho` (antes dava `algodao>soja`).
- A saída tem o campo `atual` no topo: `{"id", "culturas", "viavel", "motivo"}`. Se `viavel` é `true`, os números estão no item de `sequencias` com o mesmo `id`; se é `false`, `motivo` diz por que ela não cabe no calendário (mesmo formato de `descartadas[].motivo`). Sem histórico, `atual` é `null`.
- A API repassa a saída do motor inteira, então o campo já chega ao front sem mudança no backend.
- A tela ainda não mostra: os três cards continuam sem a rotação atual.

**Feito:**

- [x] Motor: definir `atual` pelas culturas mais recentes do histórico, respeitando o slot.
- [x] Motor: devolver a rotação atual num campo próprio (`id`, `culturas`, `viavel`, `motivo`). Os números não são copiados: ficam no item de `sequencias` com o mesmo `id`.
- [x] `docs/contrato_motor.md` (regra 14 e campo `atual`) e fixtures do front regeneradas.

**Falta:**

- [ ] Tela (Gabriel): um bloco "Sua rotação atual" ao lado dos três cards. Com `atual.viavel`, ler o item de `sequencias` pelo `id` e mostrar os mesmos números dos cards (receita de hoje e do futuro, solo, encaixe). Sem `viavel`, mostrar o motivo com o texto que já existe para as descartadas. Sem histórico, convidar a informar.
- [ ] Tela: em cada card, a diferença para a rotação atual (receita, solo, encaixe).
- [x] Decisão de 15/11: a rotação atual permanece como referência ao lado das até três melhores sequências pelo score de hoje, conforme as prioridades escolhidas.
- [ ] Pousio e slot de cada cultura do histórico: o motor supõe uma cultura por slot, sem pular. Quem deixa a safrinha vazia não consegue informar a rotação atual ("Em aberto", item 13 do contrato).

**Feito quando:** com um histórico informado, a tela mostra quatro estratégias (a atual e as três dos cards) com receita, solo e encaixe comparáveis.

## Parte 2 — Solo descoberto e erosão por sequência

**Texto:** "highlight times when fields are typically bare"; "erosion reduction"; "erosion risk".

**Hoje (14/11, branch `motor-diario`):** motor, API e tela de dias/chuva prontos. A API aceita `declividade_pct` e anuncia `capabilities.declividade_pct`.

- Cada sequência devolve `descoberto` em cada clima: dias sem cultura, dias expostos (sem palhada da cultura anterior), a chuva que cai em cada um e a lista por mês. Regra 15 do contrato.
- Com `declividade_pct` na entrada, sai também `indice_erosao` = chuva exposta × fator S da RUSLE. Regra 16.
- Decisão: fica como número à parte, fora da parte `solo` do score. Entrar no score mudaria o ranking com uma suposição sem fonte (quanto vale um dia exposto).
- Resultado nos dados reais: toda sequência deixa o talhão sem cultura de junho ou julho a setembro, como o NDVI mostra. `soja>feijao` fica 160 dias exposta e `soja>milho`, 10. A crotalária depois da soja deixa fevereiro exposto (237 mm contra 74 mm).

**Feito:**

- [x] Motor: dias sem cultura e chuva nesses dias, por sequência e por mês.
- [x] Motor: índice de exposição à erosão, ponderado pela declividade quando ela vem na entrada.
- [x] Decidido: fora do score.
- [x] `docs/contrato_motor.md` (regras 15 e 16, campo `descoberto`, entrada `declividade_pct`) e fixtures do front regeneradas.
- [x] Tela: dias expostos e chuva exposta nos cards, calendário dos primeiros 365 dias distinguindo cultura, palhada e exposição, com chuva por mês/cenário no detalhe. A referência atual recebe a mesma apresentação.
- [x] API: aceita `declividade_pct` opcional (0 a 100, finito), repassa ao motor e anuncia a capability em `/metadata`.
- [x] Tela: apresentação do índice quando retornado e envio de declividade preparado para o contorno exato da demonstração, condicionado ao suporte anunciado pela API.

**Falta:**

- [x] Conferir na tela o índice real que chega pela API com a declividade da demonstração: 4,05% enviados; Soja → Milho exibiu 34,7 / 34,2 / 24 (hoje / futuro / ano seco), após integrar a Main `1519963`.
- [ ] Para talhões fora da demonstração: declividade depende de SRTM por ponto (ver Parte 14). Sem ela, o motor devolve dias e chuva, sem o índice.
- [x] Modo diário: chuva exposta de cada ano (15/11, branch `motor-parte2`). `diario.<clima>.descoberto` traz, por sequência, a chuva sobre os dias sem cultura e sobre os dias expostos em cada ano, com mediana e ano ruim, e o `indice_erosao` quando há declividade. Os dias são os do calendário mensal; muda a chuva de cada dia. Ano ruim aqui é o de **mais** chuva sobre solo exposto (posição 20% do mais chuvoso para o menos, o 4º de 19 anos), porque é o lado do risco de erosão. Fora do score e do rank. Regra 11 do modo diário no contrato. Talhão de demonstração, outubro, sem histórico, hoje, 4,05% de declividade: `soja>milho` tem 74 mm de chuva exposta na média mensal, 58 mm no ano mediano, 116 mm no ano ruim e de 12 mm (2018) a 200 mm (2006) entre os anos; índice 34,7 no mensal, 27,0 no mediano e 54,0 no ano ruim. `soja>feijao` (160 dias expostos): 190 mm no mensal, 174 mm no mediano, 302 mm no ruim, de 18 mm (2023) a 317 mm (2012). `soja>crotalaria`: 237 mm, 240 mm e 312 mm. `milho>crotalaria` fica em 0 em todo ano. No futuro, `soja>milho` fica com 57 mm no mediano e 113 mm no ruim: como no modo mensal, a diferença entre sequências vem do calendário, e a de um ano para outro é maior que a de hoje para o futuro. Falta chegar à tela: a API ainda não chama o modo diário.
- [ ] Duração da palhada e quantidade por cultura: hoje é sim ou não, até o próximo plantio ("Em aberto", item 14 do contrato).

**Feito quando:** duas sequências com cultura de cobertura e sem ela mostram números diferentes de solo descoberto e de chuva sobre solo exposto. A tela mostra essas diferenças e o índice ponderado pela declividade foi conferido com a API real na demonstração.

## Parte 3 — Lacunas e riscos por estratégia

**Texto:** "For each strategy, you may explain why it was suggested, what evidence supports it, what benefits it may offer, where information gaps exist, and any risks that would need local review".

**Hoje (14/11, front integrado à `motor-diario` em `589b16b`):** avisos e benefícios do motor têm apresentação na tela; faltam as marcações de origem dos dados.

- Cada sequência viável devolve `avisos`: uma lista de riscos e lacunas, cada um com `tipo`, `codigo`, `cultura`, `cenario`, `dados` (os números que geraram o aviso) e `texto`. Regra 17 do contrato, com a tabela dos códigos (11 com texto próprio na tela; `geada` e `fator_agua_diario`, só do modo diário, usam o caminho de código desconhecido).
- Riscos: fator que mais limita cada cultura em cada clima, queda de receita no futuro, queda no ano ruim (modo diário), repetição de cultura, solo exposto.
- Lacunas: sem histórico, cultura sem limiar de calor, limiar de 32 °C, cultura com preço zero, Ky padrão (modo diário), valor marcado a conferir.
- Não muda score nem rank.
- O exemplo só com hoje/futuro tem zero avisos para `soja>milho` e cinco para `soja>feijao`. A API atual também inclui o ano seco da demonstração: em outubro com histórico soja, milho, são dois riscos para `soja>milho`, dois riscos e duas lacunas para `soja>crotalaria`, e seis riscos e uma lacuna para `soja>feijao`. O front usa a lista recebida, inclusive os cenários disponíveis.

**Feito:**

- [x] Motor: lista `avisos` por sequência, gerada dos próprios dados.
- [x] Motor: lê colunas opcionais `<campo>_status` de `culturas.csv` e avisa `valor_a_conferir`.
- [x] `docs/contrato_motor.md` (regra 17 e coluna `<campo>_status`) e fixtures do front regeneradas.
- [x] Tela (Gabriel): resumo separado de riscos e lacunas nos cards; lista completa com contexto e evidências no detalhe de cada estratégia, inclusive a rotação atual. Ausência do campo não é tratada como lista vazia.
- [x] Texto: os 11 códigos têm apresentação em português com os rótulos acentuados das culturas, números e unidades de `dados`. Código novo preserva texto e dados do motor.
- [x] Motor: lista `beneficios` por sequência (regra 18): fixa nitrogênio, bônus após fixadora, deixa palhada, pouco solo exposto, estável no futuro, clima favorável. Só com o que entra na conta. `culturas[]` traz `fixa_n` e `cobre_solo`.
- [x] Tela (Gabriel): benefícios junto dos avisos, com resumo nos cards e contexto e evidências no detalhe da estratégia e da rotação atual.

**Falta:**

- [x] Dados (Brenno): preencher `preco_status` e `temp_calor_c_status` em `scripts/montar_culturas.py` com o que `docs/culturas_fontes.md` marca como "memória" ou "sem fonte" (preço de feijão, girassol e algodão; limiar de girassol e trigo). Sem isso, o aviso de preço não aparece.
- [ ] Tela (Gabriel): mostrar os avisos da sequência no card e no detalhe, separando riscos de lacunas. Hoje o texto de "valide com seu agrônomo" é igual para todos os cards.
- [ ] Texto: o `texto` do motor usa o nome da cultura sem acento (`feijao`). A tela tem os rótulos e pode montar a frase a partir de `codigo` e `dados`.
- [x] `fator_limitante` usa o modo mensal; no diário a água pesa mais ("Em aberto", item 18 do contrato). Motor (15/11, branch `motor-parte3`): com `diario=`, sai o aviso novo `fator_agua_diario` (risco, por cultura e clima) quando o `fator_agua` do ano mediano fica abaixo de `AVISO_FATOR` (0,8); `fator_limitante` continua o do mensal, e `clima_favoravel` não sai quando há esse aviso. Sem o modo diário nada muda (fixtures iguais); score e rank não mudam. Talhão de demonstração, outubro, histórico soja, milho: o milho safrinha de `soja>milho` (82% no mensal, sem aviso) ganha o aviso com 0,696 hoje e 0,693 no futuro; 14 avisos em 7 das 26 sequências. A API e a tela ainda não usam o modo diário (Parte 8); quando usarem, o front mostra o código novo pelo caminho de código desconhecido (texto e dados do motor), sem mudança.

**Feito quando:** dois cards diferentes mostram avisos diferentes, e cada aviso aponta o dado que o gerou. Implementado no front, incluindo benefícios; status dos dados e limitação mensal continuam nas pendências acima. Contrato de apresentação e mensagem para Pedro em `frontend/docs/API.md`.

## Parte 4 — Geada e chuva extrema

**Texto:** "frost risk, extreme precipitation".

**Hoje (15/11, `motor-diario`):** o modo diário conta, por cultura, ano e clima, os dias do ciclo com geada e com chuva extrema (regra 10 do modo diário no contrato). Não muda score nem rank.

- Geada: mínima no abrigo de 3 °C ou menos (Grodzki et al., 1996; Embrapa Trigo). Vira o aviso `geada`.
- Chuva extrema: acima do percentil 95 dos dias com chuva da série de hoje (R95p do ETCCDI), 24,7 mm no talhão de demonstração. Fica só como número: por definição acontece todo ano no período chuvoso.
- Talhão de demonstração, com a correção da A520: um dia de geada em 19 anos, 1/jul/2021 (2,2 °C), a onda de frio de 2021. Só o milho safrinha de `milho>milho` pega esse dia. Soja na safra: chuva extrema em 18 de 19 anos, 69 dias no total; no futuro, 64.

**Feito:**

- [x] Motor, modo diário: dias de geada e de chuva extrema por cultura e ano, com `anos`, `dias_total` e `max_no_ano`.
- [x] Limiares com fonte.
- [x] Decidido: só aviso, sem desconto na produtividade.

**Falta:**

- [ ] API e tela: dependem do modo diário na API (Parte 8). Sem ele, os números não chegam à tela.
- [ ] Para o sul de Minas a geada pode não ser zero: depende da série diária por ponto (Parte 8).
- [ ] POWER é grade de cerca de 50 km; a mínima real no talhão pode ser mais baixa em baixadas.

**Feito quando:** a saída do modo diário traz dias de geada e de chuva extrema por cultura (feito), e a tela mostra a frase correspondente, mesmo que seja "nenhum dia em 19 anos".

## Parte 5 — Prioridades e restrições do agricultor

**Texto:** "farmer priorities"; "allow farmers to input their own priorities or constraints, such as water availability, equipment limitations, or market preferences"; "mapping which rotation ideas best align with farmer priorities".

**Decisão (Pedro, 15/11):** em vez de um card por objetivo (renda, solo, clima), a tela mostra as três sequências de maior score de hoje, com os pesos de água, solo e renda escolhidos pelo produtor. Cada card mostra também a posição no futuro.

**Hoje (15/11, `motor-diario`):** o motor já aceitava os pesos e ordenava por eles; a API já recebe `prioridades`. Nos dados reais, os pesos mudam as três primeiras (outubro: pesos iguais dão `soja>milho`, `soja>sorgo`, `soja>crotalaria`; só renda troca as duas últimas por `soja>trigo` e `soja>girassol`; só solo dá três sequências com crotalária).

**Feito:**

- [x] Time: decisão de 14/11 reaberta por Pedro.
- [x] Motor: desempate do ranking. Com peso só em água, várias sequências empatam em 100 (a parte `agua` satura no modo mensal); o empate agora vai para a maior média simples de `agua`, `solo` e `renda`. Com pesos iguais nada muda; fixtures iguais.
- [x] Tela (Gabriel): controles de água, solo e renda de 0 a 3, padrão 1/1/1, persistidos no rascunho. Nos resultados, mudar refaz a análise e reinicia o chat.
- [x] Tela: até três primeiras de `sequencias`, sem reordenar, com posição e score de hoje/futuro em cada card; rotação atual preservada como referência. Casos com 0, 1 e 2 opções conferidos na API real.
- [x] Integração: exemplos de outubro com histórico Soja → Milho e fevereiro (1ª hoje → 12ª no futuro) conferidos na API e no navegador. Contrato do front atualizado em `frontend/docs/API.md`.

**Falta:**

- [ ] Motor: entrada de restrições (culturas que o produtor não quer ou não consegue plantar; irrigação). Fora desta decisão.

**Feito quando:** mudar a prioridade na tela muda os três cards mostrados.

## Parte 6 — Controles de cenário

**Texto:** "scenario sliders that adjust rainfall or temperature patterns".

**Hoje (15/11):** motor, API (`0ec5f06`) e front aceitam `ajuste: {"chuva_pct", "temp_c"}` (regra 19 do contrato). Chuva de −50% a +30%, temperatura de 0 a +4 °C, o mesmo ajuste em todos os meses e em todos os climas (hoje, futuro, ano seco e série diária). ET0 e dias quentes acompanham a temperatura. Sem `ajuste`, a saída não muda.

- Exemplo com `2a60d9b` e dados `8a90877`, talhão de demonstração, outubro, histórico soja, milho: com 20% menos chuva, `soja>milho` cai de R$ 13.481 para R$ 12.695/ha e passa de 1º para 3º no ranking de hoje; `soja>feijao` sobe de 3º para 1º. Com +2 °C, `soja>sorgo` passa a liderar hoje. Valores do motor conferidos pela API real.

**Feito:**

- [x] Motor: entrada opcional de ajuste aplicada às tabelas de clima e à série diária antes da conta.
- [x] `docs/contrato_motor.md` (entrada `ajuste`, regra 19, "Em aberto" item 19).
- [x] Tela (Gabriel): controles de chuva e temperatura, persistência, reset, reanálise e identificação de cenário hipotético nos resultados/detalhes, ativados por `capabilities.ajuste: true`; ver `frontend/docs/API.md`.

**Falta:**

- [x] API (15/11): `backend/app.py` aceita `ajuste` opcional (`chuva_pct` de −50 a +30 e `temp_c` de 0 a +4, finitos, padrão 0, sem campos extras), repassa ao motor depois de escolher o clima do ponto e anuncia `capabilities.ajuste: true` em `/metadata`. Valor fora da faixa dá 422. Testes em `backend/tests/test_api.py`.
- [x] Chat (15/11): o prompt diz que, com `entrada.ajuste`, todos os números (inclusive do ano seco) são do cenário hipotético, e não previsão.
- [x] Integração (Gabriel): controles conferidos com a API real em `motor-renda-anual` (`2a60d9b`): 85 verificações de navegador, 8 análises reais, reset, persistência, limites e avisos hipotéticos. Ver `frontend/docs/VALIDACAO.md`.
- [x] Dados (Brenno): uma coluna `dias_acima_NN` por grau, de 26 a 40, em `scripts/montar_clima.py` e `scripts/clima_ponto.py` (`8a90877`). Dias quentes do futuro contados na Tmax diária do POWER deslocada pelo delta do mês (69,5 dias/ano acima de 35 °C, eram 83,6); chuva futura por razão na demonstração (1.234 mm/ano, eram 1.229). Fixtures regeneradas em `835f84d`, regra 19 atualizada em `2a60d9b`. Exemplos numéricos históricos do contrato continuam identificados como anteriores à revisão.
- [ ] Chat (Gabriel, opcional): a IA traduz "e se chover menos?" em `ajuste` e chama o motor; o número continua vindo do motor.

**Feito quando:** a tela permite pedir "20% menos chuva" e o resultado muda.

## Revisão estatística e agronômica (15/11)

Duas revisões do motor, uma estatística e uma agronômica, sem contexto do desafio. O que mudou no motor (branch `motor-renda-anual`) está em "O que mudou em 15/11" no contrato: `renda` por ano de talhão ocupado com teto fixo (soja safra + milho safrinha) e solo de 60 mm (ZARC).

Integração do front sobre `motor-renda-anual` (`2a60d9b`), que reúne a API da
Main `0ec5f06`, as correções de Pedro e os dados de Brenno (`8a90877`). O envio
é para essa branch; Pedro fará a revisão e o merge na `main`.

**Falta:**

- [ ] Dados (Brenno): trigo de sequeiro só acima de 800 m (Embrapa Cerrados); o talhão está a 484 m. Crotalária em fevereiro, não março (de memória: precisa de fonte). Feito em 15/11 (`8a90877`): colunas `dias_acima_NN` de 26 a 40 °C, dias quentes do futuro pela Tmax diária deslocada e chuva do futuro por razão.
- [x] Tela (Gabriel): testes do front com os números novos; futuro chamado de "por volta de 2060"; detalhes distinguem receita da sequência e receita por ano de ocupação.
- [x] Motor (Pedro): preços editados zero não zeram o teto. A referência usa preços da tabela e tem fallback para teto nulo (`baf7d3b`); casos mensal/diário cobertos (`1086db6`).
- [x] Motor (Pedro): textos brutos de avisos/benefícios alinhados para "por volta de 2060" (`1086db6`). Metadados e prompt recebem a mesma correção na integração do front.
- [ ] Dados (Brenno/Pedro): alinhar `origem.periodos.futuro` e o aviso de fallback em `scripts/clima_ponto.py`, que ainda usam `2041-2060`. Esses campos de proveniência são repassados sem alteração pela API.
- [x] Motor (Pedro, branch `motor-escalas`): escalas das partes do score ("Em aberto" 20, regra 12). A parte `agua` passa a ser o atendimento hídrico na faixa fixa [0,6; 1] (`AGUA_REF_MIN`, provisória), a mesma em hoje, futuro, ano seco e modo diário; o atendimento bruto sai em `atendimento_hidrico`. Com pesos iguais, o peso efetivo de água / solo / renda foi de 14% / 32% / 54% para 29% / 27% / 44% (outubro e fevereiro, hoje). Score e ranking mudam: em outubro `soja>milho` sai do 1º lugar (6º hoje, 5º no futuro) e `soja>feijao` vence hoje (6º no futuro); em fevereiro vence `feijao>soja` hoje (5º no futuro), e `sorgo>soja` segue em 1º no futuro. Fixtures do front regeneradas.
- [x] Motor (branch `motor-bonus-n`): bônus após fixadora só depois de adubo verde (`fixa_n` e produtividade zero na tabela; hoje só a crotalária) e com o plantio seguinte até 60 dias depois do fim do ciclo dela (`JANELA_BONUS_N_DIAS`, provisório, sem fonte). Para a cultura do histórico, o fim do ciclo é suposto 10 dias antes do talhão livre. Regra 10 e "O que mudou com o bônus" no contrato. Com histórico soja, milho, nenhuma sequência fica com o bônus; em outubro `soja>sorgo` passa `soja>milho` por 0,4 ponto.
- [ ] Dados/agronomia: conferir a janela de 60 dias com uma fonte (decomposição e liberação de N da palhada de crotalária no Cerrado). A crotalária de safrinha acaba em junho, na seca, quando a palhada se decompõe mais devagar: o prazo pode ser curto demais para esse caso.
- [ ] Tela (Gabriel): textos e testes do front que citam os cards e scores antigos (`soja>milho` 1º em outubro, `sorgo>soja` 75,987 em fevereiro) e a lista de testes que falham na `motor-escalas`. O prompt do chat (`backend/chat.py`) pode citar `atendimento_hidrico` para explicar a parte `agua`.
- [x] Motor (15/11, branch `motor-hospedeiro`): penalidade por hospedeiro comum de pragas e doenças (regra 10 do contrato). Tabela `HOSPEDEIRO_COMUM` em `motor/motor.py`, com fonte por par: mofo-branco entre soja, feijão, girassol e algodão (Embrapa Algodão, CT 336) e mosca-branca de soja para feijão (Embrapa Arroz e Feijão, CT 91). Fator 0,92, provisório; não soma com a repetição e multiplica o bônus após fixadora. Aviso novo `hospedeiro_comum`. `soja>feijao` segue em 3º em outubro (75,2 → 74,8); `feijao>soja` cai de 2º para 3º em fevereiro. Números em "O que mudou em 15/11 (hospedeiro comum de pragas)" no contrato.
- [ ] Agrônomo: conferir o tamanho do efeito (0,92) e se crotalária entra no grupo do mofo-branco. Tela (Gabriel): o aviso `hospedeiro_comum` aparece pelo `texto` do motor (código desconhecido); um texto próprio é opcional.
- [x] Motor (15/11, depois das revisões estatística e agronômica, branch `motor-integracao`): a parte `agua` voltou a ser o atendimento hídrico (`AGUA_REF_MIN` = 0; o piso de 0,6 multiplicava a água por 2,5 e punha `soja>feijao` em 1º); a parte `solo` não usa mais a água; mosca-branca soja→feijão com fator próprio de 0,75 (provisório); avisos de repetição e de bônus por marca, não por igualdade de número; ano mediano e ano ruim do modo diário são anos reais, escolhidos pelo score. Ranking em "O que mudou em 15/11 depois das duas revisões" no contrato: outubro `soja>milho`, `soja>sorgo`, `soja>crotalaria`; fevereiro `sorgo>soja`, `crotalaria>soja` (empate).
- [x] Dados (Brenno, 15/11): `razao_chuva` e `dias_acima_NN` por modelo em `clima_modelos.csv`; crotalária em fevereiro (Embrapa CT 44, 2018; ensaio em MS); coluna `altitude_min_m` em `culturas.csv` (trigo 800 m). Com a crotalária em fevereiro, `soja>crotalaria` passa a 1º hoje (78,2), à frente de `soja>milho` (77,9).
- [x] Motor (15/11, branch `motor-altitude`): `altitude_min_m` contra a entrada nova `altitude_m` (regra 21 do contrato). Sequência que cabe no calendário mas tem cultura acima da altitude do talhão vai para `descartadas`, com `altitude_min_m` e `altitude_m` no `motivo` (mais os campos de época). Sem `altitude_m`, a saída não muda. A API passa a média do SRTM do talhão de demonstração (484,41 m, `data/talhao/declividade.csv`) só com as tabelas da demonstração (sem `lon` ou `origem.hoje == "tabela_demo"`); o cliente não envia o campo. No demo, o trigo sai do ranking: outubro 25 → 21 viáveis (`soja>trigo`, 5º hoje, dá lugar a `soja>milheto`), fevereiro 35 → 30 (top 5 de hoje igual).
- [x] Tela (Gabriel): motivo com `altitude_min_m` e `altitude_m` validado e apresentado como restrição de altitude, inclusive na referência atual e no resumo. Mantidos os motivos antigos de calendário. Teste HTTP inclui histórico soja→trigo na demonstração.
- [ ] Motor (Pedro): ler os `dias_acima_NN` por modelo de `clima_modelos.csv` (hoje o motor desloca as colunas de hoje pelo `delta_tmax_c`, regra 20). A tolerância de chuva de `test_roda_com_os_modelos_de_data` já foi para 2,5 mm (Brenno, 15/11): com a razão de cada modelo, a média dos três fica até 2 mm de `clima_futuro`.
- [x] Tela (Gabriel): empate técnico abaixo de 2 pontos da líder, preservando score e ordem do motor; testes atualizados para a crotalária em fevereiro, inclusive referência atual no top 3.
- [ ] Declarar no pitch: pesos não são frações do resultado (renda ~metade com pesos iguais); água do mensal otimista (sem veranicos); faixa de 3 modelos não é intervalo; deltas de chuva não significativos; queda do feijão depende do limiar de 32 °C.
- [ ] Declarar no pitch: mudança de chuva do futuro não é significativa (0 de 36 deltas com |t| > 2); "hoje" representa por volta de 2015 (tendência do POWER); ano ruim com 19 anos é impreciso; vencedores com diferença de poucos pontos são empate.

## Parte 7 — Incerteza entre os modelos climáticos

**Texto:** "Explain how the model interprets uncertainty".

**Hoje:** o futuro principal é a média de três modelos, que discordam do sinal da chuva (MIROC6 −79,6 mm, ACCESS-CM2 +7,9 mm, MRI-ESM2-0 +32,7 mm por ano). D2 (`5deed52`) foi integrado pela Main `8049494`, incluindo a fixture canônica com os três modelos. O leitor da API e o painel mostram a faixa climática para o contorno de demonstração. A API já passa `clima_modelos` no clima de demonstração e o front apresenta as faixas de receita e rank por estratégia. Na `api-solo-modelos`, os dados `88afbb8` acrescentam razão de chuva exata e dias quentes por modelo. O modo diário cobre a variação entre anos, não entre modelos.

**Falta:**

- [x] Dados: gerar `data/clima_modelos.csv` (tarefa D2 do plano anterior). Feito em 15/11 por `scripts/montar_clima.py`; teste em `tests/test_clima_modelos.py`. Só o talhão de demonstração.
- [x] Integração: D2 na `main`, API local reiniciada e fixture canônica regenerada. A fixture `metadata-d2.json` preserva a validação anterior ao merge.
- [x] Motor: rodar o futuro uma vez por modelo e devolver a faixa de receita e de rank. Feito em 15/11 (branch `motor-modelos`): `recomendar(..., clima_modelos=carregar_clima_modelos())` dá a cada sequência viável `modelos` (score, rank e receita por ano de cada modelo, mín/máx de rank e de receita) e o aviso `rank_varia_entre_modelos` (faixa acima de 5 posições, provisório). Regra 20 e "Em aberto" 22 do contrato. Sem o argumento, a saída não muda. Outubro: o 1º do futuro é `soja>milho` em MIROC6 e MRI-ESM2-0 e `soja>sorgo` em ACCESS-CM2 (0,5 ponto). Fevereiro: `sorgo>soja` em 1º nos três modelos.
- [x] Dados: acrescentar `razao_chuva` (ssp245 ÷ historical, por modelo e mês) a `clima_modelos.csv`. Feito em 15/11.
- [x] API: passar `clima_modelos` ao motor só no clima de demonstração (onde `clima_futuro` é a média dos mesmos modelos). Entregue na main `3cbf07b`. A imagem já copia `data/clima_modelos.csv` e `data/clima_correcoes.csv` pelo glob `data/clima_*.csv`.
- [x] Tela: consumo opcional de `modelos.rank_min`–`rank_max` nos cards e faixa de receita anual nos detalhes; identificação de aproximação na chuva e aviso próprio `rank_varia_entre_modelos`. Integração local com a API entregue; contrato em `frontend/docs/API.md`. Deploy não verificado nesta rodada.
- [ ] A grade regional só tem a média dos modelos: fora da demonstração, a faixa depende de refazer `delta_mensal.csv` por modelo.

**Feito quando:** cada estratégia mostra a faixa entre os três modelos, e não só a média.

## Parte 8 — Modo diário na API e na tela

**Texto:** "seasons when current crops appear more vulnerable"; incerteza.

**Hoje:** o modo diário existe no motor (`recomendar(..., diario=...)`), já integrado à `main`, incluindo o aviso `fator_agua_diario` e o bloco diário de solo descoberto. A API não passa a série, o `Dockerfile` não copia `data/power`, e a tela não apresenta esses resumos diários.

**Falta:**

- [x] Commit e merge da branch `motor-diario`.
- [ ] Time: reabrir "win rates or probabilities" para a tela poder mostrar "ano ruim, 1 em 5".
- [ ] Dados: `scripts/clima_ponto.py` devolver a série diária que já baixa, para pontos fora da demonstração.
- [ ] API: passar `diario` ao motor; copiar a série da demonstração na imagem.
- [ ] Tela: ano mediano, ano ruim e pior ano por estratégia, e um gráfico por ano com `anos[]`.
- [ ] Regenerar as fixtures do front (o CI barra se ficarem diferentes).

**Feito quando:** a análise de qualquer ponto de Minas mostra o ano ruim de cada estratégia.

## Parte 9 — Informação local de solo

**Texto:** "uses NASA Earth observations along with local soil information".

**Hoje:** a textura escolhida define uma reserva de 30, 45 ou 60 mm no motor; sem escolha, a referência é 60 mm. A API sugere a textura regional GLDAS e a tela permite confirmar, trocar ou usar a referência padrão. São parâmetros de cálculo, não medições do talhão.

**Falta:**

- [x] Time (15/11): fonte de textura escolhida entre as da lista do desafio, sem reabrir SoilGrids: GLDAS (NASA, 0,25°) ou HWSD/GAEZ (FAO, ~1 km). A textura do ponto é sugestão; o produtor confirma ou troca.
- [x] Motor (15/11, branch `motor-solo`): entrada `solo_textura` (`arenoso`, `medio`, `argiloso`) → água que o solo guarda de 30, 45 ou 60 mm (classes do ZARC; regra 6 e `CAD_POR_TEXTURA` no contrato). Sem o campo, 60 mm, como antes.
- [x] Dados (Brenno, 15/11): textura sugerida por quadrado de 0,25° a partir do GLDAS2/Noah (NASA), em `data/solo/regiao_mg/textura.csv`, nos mesmos centros de `delta_mensal.csv` (`scripts/puxar_solo.py`, `scripts/montar_solo_mg.py`; colunas em `docs/colunas_dados.md`, seção 9). Quadrado do talhão de demonstração: argiloso (51,8% de argila), igual ao padrão do motor.
- [x] API: aceita `solo_textura`, anuncia `capabilities.solo_textura` e devolve a sugestão com fonte em `GET /metadata?lat&lon`. Entregue na main `3cbf07b`, incluindo a tabela no Docker. Contrato em `frontend/docs/API.md`.
- [x] Tela (Gabriel): seletor de solo (arenoso, médio, argiloso), sugestão/fonte, escolha manual, persistência, reset e validação do eco integrados sob capability explícita. Fora da cobertura, aceita textura e fonte nulas, mantendo escolha manual disponível.

**Feito quando:** dois talhões com solos diferentes dão balanços hídricos diferentes com o mesmo clima.

## Parte 10 — Atributos de cultura que faltam

**Texto:** "forage value"; "organic matter improvement"; "deep‑rooting crops, or drought‑tolerant crops"; "interrupt pest cycles"; "improve infiltration".

**Hoje:** a tabela de culturas tem fixação de nitrogênio e cobertura do solo. A braquiária vale R$ 0. A regra de pragas só penaliza repetir a mesma cultura.

**Falta:**

- [ ] Dados: colunas novas em `culturas.csv`, cada uma com fonte: família botânica, profundidade de raiz, tolerância à seca, palhada ou biomassa que fica no solo, valor de forragem.
- [ ] Motor: penalidade por repetir a família botânica (pragas), raiz e palhada na parte `solo`, valor de forragem na receita das culturas de cobertura.
- [ ] Sem fonte para um atributo, ele não entra.

**Feito quando:** a parte `solo` distingue culturas que hoje empatam, e a braquiária tem valor quando há uso para forragem.

## Parte 11 — Umidade do solo e vegetação observadas

**Texto:** "soil moisture"; "soil moisture anomalies"; "vegetation stress"; SMAP, MODIS.

**Hoje:** a umidade do solo é estimada pelo balde, sem medição. O NDVI do MODIS foi processado para o talhão de demonstração e aparece na tela, mas o motor não usa.

**Falta:**

- [x] Sem dado novo: comparar, ano a ano, o índice de água do modo diário com o NDVI do talhão (`data/talhao/ndvi_mensal.csv`, 2014 a 2024). Se andam juntos, o NDVI vira evidência observada do que o motor calcula.
  Feito em 15/11 (`scripts/comparar_ndvi_agua.py`, `docs/ndvi_vs_agua.md`): **não detectamos associação** (com 10 anos, o teste só pegaria uma associação forte). Em 10 safras (2014/15 a 2023/24), o atendimento hídrico da soja tem correlação −0,13 (Spearman −0,25, p = 0,49) com o NDVI de dezembro a março; nenhum par com o NDVI passa de 0,25. O NDVI segue a data de plantio e colheita, e o motor planta sempre em 1º de outubro. Não usar o NDVI como confirmação do balanço.
- [ ] Time: reabrir SMAP (está em "Out of scope").
- [ ] Dados: série de umidade do solo do SMAP para o talhão, para conferir o balde e mostrar anomalias.

**Feito quando:** a tela mostra um dado observado ao lado do balanço calculado, com a comparação entre os dois.

## Parte 12 — Tendência de água de longo prazo

**Texto:** "long‑term water trends"; GRACE e GRACE‑FO.

**Hoje:** nada. As tabelas são médias de 2005 a 2024, sem tendência.

**Falta:**

- [ ] Sem dado novo: tendência da chuva e do balanço hídrico por ano na série do POWER de 2005 a 2024.
- [ ] Com dado novo: armazenamento de água do GRACE para a região. A resolução é de centenas de quilômetros; serve como contexto regional, não do talhão.

**Feito quando:** a tela ou o pitch mostram se a água da região está estável, subindo ou caindo.

## Parte 13 — Comparar abordagens estatísticas ou de IA

**Texto:** "compare different SI or statistical approaches for identifying patterns in historical climate and soil conditions".

**Hoje:** o motor é por regras, por decisão do time. `docs/comparacao_abordagens.md` compara o modo mensal com o modo diário no talhão de demonstração (outubro e fevereiro, histórico soja, milho): no top-3 dos cards, mensal e ano mediano têm as mesmas sequências em outubro e duas de três em fevereiro; no ano mediano de outubro, `soja>sorgo` e `soja>milho` empatam (no bootstrap dos anos, cada uma vence em cerca de metade das reamostragens) e o ano ruim derruba as sequências com algodão.

**Falta:**

- [x] Comparar o que já existe: média mensal contra série diária. Tabela, o que cada uma capta e perde e conferência dos números do contrato em `docs/comparacao_abordagens.md`.
- [ ] Conferir o motor contra dado observado: produtividade por ano do IBGE PAM contra o fator calculado pelo modo diário nos mesmos anos. Precisa da PAM de vários anos; hoje só há 2025. Dado novo, dono Brenno; nada baixado.
- [x] Texto para o pitch: por que regras explicáveis e não um modelo treinado, com o que a escolha perde. Em `docs/comparacao_abordagens.md`.

**Feito quando:** existe uma tabela comparando ao menos duas abordagens no mesmo talhão, com o que cada uma acerta e erra.

## Parte 14 — Mapa com camadas, tempo e zonas do talhão

**Texto:** "interactive maps could help users explore trends over time"; "field‑level vulnerabilities (e.g., zones of erosion risk, water stress hotspots, frost‑prone areas)"; "overlays comparing datasets".

**Hoje:** o mapa serve para desenhar e importar o contorno. Não mostra camada de dado nem evolução no tempo. Declividade e NDVI são um número só para o talhão inteiro.

**Falta:**

- [ ] Dados: declividade e NDVI por pixel dentro do contorno (os rasters do AppEEARS estão em `data/appeears/` para a demonstração).
- [ ] Tela: camada de declividade e de NDVI sobre o satélite, com seletor de data para o NDVI.
- [ ] Fora da demonstração: SRTM e MODIS por ponto, que hoje vêm de um pedido manual ao AppEEARS.

**Feito quando:** o talhão de demonstração mostra onde a declividade é maior e como o NDVI muda ao longo do ano.

## Parte 15 — Explicações para o agricultor

**Texto:** "explaining scientific terms such as evapotranspiration, soil moisture anomalies, vegetation indices (e.g., NDVI), frost risk, and water‑balance indicators"; "brief explanations of how nitrogen‑fixing crops, cover crops, deep‑rooting crops, or drought‑tolerant crops contribute to long‑term soil health".

**Hoje:** o glossário cobre evapotranspiração, Kc, déficit, atendimento hídrico, NDVI, encaixe, água disponível no solo, risco de geada, Ky, ano ruim e empate técnico, além dos quatro tipos de cultura abaixo. Os termos do modo diário explicam o contrato; a visualização anual continua na Parte 8.

**Falta:**

- [x] Glossário: água disponível no solo, risco de geada, ano ruim, Ky e empate técnico (15/11, front na `api-solo-modelos`).
- [ ] Glossário: anomalia de umidade do solo.
- [x] Texto curto sobre o papel de cada tipo de cultura: fixadora de nitrogênio, cobertura, raiz profunda, tolerante à seca (15/11, front na `api-solo-modelos`).
- [x] API: `POST /chat` responde dúvidas do produtor sobre a análise na tela, só com os números do motor (`docs/chat.md`).
- [x] Tela (Gabriel): painel de chat quando `/metadata` anunciar `capabilities.chat: true`, com foco dos cards e histórico reenviado. Credencial e teste com a Anthropic real continuam pendentes; ver `docs/chat.md`.

**Feito quando:** todo termo técnico que aparece na tela tem explicação na própria tela.

## Parte 16 — Dados de resoluções diferentes

**Texto:** "harmonizing datasets with different spatial and temporal resolutions [...] to a common analysis grid".

**Hoje:** o clima é de um ponto, o NDVI de 250 m e a altitude de 30 m. Não há grade comum. A tela avisa que as resoluções são diferentes.

**Falta:**

- [ ] Documentar como cada dado é reduzido ao talhão (média dos pixels dentro do contorno, célula do POWER, célula de 0,25° do NEX).
- [ ] Se a Parte 14 for feita: reamostrar NDVI e declividade para a mesma grade dentro do contorno.

**Feito quando:** existe uma seção no README ou em `docs/` que explica a redução de cada fonte ao talhão.

## Parte 17 — Outros satélites citados pelo desafio

**Texto:** "SMAP, ECOSTRESS, GPM, Landsat, MODIS, NASA POWER, GRACE and GRACE‑FO, and SRTM".

**Hoje:** usados: POWER, MODIS, SRTM e NEX-GDDP (que é da NASA, mas não está na lista do desafio). Não usados: SMAP (Parte 11), GRACE (Parte 12), GPM, ECOSTRESS e Landsat.

**Falta:**

- [ ] Time: decidir quais valem o tempo. GPM daria a chuva em resolução melhor que o POWER; ECOSTRESS e Landsat dariam temperatura da superfície e NDVI mais fino.
- [ ] Para os que ficarem de fora: uma frase no README e no pitch dizendo por quê e como entrariam.

**Feito quando:** cada satélite citado pelo desafio está usado ou tem a justificativa escrita.

## Parte 18 — Entrega: README, licença, acessibilidade

**Texto:** "easily interpretable for farmers who may have limited technical or geospatial experience". A submissão pede repositório público com README explicando os dados.

**Hoje:**

- `README.md` e `frontend/README.md` mandam rodar em `D:\NasaSpaceApps`; o `requirements.txt` da raiz não instala o backend.
- Não há arquivo de licença.
- `docs/ibge_pam.md` e `docs/culturas_fontes.md` têm trechos desatualizados (regra de calor "ainda não existe"; preço "editável na tela").
- Leitor de tela e celular físico não foram validados.

**Falta:**

- [ ] README: caminho genérico, instalação do backend, lista de dados atualizada com o modo diário.
- [ ] Licença, se o time confirmar que o Space Apps pede (é de memória).
- [ ] Corrigir os trechos desatualizados.
- [ ] Testar com leitor de tela e num celular.

**Feito quando:** alguém de fora clona o repositório e roda o projeto só com o README.
