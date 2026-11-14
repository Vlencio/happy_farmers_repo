# Integração Rune ↔ FastAPI ↔ motor

O contrato vigente é [docs/contrato_motor.md](../../docs/contrato_motor.md), de
14/11/2026, incluindo P1 de `motor-dev2` (`82cabe8`) e D1 de `dados-calor` (`87cd7ec`). Ele substitui a proposta anterior deste
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
| Pesos e preços | Pesos iguais, sem substituição dos preços da tabela |
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

## Saída e três objetivos

`web/api.mjs` valida `entrada`, `slots`, `clima`, `sequencias` e `descartadas`, então
converte os números para o modelo de apresentação consumido pelo Rune.

Os três cards seguem os objetivos pedidos por Gabriel. A sugestão “três primeiras”
no contrato do motor não é adotada: essas seriam as três melhores no score geral.

| Card | Seleção entre sequências viáveis | Empate |
|---|---|---|
| Maior renda | Maior `hoje.receita_ha` | Melhor `rank_hoje`, depois ID |
| Saúde do solo | Maior `hoje.solo` | Melhor `rank_hoje`, depois ID |
| Resiliência climática | Maior `futuro.encaixe` entre sequências em que **cada** `futuro.culturas[].receita_ha > 0`; se nenhuma passar, usa todas | Maior `futuro.agua`, depois ID |

Uma sequência pode aparecer em vários cards. `encaixe` expressa adequação de
temperatura/chuva/calor no motor; não é probabilidade nem avaliação completa de eventos extremos.
Solo e encaixe são exibidos na escala 0–100. Receita é **bruta**, sem custos.
Os scores/ranks gerais permanecem visíveis nos detalhes de cada alternativa.

### Referência da rotação atual — Parte 1

A tela acrescenta a **rotação atual** aos três objetivos, sem alterar a seleção dos
vencedores. Os quatro cards mostram os mesmos indicadores: receita bruta por hectare
de hoje, índice de solo de hoje e encaixe climático futuro. A referência tem calendário,
detalhes e ano seco quando esses dados existem na resposta. Ela permanece separada
mesmo quando a mesma sequência vence um objetivo.

O adaptador produz `current_rotation: {status, title, description, strategy}` e
`comparison_facts` em cada estratégia. Esses são modelos locais de apresentação,
não novos campos exigidos da API. A referência usa o marcador `atual` existente:

- `ready`: um único marcador em `sequencias`; usa os números recebidos.
- `discarded`: marcador em `descartadas`; mostra o motivo, sem números ou timeline.
- `no_history`: histórico vazio; oferece acesso à edição do histórico.
- `ambiguous`: histórico maior que o horizonte; não apresenta o marcador antigo
  como se identificasse as culturas mais recentes.
- `unavailable`: histórico informado sem marcador; informa a indisponibilidade.

O histórico de uma cultura pode ser repetido pelo motor em um horizonte de duas;
a tela explica essa repetição. O front não escolhe outras culturas, alinha slots
nem calcula uma referência substituta. A identificação definitiva ainda depende
das duas primeiras pendências da Parte 1. As fixtures reais atuais já cobrem
referência viável em outubro e descartada em fevereiro e foram preservadas.

**Mensagem para o responsável pelo motor/API:**

> Pedro, o front já mostra a referência da rotação atual junto dos três objetivos,
> usando `atual: true` em `sequencias` ou o motivo em `descartadas`. Para fechar a
> Parte 1, falta identificar a rotação pelas culturas mais recentes respeitando
> safra/safrinha e devolvê-la em campo próprio, com os mesmos indicadores das
> estratégias viáveis ou o motivo quando não couber no calendário. Hoje o marcador
> pega o começo do histórico; por isso o front informa comparação indisponível
> quando o histórico é maior que o horizonte. Quando definir o formato, atualize
> `docs/contrato_motor.md` e encaminhe uma resposta de exemplo para eu adaptar o
> consumo e as fixtures do front.

Verificação em 14/11/2026: `npm test` (45 testes), `npm run test:rust` (1 teste),
build WASM e build web aprovados. `tests/browser-current-rotation.js` passou 23
verificações contra a API local com o contorno de demonstração: quatro detalhes,
grade em 1440/1024/390 px, ausência de histórico, descarte, histórico longo e
resultado vazio. Capturas em `../output/playwright/current-rotation-*.png`
(a partir da raiz `frontend/`). A largura móvel foi simulada no navegador;
não houve teste em celular físico ou leitor de tela.

### Calendário e detalhes

Com as tabelas da Main em `c54fe17`, o card climático é Soja → Sorgo em outubro
e Sorgo → Soja em fevereiro. A regra evita escolher cobertura sem receita apenas
porque não há limiar de calor cadastrado; não altera o motor nem cria limites de calor.

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
previsão. Os vencedores dos três objetivos continuam calculados em hoje/futuro.
O front não executa uma segunda análise com a tabela seca no lugar do futuro.
`carregar_dados()` continua retornando três tabelas. A API carrega o ano seco por
`carregar_clima_seco()` e passa como quinto argumento a `recomendar` apenas no fluxo
sem longitude ou quando `origem.hoje == "tabela_demo"`. Para outros pontos e para o
fallback do POWER, passa `None`: não associa o ano seco de demonstração a outra
fazenda. `clima_seco.csv` entra no Docker. Há fixture e teste com a saída real de P1.

D2 ainda deve fornecer `data/clima_modelos.csv` com `modelo,mes,delta_chuva_mm,
delta_tmin_c,delta_tmax_c`. O leitor opcional exige 12 meses únicos e valores finitos
por modelo. Soma os deltas mensais de chuva e tira a média aritmética dos 12 deltas
de temperatura máxima; não pondera pelo número de dias. `/metadata.model_spread`
contém esses agregados, fonte, método e `scope: talhao_demo_2`. A tela calcula a faixa
entre modelos e avisa quando a chuva cruza zero. Sem o arquivo, informa que a faixa
ainda não está disponível. Não apresenta os números sugeridos no plano como dados
calculados pela aplicação. A faixa só é exibida para o contorno de demonstração.

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
