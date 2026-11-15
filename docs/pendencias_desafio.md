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
| 6 | Controles de cenário | Motor feito; faltam API e tela | Gabriel | Não | Não |
| 7 | Incerteza entre os modelos climáticos | Incompleto | Brenno, Pedro, Gabriel | Não na demonstração | Não |
| 8 | Modo diário na API e na tela | Incompleto | Gabriel, Brenno | Não | Sim (probabilidades) |
| 9 | Informação local de solo | Falta | Brenno, Pedro | Sim | Sim (SoilGrids) |
| 10 | Atributos de cultura que faltam | Falta | Brenno, Pedro | Fontes a levantar | Não |
| 11 | Umidade do solo e vegetação observadas | Falta e incompleto | Brenno, Pedro | Sim (SMAP) | Sim (SMAP) |
| 12 | Tendência de água de longo prazo | Falta | Brenno | Talvez (GRACE) | Não |
| 13 | Comparar abordagens estatísticas ou de IA | Falta | Pedro | Não | Não |
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
- [ ] Modo diário: chuva exposta de cada ano (hoje só no modo mensal).
- [ ] Duração da palhada e quantidade por cultura: hoje é sim ou não, até o próximo plantio ("Em aberto", item 14 do contrato).

**Feito quando:** duas sequências com cultura de cobertura e sem ela mostram números diferentes de solo descoberto e de chuva sobre solo exposto. A tela mostra essas diferenças e o índice ponderado pela declividade foi conferido com a API real na demonstração.

## Parte 3 — Lacunas e riscos por estratégia

**Texto:** "For each strategy, you may explain why it was suggested, what evidence supports it, what benefits it may offer, where information gaps exist, and any risks that would need local review".

**Hoje (14/11, front integrado à `motor-diario` em `589b16b`):** avisos e benefícios do motor têm apresentação na tela; faltam as marcações de origem dos dados.

- Cada sequência viável devolve `avisos`: uma lista de riscos e lacunas, cada um com `tipo`, `codigo`, `cultura`, `cenario`, `dados` (os números que geraram o aviso) e `texto`. Regra 17 do contrato, com a tabela dos 11 códigos.
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
- [ ] `fator_limitante` usa o modo mensal; no diário a água pesa mais ("Em aberto", item 18 do contrato).

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

**Hoje (15/11, `motor-diario`):** o motor aceita `ajuste: {"chuva_pct", "temp_c"}` (regra 19 do contrato). Chuva de −50% a +30%, temperatura de 0 a +4 °C, o mesmo ajuste em todos os meses e em todos os climas (hoje, futuro, ano seco e série diária). ET0 e dias quentes acompanham a temperatura. Sem `ajuste`, a saída não muda.

- Talhão de demonstração, outubro, histórico soja, milho: com 20% menos chuva, `soja>milho` continua em 1º e cai de R$ 14.171 para R$ 13.385/ha; `soja>feijao` sobe de 5º para 3º. Com +2 °C, `soja>crotalaria` passa `soja>sorgo` no futuro.

**Feito:**

- [x] Motor: entrada opcional de ajuste aplicada às tabelas de clima e à série diária antes da conta.
- [x] `docs/contrato_motor.md` (entrada `ajuste`, regra 19, "Em aberto" item 19).

**Falta:**

- [ ] API (Gabriel): aceitar e validar `ajuste` em `backend/app.py`, repassar ao motor e anunciar em `/metadata`.
- [ ] Tela (Gabriel): dois controles (chuva e temperatura), com o texto de que é um "e se", não uma previsão.
- [ ] Dados (Brenno, opcional): uma coluna `dias_acima_NN` por grau, de 28 a 38, em `scripts/montar_clima.py`. Hoje os dias quentes entre os limiares são interpolados, e abaixo de 32 °C, extrapolados.
- [ ] Chat (Gabriel, opcional): a IA traduz "e se chover menos?" em `ajuste` e chama o motor; o número continua vindo do motor.

