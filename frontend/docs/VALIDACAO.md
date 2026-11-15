# Verificação da integração · 14/11/2026

## Interface em inglês para apresentação · 15/11/2026

Trabalho local na `front-dev3`, atualizada por fast-forward até `2787fb9`, com
as entregas anteriores de solo, modelos e altitude. Esta rodada muda somente
o front, seus testes e documentação; backend, motor, dados e fixtures canônicas
permanecem iguais à base integrada.

- UI Rune, HTML, mapa/Geoman, acessibilidade, mensagens, glossário, riscos,
  benefícios, exposição, fontes e rótulos do catálogo em inglês. Documento com
  `lang="en-US"`, números en-US e moeda BRL explícita, sem conversão de valores.
  Campos e IDs do protocolo permanecem em português; notas e nomes do usuário
  não são traduzidos. Nomes próprios de fontes e localidades são preservados.
- **151 testes JavaScript**, **1 Rust**, `cargo fmt --check`, `git diff --check`
  e build Rune/WASM + Vite passaram. Os avisos conhecidos de compilação do Rune
  e tamanho do bundle continuam. O backend/Python não foi alterado nesta rodada.
- **45 análises HTTP válidas + rejeição 422** passaram: calendário, referência
  atual, altitude, prioridades, fevereiro, ajustes e reset. Tradução não muda
  cálculos, ordenação, foco do chat ou o payload enviado.
- **515 verificações de navegador**: prioridades 98, renda anual 38, solo/API
  46, cenários/API 85, exposição 28, referência atual 26, benefícios 37,
  modelos/avisos 50, avisos 35, chat 38 e revisão de inglês 34.
- Limites dos testes: prioridades inclui oito verificações de chat simulado;
  exposição e avisos incluem quatro verificações simuladas cada. Modelos/avisos
  usa cinco saídas reais do motor com transporte simulado. Chat inclui 33
  verificações simuladas e 22 POSTs interceptados, sem provedor real. Revisão
  de inglês usa uma análise real e uma falha de metadata simulada para conferir
  o rascunho offline. As demais suites citadas usam a API local real.
- O teste de renda anual agora aguarda a sugestão de solo antes de preparar o
  histórico via localStorage e confirma o histórico enviado; a espera evita
  uma corrida do próprio teste. Nos testes de teclado, os controles de cenário
  do Rune são grupos focáveis, e sua ordem foi incluída na navegação.
- Corrigidos vazamentos de idioma na atribuição do mapa, fontes de solo/API e
  fallback dos nomes de culturas quando metadata falha. A recusa fixa do chat
  é traduzida apenas na projeção para a tela; testes confirmam o reenvio do
  texto original na próxima pergunta. Essa última mudança foi coberta por
  unidade depois do teste de navegador do chat.
- Desktop 1440 px e celular simulado 390 px inspecionados: mapa, confirmação,
  cards, valores, detalhes e glossário legíveis, sem corte horizontal.
  Capturas: `output/playwright/english-*.png`; logs de navegador
  `output/playwright/english-*.log` e `frontend/.cache/english-browser.log`.
  Unitários, HTTP e build: `frontend/.cache/english-*.log`.

Suites principais e afetadas foram executadas; os demais roteiros antigos de
navegador tiveram seus seletores/textos adaptados e sintaxe conferida, sem
afirmar que todos foram executados. Sem chamada ao LLM nem download POWER.
Não houve verificação de Docker, CI remoto, produção, celular físico ou leitor
de tela. Sessões de navegador de QA foram fechadas.

Pendência externa: a instrução do chat no backend ainda pede respostas em
português. A interface está em inglês, mas respostas livres da IA precisam da
alteração descrita em [ENGLISH_HANDOFF.md](ENGLISH_HANDOFF.md).

## Crotalária em fevereiro, solo/modelos HTTP e glossário · 15/11/2026

Main local atualizada para `1268224`. Trabalho na `api-solo-modelos`, base
`353bb8f`, que inclui os dados `88afbb8` de Brenno e a API de solo/modelos.
Nenhuma alteração no backend, motor, dados ou Docker nesta rodada do front.

- Fixtures canônicas regeneradas com `python -m backend.export_fixture`;
  uma segunda exportação produziu os mesmos arquivos. As 17 falhas iniciais
  foram corrigidas preservando as verificações de comportamento.
- **143 testes JS**, **206 Python** (169 motor/dados + 37 backend), **1 Rust**,
  formatação Rust e build Rune/WASM + Vite passaram. Avisos de compilação do
  Rune e tamanho do bundle permanecem.
- **44 análises HTTP válidas + rejeição 422**: meses/horizontes, referência,
  prioridades, fevereiro e ajustes de cenário. Outubro: soja→crotalária,
  soja→milho, soja→sorgo; fevereiro: crotalária→soja, sorgo→soja, feijão→soja.
- Referência atual verificada pelo ID, inclusive quando é o segundo card;
  foco do chat sem duplicação, empate abaixo de 2 pontos medido da líder,
  calendário e exposição preservados. Um caso sintético adicional garante
  que a referência fora da faixa de empate não herde o selo da líder.
