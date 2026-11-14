# Contrato do motor — entradas e saída

> Versão de 14/11/2026, depois da junção com as tabelas do Dev de dados. O motor lê `data/culturas.csv`, `data/clima_hoje.csv` e `data/clima_futuro.csv` como estão hoje. Se o formato de alguma mudar, avisem.

## Como chamar

```python
from motor import carregar_dados, recomendar

culturas, clima_hoje, clima_futuro = carregar_dados()   # lê os três CSVs de data/
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro)   # dict pronto para json.dumps
```

- Demo: `python -m motor` (tabela) ou `python -m motor --json` (JSON completo, ~85 KB medido com as 9 culturas, antes do trigo).
- Testes: `python -m unittest discover tests`. Usam tabelas fixas em `tests/dados/`, com valores de teste.
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
| `lat` | sim | Latitude do centro do talhão (graus, sul negativo). Só é usada se a tabela de clima vier sem `et0_mm` |
| `rotacao_atual` | não | Histórico, na ordem de plantio. A última cultura conta como "cultura anterior". Lista vazia = sem histórico |
| `prioridades` | não | Pesos de `agua`, `solo` e `renda`. Qualquer escala; o motor normaliza para somar 1. Sem nada = pesos iguais |
| `horizonte` | não (padrão 2) | 1 = próxima cultura, 2 = próximas duas |
| `mes_plantio` | não (padrão 10) | Mês em que o talhão fica livre (dia 1). Define o primeiro slot: de julho a dezembro é a safra; de janeiro a junho, a safrinha |
| `precos` | não | Preço editado pelo usuário, por cultura, em R$/t. Substitui o `preco` da tabela |

Nomes de cultura são exatamente os da coluna `cultura` do `culturas.csv`, hoje sem acento (`feijao`, `crotalaria`). Nome fora da tabela gera `ValueError`.

## Entrada 2 — tabelas de clima

`data/clima_hoje.csv` e `data/clima_futuro.csv`, de `scripts/montar_clima.py`. Detalhes em `docs/colunas_dados.md`, seção 6.

| Coluna | Uso no motor |
|---|---|
| `mes` | 1 a 12 |
| `chuva_mm` | Chuva do mês, no balanço hídrico e no encaixe de chuva |
| `tmin_c`, `tmax_c` | Encaixe de temperatura (média das duas) |
| `et0_mm` | Opcional. Se vier, o motor usa esse ET0 e não recalcula. Se não vier, calcula por Hargreaves com `tmin_c`, `tmax_c` e `lat` |

As tabelas atuais trazem `et0_mm`, calculado com as temperaturas do POWER sem a correção da estação A520. Por isso o motor não recalcula.

## Entrada 3 — `data/culturas.csv`

De `scripts/montar_culturas.py`. Detalhes em `docs/colunas_dados.md`, seção 5, e `docs/culturas_fontes.md`.

| Coluna | Uso no motor |
|---|---|
| `cultura` | Identificador no JSON |
| `ciclo_dias` | Dias do plantio ao fim do ciclo (1 a 365) |
| `temp_min`, `temp_max`, `temp_otima_min`, `temp_otima_max` | Encaixe de temperatura |
| `chuva_min`, `chuva_max` | Encaixe de chuva, comparado com a chuva **do ciclo** |
| `kc_ini`, `kc_med`, `kc_fim` | Demanda de água |
| `fixa_n`, `cobre_solo` | 1/0 (ou sim/nao). Parte de solo do score e bônus de sequência |
| `mes_plantio_safra`, `mes_plantio_safrinha` | Mês de plantio em cada slot. Vazio = a cultura não entra naquele slot |
| `preco` | R$/t |
| `produtividade`, `produtividade_safrinha` | t/ha em cada slot. Safrinha vazia = usa a da safra |

As outras colunas (`especie_ecocrop`, `chuva_otima_*`, `ciclo_ecocrop_*`) não são lidas.

## Saída

