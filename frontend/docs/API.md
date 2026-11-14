# Integração Rune ↔ FastAPI ↔ motor

O contrato vigente é [docs/contrato_motor.md](../../docs/contrato_motor.md), de
14/11/2026, presente na Main em `f75c784`. Ele substitui a proposta anterior deste
arquivo (`schema_version`, `farm`, `recommendations`, `horizon_months`).

`backend/app.py` somente valida a entrada HTTP, carrega as tabelas existentes e
chama `motor.recomendar`. Sua resposta é o dicionário do motor, sem reordenar,
recalcular ou alterar os resultados. As tabelas são lidas no início do processo;
reinicie a API depois de atualizá-las. Nenhum script de coleta é executado.

## Transporte

- `GET /health`: disponibilidade do serviço.
- `GET /metadata`: IDs e nomes de culturas da tabela atual, origem e períodos climáticos.
- `POST /analyze`: recebe a entrada documentada pelo motor, retorna sua saída completa.
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
  "rotacao_atual": ["soja", "milho"],
  "prioridades": {"agua": 1, "solo": 1, "renda": 1},
  "horizonte": 2,
  "mes_plantio": 10,
  "precos": {}
}
```

| Origem na tela | Campo/uso |
|---|---|
| Contorno GeoJSON | `lat`: latitude média dos extremos norte/sul (centro da caixa envolvente) |
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

## Saída e três objetivos

`web/api.mjs` valida `entrada`, `slots`, `clima`, `sequencias` e `descartadas`, então
converte os números para o modelo de apresentação consumido pelo Rune.

Os três cards seguem os objetivos pedidos por Gabriel. A sugestão “três primeiras”
no contrato do motor não é adotada: essas seriam as três melhores no score geral.

| Card | Seleção entre sequências viáveis | Empate |
|---|---|---|
| Maior renda | Maior `hoje.receita_ha` | Melhor `rank_hoje`, depois ID |
| Saúde do solo | Maior `hoje.solo` | Melhor `rank_hoje`, depois ID |
| Resiliência climática | Maior `futuro.encaixe` | Maior `futuro.agua`, depois ID |

Uma sequência pode aparecer em vários cards. `encaixe` expressa adequação de
temperatura/chuva no motor; não é probabilidade nem avaliação de eventos extremos.
Solo e encaixe são exibidos na escala 0–100. Receita é **bruta**, sem custos.
Os scores/ranks gerais permanecem visíveis nos detalhes de cada alternativa.

Cada cultura gera uma etapa com plantio, colheita, espera e balanço mensal retornados
pelo motor. Os meses são desenrolados na ordem da sequência, preservando a passagem
por dezembro; “ano 1” é o ano inicial sem vincular a um ano civil específico.
A régua tem pelo menos 12 meses e se estende até o último mês da sequência.
A tabela mensal compara chuva, demanda e déficit de hoje/futuro, além de dias e Kc.
Não são inventadas etapas de preparo ou regras agronômicas pelo front-end.

`sequencias: []` é um resultado válido: mostra ausência de alternativa viável e
oferece ajuste do calendário. `descartadas[].motivo` é convertido em explicações
expansíveis, tanto para ausência de plantio naquela safra quanto para época perdida.

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