- **287 verificações de navegador**: 98 prioridades, 50 modelos/avisos,
  37 benefícios, 37 renda anual, 46 solo/modelos HTTP e 19 de apresentação
  do glossário em desktop/celular simulado. Sem erros JavaScript.
- Nos testes de prioridades, oito verificações usam chat simulado. O roteiro
  de modelos/avisos usa cinco saídas reais do motor com transporte simulado,
  inclusive modo diário. Nos roteiros de renda, benefícios e solo, o HTTP é
  real; solo/modelos executa seis análises, sem mock de capability ou sugestão.
- A API real sugere solo argiloso da GLDAS para a demonstração; escolhas de
  30/45/60 mm, persistência manual e reset foram conferidos. Sem cobertura,
  o front agora aceita `textura_sugerida: null, fonte: null`, ainda exigindo
  o ponto consultado e fonte válida quando houver sugestão.
- A API entrega três modelos com `modelos.chuva: "razao"`; os cards mostram
  as faixas reais sem aviso de aproximação. O fallback `"aproximada"` continua
  coberto pelos testes unitários. O caso real de aviso de variação passou a
  milho→algodão em fevereiro, faixa 13ª–22ª, pois crotalária→algodão é descartada.
- Glossário ampliado com nove entradas. Capturas de 1440 px e 390 px
  inspecionadas, legíveis e sem corte horizontal. Artefatos locais ignorados:
  `output/playwright/glossary-*.png`, `soil-api-mobile.png`, `annual-*.png` e
  logs `feb-*.log`; testes locais também em `frontend/.cache/feb-*.log`.

Para reproduzir a integração nova, executar via Playwright CLI
`frontend/tests/browser-soil-api.js` com API em 8000 e web em 4173.
Nenhuma chamada ao LLM ou download POWER foi feito. Docker, deploy, CI remoto,
celular físico e leitor de tela não foram verificados nesta rodada.
O descarte do trigo por altitude ainda aguardava a entrega do motor/API nesta
etapa; a integração recebida antes do push está registrada abaixo.

### Atualização remota recebida antes do push

A branch remota avançou para `490201e`, incluindo `407aed4` (altitude) e a
exportação das fixtures. Merge preservou o trabalho de Pedro, com conflito
somente no status das pendências. Os arquivos canônicos exportados por ele
eram iguais aos desta rodada; a regeneração após o merge não produz diff.
O motor/API continuam sendo os entregues por Pedro.

O front passou a distinguir o motivo de altitude do calendário e a validar
seus campos. API sem `lon` ou com clima de demonstração inclui a altitude SRTM;
fixtures diretas do motor continuam sem ela. Assim, renda apenas passa a
soja→milho, soja→sorgo, soja→girassol; março fica sem sequência, e feijão→soja
passa ao 9º lugar no futuro em fevereiro. Testes HTTP e de navegador afetados
acompanham essas diferenças sem mudar a seleção de cards no front.

Após a integração: **146 testes JS**, **216 Python** (177 motor/dados + 39
backend), build web e `git diff --check` passaram. A formatação e o teste Rust
da etapa anterior permanecem válidos; o Rust não mudou nesta integração.
**45 análises HTTP válidas + rejeição 422** passaram, incluindo referência
soja→trigo descartada com texto de altitude. Reexecutadas **181 verificações
de navegador**: 98 prioridades (oito de chat simulado), 37 renda anual e 46
solo/modelos com API real. Sem erros JavaScript; sem LLM ou download POWER.
Logs locais: `frontend/.cache/altitude-*.log` e
`output/playwright/altitude-{priorities,annual,soil}.log`.

## Revisão integrada da main `7d8c1fe` · 15/11/2026

Trabalho do front na `front-dev3`, após atualizar a main e preservar `28c8a9c`.
Backend, motor, dados e fixtures canônicas não foram alterados nesta integração.

- **141 testes JS**, **201 Python** (167 motor/dados + 34 API), um teste Rust,
  `cargo fmt --check` e build Rune/WASM + Vite passaram. Permanecem os avisos de
  compilação do Rune e de tamanho do bundle já conhecidos.
- **44 análises HTTP válidas** e rejeição do ajuste inválido passaram contra a
  API reiniciada com o motor novo. A expectativa antiga do terceiro card que
  quebrou o CI foi atualizada; os números vêm do motor, sem alterar o ranking.
- **333 verificações de navegador**: 85 cenários na API real, 37 renda anual
  na API real, 97 prioridades (8 verificações de chat simulado), 50 modelos/novos
  avisos e 64 solo. Não houve chamadas ao LLM nem downloads POWER.
- Nos testes de modelos e solo, os resultados são gerados pelo motor real;
  o **transporte é simulado**, pois a API de `7d8c1fe` ainda não passa os campos.
  Também são simuladas falhas, capability, sugestões regionais e respostas tardias.
  Isso valida a preparação do front, não uma integração HTTP já entregue.
