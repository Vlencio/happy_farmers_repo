# Integração Rune ↔ FastAPI ↔ motor

O contrato vigente é [docs/contrato_motor.md](../../docs/contrato_motor.md), de
15/11/2026, incluindo as prioridades da Parte 5 (`2413f15`) e os ajustes da Parte 6 (`2638e98`). Ele substitui a proposta anterior deste
arquivo (`schema_version`, `farm`, `recommendations`, `horizon_months`).

`backend/app.py` valida a entrada HTTP, seleciona as tabelas do ponto e chama
`motor.recomendar`, sem recalcular scores ou calendários. Com longitude, acrescenta
`origem` ao dicionário do motor. As tabelas locais e a grade são lidas no início do
processo; reinicie a API depois de atualizá-las. Somente o POWER do ponto pode ser
consultado ao vivo; os scripts de download regional não são executados pela API.

## Transporte

- `GET /health`: disponibilidade do serviço.
- `GET /metadata`: catálogo, origem e períodos climáticos; `demo_field`, `model_spread`
  e disponibilidade de clima por ponto (`point_climate_available: true`).
- `POST /analyze`: entrada do motor mais `lon` opcional; retorna a saída completa e a origem do clima.
- `GET /docs`: documentação OpenAPI gerada pelo FastAPI.
- Entradas inválidas: HTTP 422 com `detail` (texto ou lista de erros do FastAPI).

Vite serve `/api/*` por proxy para `http://127.0.0.1:8000/*`, tanto em desenvolvimento
quanto em preview. `VITE_API_BASE_URL` permite outro serviço compatível. CORS libera
`127.0.0.1:4173` e `localhost:4173`; `HAPPY_FARMERS_ORIGINS` aceita uma lista separada
por vírgulas quando necessário. Os servidores locais escutam apenas em loopback.

## Entrada da interface

```json
{
  "lat": -20.032,
  "lon": -48.526,
  "rotacao_atual": ["soja", "milho"],
  "prioridades": {"agua": 1, "solo": 1, "renda": 1},
  "horizonte": 2,
  "mes_plantio": 10,
  "precos": {}
}
```

| Origem na tela | Campo/uso |
|---|---|
| Contorno GeoJSON | `lat` e `lon`: centro da caixa envolvente; graus decimais WGS84 |
| Histórico, na ordem mostrada | `rotacao_atual`: IDs canônicos do catálogo; a última cultura é a anterior |
| Mês em que o talhão fica livre | `mes_plantio`, 1–12, padrão outubro |
| Próxima cultura / próximas duas | `horizonte`, 1 ou 2, padrão 2 |
| Suas prioridades: água, solo e renda | `prioridades`: cada controle de 0 a 3, padrão 1/1/1 |
| Simule outro clima | `ajuste: {chuva_pct, temp_c}`, somente após o servidor anunciar suporte; veja Parte 6 |
| Preços | Sem substituição dos preços da tabela |
| Área em hectares | Uso local: `receita_ha × area_ha` |
| Safra/ano e observações | Rascunho local; não são campos aceitos pelo motor |

O GeoJSON completo não é enviado. As culturas do seletor vêm do catálogo real;
acentos são apresentados ao usuário e convertidos para os IDs sem acento. Rascunhos
antigos são preservados: cultura não suportada bloqueia a análise com mensagem,
sem apagar nem ignorar o registro. Setas permitem corrigir a ordem de plantio.

`lon` aceita −180 a 180, com validação de finitude; é opcional para preservar clientes
anteriores. Não vai para `motor.recomendar`: a API usa latitude e longitude para
chamar a função entregue em `scripts/clima_ponto.py`. Sem longitude, mantém as
tabelas de demonstração, incluindo o ano seco opcional, sem consulta externa.

## Prioridades e três melhores pontuações — Parte 5

`web/api.mjs` valida `entrada`, `slots`, `clima`, `sequencias` e `descartadas`, então
converte os números para o modelo de apresentação consumido pelo Rune.