```json
{
  "entrada": { "...": "a entrada, com prioridades já normalizadas" },
  "slots": ["safra", "safrinha"],
  "clima": {
    "hoje":   [{"mes": 1, "chuva_mm": 239.14, "tmin_c": 20.22, "tmax_c": 30.93, "et0_mm": 152.35}, "... 12 meses"],
    "futuro": ["... 12 meses"]
  },
  "sequencias": [
    {
      "id": "soja>milho",
      "culturas": ["soja", "milho"],
      "atual": true,
      "rank_hoje": 1,
      "rank_futuro": 1,
      "hoje": {
        "score": 82.124,
        "agua": 0.918,
        "solo": 0.546,
        "renda": 1.0,
        "receita_ha": 14284.203,
        "encaixe": 1.0,
        "culturas": [
          { "...": "soja, na safra" },
          {
            "cultura": "milho",
            "slot": "safrinha",
            "mes_plantio": 2,
            "mes_colheita": 6,
            "ciclo_dias": 135,
            "espera_dias": 0,
            "encaixe_temp": 1.0,
            "encaixe_chuva": 1.0,
            "atendimento_hidrico": 0.819,
            "chuva_mm": 440.598,
            "etc_mm": 421.529,
            "deficit_mm": 76.17,
            "fator_sequencia": 1.1,
            "fator": 0.901,
            "receita_ha": 5953.803,
            "solo": 0.492,
            "meses": [
              {"mes": 2, "dias": 26, "kc": 0.3, "chuva_mm": 163.048, "etc_mm": 37.429, "deficit_mm": 0.0}
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
      "motivo": {"cultura": "soja", "posicao": 2, "slot": "safrinha", "mes_livre": 2, "mes_plantio": null}
    },
    {
      "id": "algodao>milho",
      "culturas": ["algodao", "milho"],
      "atual": false,
      "motivo": {"cultura": "milho", "posicao": 2, "slot": "safrinha", "mes_livre": 5, "mes_plantio": 2}
    }
  ]
}
```

`sequencias` vem ordenada por `rank_hoje` e só tem as sequências viáveis. As outras vão para `descartadas`, sem score nem rank. Juntas somam N com horizonte 1 e N² com horizonte 2, sendo N o número de culturas da tabela. Com a tabela atual (10 culturas, com o trigo) e talhão livre em outubro, são 26 viáveis e 74 descartadas. `sequencias` pode vir vazia.

| Campo | Significado |
|---|---|
| `slots` | O slot de cada posição da sequência, na ordem |
| `atual` | `true` na sequência que repete a rotação atual. No máximo uma, e ela pode estar em `descartadas` |
| `rank_hoje`, `rank_futuro` | Posição (1 = melhor) em cada clima |
| `score` | 0 a 100. Média de `agua`, `solo` e `renda` com os pesos do usuário |
| `agua`, `solo`, `renda` | As três partes do score, de 0 a 1 |
| `receita_ha` | R$ por hectare, somando as culturas da sequência. O front multiplica pela área |
| `encaixe` | Pior encaixe de clima (temperatura ou chuva) entre as culturas, de 0 a 1 |
| `culturas[]` | Uma entrada por cultura, na ordem de plantio, com os números que explicam o score |
| `espera_dias` | Dias que o talhão ficou sem cultura esperando o mês de plantio |
| `meses[]` | Balanço hídrico mês a mês da cultura. Serve para a timeline |
| `descartadas[].motivo` | A cultura que não coube, sua posição (1 ou 2), o slot, o mês em que o talhão ficou livre e o mês de plantio dela no slot. `mes_plantio` nulo = a cultura não é plantada naquele slot; preenchido = o talhão só ficou livre depois desse mês |

Para os cards: as três primeiras de `sequencias`. Para o LLM: mandar o item inteiro da sequência; ele explica os números, não calcula.

## Regras