- Empates: três primeiros em outubro e dois em fevereiro, sem alterar ranks e
  scores. Faixas por modelo nos cards e receita anual nos detalhes. Aviso real de
  faixa 14ª–21ª com histórico Crotalária → Algodão em fevereiro. Água diária e
  hospedeiros foram conferidos com avaliações reais, mantendo modos distintos.
- Solo: sugestão, manual, 30/45/60 mm, persistência, reset explícito preservado
  após reload, falta de capability/cobertura, eco ausente/divergente, descarte de
  respostas tardias após escolha/análise/troca de contorno. Rascunhos anteriores
  continuam válidos; `solo_padrao` é local e não entra no pedido HTTP.
- Capturas desktop 1440 px e celular simulado 390 px inspecionadas: cards,
  detalhes, novos avisos e seletor de solo legíveis, sem estouro horizontal.
  Exemplos: `output/playwright/reviewed-models-*.png`,
  `reviewed-host-warnings-desktop.png`, `soil-desktop.png` e `soil-mobile.png`.

Reprodução das entradas específicas de QA (arquivos gerados ignorados pelo Git):

```powershell
.\.venv\Scripts\python.exe frontend/scripts/export-reviewed-models.py
.\.venv\Scripts\python.exe frontend/scripts/export-soil-fixtures.py
.\.venv\Scripts\python.exe frontend/scripts/export-scenario-fixtures.py
```

Com o servidor local na porta 4173, executar os scripts de navegador via
`playwright-cli run-code --filename=frontend/tests/browser-<nome>.js`:
`reviewed-models`, `soil`, `priorities`, `annual-income` e `scenario-api`.