Os cards são `sequencias.slice(0, 3)`, preservando a ordem de `rank_hoje` devolvida
pelo motor. Não há seleção por receita, solo ou encaixe, nem desempate no front.
Se vierem duas, uma ou nenhuma sequência viável, a tela mostra somente as existentes.
Cada card apresenta `rank_hoje`, `hoje.score`, `rank_futuro` e `futuro.score`, também
disponíveis no detalhe. O ranking futuro usa os mesmos pesos, mas não muda a ordem dos cards.

Os três controles têm os níveis 0 (nada), 1 (pouco), 2 (médio) e 3 (muito).
`buildRequest` envia os valores escolhidos, sem normalizar. A API aceita quaisquer
números não negativos; o motor normaliza e, para 0/0/0, aplica pesos iguais.
A explicação do resultado usa os pesos normalizados de `entrada.prioridades`.
Em empate de score, o motor considera a média simples de água, solo e renda.
Peso zero não exclui culturas nem representa uma restrição de irrigação.

No planejamento, alterar prioridades salva o rascunho; a consulta começa em
“Analisar”. Nos resultados, cada mudança refaz `/analyze`, cancela a consulta
anterior e reinicia o chat. Respostas antigas não substituem o resultado novo.
Rascunhos anteriores sem `prioridades` são migrados para 1/1/1.

Exemplos reais do talhão de demonstração, livre em outubro, horizonte 2 e histórico
Soja → Milho (o histórico participa do índice de solo):

| Pesos água/solo/renda | Cards, na ordem |
|---|---|
| 1/1/1 ou 0/0/0 | Soja → Milho; Soja → Sorgo; Soja → Crotalária |
| 0/0/1 | Soja → Milho; Soja → Trigo; Soja → Girassol |
| 0/1/0 | Soja → Crotalária; Sorgo → Crotalária; Feijão → Crotalária |

Em fevereiro, com pesos iguais, Crotalária → Algodão é a 1ª de hoje (79,218)
e a 12ª no futuro (64,583). A tela formata os números recebidos, sem recalculá-los.
`encaixe` expressa adequação de temperatura/chuva/calor no motor; não é probabilidade
nem avaliação completa de eventos extremos. Receita é **bruta**, sem custos.

### Referência da rotação atual — Parte 1

A tela acrescenta a **rotação atual** às até três sugestões, sem alterar sua ordem.
Os cards mostram os mesmos indicadores: receita bruta por hectare
de hoje, índice de solo de hoje e encaixe climático futuro. A referência tem calendário,
detalhes e ano seco quando esses dados existem na resposta. Ela permanece separada
mesmo quando a mesma sequência está entre as três primeiras.

O adaptador produz `current_rotation: {status, title, description, strategy}` e
`comparison_facts` em cada estratégia. Esses são modelos locais de apresentação,
não novos campos exigidos da API. Após integrar a Main `ff2e22c`, a referência
consome o campo `atual` do topo da resposta do motor:

- `ready`: `atual.viavel: true`; busca os números em `sequencias` pelo `atual.id`.
- `discarded`: `atual.viavel: false`; mostra `atual.motivo`, sem números ou timeline.
- `no_history`: histórico vazio e `atual: null`; oferece acesso ao histórico.
- `unavailable`: resposta legada sem referência identificável com segurança.

O histórico de uma cultura pode ser repetido pelo motor em um horizonte de duas;
a tela explica essa repetição. Históricos maiores que o horizonte são aceitos:
`algodao, soja, milho` produz a referência `soja>milho`; com horizonte 1, o motor
devolve `soja`, por ser a cultura do slot equivalente. O front não refaz essa
escolha, alinha slots nem calcula uma referência substituta. O motor ainda supõe
uma cultura por slot, sem pousio ou safras puladas; safra/ano permanece local.

Respostas antigas sem o campo do topo continuam usando os marcadores das listas.
Somente nesse formato legado, um histórico maior que o horizonte permanece
indisponível, pois o motor antigo marcava as culturas mais antigas. Uma resposta
nova inconsistente (por exemplo, referência viável sem a sequência correspondente)
é rejeitada em vez de exibir números de outra estratégia.

