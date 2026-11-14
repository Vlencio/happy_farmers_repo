# Contrato proposto · Happy Farmers v1

Proposta de integração para o responsável pelo backend Python/FastAPI.
O front-end não implementa o motor nem presume que este endpoint já exista.
As propriedades descritas aqui são consumidas por `web/api.mjs` e pelos tipos Rust.

## Requisição

`POST {VITE_API_BASE_URL}/analyze`, `Content-Type: application/json`.

```json
{
  "schema_version": "1.0",
  "farm": {
    "name": "Minha fazenda",
    "boundary": {
      "type": "Feature",
      "properties": { "name": "Minha fazenda" },
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[-48.53,-20.03],[-48.52,-20.03],[-48.52,-20.02],[-48.53,-20.03]]]
      }
    },
    "area_ha": 58.1
  },
  "history": [
    { "crop": "Soja", "season": "2025/26", "notes": "Pouca chuva no fim do ciclo" }
  ],
  "requested_objectives": ["income", "soil", "climate"],
  "horizon_months": 12
}
```

O exemplo ilustra a estrutura; a área deve ser recalculada no servidor, não confiada como entrada.
`boundary` é um Feature com Polygon ou MultiPolygon, em WGS84 `[longitude, latitude]`.
`history: []` significa que o usuário preferiu não informar histórico, e não que não houve cultivo.
A ordem do histórico é a de inclusão. Safras aceitas: ano (`2025`) ou par consecutivo/mesmo ano (`2025/26`, `2025/2026`).
Cultura pode ser texto livre em “Outra cultura”; o backend deve mapear ou explicar culturas não suportadas.

## Resposta 200

```text
{
  schema_version: "1.0",
  analysis_id: string,
  demo: boolean,
  summary: string,
  recommendations: [incomeRecommendation, soilRecommendation, climateRecommendation]
}
```

Exatamente uma recomendação de cada categoria. A mesma cultura pode vencer mais de um objetivo.
Na integração real, use `demo: false`; respostas de simulação do backend devem manter `demo: true`.
O front-end ordena os cards por renda, solo e clima, independentemente da ordem recebida.

Cada recomendação:

```json
{
  "category": "income",
  "crop": "Soja → milho",
  "metric": "R$ 8.450/ha",
  "metric_label": "Receita bruta ilustrativa / ciclo",
  "reason": "Texto curto explicando a escolha para este objetivo.",
  "tradeoff": "Limitações, riscos e o que se abre mão nesta alternativa.",
  "facts": [
    { "label": "Confiança", "value": "Não calculada • demonstração" }
  ],
  "timeline": [
    {
      "id": "preparo",
      "title": "Preparar o ciclo",
      "period": "Mês 1",
      "start_month": 1,
      "end_month": 1,
      "description": "Explicação da etapa.",
      "water": "Disponibilidade hídrica e clima nesta etapa.",
      "soil": "Cuidados com solo e manejo.",
      "risk": "Ponto de atenção ou lacuna de dados."
    }
  ]
}
```

Os valores acima são demonstração, não um cálculo agronômico. A fixture completa com as três
alternativas está em `web/demo.mjs`; ela pode ser usada em testes de contrato.

- `category`: `income`, `soil` ou `climate`.
- Strings são obrigatórias, não vazias, com até 2.000 caracteres; `analysis_id`, até 120.
- `facts`: de 1 a 6 pares de texto.
- `timeline`: de 1 a 12 etapas. Meses inteiros de 1 a 12, com início ≤ fim. O motor fornece a ordem.
- M01 é relativo ao início do ciclo; períodos reais podem ser explicados em `period`.
- Métricas chegam formatadas, com unidade e base temporal explícitas. O front-end não calcula scores ou receita.
- Quando não houver dado, retornar uma explicação como “Dados insuficientes” em vez de inventar um número.
- O frontend ainda não renderiza séries temporais de chuva/NDVI, probabilidades ou uma classificação completa.

## Integração e falhas

No desenvolvimento, o FastAPI precisa permitir CORS para `http://127.0.0.1:4173`
(e `http://localhost:4173` se essa URL for usada), método POST e cabeçalho Content-Type.
O cliente atual não envia cookies ou credenciais. Em produção, configure a origem real.

HTTP não-2xx, JSON inválido e resposta incompleta aparecem como erro. Não há fallback automático
para demo quando uma API está configurada. O timeout é de 45 s; o usuário pode cancelar.
Se contorno ou histórico mudarem, a chamada anterior é abortada e respostas atrasadas são ignoradas.
O backend deve validar os dados independentemente do cliente e definir seu próprio comportamento de cancelamento.