**Feito quando:** a tela permite pedir "20% menos chuva" e o resultado muda.

## Parte 7 — Incerteza entre os modelos climáticos

**Texto:** "Explain how the model interprets uncertainty".

**Hoje:** o futuro é a média de três modelos, que discordam do sinal da chuva (MIROC6 −80 mm, ACCESS-CM2 +8 mm, MRI-ESM2-0 +33 mm por ano). O leitor da faixa já existe na API, mas `data/clima_modelos.csv` não foi entregue e a tela mostra "ainda não foi disponibilizada". O modo diário cobre a variação entre anos, não entre modelos.

**Falta:**

- [ ] Dados: gerar `data/clima_modelos.csv` (tarefa D2 do plano anterior). Os números já estão em `data/nexgddp/`.
- [ ] Motor: rodar o futuro uma vez por modelo e devolver a faixa de receita e de rank.
- [ ] A grade regional só tem a média dos modelos: fora da demonstração, a faixa depende de refazer `delta_mensal.csv` por modelo.

**Feito quando:** cada estratégia mostra a faixa entre os três modelos, e não só a média.

## Parte 8 — Modo diário na API e na tela

**Texto:** "seasons when current crops appear more vulnerable"; incerteza.

**Hoje:** o modo diário existe no motor (`recomendar(..., diario=...)`), na branch `motor-diario`. A API não passa a série, o `Dockerfile` não copia `data/power`, e a tela não mostra nada disso.

**Falta:**

- [ ] Commit e merge da branch `motor-diario`.
- [ ] Time: reabrir "win rates or probabilities" para a tela poder mostrar "ano ruim, 1 em 5".
- [ ] Dados: `scripts/clima_ponto.py` devolver a série diária que já baixa, para pontos fora da demonstração.
- [ ] API: passar `diario` ao motor; copiar a série da demonstração na imagem.
- [ ] Tela: ano mediano, ano ruim e pior ano por estratégia, e um gráfico por ano com `anos[]`.
- [ ] Regenerar as fixtures do front (o CI barra se ficarem diferentes).

**Feito quando:** a análise de qualquer ponto de Minas mostra o ano ruim de cada estratégia.

## Parte 9 — Informação local de solo

**Texto:** "uses NASA Earth observations along with local soil information".

**Hoje:** o solo é um balde de 100 mm igual para qualquer talhão (`CAD_MM`), sem fonte.

**Falta:**

- [ ] Time: reabrir SoilGrids (está em "Out of scope") ou escolher outra fonte de textura do solo.
- [ ] Dados: água disponível do solo por ponto, a partir da textura.
- [ ] Motor: receber a capacidade do solo por talhão no lugar da constante.
- [ ] Alternativa sem dado novo: o agricultor informa o tipo de solo (arenoso, médio, argiloso) e o motor usa três valores com fonte.

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

- [ ] Sem dado novo: comparar, ano a ano, o índice de água do modo diário com o NDVI do talhão (`data/talhao/ndvi_mensal.csv`, 2014 a 2024). Se andam juntos, o NDVI vira evidência observada do que o motor calcula.
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

**Hoje:** o motor é por regras, por decisão do time. Não há comparação com outra abordagem.

**Falta:**

- [ ] Comparar o que já existe: média mensal contra série diária (os números estão em `docs/contrato_motor.md`).
- [ ] Conferir o motor contra dado observado: produtividade por ano do IBGE PAM contra o fator calculado pelo modo diário nos mesmos anos. Precisa da PAM de vários anos; hoje só há 2025.
- [ ] Texto para o pitch: por que regras explicáveis e não um modelo treinado.

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

**Hoje:** o glossário cobre evapotranspiração, Kc, déficit, atendimento hídrico, NDVI e encaixe.

**Falta:**

- [ ] Glossário: anomalia de umidade do solo, risco de geada, ano ruim, Ky.
- [ ] Texto curto sobre o papel de cada tipo de cultura: fixadora de nitrogênio, cobertura, raiz profunda, tolerante à seca.
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