Verificação após a integração em 14/11/2026: 73 testes do conjunto Python raiz,
20 do backend, 47 do front e 1 Rust aprovados, além do build WASM/web. As fixtures
regeneradas coincidem com as entregues na Main. A integração HTTP confere as 24
combinações de mês/horizonte e 6 casos de referência, incluindo histórico longo,
slot equivalente, descarte e ausência de histórico. As 26 verificações de navegador
em `tests/browser-current-rotation.js` passaram, com capturas em
`../output/playwright/current-rotation-*.png` (a partir da raiz `frontend/`).
A largura móvel é simulada; celular físico, leitor de tela e deploy do Railway
não foram verificados nesta rodada.

### Calendário e detalhes

Cada cultura gera uma etapa com plantio, colheita, espera e balanço mensal retornados
pelo motor. Os meses são desenrolados na ordem da sequência, preservando a passagem
por dezembro; “ano 1” é o ano inicial sem vincular a um ano civil específico.
A régua tem pelo menos 12 meses e se estende até o último mês da sequência.
A tabela mensal compara chuva, demanda e déficit de hoje/futuro, além de dias e Kc.
`encaixe_calor` e `dias_calor`, quando fornecidos, são validados e mostrados nos
detalhes da cultura. A ausência de penalização não é apresentada como tolerância comprovada.
Não são inventadas etapas de preparo ou regras agronômicas pelo front-end.

`sequencias: []` é um resultado válido: mostra ausência de alternativa viável e
oferece ajuste do calendário. `descartadas[].motivo` é convertido em explicações
expansíveis, tanto para ausência de plantio naquela safra quanto para época perdida.

## Simulação de chuva e temperatura — Parte 6

O motor da Main `d6d7a73` já aceita `ajuste`, mas a API ainda responde **422**
para esse campo. O front está preparado; a ativação depende da entrega abaixo.
O nome da capability é uma proposta de integração para Pedro, não um campo já
disponível no servidor atual:

```json
{"capabilities": {"ajuste": true}}
```

Com esse sinal booleano, os dois controles de “Simule outro clima” ficam ativos:
chuva entre −50% e +30%, em passos de 5%; temperatura entre 0 e +4 °C, em passos
de 0,5 °C. Podem ser arrastados ou operados por teclado e pelos botões −/+. O
rascunho preserva os valores; rascunhos anteriores começam em 0/0. Ajuste inválido
no rascunho é recuperado sem apagar histórico, calendário ou prioridades válidos.

No planejamento, a consulta começa em “Analisar fazenda”. Nos resultados, mudar
um controle invalida a análise e o chat; “Aplicar cenário” consulta os novos
números. Arrastar mostra a escolha provisória e só salva ao soltar; cancelar o
gesto preserva a escolha anterior. “Voltar ao clima sem ajuste” zera os dois campos.

Quando ambos são zero, `buildRequest` omite `ajuste`, preservando compatibilidade
com a API atual. Sem suporte, os controles ficam indisponíveis. Um rascunho com
valores não zero bloqueia a análise até ser zerado; a tela não ignora o cenário
salvo nem envia um campo que o servidor rejeita. Com suporte, um exemplo de envio é:

```json
{"ajuste": {"chuva_pct": -20, "temp_c": 2}}
```

Antes de exibir uma resposta, `assertAdjustmentApplied` exige os mesmos valores
em `entrada.ajuste`. Resposta sem o ajuste solicitado, divergente ou com um ajuste
não solicitado vira erro, e respostas de consultas canceladas são descartadas.
`web/scenario.mjs` valida e rotula os dados; não altera chuva, temperatura, ET0,
dias quentes, receita, score ou ranking. Os números continuam vindo do motor.

Resultados e detalhes exibem “Cenário hipotético”: é um **e se**, não uma previsão.
O mesmo ajuste vale para todos os meses e cenários, inclusive a base de 2020/21.
Quando ajustado, esse ano seco não é apresentado como observação original.
Com aumento de temperatura, a tela informa que os dias quentes são estimados por
interpolação ou extrapolação dos limiares existentes.

