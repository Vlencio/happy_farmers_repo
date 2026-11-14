# Integração Rune ↔ FastAPI ↔ motor

O contrato vigente é [docs/contrato_motor.md](../../docs/contrato_motor.md), de
14/11/2026, com a regra de calor presente na Main em `c54fe17`. Ele substitui a proposta anterior deste
arquivo (`schema_version`, `farm`, `recommendations`, `horizon_months`).

`backend/app.py` somente valida a entrada HTTP, carrega as tabelas existentes e
chama `motor.recomendar`. Sua resposta é o dicionário do motor, sem reordenar,
recalcular ou alterar os resultados. As tabelas são lidas no início do processo;
reinicie a API depois de atualizá-las. Nenhum script de coleta é executado.

## Transporte

- `GET /health`: disponibilidade do serviço.
- `GET /metadata`: catálogo, origem e períodos climáticos; `demo_field`, `model_spread`
  e disponibilidade de clima por ponto (`point_climate_available`, hoje `false`).
- `POST /analyze`: entrada do motor mais `lon` opcional no transporte; retorna a saída completa do motor.
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
anteriores. Ainda não vai para `motor.recomendar`: a função de clima por ponto (D1)
não foi entregue. Enviar coordenadas não muda as tabelas climáticas por enquanto.

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

## Extensões preparadas (G4/G5)

O cenário seco depende da entrega P1 do motor. A interface já aceita **opcionalmente**
`clima.seco` com 12 meses e, em cada sequência viável, `rank_seco` e `seco` com a mesma
estrutura e faixas de `hoje`. O cenário precisa estar completo; calendários e dias
devem coincidir entre cenários e `renda` deve continuar em 0–1. Respostas parciais são
recusadas. Sem o cenário, a tela mantém hoje/futuro e informa sua indisponibilidade.

Quando recebido, adiciona fatos de receita por hectare/área e ranking/score, além do
terceiro valor na tabela mensal e nos detalhes. Legenda explícita: **hoje / futuro /
ano seco**. O ano observado é 2020/21, conforme `docs/plano_gap.md`; não é média nem
previsão. Os vencedores dos três objetivos continuam calculados em hoje/futuro.
O front não executa uma segunda análise com a tabela seca no lugar do futuro.
O backend já repassa `*app.state.tables`; P1 deve manter a ordem dos retornos de
`carregar_dados` compatível com `recomendar`. `clima_seco.csv` entra no Docker.

D2 ainda deve fornecer `data/clima_modelos.csv` com `modelo,mes,delta_chuva_mm,
delta_tmin_c,delta_tmax_c`. O leitor opcional exige 12 meses únicos e valores finitos
por modelo. Soma os deltas mensais de chuva e tira a média aritmética dos 12 deltas
de temperatura máxima; não pondera pelo número de dias. `/metadata.model_spread`
contém esses agregados, fonte, método e `scope: talhao_demo_2`. A tela calcula a faixa
entre modelos e avisa quando a chuva cruza zero. Sem o arquivo, informa que a faixa
ainda não está disponível. Não apresenta os números sugeridos no plano como dados
calculados pela aplicação. A faixa só é exibida para o contorno de demonstração.

G5 fica preparado pelo envio/validação de `lon`. A seleção de tabelas por ponto
continua pendente de D1 e de sua assinatura/proveniência; não há provedor fictício.

## Dados e falhas

O motor atual usa os CSVs climáticos do talhão de demonstração (-20.032, -48.526),
mesmo ao desenhar outra fazenda. Latitude só intervém se faltar ET0 na tabela;
as tabelas atuais já têm ET0. A interface informa essa limitação antes e depois da
análise. Não há consulta geográfica automática a NASA, estação ou solo.

A conexão inicial consulta o catálogo; se falhar, a análise fica indisponível até
reconectar. POST tem timeout de 45 segundos e cancelamento. Mudar área, histórico
ou opções invalida a análise e aborta a chamada pendente; respostas antigas não
substituem o planejamento atual. Não há fallback silencioso para fixture.

Fixtures em `tests/fixtures/` foram exportadas do motor e servem apenas aos testes.
`npm run test:integration`, com os serviços ativos, verifica as 24 combinações de
mês/horizonte via HTTP real e valida seu mapeamento para cards e calendário.