O [CI da main `7d8c1fe`](https://github.com/Vlencio/happy_farmers_repo/actions/runs/43743587386)
passou Python, fixtures, JavaScript, Rust e formatação; falhou na expectativa
antiga do teste HTTP. Docker foi pulado. A correção passou localmente, mas uma
nova execução remota depende de publicar este trabalho. O status de deploy
Railway separado não comprova que o CI completo passou. Não foi executado Docker
local, leitor de tela ou validação de produção nesta rodada.

## Integração final na motor-renda-anual · 15/11/2026

Base `2a60d9b`, que reúne a API da Main `0ec5f06`, as correções do motor e os
dados `8a90877` de Brenno. Os ajustes anteriores do front foram preservados e
adaptados às fixtures novas de `835f84d`. A publicação é na `motor-renda-anual`;
o merge na `main` fica com Pedro. Motor, dados e seus testes não foram alterados
por esta integração do front.

- 117 testes JS e 163 Python (129 raiz + 34 backend) passaram.
- Oito verificações adicionais cobriram preços de referência/todos os preços
  zero, peso renda 0/1 e modos mensal/diário. O caso que retornava 500 agora
  retorna 200. O teto usa preços da tabela, conforme a correção de Pedro.
- 44 análises HTTP válidas passaram: 36 casos de calendário/referência/prioridades,
  seis ajustes reais, ajuste zero e reset. Uma entrada fora da faixa deu 422.
- `tests/browser-scenario-api.js`: 85 verificações no Chromium com oito análises
  reais, sem substituir metadados nem resultados. Cobriu chuva, temperatura,
  combinação, todos os meses dos três climas, receita/rank na tela, detalhes
  anuais, persistência, reset, limites e avisos de hipótese/ano seco ajustado.
  Todas as consultas usaram a demonstração; zero chamadas ao chat, zero consultas
  externas ao POWER e zero erros JavaScript.
- Capturas `output/playwright/real-scenarios-{desktop,mobile,cards-mobile}.png`
  inspecionadas em 1440 px e 390 px: controles e dados legíveis, sem overflow.
- `tests/browser-scenarios.js`: 77 verificações de resiliência passaram, com
  capability ausente, ecos incorretos, respostas atrasadas e chat explicitamente
  simulados. Três POSTs de chat foram interceptados; nenhum provedor foi chamado.
- Teste Rust, `cargo fmt --check` e build Rune/WASM + Vite passaram. Os avisos
  da dependência Rune permanecem sem mudança.
- Quatro fixtures canônicas conferem com o exportador; só o rótulo de futuro
  em `metadata.json` muda em relação à branch recebida. As seis fixtures ignoradas
  de cenários foram regeneradas com os dados novos, sem download.

A Parte 6 está integrada pela API real. Tradução de pergunta do chat em ajuste
continua opcional e não foi implementada. Chat com provedor real, leitores de
tela, celular físico e deploy não foram testados. Partes 7/8 mantêm suas
dependências. Rótulos antigos em `origem.periodos` e num aviso do provedor de
dados estão registrados em [API.md](API.md), sem mudar os campos de proveniência.

## Histórico — renda anual antes das correções de Pedro · 15/11/2026

O registro abaixo descreve a rodada anterior (`195bf1a`). O teto zero e a API
de ajuste pendentes nessa rodada foram resolvidos na integração acima.

Checkout atualizado até a Main `8049494`. Integração local de
`motor-renda-anual` (`195bf1a`) preparada em `front-dev3`, **sem concluir o merge
nem publicar**, por decisão de Gabriel: o caso de teto zero fica com Pedro.
O motor e seus testes permanecem exatamente como nessa branch.

- 117 testes JS passaram, incluindo os sete testes atualizados e três novos
  testes para renda anual, respostas antigas e campos anuais inválidos.
- 121 testes Python da raiz e 33 do backend passaram. Os 33 do backend foram
  repetidos após a correção textual de futuro nos metadados e no prompt do chat.
- Teste Rust e `cargo fmt --check` passaram; build Rune/WASM e Vite passou,
  com avisos existentes da dependência Rune e tamanho do bundle.
- 36 análises HTTP reais passaram: 24 calendários, 6 referências, 5 conjuntos
  de prioridades e fevereiro. Outubro começa com Soja → Milho, Soja → Sorgo,
  Soja → Feijão; fevereiro, com Sorgo → Soja, Feijão → Soja, Crotalária → Soja.
- As quatro fixtures canônicas foram conferidas contra o exportador; depois
  do ajuste do rótulo, `metadata.json` foi regenerada. Os três arquivos do motor
  continuaram idênticos aos da branch do Pedro.
- `tests/browser-annual-income.js`: 37 verificações no Chromium com respostas
  reais, cobrindo seletor de fevereiro, ranking, receita total/anual e ocupação
  nos três cenários, mínimo de um ano, rótulo 2060, solo 60 mm e D2.
  Uma análise da demonstração (`origem.hoje=tabela_demo`), nenhuma chamada
  ao chat ou consulta externa ao POWER, e nenhum erro de JavaScript.
- Capturas `output/playwright/annual-{cards,detail}-*.png` inspecionadas em
  1440 px e 390 px, com dados legíveis e sem overflow horizontal.
- Roteiros anteriores de prioridades, cenários, benefícios e avisos tiveram
  suas expectativas atualizadas e a sintaxe conferida; não foram reexecutados
  integralmente nesta rodada. As seis fixtures ignoradas de cenários foram
  regeneradas com o motor atual, sem download.

### Pendência de Pedro antes do merge

Uma verificação adicional encontrou uma entrada válida que os testes existentes
não cobrem. `POST /analyze` retorna **500** por `ZeroDivisionError` com:

```json
{"lat":-20.032,"mes_plantio":2,"horizonte":2,"precos":{"soja":0,"milho":0},"prioridades":{"agua":1,"solo":1,"renda":0}}
```

`teto_de_renda` devolve zero para o sistema de referência; a divisão ocorre
mesmo com peso de renda zero. O front não permite editar preços e envia `{}`,
por isso o fluxo normal passa. Pedro precisa tratar teto nulo e testar preços
de referência zero e todos os preços zero, nos modos mensal e diário.
O merge aguarda essa correção; nenhum conserto foi aplicado ao motor aqui.

Os textos brutos de avisos/benefícios do motor ainda citam `2041-2060`, para
Pedro alinhar. Metadados HTTP, prompt do chat e apresentação usam “por volta
de 2060”; o chat real não foi chamado. Parte 6 ainda precisa da API aceitar
`ajuste` e anunciar a capability; Partes 7/8 continuam com as dependências
registradas nas pendências. Deploy e celular físico não foram testados.

## D2 — faixa climática entre modelos · 15/11/2026

Front na `front-dev3` (`a7bf90e` como base), com a entrega de Breno `5deed52`
verificada em checkout isolado de `dados-calor` (`67d1c3f`). A API real desse
checkout foi iniciada em 8001, e o front atual em 4174; não houve merge nem
alteração dos arquivos de dados, backend ou motor da `front-dev3`.

- 114 testes JS passaram; os 10 testes de contexto do talhão foram conferidos
  novamente após tornar a verificação de ausência de D2 independente da fixture.
- Os 5 testes originais de D2 e os 3 testes do leitor de contexto passaram.
  Nenhum script de download foi executado.
- Build Vite passou; não houve mudança Rust/WASM nesta entrega.
- `tests/browser-model-spread.js`: 20 verificações no Chromium, usando respostas
  reais de `/metadata` e `/analyze`, sem simular os números. Conferiu o texto
  +1,34 a +2,31 °C e −79,6 a +32,7 mm, os avisos de discordância da chuva e de
  faixa entre modelos (não intervalo de confiança), além dos cards existentes.
- Contorno importado equivalente, com anel invertido, mantém a faixa; mover um
  vértice a oculta. A única análise foi da demonstração, com
  `origem.hoje=tabela_demo`: nenhuma consulta externa ao POWER e nenhuma chamada
  ao chat. Sem erros de JavaScript.
- Capturas `output/playwright/d2-desktop.png` (1440 px) e `d2-mobile.png`
  (390 px) inspecionadas, com texto completo e sem corte na faixa climática.
- `metadata-d2.json` foi produzida por `backend.export_fixture` no checkout D2.
  A regeneração das quatro fixtures canônicas na `front-dev3` não produziu diff,
  preservando a verificação do CI enquanto o CSV ainda não foi integrado.

Isso valida o resumo climático de D2. Faixas de receita/rank por estratégia,
dados por modelo fora da demonstração, deploy e celular físico não foram
validados. A Parte 7 completa ainda depende das entregas do motor/API.

## Parte 6 — cenário de chuva e temperatura · 15/11/2026

Base: Main `d6d7a73` na `front-dev3`. O motor já calcula `ajuste`; o front agora
prepara e apresenta esse pedido. A API real ainda não anuncia a capability nem
aceita o campo: `/analyze` com `ajuste` retorna 422 `extra_forbidden`.
Ativação proposta: `capabilities.ajuste: true`, conforme [API.md](API.md).

- 112 testes JS, 9 testes de ajuste do motor e 1 Rust passaram.
- As 36 análises HTTP existentes passaram contra a API real, sem ajustes:
  24 calendários, 6 referências, 5 conjuntos de prioridades e o exemplo de fevereiro.
- Build Rune/WASM e Vite passou. Nenhum arquivo do motor, backend ou dados foi alterado.
- Seis respostas reais foram geradas pelo motor com as tabelas locais, sem download,
  usando `scripts/export-scenario-fixtures.py`. O arquivo fica em
  `output/playwright/scenario-fixtures.json`, ignorado pelo Git.
- `tests/browser-scenarios.js`: 77 verificações passaram no Chromium. O caminho
  sem suporte usa a API atual; o caminho ajustado simula o transporte/capability
  com as respostas reais do motor. Cobriu arraste provisório/soltura, setas/Home/End,
  aplicação/reset, limites, persistência, ajuste ausente/divergente na resposta,
  descarte de análise atrasada e reinício/contexto do chat (3 chamadas simuladas).
- Capturas `output/playwright/scenarios-*.png` inspecionadas em 1440 px e 390 px,
  sem cortes nos controles e avisos. Sem erros de JavaScript. Os botões −/+
  consultam o estado atual para preservar cada passo em cliques consecutivos.
- API ajustada real, Anthropic real, celular físico e leitores de tela continuam
  sem validação nesta entrega. O front permanece indisponível para ajustes até
  o servidor anunciar suporte; uma análise normal continua funcionando.

## Parte 5 — prioridades e ranking · 15/11/2026

`front-dev3` atualizada por fast-forward para a Main `2413f15`. Os controles de
água, solo e renda enviam os valores escolhidos; os cards preservam as três
primeiras posições do motor, com posição e score de hoje/futuro. A referência
atual permanece separada. Contrato vigente em [API.md](API.md).

- 132 testes Python (99 raiz e 33 backend), 102 JS e 1 Rust passaram.
- As quatro fixtures conferem com o motor atual, sem regeneração ou download.
- Integração HTTP real: 24 combinações de mês/horizonte, 6 referências, 5 conjuntos
  de prioridades e o caso de fevereiro que muda da 1ª para a 12ª posição no futuro.
- Build Rune/WASM e Vite passou. Motor/API não receberam mudanças locais.
- `tests/browser-priorities.js`: 83 verificações no Chromium, incluindo 8 com
  chat simulado (5 chamadas interceptadas, nenhuma consulta à Anthropic). Rankings,
  scores e análises vieram do motor real. Cobriu migração do rascunho, persistência,
  reanálise por prioridade, 0/0/0, referências, 0/1/2 opções, detalhe e foco/reset do chat.
- Após os ajustes finais de quebra de texto e nome acessível da opção selecionada,
  outras 9 verificações passaram: seleção dos controles, cancelamento de análise
  pendente e descarte de resposta antiga. Esse teste usou a API real com atraso
  controlado no transporte. A verificação de seleção também entrou no roteiro
  versionado (84 verificações na próxima execução completa).
- Capturas em `output/playwright/priorities-*.png`, na raiz do repositório,
  conferidas em 1440 px e 390 px. Sem erros de JavaScript.
- Celular físico, leitores de tela, Anthropic real e deploy não foram testados.
  Geada e chuva extrema da Main continuam restritas ao motor diário; dependem
  da API da Parte 8 para aparecer na tela.

Os registros abaixo são históricos e podem descrever os antigos cards por objetivo.

## Rodada de QA do front-end

Relatório de fluxos, falhas, layouts e correções em [QA_2026-11-14.md](QA_2026-11-14.md).
Inclui testes repetíveis de navegador em contextos isolados. As seções abaixo
preservam as verificações das entregas anteriores.

## Atualização — automação e Main com trigo

- `front-dev3` atualizada por fast-forward para a Main `f0c81b2`, com a entrega
  IBGE/PAM e trigo como décima cultura. Fixtures regeneradas pelo motor real;
  outubro/duas culturas passou a ter 26 opções viáveis e 74 descartadas.
- Validação local: **47 testes de motor/dados, 20 de backend, 31 JS e 1 Rust
  passaram**. Os quatro testes NetCDF que antes eram pulados agora executaram,
  com `backend/requirements-ci.txt`. Nenhum script de coleta foi executado.
- As **24 combinações HTTP** passaram na base atual. O novo smoke test conferiu
  API, três cenários, cobertura, HTML, CSS, JS e WASM no serviço local.
- Workflow validado com `actionlint` 1.7.12; formatação Rust e `git diff --check`
  passaram. A automação confere também a atualização das fixtures em cada execução.
- O build completo Linux e a execução do contêiner são etapas do GitHub Actions,
  independentes do Docker local. Resultado de cada commit em
  [Testes e Docker](https://github.com/Vlencio/happy_farmers_repo/actions/workflows/ci.yml).
  Escopo, cache e reprodução em [docs/CI.md](../../docs/CI.md).

## Atualização — clima por ponto, origem e ano seco

Entregas integradas: `motor-dev2` em `82cabe8` (P1/P3) e `dados-calor` em
`87cd7ec` (D1). Os registros abaixo desta seção são históricos.

- Backend: **20 testes passaram**. Cobrem repasse das tabelas do ponto, origem e
  aviso, falha simulada do POWER, invalidação antes de acessar a rede, seleção de
  células sem extrapolação, máscara de Minas (incluindo pontos de SP/GO/DF dentro
  da grade), demonstração sem rede e ano seco restrito à demonstração.
- Motor/dados: **43 passaram e 4 foram pulados** (testes de montagem NetCDF sem
  `xarray/netCDF4` instalados). Os testes de D1 e do cenário seco real passaram.
- Front: **31 testes JS e 1 Rust passaram**; inclui aviso de origem, fixture real
  do ano seco, contrato de dois cenários e preservação dos três objetivos.
- Build release Rune/WASM + Vite concluído. Revisão e patches do Rune preservados.
- Matriz HTTP pelo proxy Vite: **24 combinações** de mês/horizonte; 7 respostas
  vazias válidas e 5 timelines maiores que 12 meses. Agora confere origem de
  demonstração e os três cenários em cada resposta.
- POWER real via `/analyze`, sem executar scripts de download em lote:

| Ponto (lat, lon) | Primeira resposta | Fonte | Delta |
|---|---:|---|---|
| −18,9; −48,2 (Triângulo) | 2,04 s | POWER API | Regional |
| −16,7; −43,9 (norte) | 2,39 s | POWER API | Regional |
| −21,5; −45,4 (sul) | 2,55 s | POWER API | Regional |
| −18,9; −48,2, repetido | 0,08 s | Cache diário | Regional |

As três respostas reais foram validadas pelo adaptador JS e produziram três cards.
Tempos são observações locais, não garantia de resposta do serviço externo.

- Navegador: ano seco 2020/21 na timeline da demonstração, origem regional no
  resultado do norte, ressalva de chuva extrema, ponto de SP com aviso fora de
  Minas e erro de cobertura fora da grade. Avisos conferidos em **1280 × 720** e
  **390 × 844**, sem corte de texto. Estado de espera com seis minutos observado.
  Talhão original restaurado após os testes. Capturas locais, fora do Git:
  `test-results/climate-regional.jpg` e `climate-outside-mobile.jpg`.
- POWER indisponível foi exercitado por simulação no teste de integração da API;
  o serviço real respondeu nos pontos consultados. Não foi provocada uma espera
  real de seis minutos. Cancelamento e descarte de respostas antigas preservados.
- Docker ainda não executável neste computador: o pipe do daemon Linux não está
  disponível; a tentativa anterior registrou falha de virtualização WSL2. O build
  completo da imagem permanece para um ambiente com Docker funcional.
- Pacote de execução conferido separadamente: cópia isolada dos arquivos previstos
  no Dockerfile, sem dados brutos nem cache POWER prévio, front compilado com
  `VITE_API_BASE_URL=/` e `deploy.serve:app` em loopback. HTML, CSS, JS e WASM
  responderam; as 24 combinações HTTP passaram novamente. Um ponto regional
  retornou `power_api` e, na repetição, `power_arquivo`, comprovando a ligação
  e escrita/leitura do cache nesse pacote. Isso não substitui o build da imagem Linux.
- D2 (faixa por modelo), leitor de tela e celular físico continuam pendentes.
  O ano seco regional não foi fornecido e não é inventado pela API.

## Atualização — satélite no resumo do talhão

- Cartão “A sua fazenda” mostra Esri World Imagery e o contorno confirmado,
  com atribuição, sem precisar abrir novamente o editor. Os pixels são desenhados
  pelo Rune, mantendo a rolagem e o recorte do cartão.
- Projeção Web Mercator única para tiles e todos os anéis do GeoJSON. Furos usam
  preenchimento par/ímpar; partes de MultiPolygon são mantidas. O GeoJSON original
  não é alterado e a imagem não entra no `localStorage`.
- Carregamento limitado ao tamanho da prévia, com cancelamento e descarte de
  respostas antigas ao mudar/apagar a área. Rolagem sem mudança de tamanho não
  recarrega tiles. Falhas de satélite mantêm o contorno e uma mensagem.
- `npm test`: **29 passaram**, incluindo enquadramento desktop/celular, projeção,
  preservação de anéis e cancelamento de respostas antigas. `npm run test:rust`:
  **1 passou**. Build otimizado WASM + Vite e `cargo fmt --check` concluídos.
- Navegador: versão compilada conferida em **1280 × 720** e **390 × 844**. A área
  importada existente apareceu sobre o satélite. Um desenho novo de teste, com
  3 vértices e 16,39 ha, atualizou o resumo após “Usar esta área”. Limpeza, retorno
  ao exemplo e restauração após recarregar também conferidos. Sem erros no console.
  Teste de desenho em `localhost`, separado do rascunho em `127.0.0.1`.
- Capturas locais ignoradas pelo Git: `test-results/satellite-preview-desktop.jpg`,
  `satellite-preview-mobile.jpg` e `satellite-preview-drawn.jpg`.
- Limites: celular físico e falha de rede real não foram exercitados nesta rodada.
  As dependências P1/D1/D2, Docker e leitor de tela do registro anterior permanecem.

## Atualização — tarefas de Gabriel no plano de lacunas

Base `origin/main` em `c54fe17`, entrega na branch `front-dev3`. As seções abaixo
desta atualização registram a integração anterior; os números desta seção são os
da nova implementação.

- Build final `node scripts/build.mjs --release` concluído, com Rune/rune-kit e
  os patches na mesma revisão fixada. `cargo fmt --check` passou.
- `npm test`: **26 passaram**. Além dos casos anteriores: seleção comercial e
  fallback climático, outubro/fevereiro reais, campos de calor, longitude,
  terceiro cenário opcional/completo, rejeição de calendário ou métricas inválidas,
  identidade do contorno, não exposição dos dados em outro polígono e faixa de modelos.
- `npm run test:rust`: **1 passou**.
- `python -m unittest discover -s backend/tests -v`: **11 passaram**. Inclui
  metadados lidos dos arquivos reais, limites de longitude, repasse de tabelas
  opcionais, ausência de dados e agregação/validação dos deltas por modelo.
- `python -m unittest discover tests -v`: **29 testes do motor passaram**, sem
  alterações nos testes ou no motor. O `pytest` não está instalado nesse ambiente;
  não se está repetindo a contagem de 33/4 pulados citada no plano.
- `npm run test:integration`: **24 combinações passaram** contra API e proxy reais,
  incluindo os vencedores climáticos de outubro/fevereiro. Sete combinações sem
  sequência viável; cinco timelines selecionadas maiores que 12 meses.
- Entrada `deploy.serve` verificada com TestClient: HTML, loader WASM, GeoJSON,
  metadados e análise responderam corretamente. Conferência complementar por
  HTTP em `127.0.0.1:4180`, com bundle compilado usando `VITE_API_BASE_URL=/`:
  HTML, assets JS/CSS, loader e binário WASM, GeoJSON, `/health` e `/metadata`
  responderam corretamente. As **24 combinações** também passaram nessa entrada,
  sem o proxy Vite. O bundle local voltou ao modo padrão `/api` após a conferência.
  Dockerfile e exclusões atualizados;
  imagem Docker **não compilada**: ao iniciar o Docker Desktop, o WSL2 retornou
  `HCS_E_HYPERV_NOT_INSTALLED`, sem conseguir iniciar o daemon. Não foram
  alterados recursos do Windows nem a BIOS. Logs locais e ferramentas de QA
  ficam excluídos do contexto Docker.

No navegador, distribuição compilada em **1280 × 720** e **390 × 844**:

- Soja → Sorgo confirmado no card climático; detalhes da segunda cultura exibiram
  encaixe e dias de calor vindos do motor.
- Painel reconheceu tanto o GeoJSON de demonstração importado no rascunho existente
  quanto a área aberta pelo botão de exemplo. NDVI, frequências, relevo e A520 visíveis.
- Gráfico mensal com rolagem horizontal até dezembro em tela pequena; textos sem
  transbordamento. Glossário expandido, com os seis termos e avisos.
- G6: reproduzida ausência de ação com Enter quando o botão tinha o foco interno do
  Rune; Espaço e a ação acessível já funcionavam. Após o ajuste, navegação com Tab
  até o exemplo, foco visível e Enter abriram o mapa. Escape, foco inicial no botão
  de fechar, Tab entre controles nativos e confirmação da área foram exercitados.
- O teste de início vazio usou `localhost`, separado do rascunho existente em
  `127.0.0.1`; nenhum histórico do usuário foi removido.
- Nenhum erro no console da aba de teste final.

Capturas ignoradas pelo Git em `test-results/`: `gap-cards.jpg`, `gap-talhao.jpg`,
`gap-mobile.jpg`, `gap-example-focus.jpg` e `gap-example-enter.jpg`.

Limites desta rodada: P1/D2 ainda ausentes, então ano seco e faixa entre modelos
foram testados como extensões de contrato, sem prova de análise real em três cenários.
Clima por ponto aguarda D1. Acessibilidade verificada por foco/teclado/árvore, sem
escuta com NVDA/Narrador ou auditoria completa; celular físico também não testado.
Na tentativa complementar, NVDA 2026.3.1 portátil foi preparado a partir da
distribuição oficial, com assinatura válida da NV Access. O controle do navegador
foi encerrado pela ferramenta porque não conseguiu confirmar a URL da janela;
não houve teste de leitura ou ativação pelo NVDA. Nenhum ajuste de acessibilidade
do sistema foi feito para contornar esse bloqueio.
Avisos de código não utilizado do Rune, bundle JS acima de 500 kB e depreciação do
TestClient permanecem; não impediram build nem execução.

## Registro anterior da integração

## Ambiente e contrato

- Windows, Python 3.13, Node 22.12.0, npm 10.9.1, Rust 1.99.1/MSVC.
- Rune/rune-kit continuam em `56f01cb88e629db2c8b8877631cde00de7f37bd5`, com os quatro
  patches de dependência e o patch local do cache WASM.
- Contrato e motor da Main em `f75c784`; integração criada sobre `front-dev3`, que
  já continha a interface Rune e essa versão da Main.
- Build otimizado WASM + Vite concluído; `cargo fmt --check` e `git diff --check` passaram.
- Launcher testado: inicia FastAPI e Vite preview, responde HTML/health e encerra os
  dois serviços com Ctrl+C. Reinício na mesma porta confirmado.
- Nenhuma alteração em `motor/`, `data/`, scripts de coleta ou testes originais do motor.
  O motor foi executado para analisar os dados existentes; nenhum download de dados foi feito.

## Testes automatizados

- `npm test`: **18 testes passaram**. Inclui os seis testes GeoJSON existentes,
  contrato real exportado do motor, catálogo e acentos, ordem do histórico,
  culturas não suportadas, seleção por objetivo, receita × área, passagem por
  dezembro, balanço mensal, resposta vazia/inválida, erros HTTP/JSON e cancelamento.
- `npm run test:rust`: **1 teste passou**, formatos de safra/ano.
- `python -m unittest discover -s backend/tests -v`: **6 testes passaram**.
  Igualdade entre HTTP e chamada direta ao motor, catálogo da tabela, validação,
  uma cultura, prioridades parciais e CORS.
- `python -m unittest discover tests -v`: **25 testes existentes do motor passaram**.
- `npm run test:integration`: **24 combinações de mês/horizonte passaram**, usando
  HTTP via proxy Vite e o motor real. Sete respostas não tinham sequência viável;
  seis timelines selecionadas excediam 12 meses. Contagens, histórico enviado,
  quantidade de etapas e posição dos meses foram conferidos.

## Verificação no navegador

Interação e revisão visual com a distribuição compilada, em 1440 × 900 e 390 × 844:

- Rascunho da versão anterior restaurado com GeoJSON de aproximadamente 219,16 ha.
- Catálogo real, seleção de Crotalária, inclusão de histórico e análise com/sem contexto.
- Dois registros reordenados por setas; a nova ordem permaneceu ao recarregar.
- Opções de fevereiro/uma cultura e outubro/duas culturas alteraram os resultados.
- Outubro/duas, sem histórico: cards Soja → Milho, Soja → Crotalária e Soja → Girassol.
- Abertura dos três caminhos; troca para a segunda cultura atualizou calendário e números.
- Balanço de água mensal com hoje/futuro, incluindo rolagem horizontal em tela pequena.
- Abril/uma cultura: nenhum card inventado, aviso de ausência de sequência viável e
  nove motivos de descarte expansíveis.
- Períodos 2005–2024 / 2041–2060 e limitação geográfica visíveis na versão final.
- Registros criados para o teste removidos; contorno preservado, opções retornadas a outubro/duas.

Capturas locais, ignoradas pelo Git: `test-results/motor-cards.jpg`, `motor-water.jpg`,
`motor-empty.jpg` e `motor-mobile.jpg`. A captura dos cards foi atualizada após o build final.

Desenho, edição/importação e download com coordenadas preservadas já tinham sido
verificados na primeira versão. Esses módulos não foram modificados nesta integração;
os testes automatizados de geometria foram executados novamente.

## Limites

- Verificação de integração e apresentação, não validação científica das regras do motor.
- As tabelas continuam fixas ao talhão de demonstração; não há coleta climática por GeoJSON.
- Não houve teste em celular físico, Safari/iOS ou auditoria completa de acessibilidade.
  O Select e os campos de texto do runtime Rune ainda precisam de revisão com leitores de tela.
- Não foram exercitados separadamente todos os fallbacks gráficos do Rune.
- O build mantém avisos do Rune sobre código não utilizado no alvo web. O TestClient
  emite aviso de depreciação de httpx; os testes e a API concluíram normalmente.