O chat recebe a resposta completa, incluindo `entrada.ajuste`, e os IDs dos novos
cards e da referência. Interpretar uma pergunta para mudar o cenário automaticamente
não faz parte desta entrega. O prompt do servidor ainda precisa contextualizar
os cenários ajustados como hipóteses.

**Mensagem para Pedro:**

> Pedro, o front da Parte 6 está preparado. Confirmei os 9 testes do motor e os
> números do caso −20% de chuva. A API atual ainda retorna 422 para `ajuste`.
> Falta aceitar esse objeto opcional no `/analyze`: `chuva_pct` entre −50 e +30,
> `temp_c` entre 0 e +4, ambos finitos e com padrão zero; repassar ao motor após
> selecionar o clima do ponto; e anunciar `capabilities.ajuste: true` no `/metadata`.
> O front envia os dois campos quando há ajuste e valida o retorno em
> `entrada.ajuste`. Sem ajuste, mantém a requisição anterior. No chat, o contexto
> já conserva `entrada.ajuste`; falta orientar o prompt de que os números ajustados
> são hipóteses, inclusive o ano seco, e não observações originais. Não alterei API
> nem motor. Depois da integração precisamos testar o fluxo HTTP real ajustado.

Para preparar os testes de navegador, execute da raiz:

```powershell
.\.venv\Scripts\python.exe frontend/scripts/export-scenario-fixtures.py
```

O comando usa somente as tabelas locais e grava seis respostas reais do motor em
`output/playwright/scenario-fixtures.json` (ignorado pelo Git). O roteiro
`tests/browser-scenarios.js` usa essas respostas ao simular o transporte futuro;
isso não substitui a validação do `/analyze` ajustado após a entrega da API.

## Solo entre as culturas — Parte 2

A Main `ff2e22c` já entrega `sequencias[].hoje/futuro/seco.descoberto`.
O front valida e apresenta esses números sem alterar as três sugestões, o score
ou o ranking. A rotação atual usa a mesma apresentação das sugestões.

- Nos cards: dias expostos nos primeiros 365 dias e chuva em solo exposto hoje.
- No detalhe: totais sem cultura e expostos, chuva de hoje/futuro/ano seco e um
  calendário de 12 meses com seleção para consultar a chuva de cada mês.
- As barras mostram proporções de dias com cultura, sem cultura com palhada e
  expostos sem palhada. Não representam a posição exata dos intervalos no mês.
- A janela começa no mês em que o talhão fica livre e termina após 365 dias.
  A timeline das culturas pode continuar além dela; não se extrapola a exposição.
- `indice_erosao`, quando recebido, aparece com sua comparação entre cenários e a
  explicação de que não representa perda de solo em t/ha. Ausência é diferente de zero.

`web/exposure.mjs` faz a validação e monta `Recommendation.exposure` para o Rune.
Meses omitidos no contrato têm zero dias sem cultura dentro da janela de 12 meses.
Dias, totais, ordem dos meses e consistência entre cenários são conferidos; somas
de chuva aceitam 0,01 mm de diferença pelo arredondamento do motor. Uma resposta
legada sem `descoberto` mantém os cards/calendários, com aviso de indisponibilidade.
Os limites da hipótese de palhada aparecem no próprio painel.

### Declividade integrada

A API integrada na Main `1519963` aceita `declividade_pct` opcional, finita entre
0 e 100, e repassa o campo ao motor. `getAnalysisSlope` habilita o envio quando
os metadados anunciam a capability abaixo e o contorno coincide com o talhão de
demonstração:

```json
{"capabilities": {"declividade_pct": true}}
```

Com esse sinal, o front envia `demo_field.terrain.decl_media_pct` validado
entre 0 e 100, preservando zero. Nome, proximidade, centro e área aproximada não
autorizam reutilizar a declividade. Para outros talhões, o campo continua omitido.
O front não calcula o índice de erosão nem consulta uma fonte de relevo nova.

Conferência real após essa integração: a tela enviou 4,05% e exibiu, para
Soja → Milho, os índices 34,7 / 34,2 / 24 (hoje / futuro / ano seco), recebidos
como 34,681 / 34,164 / 23,968 da API. Não houve simulação nesse teste.

