# Contrato do motor — entradas e saída

> Rascunho de 14/11/2026, proposto pelo Dev 2 (motor). Se algo aqui não servir para dados ou front, avisem antes de mudar.

## Como chamar

```python
from motor import carregar_dados, recomendar

culturas, clima_hoje, clima_futuro = carregar_dados()   # lê os três CSVs
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro)   # dict pronto para json.dumps
```

- Demo: `python -m motor` (tabela) ou `python -m motor --json` (JSON completo, ~22 KB com 3 culturas).
- Testes: `python -m unittest discover tests`
- Rodar sempre da raiz do repo.

## Entrada 1 — o que vem da tela (`entrada`)

```json
{
  "lat": -20.032,
  "rotacao_atual": ["soja", "milho"],
  "prioridades": {"agua": 1, "solo": 1, "renda": 1},
  "horizonte": 2,
  "mes_plantio": 10,
  "precos": {"soja": 2300}
}
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `lat` | sim | Latitude do centro do talhão (graus, sul negativo). Entra no ET0 |
| `rotacao_atual` | não | Histórico, na ordem de plantio. A última cultura conta como "cultura anterior". Lista vazia = sem histórico |
| `prioridades` | não | Pesos de `agua`, `solo` e `renda`. Qualquer escala; o motor normaliza para somar 1. Sem nada = pesos iguais |
| `horizonte` | não (padrão 2) | 1 = próxima cultura, 2 = próximas duas |
| `mes_plantio` | não (padrão 10) | Mês em que o talhão fica livre para plantar (dia 1). Cada cultura entra no primeiro dia livre dentro da sua janela de plantio; a segunda, a partir de 10 dias depois do fim do ciclo da primeira (tempo de colheita) |
| `precos` | não | Preço editado pelo usuário, por cultura. Substitui o `preco` da tabela |

Nomes de cultura são exatamente os da coluna `cultura` do `culturas.csv`. Nome fora da tabela gera `ValueError`.

## Entrada 2 — tabelas de clima (Dev de dados)

`data/clima_hoje.csv` e `data/clima_futuro.csv`, 12 linhas cada, uma por mês.

| Coluna | Significado |
|---|---|
| `mes` | 1 a 12 |
| `chuva_mm` | Chuva total do mês (mm) |
| `tmin_c`, `tmax_c` | Média das mínimas e das máximas diárias (°C) |

- Hoje: POWER, média de 2005–2024 por mês.
- Futuro: hoje + (NEX-GDDP `ssp245` − `historical`), diferença média dos três modelos. Chuva nunca abaixo de zero.

## Entrada 3 — `data/culturas.csv` (Dev de dados)

Uma linha por cultura, UTF-8.

| Coluna | Unidade |
|---|---|
| `cultura` | Nome, usado como identificador no JSON |
| `ciclo_dias` | Dias do plantio à colheita (1 a 365) |
| `temp_min`, `temp_max` | °C, limites absolutos (temperatura média) |
| `temp_otima_min`, `temp_otima_max` | °C, faixa ótima (temperatura média) |
| `chuva_min`, `chuva_max` | mm de chuva **durante o ciclo**, não no ano |
| `kc_ini`, `kc_med`, `kc_fim` | Kc do FAO-56 |
| `fixa_n`, `cobre_solo` | `sim` ou `nao` |
| `preco` | R$ por tonelada (0 para planta de cobertura) |
| `produtividade` | Toneladas por hectare |
| `plantio_ini`, `plantio_fim` | Meses (1 a 12) em que a cultura pode ser plantada, os dois inclusive. A janela pode virar o ano: 9 e 3 = setembro a março |

A janela de plantio não vem do ECOCROP, que só tem faixas de clima. Sugestão de fonte: calendário de plantio da Conab ou o ZARC (MAPA). Só cabe uma janela por cultura; se a cultura tiver duas épocas separadas, usar a que cobre as duas ou a mais comum na região.

### Enquanto as tabelas finais não chegam

O motor lê de `data/provisorio/`:

- `culturas.csv`: 3 culturas (soja, milho, crotalária). Faixas de clima do ECOCROP; **Kc, preço, produtividade e janelas de plantio são de memória. Não usar na demo.**
- `clima_hoje.csv`, `clima_futuro.csv`: calculados dos arquivos de POWER e NEX-GDDP do repo, pelo método acima.

Quando as finais chegarem em `data/`, trocar `PROVISORIO` em `motor/motor.py`.

## Saída

```json
{
  "entrada": { "...": "a entrada, com prioridades já normalizadas" },
  "clima": {
    "hoje":   [{"mes": 1, "chuva_mm": 239.14, "tmin_c": 21.39, "tmax_c": 29.72, "et0_mm": 152.379}, "... 12 meses"],
    "futuro": ["... 12 meses"]
  },
  "sequencias": [
    {
      "id": "soja>milho",
      "culturas": ["soja", "milho"],
      "atual": true,
      "rank_hoje": 2,
      "rank_futuro": 2,
      "hoje": {
        "score": 76.652,
        "agua": 0.918,
        "solo": 0.381,
        "renda": 1.0,
        "receita_ha": 12470.292,
        "encaixe": 1.0,
        "culturas": [
          {
            "cultura": "milho",
            "mes_plantio": 2,
            "mes_colheita": 6,
            "ciclo_dias": 130,
            "encaixe_temp": 1.0,
            "encaixe_chuva": 1.0,
            "atendimento_hidrico": 0.812,
            "chuva_mm": 409.242,
            "etc_mm": 402.537,
            "deficit_mm": 75.83,
            "espera_dias": 0,
            "fator_sequencia": 1.1,
            "fator": 0.893,
            "receita_ha": 4910.292,
            "solo": 0.162,
            "meses": [
              {"mes": 2, "dias": 21, "kc": 0.3, "chuva_mm": 131.693, "etc_mm": 29.958, "deficit_mm": 0.0}
            ]
          }
        ]
      },
      "futuro": { "...": "mesma estrutura de hoje" }
    }
  ],
  "descartadas": [
    {
      "id": "soja>soja",
      "culturas": ["soja", "soja"],
      "atual": false,
      "motivo": {"cultura": "soja", "posicao": 2, "mes_livre": 2, "plantio_ini": 10, "plantio_fim": 12}
    }
  ]
}
```

`sequencias` vem ordenada por `rank_hoje` e só tem as sequências viáveis. As que plantam alguma cultura fora da janela vão para `descartadas`, sem score nem rank. Juntas somam 9 com horizonte 1 e 81 com horizonte 2 (tabela de 9 culturas). `sequencias` pode vir vazia.

| Campo | Significado |
|---|---|
| `atual` | `true` na sequência que repete a rotação atual. No máximo uma, e ela pode estar em `descartadas` |
| `descartadas[].motivo` | A cultura que ficou fora da janela, sua posição na sequência (1 ou 2), o mês em que o talhão ficou livre e a janela dela |
| `espera_dias` | Dias que o talhão ficou sem cultura esperando a janela abrir (0 a 30) |
| `rank_hoje`, `rank_futuro` | Posição (1 = melhor) em cada clima |
| `score` | 0 a 100. Média de `agua`, `solo` e `renda` com os pesos do usuário |
| `agua`, `solo`, `renda` | As três partes do score, de 0 a 1 |
| `receita_ha` | R$ por hectare, somando as culturas da sequência. O front multiplica pela área |
| `encaixe` | Pior encaixe de clima (temperatura ou chuva) entre as culturas, de 0 a 1 |
| `culturas[]` | Uma entrada por cultura, na ordem de plantio, com os números que explicam o score |
| `meses[]` | Balanço hídrico mês a mês da cultura. Serve para a timeline |

Para os cards: as três primeiras de `sequencias`. Para o LLM: mandar o item inteiro da sequência; ele explica os números, não calcula.

## Regras

1. **ET0** por Hargreaves, com `tmin_c`, `tmax_c` e latitude. Mesmo método nos dois climas.
2. **Calendário e janela de plantio:** cada cultura é plantada no primeiro dia livre que cai dentro da sua janela (`plantio_ini` a `plantio_fim`) e ocupa `ciclo_dias`. Depois do fim do ciclo, o talhão leva 10 dias para ser colhido e só então fica livre para a próxima cultura. Se a janela não estiver aberta, o talhão espera até 30 dias sem cultura, só acumulando chuva no solo. Se nem assim abrir, a sequência é descartada. A sequência pode passar de 12 meses; o clima se repete.
3. **Kc** ao longo do ciclo: `kc_ini` nos primeiros 20%, sobe até `kc_med` aos 45%, fica até 80%, desce até `kc_fim`.
4. **Balanço hídrico** dia a dia: demanda = Kc × ET0. A cultura usa a chuva do dia e a água guardada no solo (até 100 mm). `deficit_mm` é a demanda não atendida; `atendimento_hidrico` = 1 − déficit / demanda.
5. **Encaixe de temperatura:** 1 dentro da faixa ótima, 0 fora dos limites absolutos, linear entre os dois. Média sobre os dias do ciclo, com a temperatura média do mês.
6. **Encaixe de chuva:** chuva do ciclo contra `chuva_min` e `chuva_max`. Cai em proporção à falta ou ao excesso.
7. **Regras de sequência** (`fator_sequencia`): 0,85 se repete a cultura anterior; 1,10 se é não fixadora depois de fixadora de N; 1 nos outros casos.
8. **Receita** = preço × produtividade × `fator`, onde `fator` = menor entre encaixe de temperatura, encaixe de chuva e atendimento hídrico, vezes `fator_sequencia`.
9. **Partes do score:**
   - `agua` = 1 − déficit total / demanda total da sequência.
   - `solo` = média, por cultura, de (0,4 se fixa N + 0,4 se cobre o solo + 0,2 se é diferente da anterior) × o quanto a cultura cresce.
   - `renda` = receita da sequência ÷ a maior receita entre todas as sequências nos dois climas.

## Constantes provisórias (sem fonte, no topo de `motor/motor.py`)

| Constante | Valor | O que é |
|---|---|---|
| `CAD_MM` | 100 | Água que o solo guarda (mm) |
| `PENALIDADE_REPETICAO` | 0,85 | Fator ao repetir a cultura |
| `BONUS_APOS_FIXADORA` | 1,10 | Fator depois de fixadora de N |
| `PESO_SOLO` | 0,4 / 0,4 / 0,2 | Pesos de fixa N, cobre solo, diversidade |
| `FASES_KC` | 20% / 45% / 80% | Fases do Kc no ciclo |
| `ESPERA_MAX_DIAS` | 30 | Espera máxima pela janela de plantio |
| `DIAS_COLHEITA` | 10 | Dias entre o fim do ciclo e o talhão livre, igual para todas as culturas |

## Em aberto

Um problema do primeiro teste continua. A proposta muda as tabelas do Dev de dados, então ainda não foi implementada.

**Hoje e futuro dão quase o mesmo ranking.** Com médias mensais, o futuro é só +1,5 °C e +5% de ET0, e nenhuma cultura sai da faixa ótima. O que muda de verdade são os dias de calor: nos dados diários do NEX-GDDP, os dias acima de 35 °C passam de 33 para 82 por ano (os três modelos concordam). Proposta: uma coluna `dias_quentes` nas tabelas de clima (dias do mês com máxima acima de 35 °C) e uma regra de calor no motor.