1. **ET0:** a coluna `et0_mm` da tabela de clima; sem ela, Hargreaves.
2. **Slots:** cada posição da sequência é um slot. Talhão livre de julho a dezembro: safra e depois safrinha. Livre de janeiro a junho: safrinha e depois a safra seguinte.
3. **Época de plantio:** a cultura entra no mês de plantio dela naquele slot: no dia em que o talhão fica livre, se cair dentro do mês, ou no dia 1 do mês, se ainda não chegou. Enquanto espera, o solo só acumula chuva. A sequência é descartada se a cultura não tem mês naquele slot ou se o talhão só fica livre depois do mês (espera de mais de meio ano).
4. **Tempo de colheita:** o talhão fica livre 10 dias depois do fim do ciclo.
5. **Kc** ao longo do ciclo: `kc_ini` nos primeiros 20%, sobe até `kc_med` aos 45%, fica até 80%, desce até `kc_fim`.
6. **Balanço hídrico** dia a dia: demanda = Kc × ET0. A cultura usa a chuva do dia e a água guardada no solo (até 100 mm). `deficit_mm` é a demanda não atendida; `atendimento_hidrico` = 1 − déficit / demanda.
7. **Encaixe de temperatura:** 1 dentro da faixa ótima, 0 fora dos limites absolutos, linear entre os dois. Média sobre os dias do ciclo, com a temperatura média do mês.
8. **Encaixe de chuva:** chuva do ciclo contra `chuva_min` e `chuva_max`. Cai em proporção à falta ou ao excesso.
9. **Regras de sequência** (`fator_sequencia`): 0,85 se repete a cultura anterior; 1,10 se é não fixadora depois de fixadora de N; 1 nos outros casos.
10. **Receita** = preço × produtividade do slot × `fator`, onde `fator` = menor entre encaixe de temperatura, encaixe de chuva e atendimento hídrico, vezes `fator_sequencia`.
11. **Partes do score:**
    - `agua` = 1 − déficit total / demanda total da sequência.
    - `solo` = média, por cultura, de (0,4 se fixa N + 0,4 se cobre o solo + 0,2 se é diferente da anterior) × o quanto a cultura cresce.
    - `renda` = receita da sequência ÷ a maior receita entre as sequências viáveis nos dois climas.

## Constantes provisórias (sem fonte, no topo de `motor/motor.py`)

| Constante | Valor | O que é |
|---|---|---|
| `CAD_MM` | 100 | Água que o solo guarda (mm) |
| `PENALIDADE_REPETICAO` | 0,85 | Fator ao repetir a cultura |
| `BONUS_APOS_FIXADORA` | 1,10 | Fator depois de fixadora de N |
| `PESO_SOLO` | 0,4 / 0,4 / 0,2 | Pesos de fixa N, cobre solo, diversidade |
| `FASES_KC` | 20% / 45% / 80% | Fases do Kc no ciclo |
| `DIAS_COLHEITA` | 10 | Dias entre o fim do ciclo e o talhão livre, igual para todas as culturas |
| `ESPERA_MAX_DIAS` | 182 | Espera máxima pelo mês de plantio; mais que isso, a época do slot já passou |

## Em aberto

1. **Chuva do ECOCROP: anual ou do ciclo?** `docs/culturas_fontes.md` diz que `RMIN`/`RMAX` são de chuva anual (de memória). O motor compara com a chuva do ciclo. Com a anual (1.242 mm), o sorgo (`chuva_max` = 700) seria penalizado sempre. Falta conferir na documentação da FAO.
2. **Mês de plantio é um mês só.** Uma cultura de safra que libera o talhão no dia 1 de março já não deixa plantar nada de fevereiro. Hoje isso acontece com o sorgo de safra: só a crotalária (março) cabe depois dele.
3. **Calor.** Com as 9 culturas, hoje e futuro já dão rankings diferentes (14 das 22 sequências mudam de posição, puxadas pelo feijão, que tem faixa ótima até 25 °C). As três primeiras não mudam. As médias mensais ainda escondem os dias de calor: nos dados diários do NEX-GDDP, os dias acima de 35 °C passam de 33 para 82 por ano. Proposta, ainda não implementada: uma coluna `dias_quentes` nas tabelas de clima e uma regra de calor no motor.