Validação local em 14/11/2026: 61 testes JS, 1 teste Rust, build WASM/web e as
30 análises HTTP existentes passaram, com conferência dos totais mensais de
exposição. `tests/browser-exposure.js` passou 25 verificações (21 com a API atual
e 4 com suporte futuro explicitamente simulado) e cobre valores diferentes entre estratégias,
os 12 meses, seleção de mês, desktop/celular simulado e ausência do campo de
declividade no POST para a API atual. A simulação confirma o envio de 4,05% no
contorno exato, sua omissão em outro contorno e a exibição do índice com números
sintéticos identificados. Esse registro é anterior à integração da declividade;
as expectativas antigas de ausência do índice em `browser-exposure.js` precisam
ser atualizadas antes de reutilizar esse roteiro com a API nova.

## Riscos e lacunas por estratégia — Parte 3

O endpoint já repassa `sequencias[].avisos` (regra 17 do contrato). O adaptador
`web/warnings.mjs` valida a lista e transforma os dados para `Recommendation.warnings`,
com grupos `risks` e `gaps`. Não gera avisos por conta própria, altera índices ou
interfere na ordem das três sugestões. A referência atual recebe o mesmo tratamento.

- Os cards mostram as contagens separadas, um aviso de cada tipo com contexto e
  o número de avisos restantes no detalhe. O nome acessível inclui esse resumo.
- O painel “Riscos e lacunas desta estratégia” mostra a lista inteira, separada
  por tipo. Cada item identifica cultura/cenário/slot quando aplicável, explica o
  ponto de atenção e apresenta os dados que o motor usou.
- Os 11 códigos têm texto em português, com acentos e unidades. Valores monetários
  são receita bruta por hectare; os fatores são índices, não probabilidades.
- `avisos: []` significa apenas que as regras não sinalizaram avisos. Campo ausente
  em uma resposta legada significa indisponibilidade, sem presumir lista vazia.
- Código novo mantém o texto e os dados fornecidos, dentro do grupo indicado pelo
  motor. Formato inválido causa erro de contrato, em vez de omitir um aviso.

O ano seco observado (2020/21) é distinto do “ano ruim” do modo diário. O front
não ativa o modo diário nesta etapa. `fator_limitante` permanece baseado no cálculo
mensal; a limitação é explicada junto aos avisos. Benefícios específicos não são
deduzidos pelo front: além do critério do card, a tela usa a lista `beneficios`
entregue em `motor-diario` (`317f29a`), conforme a regra 18.

`web/benefits.mjs` valida os seis códigos e produz `Recommendation.benefits`.
Nos cards aparecem a contagem e o primeiro benefício; no detalhe, todos os itens
com cultura, cenário e dados. Fixação e palhada são atributos/hipóteses do motor,
não medições no talhão. Queda negativa de receita é apresentada como alta.
`clima_favoravel` refere-se apenas a hoje/futuro, sem incluir o ano seco. Código
novo preserva texto e evidências; lista ausente não é convertida em lista vazia.

### Pendências para Pedro e dados

Não falta campo de transporte para mostrar os avisos existentes. As colunas
`preco_status` e `temp_calor_c_status` ainda não existem em `culturas.csv`, embora
o motor já leia `<campo>_status`. Sem elas, os valores marcados como “memória” ou
“sem fonte” na documentação não geram `valor_a_conferir` nos resultados reais.
A lista estruturada de benefícios já foi entregue e está integrada à tela.

Validação da entrega inicial em 14/11/2026: 72 testes JS (11 de avisos), 1 teste Rust, build
WASM/web e 30 análises HTTP passaram. `tests/browser-warnings.js` passou 35
verificações: 31 sem simulação e 4 com respostas explicitamente simuladas para
campo ausente/lista vazia. O roteiro compara avisos da API real, rotação atual,
histórico ausente, acentos, dados, teclado (Tab/Enter) e largura móvel de 390 px.
As capturas `output/playwright/warnings-*.png`, relativas à raiz do repositório,
foram inspecionadas em desktop e celular simulado. Sem erros de JavaScript;
celular físico, leitor de tela e deploy não foram verificados nesta rodada.

**Mensagem para Pedro:**

> Pedro, integrei a `motor-diario`: os benefícios agora aparecem junto dos avisos,
> e o chat está ligado à capability, com foco nos cards e histórico reenviado a
> cada pergunta. Ainda faltam os status de origem com o Brenno: `preco_status`
> para feijão, girassol e algodão; `temp_calor_c_status` para girassol e trigo.
> No chat, precisamos alinhar a resposta ao limite de 4.000 caracteres por
> mensagem do histórico: hoje uma resposta maior provoca 422 na pergunta seguinte.
> Também vale rejeitar resposta vazia. O front já protege esses dois casos sem
> perder a pergunta ou truncar a resposta. Falta testar uma resposta real da
> Anthropic com credencial no servidor; localmente a capability está false.

## Chat sobre a análise

Contrato do endpoint entregue pelo Pedro: [docs/chat.md](../../docs/chat.md).
O front não chama o provedor diretamente nem recebe chaves. `web/chat.mjs` envia
`POST /chat` pelo mesmo endereço-base/proxy da análise. O painel Rune só é exibido
quando `/metadata.capabilities.chat === true` e existe um resultado de análise.

- `analise`: resposta original e completa do `/analyze`, preservada em memória.
- `foco`: IDs únicos das até três primeiras do ranking e da rotação atual viável.
  Referência descartada não é incluída. Não envia foco vazio;
  se não há estratégias viáveis, o envio fica bloqueado com explicação.
- `historico`: todos os pares de perguntas/respostas aceitos nessa conversa,
  na ordem, com `papel` e `texto`. A pergunta nova vai separada em `pergunta`.
- A pergunta aceita até 1.000 caracteres Unicode, após remover espaços nas pontas.
  Envio pelo botão ou Ctrl+Enter; durante a consulta o campo fica desabilitado.
- Cancelamento e timeout de cinco minutos preservam a pergunta e descartam a
  resposta tardia. 422, 502, 503, JSON inválido e resposta vazia viram erro local
  do chat, mantendo os cards e o histórico válido. `recusada: true` aparece com
  a mensagem recebida e uma indicação de que a pergunta não foi respondida.
- Sem armazenamento persistente do chat. Troca de área, histórico de culturas,
  opções, prioridades ou nova análise cancela a consulta e limpa a conversa. Navegar entre
  cards/detalhes conserva a conversa da mesma análise; “Nova conversa” a reinicia.
- Até dez pares completos (20 mensagens). O front ainda limita cada mensagem do
  histórico a 4.000 caracteres, embora o backend aceite 16.000 desde `dc841a1`.
  Se uma resposta ultrapassa o limite local, ela continua visível inteira,
  mas uma nova pergunta exige “Nova conversa”. Não há truncamento silencioso.

O painel informa antes do envio que pergunta, conversa e dados da análise em foco
(incluindo coordenadas e histórico de culturas) vão à Anthropic. Texto é renderizado
diretamente como texto simples pelo Rune, sem interpretar HTML ou Markdown.

Verificação após integrar `589b16b`: 122 testes Python (91 raiz + 31 backend),
97 JS (incluindo 12 de benefícios e 13 de chat), 1 Rust, 30 análises HTTP e build
WASM/web passaram. As três fixtures do motor conferem com a saída real. O SDK
declarado no backend foi instalado na `.venv`; nenhuma credencial foi configurada.
O servidor local anuncia `chat: false`; a geração real com Anthropic continua
sem validação. Testes do chat usam respostas de provedor simuladas.
`tests/browser-benefits.js` passou 36 verificações com a API real, sem simulação:
quatro cards, seis códigos, dados e escopo de cada benefício, referências distintas
e tela móvel de 390 px. Capturas desktop/mobile foram inspecionadas; sem erros de
JavaScript. Não foi necessário modificar o motor ou a API entregues pelo Pedro.
`tests/browser-chat.js` passou 38 verificações: 33 explicitamente simuladas (22
POSTs de chat interceptados) e 5 sem simulação, incluindo capability desligada,
benefícios reais e ausência de erros. Conferiu foco, análise e histórico exatos,
Ctrl+Enter, recusa, erros, limites, cancelamento, respostas antigas e nova análise.
Alertas e estados de espera/cancelamento expõem nome e texto acessíveis. As capturas
`output/playwright/chat-*.png` foram inspecionadas em desktop e 390 px. Nenhuma
chamada foi feita à Anthropic; celular físico e leitor de tela não foram testados.

## Contexto do talhão (G2)

`backend/field_context.py` lê somente arquivos já existentes:

- `demo_field.boundary`: contorno de `data/talhao_demo_2.geojson`.
- `demo_field.ndvi`: 12 meses de `data/talhao/ndvi_climatologia.csv`.
- `demo_field.terrain`: média, percentil 90 e máxima de `data/talhao/declividade.csv`.
- `demo_field.station`: identificação da A520 e offsets mensais de `data/clima_correcoes.csv`.
- `demo_field.sources`: resoluções, período e escopo dessas observações.

O painel só aparece com números se o **contorno completo** coincidir com o de
referência. A comparação aceita arquivo importado, ordem/orientação dos anéis e
Polygon/MultiPolygon equivalentes, sem tolerância de distância. Nome, tag `sample`,
centro e área aproximada não bastam. Mover um vértice retira o contexto demonstrativo.

NDVI abaixo de 0,35 indica possível solo descoberto **ou palhada**, não medição direta
da cobertura. Agosto tem frequência de 50%, setembro 60%, outubro 40%. O relevo e
essas frequências são fatos do talhão, não diferenciais de uma sequência.

Os arquivos necessários entram na imagem Docker; dados brutos continuam excluídos.
Sem esses arquivos opcionais, `demo_field` é `null`; arquivo presente e inválido
interrompe a carga, sem inventar valores.

## Ano seco e faixa dos modelos (G4)

O cenário seco da entrega P1 está ligado para a demonstração. A interface aceita **opcionalmente**
`clima.seco` com 12 meses e, em cada sequência viável, `rank_seco` e `seco` com a mesma
estrutura e faixas de `hoje`. O cenário precisa estar completo; calendários e dias
devem coincidir entre cenários e `renda` deve continuar em 0–1. Respostas parciais são
recusadas. Sem o cenário, a tela mantém hoje/futuro e informa sua indisponibilidade.

Quando recebido, adiciona fatos de receita por hectare/área e ranking/score, além do
terceiro valor na tabela mensal e nos detalhes. Legenda explícita: **hoje / futuro /
ano seco**. O ano observado é 2020/21, conforme `docs/plano_gap.md`; não é média nem
previsão. A seleção dos cards continua baseada no ranking de hoje; os números
futuros são comparações com os mesmos pesos.
O front não executa uma segunda análise com a tabela seca no lugar do futuro.
`carregar_dados()` continua retornando três tabelas. A API carrega o ano seco por
`carregar_clima_seco()` e passa como quinto argumento a `recomendar` apenas no fluxo
sem longitude ou quando `origem.hoje == "tabela_demo"`. Para outros pontos e para o
fallback do POWER, passa `None`: não associa o ano seco de demonstração a outra
fazenda. `clima_seco.csv` entra no Docker. Há fixture e teste com a saída real de P1.

D2 foi entregue por Breno em `dados-calor`, commit `5deed52` (15/11/2026), com
`data/clima_modelos.csv`: `modelo,mes,delta_chuva_mm,delta_tmin_c,delta_tmax_c`.
Essa entrega ainda não está integrada à `main` nem à `front-dev3`.
O leitor opcional exige 12 meses únicos e valores finitos
por modelo. Soma os deltas mensais de chuva e tira a média aritmética dos 12 deltas
de temperatura máxima; não pondera pelo número de dias. `/metadata.model_spread`
contém esses agregados, fonte, método e `scope: talhao_demo_2`. A tela calcula a faixa
entre modelos e avisa quando a chuva cruza zero. Sem o arquivo, informa que a faixa
ainda não está disponível. A faixa só é exibida para o contorno de demonstração,
com até duas casas decimais para temperatura e uma para chuva. Os extremos vêm da
resposta da API, sem valores fixados no front. Na entrega D2, a faixa é de
**+1,34 a +2,31 °C** e **−79,6 a +32,7 mm/ano**, com discordância no sinal da chuva.
É uma faixa entre modelos, não um intervalo de confiança.

Para validar antes do merge, `tests/fixtures/metadata-d2.json` registra a exportação
do checkout D2 isolado. A fixture canônica `tests/fixtures/metadata.json` permanece
compatível com os dados desta branch: o CI a regenera com `backend.export_fixture`
e exige igualdade. Após integrar o CSV, reiniciar a API e regenerar as fixtures
com `python -m backend.export_fixture` na raiz do projeto.

Essa faixa descreve o clima do talhão. O motor ainda calcula o futuro com a média
dos três modelos; a Parte 7 continua dependendo de Pedro para calcular e expor
faixas de receita e de rank por estratégia. Fora da demonstração, também faltam
deltas regionais separados por modelo.

## Clima por ponto (G5)

`backend/point_climate.py` faz a ligação com a entrega de dados:

- Seleciona a célula de 0,25° que contém o ponto em
  `data/nexgddp/regiao_mg/delta_mensal.csv`; nunca extrapola para uma célula distante.
- Até 25 km da demonstração, preserva o comportamento de D1: tabelas prontas,
  correção A520 e nenhuma consulta ao POWER. O aviso explica esse raio.
- Nos demais pontos, chama `clima_por_ponto` com os 12 deltas mensais da célula e
  `origem_delta="nex_regional"`. As duas tabelas devolvidas vão diretamente ao motor.
- Retorna `origem` com a proveniência de D1 e acrescenta `dentro_mg` e, quando o
  delta regional foi efetivamente usado, `celula_nex` (lat/lon/resolução).
- Preserva o aviso do provedor e acrescenta as limitações aplicáveis. A tela mostra
  `origem.aviso` em destaque nos resultados e na timeline, inclusive quando não há
  sequência viável.
- Fora de Minas, mas dentro da grade, continua com aviso de análise exploratória.
  Fora da cobertura ou em célula sem dados, responde 422 antes de chamar POWER.
  O aviso estadual usa o ponto enviado e a malha simplificada do IBGE versionada
  em `backend/geo/`; não verifica o polígono inteiro nem divisas cadastrais.
- A ressalva do Pedro sobre extremos de chuva no norte da grade aparece quando
  latitude > −17,1 e o delta regional foi usado. Nenhum dado científico foi corrigido.

## Dados e falhas

Se o POWER falhar ou entregar uma série insuficiente, D1 devolve as tabelas de
demonstração com `origem.hoje="fallback_tabela_demo"` e aviso explícito. A interface
não apresenta esse resultado como clima local. Falha de leitura dos arquivos vira
503 com mensagem; erro de entrada/cobertura vira 422. Os avisos são texto, sem HTML.

O cache diário já fornecido por D1 fica em `data/power/`, por ponto arredondado a
três casas decimais. Não há cache do ranking: trocar histórico ou opções recalcula
o motor. O Docker cria essa pasta; a escrita é opcional em ambientes somente de
leitura, conforme o provedor. Arquivos gerados ficam fora do Git e da imagem. Não
há coleta nova de NDVI, relevo ou estação para outras áreas.

A conexão inicial consulta o catálogo; se falhar, a análise fica indisponível até
reconectar. POST tem timeout de 6 minutos (POWER usa 300 s) e cancelamento. Mudar área, histórico
ou opções invalida a análise e aborta a chamada pendente; respostas antigas não
substituem o planejamento atual. Cancelar encerra a espera na tela; uma consulta
já iniciada no servidor pode terminar e preencher o cache. Não há fallback para fixture.

O pacote inclui `scripts/`, o delta regional, as tabelas de clima, a malha de Minas
e `requests` nas dependências. Os NetCDF brutos continuam fora do contexto Docker.

Fixtures em `tests/fixtures/` foram exportadas do motor e servem apenas aos testes.
`npm run test:integration`, com os serviços ativos, verifica as 24 combinações de
mês/horizonte via HTTP real e valida seu mapeamento para cards e calendário.
