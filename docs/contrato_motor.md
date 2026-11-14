# Contrato do motor — entradas e saída

> Versão de 14/11/2026, com a regra de calor, o ano seco opcional e o modo diário opcional. O motor lê `data/culturas.csv`, `data/clima_hoje.csv` e `data/clima_futuro.csv` como estão hoje, e `data/clima_seco.csv` e a série diária do POWER se forem pedidos. Se o formato de alguma mudar, avisem.

## Como chamar

```python
from motor import carregar_clima_seco, carregar_dados, recomendar

culturas, clima_hoje, clima_futuro = carregar_dados()   # lê os três CSVs de data/
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro)   # dict pronto para json.dumps

# com o ano seco como terceiro cenário (opcional):
clima_seco = carregar_clima_seco()   # data/clima_seco.csv; None se o arquivo não existe
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro, clima_seco)
```

Sem `clima_seco` (ou com `None`), a saída é a mesma de antes: só `hoje` e `futuro`. Quem já chama `recomendar(entrada, *carregar_dados())` não precisa mudar nada.

```python
# com o modo diário (opcional): cada sequência em cada ano da série diária
from motor import carregar_diario
diario = carregar_diario()   # POWER diário do talhão de demonstração; None se o arquivo não existe
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro, diario=diario)
```

Sem `diario` (ou com `None`), nada muda. Com ele, a saída ganha os campos `diario`, descritos em "Modo diário". Os campos que já existiam continuam idênticos.

- Demo: `python -m motor` (tabela, com o resumo do modo diário) ou `python -m motor --json` (JSON completo). `--mes 2` troca o mês em que o talhão fica livre.
- Tamanho do JSON sem indentação, com as 10 culturas e outubro: ~105 KB só com hoje e futuro; ~217 KB com o modo diário (fevereiro: ~137 KB e ~292 KB).
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
  "precos": {"soja": 2300},
  "declividade_pct": 4.05
}
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `lat` | sim | Latitude do centro do talhão (graus, sul negativo). Só é usada se a tabela de clima vier sem `et0_mm` |
| `rotacao_atual` | não | Histórico, na ordem de plantio, uma cultura por slot. A última cultura conta como "cultura anterior", e as mais recentes definem a rotação atual (ver "Rotação atual"). Lista vazia = sem histórico |
| `prioridades` | não | Pesos de `agua`, `solo` e `renda`. Qualquer escala; o motor normaliza para somar 1. Sem nada = pesos iguais |
| `horizonte` | não (padrão 2) | 1 = próxima cultura, 2 = próximas duas |
| `mes_plantio` | não (padrão 10) | Mês em que o talhão fica livre (dia 1). Define o primeiro slot: de julho a dezembro é a safra; de janeiro a junho, a safrinha |
| `precos` | não | Preço editado pelo usuário, por cultura, em R$/t. Substitui o `preco` da tabela |
| `declividade_pct` | não | Declividade média do talhão, em %. Se vier, cada sequência ganha `descoberto.indice_erosao`. Não muda score nem rank. Para o talhão de demonstração: 4,05 (`data/talhao/declividade.csv`) |

Nomes de cultura são exatamente os da coluna `cultura` do `culturas.csv`, hoje sem acento (`feijao`, `crotalaria`). Nome fora da tabela gera `ValueError`.

## Entrada 2 — tabelas de clima

`data/clima_hoje.csv` e `data/clima_futuro.csv`, de `scripts/montar_clima.py`. Detalhes em `docs/colunas_dados.md`, seção 6.

| Coluna | Uso no motor |
|---|---|
| `mes` | 1 a 12 |
| `chuva_mm` | Chuva do mês, no balanço hídrico e no encaixe de chuva |
| `tmin_c`, `tmax_c` | Encaixe de temperatura (média das duas) |
| `et0_mm` | Opcional. Se vier, o motor usa esse ET0 e não recalcula. Se não vier, calcula por Hargreaves com `tmin_c`, `tmax_c` e `lat` |
| `dias_acima_NN` | Dias do mês com máxima acima de NN °C. Regra de calor. Precisa existir uma coluna para cada limiar usado em `temp_calor_c`; se faltar, o motor dá `ValueError` |

As tabelas atuais trazem `et0_mm`, calculado com as temperaturas do POWER sem a correção da estação A520. Por isso o motor não recalcula.

`dias_quentes` não é lido.

`data/clima_seco.csv` tem o mesmo formato e entra como terceiro argumento de clima, opcional. É a safra 2020/21, o ano agrícola (julho a junho) com menos chuva no POWER de 2005 a 2024. Diferenças para as outras duas tabelas:

- É **um ano real**, não uma média de 20 anos. Os dias de calor são contagens inteiras daquele ano.
- As linhas vão de janeiro a dezembro, mas julho a dezembro são de 2020 e janeiro a junho, de 2021. Uma sequência que passa de junho para julho volta ao começo do mesmo ano seco.
- Precisa das mesmas colunas `dias_acima_NN`; se faltar alguma, o motor dá `ValueError`.

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
| `temp_calor_c` | Opcional. Máxima diária (°C) que prejudica o florescimento. Vazio = a regra de calor não se aplica à cultura |

As outras colunas (`especie_ecocrop`, `chuva_otima_*`, `ciclo_ecocrop_*`) não são lidas.

## Saída

```json
{
  "entrada": { "...": "a entrada, com prioridades já normalizadas" },
  "slots": ["safra", "safrinha"],
  "atual": {"id": "soja>milho", "culturas": ["soja", "milho"], "viavel": true, "motivo": null},
  "clima": {
    "hoje":   [{"mes": 1, "chuva_mm": 239.14, "tmin_c": 20.22, "tmax_c": 30.93, "et0_mm": 152.35, "dias_acima_32": 9.6, "dias_acima_35": 1.85, "dias_acima_36": 1.4, "dias_acima_38": 0.5}, "... 12 meses"],
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
        "score": 81.988,
        "agua": 0.918,
        "solo": 0.542,
        "renda": 1.0,
        "receita_ha": 14170.702,
        "encaixe": 0.986,
        "descoberto": {
          "dias": 115, "dias_expostos": 10, "chuva_mm": 145.106, "chuva_exposta_mm": 74.256, "indice_erosao": 34.681,
          "meses": [{"mes": 1, "dias": 8, "dias_expostos": 8, "chuva_mm": 61.714, "chuva_exposta_mm": 61.714}, "..."]
        },
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
            "encaixe_calor": 0.986,
            "dias_calor": 0.67,
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

Com `clima_seco`, a saída ganha três campos, com a mesma estrutura dos de hoje e futuro:

```json
{
  "clima": {"hoje": ["..."], "futuro": ["..."], "seco": ["... 12 meses"]},
  "sequencias": [
    {
      "id": "soja>milho",
      "rank_hoje": 1,
      "rank_futuro": 1,
      "rank_seco": 1,
      "hoje": { "...": "..." },
      "futuro": { "...": "..." },
      "seco": { "score": 59.509, "agua": 0.663, "renda": 0.729, "...": "mesma estrutura de hoje" }
    }
  ]
}
```

`rank_hoje`, `rank_futuro`, `hoje`, `futuro`, a ordem de `sequencias` e `descartadas` não mudam com o ano seco.

`sequencias` vem ordenada por `rank_hoje` e só tem as sequências viáveis. As outras vão para `descartadas`, sem score nem rank. Juntas somam N com horizonte 1 e N² com horizonte 2, sendo N o número de culturas da tabela. Com a tabela atual (10 culturas, com o trigo) e talhão livre em outubro, são 26 viáveis e 74 descartadas. `sequencias` pode vir vazia.

| Campo | Significado |
|---|---|
| `slots` | O slot de cada posição da sequência, na ordem |
| `atual` (no topo) | A rotação atual, para comparar com as outras. `null` sem histórico. `viavel: true` = os números dela estão no item de `sequencias` com o mesmo `id`. `viavel: false` = ela não cabe no calendário; `motivo` tem o mesmo formato de `descartadas[].motivo` |
| `atual` (em cada sequência) | `true` na sequência que repete a rotação atual. No máximo uma, e ela pode estar em `descartadas` |
| `rank_hoje`, `rank_futuro`, `rank_seco` | Posição (1 = melhor) em cada clima. `rank_seco` só existe se o ano seco foi passado |
| `score` | 0 a 100. Média de `agua`, `solo` e `renda` com os pesos do usuário |
| `agua`, `solo`, `renda` | As três partes do score, de 0 a 1 |
| `receita_ha` | R$ por hectare, somando as culturas da sequência. O front multiplica pela área |
| `encaixe` | Pior encaixe de clima (temperatura, chuva ou calor) entre as culturas, de 0 a 1 |
| `descoberto` | Solo sem cultura nos 365 dias a partir do talhão livre (regra 15). `dias` e `chuva_mm`: dias sem cultura em pé e a chuva que cai neles. `dias_expostos` e `chuva_exposta_mm`: a parte desses dias sem palhada da cultura anterior. `indice_erosao` só existe se a entrada trouxe `declividade_pct`. `meses[]`: os mesmos quatro números por mês, na ordem do calendário a partir do talhão livre; só os meses com algum dia sem cultura |
| `culturas[]` | Uma entrada por cultura, na ordem de plantio, com os números que explicam o score |
| `encaixe_calor` | 1 = sem dias acima do limiar na fase sensível; cai com a fração desses dias. Sempre 1 em cultura sem limiar |
| `dias_calor` | Dias esperados acima do limiar da cultura dentro da fase sensível |
| `espera_dias` | Dias que o talhão ficou sem cultura esperando o mês de plantio |
| `meses[]` | Balanço hídrico mês a mês da cultura. Serve para a timeline |
| `descartadas[].motivo` | A cultura que não coube, sua posição (1 ou 2), o slot, o mês em que o talhão ficou livre e o mês de plantio dela no slot. `mes_plantio` nulo = a cultura não é plantada naquele slot; preenchido = o talhão só ficou livre depois desse mês |

Os três cards da tela não são as três primeiras de `sequencias`: cada um escolhe por um objetivo (maior `receita_ha` de hoje, maior `solo` de hoje, maior `encaixe` no futuro). A regra está em `frontend/docs/API.md`. O texto por LLM foi abandonado pelo time em 14/11.

## Regras

1. **ET0:** a coluna `et0_mm` da tabela de clima; sem ela, Hargreaves.
2. **Slots:** cada posição da sequência é um slot. Talhão livre de julho a dezembro: safra e depois safrinha. Livre de janeiro a junho: safrinha e depois a safra seguinte.
3. **Época de plantio:** a cultura entra no mês de plantio dela naquele slot: no dia em que o talhão fica livre, se cair dentro do mês, ou no dia 1 do mês, se ainda não chegou. Enquanto espera, o solo só acumula chuva. A sequência é descartada se a cultura não tem mês naquele slot ou se o talhão só fica livre depois do mês (espera de mais de meio ano).
4. **Tempo de colheita:** o talhão fica livre 10 dias depois do fim do ciclo.
5. **Kc** ao longo do ciclo: `kc_ini` nos primeiros 20%, sobe até `kc_med` aos 45%, fica até 80%, desce até `kc_fim`.
6. **Balanço hídrico** dia a dia: demanda = Kc × ET0. A cultura usa a chuva do dia e a água guardada no solo (até 100 mm). `deficit_mm` é a demanda não atendida; `atendimento_hidrico` = 1 − déficit / demanda.
7. **Encaixe de temperatura:** 1 dentro da faixa ótima, 0 fora dos limites absolutos, linear entre os dois. Média sobre os dias do ciclo, com a temperatura média do mês.
8. **Encaixe de chuva:** chuva do ciclo contra `chuva_min` e `chuva_max`. Cai em proporção à falta ou ao excesso.
9. **Calor:** a fase sensível é o meio do ciclo, de 45% a 80% (florescimento e enchimento de grãos, a mesma fase do Kc médio). O motor soma os dias acima do limiar da cultura (`dias_acima_<temp_calor_c>`) que caem nessa fase. `encaixe_calor` = 1 − dias de calor / dias da fase. Exemplo: 10 dias de calor em 40 dias de fase dá 0,75.
10. **Regras de sequência** (`fator_sequencia`): 0,85 se repete a cultura anterior; 1,10 se é não fixadora depois de fixadora de N; 1 nos outros casos.
11. **Receita** = preço × produtividade do slot × `fator`, onde `fator` = menor entre encaixe de temperatura, encaixe de chuva, encaixe de calor e atendimento hídrico, vezes `fator_sequencia`.
12. **Partes do score:**
    - `agua` = 1 − déficit total / demanda total da sequência.
    - `solo` = média, por cultura, de (0,4 se fixa N + 0,4 se cobre o solo + 0,2 se é diferente da anterior) × o quanto a cultura cresce.
    - `renda` = receita da sequência ÷ a maior receita entre as sequências viáveis, hoje e no futuro. O ano seco não entra nesse teto, para os números de hoje e futuro serem os mesmos com ou sem ele. Se uma sequência render mais no ano seco que o teto, a `renda` dela no ano seco fica em 1.
13. **Época de plantio no ano seco:** a mesma. As sequências viáveis e as descartadas não dependem do clima.
14. **Rotação atual:** são as culturas mais recentes do histórico. O motor supõe uma cultura por slot, sem pular: a última ocupou o slot anterior ao próximo, e a penúltima, o mesmo slot do próximo, um ano antes. Com horizonte 2, a rotação atual é penúltima > última; com horizonte 1, é a penúltima. Com uma cultura só no histórico, ela se repete em todo slot. Exemplo: histórico algodão, soja, milho e talhão livre em outubro dá `soja>milho`. A rotação atual entra no ranking como qualquer outra sequência; se não couber na época de plantio, vai para `descartadas` e o campo `atual` do topo traz o motivo.
15. **Solo descoberto:** o motor olha os 365 dias a partir do dia em que o talhão fica livre. Dia sem cultura = nenhuma cultura em pé: a espera pelo mês de plantio, os dias de colheita e o tempo depois da última cultura. Dia exposto = dia sem cultura em que a cultura anterior não deixa palhada (`cobre_solo` = 0). Antes da primeira cultura vale a última do histórico; sem histórico, o dia conta como exposto. A chuva de cada dia é a média do mês. Os dias são os mesmos em todos os climas; a chuva muda.
16. **Índice de erosão** (só com `declividade_pct`): `chuva_exposta_mm` × fator S da RUSLE (McCool et al., 1987). S = 10,8 × sen θ + 0,03 abaixo de 9% de declividade e 16,8 × sen θ − 0,50 a partir de 9%, com θ = ângulo da declividade. S vale 1 em 9% e 0,47 em 4,05%. É um índice para comparar sequências no mesmo talhão, não uma perda de solo em t/ha. Não entra no score.

## Modo diário (opcional)

O modo mensal usa a média de 20 anos de cada mês. A média apaga os veranicos: a parte de `agua` fica entre 0,88 e 1,00 em todas as sequências. O modo diário roda a mesma conta com a chuva, o ET0 e as temperaturas de cada dia, um ano de cada vez, e resume o ano mediano e o ano ruim.

### Entrada: a série diária

Um DataFrame com uma linha por dia, sem dias faltando.

| Coluna | Uso |
|---|---|
| `data` | Dia |
| `chuva_mm` | Chuva do dia |
| `tmin_c`, `tmax_c` | Encaixe de temperatura (média das duas) e calor (`tmax_c` contra `temp_calor_c`) |
| `et0_mm` | Opcional, mm no dia. Se não vier, o motor calcula Hargreaves do dia com `tmin_c`, `tmax_c` e `lat` |

- `carregar_diario()` monta a série do talhão de demonstração: `data/power/power_diario_-20.032_-48.526_2005_2024.csv`, com a correção da A520 em `tmin_c` e `tmax_c` e o ET0 sem a correção, como em `clima_hoje.csv`. Devolve `None` se o arquivo não existe (a imagem Docker não copia `data/power`).
- `diario_do_power(power, lat, correcoes=None)` converte qualquer série diária do POWER (`data`, `PRECTOTCORR`, `T2M_MIN`, `T2M_MAX`) para essas colunas. Serve para outros pontos: `scripts/clima_ponto.py` já baixa essa série.
- Série com menos de 5 anos completos para o mês pedido dá `ValueError`.

### Regras do modo diário

1. **Anos:** o talhão fica livre no dia 1 de `mes_plantio` de cada ano da série. Entram os anos em que a sequência mais longa cabe inteira. Com a série de 2005 a 2024: 19 anos, de 2005 a 2023. O `ano` é o do dia em que o talhão fica livre (outubro de 2020 = safra 2020/21).
2. **Calendário:** o mesmo do modo mensal, em dias contados a partir do talhão livre. As sequências viáveis e as descartadas não mudam.
3. **Balanço hídrico:** as regras 5 e 6, com a chuva e o ET0 de cada dia.
4. **Encaixe de temperatura e de chuva:** as regras 7 e 8, com a temperatura média de cada dia e a chuva do ciclo naquele ano.
5. **Calor:** conta os dias da fase sensível com `tmax_c` acima do limiar da cultura. Não usa as colunas `dias_acima_NN`.
6. **Perda por falta de água (Ky):** `fator_agua` = 1 − Ky × (1 − `atendimento_hidrico`), a função de resposta da FAO (FAO-56, equação 90). No modo diário ele entra no lugar do atendimento hídrico no "menor fator" da regra 11. Com Ky acima de 1, a cultura perde mais produtividade do que a água que faltou.
7. **Futuro:** a série de hoje com a mudança mensal entre `clima_futuro` e `clima_hoje`. Nas temperaturas, soma a diferença do mês; na chuva e no ET0, multiplica pela razão do mês (dia sem chuva continua sem chuva). Funciona para qualquer ponto que tenha as duas tabelas.
8. **Resumo:** para cada sequência e clima, a mediana e o valor do ano ruim de `agua`, `solo` e `receita_ha` entre os anos. O ano ruim é o valor na posição 20% da lista ordenada: com 19 anos, o 4º pior. Cada parte tem o seu ano ruim; não é um único ano.
9. **Renda, score e rank:** `renda` = receita ÷ a maior receita do ano mediano entre as sequências, hoje e no futuro. O `score` usa os mesmos pesos da entrada. Há um rank para o ano mediano e outro para o ano ruim, em cada clima.

Ky por cultura (FAO-56, tabela 24, que repete o FAO Irrigation and Drainage Paper 33), em `KY` no topo de `motor/motor.py`:

| Cultura | Ky |
|---|---|
| soja | 0,85 |
| milho | 1,25 |
| sorgo | 0,90 |
| feijão | 1,15 |
| girassol | 0,95 |
| algodão | 0,85 |
| trigo | 1,15 ("spring wheat") |
| milheto, braquiária, crotalária | 1,00 (não estão na tabela da FAO) |

Uma coluna `ky` em `culturas.csv`, se existir, vale no lugar da tabela.

### Saída

No topo:

```json
{"diario": {"anos": [2005, 2006, "...", 2023], "n_anos": 19, "quantil_ruim": 0.2}}
```

Em cada item de `sequencias` (exemplo: `milho>soja`, talhão livre em fevereiro, histórico soja, milho):

```json
{
  "diario": {
    "hoje": {
      "mediano": {"agua": 0.855, "solo": 0.427, "receita_ha": 11888.82, "renda": 0.678, "score": 65.338, "rank": 13},
      "ruim":    {"agua": 0.795, "solo": 0.389, "receita_ha": 10839.506, "renda": 0.619, "score": 60.08, "rank": 10},
      "pior_ano": {"ano": 2020, "agua": 0.694, "receita_ha": 9472.053},
      "culturas": [
        {
          "cultura": "milho",
          "slot": "safrinha",
          "mediano": {"atendimento_hidrico": 0.777, "fator_agua": 0.721, "encaixe_calor": 1.0, "fator": 0.613, "receita_ha": 4050.442},
          "ruim":    {"atendimento_hidrico": 0.625, "fator_agua": 0.532, "encaixe_calor": 1.0, "fator": 0.452, "receita_ha": 2984.592}
        },
        { "...": "soja, na safra" }
      ],
      "anos": [{"ano": 2005, "agua": 0.855, "solo": 0.423, "receita_ha": 11771.385}, "... um por ano"]
    },
    "futuro": { "...": "mesma estrutura" }
  }
}
```

| Campo | Significado |
|---|---|
| `mediano`, `ruim` | Mediana e ano ruim de cada parte entre os anos, com `renda`, `score` e `rank` próprios |
| `pior_ano` | O ano de menor receita da sequência (em empate, o de menos água) |
| `culturas[]` | Por cultura: mediana e ano ruim do atendimento hídrico, do `fator_agua`, do encaixe de calor, do `fator` e da receita |
| `anos[]` | `agua`, `solo` e `receita_ha` de cada ano. Serve para um gráfico |

Não há bloco `seco` no modo diário: o ano seco já é um dos anos da série (2020).

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
| `FASE_SENSIVEL` | 45% a 80% | Parte do ciclo em que o calor conta |
| `PERDA_CALOR` | 1,0 | Fração da produtividade perdida se todos os dias da fase sensível passam do limiar |
| `QUANTIL_RUIM` | 0,2 | Modo diário: posição do "ano ruim" na lista ordenada dos anos |
| `MIN_ANOS_DIARIO` | 5 | Modo diário: mínimo de anos completos na série |
| `KY_PADRAO` | 1,0 | Modo diário: Ky das culturas que não estão na tabela da FAO |

Os valores de `KY` têm fonte (FAO-56, tabela 24) e não entram nesta lista.

## O que a regra de calor muda (tabelas de 14/11)

| Cultura e slot | `encaixe_calor` hoje | futuro |
|---|---|---|
| soja, safra (38 °C) | 0,99 | 0,97 |
| milho, safra (35 °C) | 0,94 | 0,86 |
| milho, safrinha | 0,99 | 0,90 |
| sorgo, safrinha (36 °C) | 0,99 | 0,95 |
| girassol, safrinha (35 °C) | 0,98 | 0,87 |
| feijão, safra (32 °C) | 0,66 | 0,37 |
| feijão, safrinha | 0,78 | 0,45 |
| algodão, safra (32 °C) | 0,74 | 0,39 |

- **Talhão livre em outubro:** as três primeiras são as mesmas nos dois climas (`soja>milho`, `soja>sorgo`, `soja>crotalaria`). `soja>feijao` cai de 4º para 7º.
- **Talhão livre em fevereiro:** hoje ganha `crotalaria>algodao`; no futuro ela cai para 13º (12º com o histórico soja, milho) e ganha `crotalaria>soja`. Conferido em 14/11 com as 10 culturas.

## O que o ano seco mostra (tabelas de 14/11)

No clima médio, a parte de `agua` do score quase não separa as sequências. No ano seco ela separa:

| Talhão livre em | `agua` hoje | `agua` no ano seco |
|---|---|---|
| outubro | 0,88 a 1,00 | 0,66 a 0,90 |
| fevereiro | 0,91 a 1,00 | 0,63 a 0,90 |

- **Outubro, sem histórico:** hoje ganha `soja>milho`; no ano seco, `milho>crotalaria`. Com o histórico soja, milho, `soja>milho` continua em primeiro (o milho na safra repete a cultura anterior e perde 15%), com receita de R$ 10.337/ha contra R$ 14.171/ha hoje.
- **Fevereiro:** hoje ganha `crotalaria>algodao`; no ano seco, `crotalaria>milho`, com ou sem o histórico soja, milho.

## O que o solo descoberto mostra (tabelas de 14/11, sem histórico, clima de hoje)

| Sequência | Dias sem cultura | Dias expostos | Chuva exposta | Índice de erosão (4,05%) |
|---|---|---|---|---|
| `soja>milho` (outubro) | 115 | 10 | 74 mm | 34,7 |
| `soja>sorgo` (outubro) | 140 | 10 | 74 mm | 34,7 |
| `soja>crotalaria` (outubro) | 150 | 36 | 237 mm | 110,8 |
| `soja>feijao` (outubro) | 160 | 160 | 190 mm | 88,8 |
| `milho>crotalaria` (outubro) | 130 | 0 | 0 mm | 0 |
| `milho>soja` (fevereiro) | 115 | 8 | 62 mm | 28,8 |

- **Toda sequência deixa o talhão sem cultura de junho ou julho a setembro**, de 95 a 185 dias com o talhão livre em outubro. É o mesmo período em que o NDVI do talhão de demonstração mostra indício de solo descoberto (`data/talhao/ndvi_climatologia.csv`). O que muda entre as sequências é se há palhada.
- **Depois de soja, feijão, girassol ou algodão não há palhada:** `soja>feijao` fica 160 dias exposta; `soja>milho`, 10.
- **A crotalária depois da soja deixa fevereiro exposto.** Ela só é plantada em março, e a soja sai no fim de janeiro: são 36 dias sem palhada no mês mais chuvoso, 237 mm contra 74 mm de `soja>milho`. A cultura de cobertura melhora o inverno e piora a entressafra.
- **A chuva exposta quase não muda entre hoje e o futuro** (74 e 73 mm em `soja>milho`): a diferença entre as sequências vem do calendário.

## O que o modo diário mostra (tabelas de 14/11, série de 2005 a 2023)

A parte de `agua` passa a separar as sequências:

| Talhão livre em | `agua` no modo mensal | diário, ano mediano | diário, ano ruim |
|---|---|---|---|
| outubro | 0,88 a 1,00 | 0,82 a 0,99 | 0,75 a 0,93 |
| fevereiro | 0,90 a 1,00 | 0,85 a 0,99 | 0,77 a 0,95 |

Receita em R$/ha, sem histórico:

| Sequência | Mensal, hoje | Diário, ano mediano | Ano ruim | Pior ano | Futuro, ano mediano | Futuro, ano ruim |
|---|---|---|---|---|---|---|
| `soja>milho` (outubro) | 14.171 | 12.438 | 11.905 | 9.537 (2020) | 12.162 | 11.671 |
| `soja>sorgo` (outubro) | 11.563 | 10.839 | 9.740 | 8.851 (2020) | 10.732 | 9.495 |
| `milho>algodao` (fevereiro) | 18.173 | 18.072 | 12.547 | 7.790 (2020) | 11.365 | 7.913 |
| `crotalaria>algodao` (fevereiro) | 13.930 | 15.223 | 9.197 | 5.074 (2020) | 7.928 | 4.123 |
| `sorgo>soja` (fevereiro) | 11.262 | 10.822 | 10.262 | 9.253 (2020) | 10.800 | 10.021 |

- **Outubro:** no ano mediano, `soja>sorgo` passa `soja>milho` no score; no ano ruim, `soja>milho` volta ao primeiro lugar. O milho safrinha atende 76% da demanda de água no ano mediano e, com Ky de 1,25, fica com `fator_agua` de 0,70 (0,53 no ano ruim).
- **Fevereiro:** no ano mediano de hoje ganha `crotalaria>algodao`; no ano ruim ela cai para 9º e ganha `sorgo>soja`. No futuro ganha `crotalaria>soja`, no ano mediano e no ruim. As sequências com algodão são as de maior receita no ano mediano e as que mais caem: `milho>algodao` perde 31% no ano ruim e 37% no futuro.
- **O pior ano** em receita não é sempre o mais seco. Com o talhão livre em outubro, é 2023 em 18 das 26 sequências e 2020 em 4; em fevereiro, 2020 em 13 das 36 e 2023 em 12. A safra 2020/21 é a de `clima_seco.csv`, escolhida só pela chuva.
- **Conferência com as tabelas:** a série diária dá a mesma chuva anual de `clima_hoje.csv` (1.242 mm) e 1.625 mm de ET0 contra 1.634 mm. Os dias acima de cada limiar de calor, hoje, são os mesmos das colunas `dias_acima_NN`.
- **Tempo:** 0,3 s por chamada com o modo diário, contra 0,08 s sem ele.

## Em aberto

1. **Mês de plantio é um mês só.** Uma cultura de safra que libera o talhão no dia 1 de março já não deixa plantar nada de fevereiro. Hoje isso acontece com o sorgo de safra: só a crotalária (março) cabe depois dele.
2. **Limiar de 32 °C.** O feijão e o algodão são os que mais caem, e é nesse limiar que POWER e NEX mais diferem (20%, ver `docs/colunas_dados.md`). A troca de vencedor no caso de fevereiro depende dele.
3. **Perda de 1 para 1.** Cada dia de calor na fase sensível tira a mesma fração da produtividade. É um valor provisório (`PERDA_CALOR`), sem fonte.
4. **Calor de hoje pode estar contado duas vezes.** A produtividade da Conab já reflete o calor atual do Brasil; a regra desconta o calor de hoje de novo. O que a regra mostra bem é a diferença entre hoje e futuro.
5. **Ano seco na API e na tela.** O motor já devolve o terceiro cenário quando recebe `clima_seco`. A API (`backend/app.py`) ainda chama o motor sem ele, e o `Dockerfile` não copia `data/clima_seco.csv`. Ligar isso é com o Gabriel (`docs/plano_gap.md`, G4).
6. **Um ano seco só.** É a safra 2020/21, com o clima de hoje. Não há ano seco do clima futuro.
7. **Calor futuro no modo diário é menor que o das tabelas.** O modo diário soma a mudança mensal da máxima em cada dia; as tabelas somam a mudança na contagem de dias dos modelos. Dias por ano no futuro, tabela / modo diário: 208 / 197 acima de 32 °C; 84 / 70 acima de 35 °C; 54 / 49 acima de 36 °C; 23 / 23 acima de 38 °C.
8. **O futuro diário repete os veranicos de hoje.** A mudança é aplicada mês a mês sobre os mesmos dias; uma mudança na frequência dos períodos secos não aparece.
9. **Água de hoje pode estar contada duas vezes.** É o mesmo problema do item 4: a produtividade da Conab já é a de um ano médio, e o modo diário desconta de novo a falta de água do ano mediano. A diferença entre ano mediano, ano ruim e futuro é o que ele mostra bem.
10. **Hargreaves dia a dia.** O método é indicado para médias de vários dias; o total anual bate com o da tabela, mas o valor de um dia isolado é ruidoso.
11. **Modo diário na API e na tela.** A API (`backend/app.py`) ainda chama o motor sem `diario`, e o `Dockerfile` não copia `data/power`. Para outros pontos, a função de clima por ponto teria de devolver a série diária que já baixa. "Ano ruim, 1 em 5" encosta em "win rates or probabilities", que está fora do escopo no `CLAUDE.md`: mostrar isso na tela depende de o time reabrir.
12. **Ky é o da estação inteira.** A FAO também dá Ky por fase da cultura; o motor usa um valor só por cultura.
13. **Rotação atual supõe uma cultura por slot.** O motor só recebe a ordem das culturas, sem a safra de cada uma. Quem planta uma cultura por ano e deixa a safrinha sem nada (pousio) não consegue informar isso: o histórico soja, soja vira `soja>soja`, que é descartada porque a soja não tem plantio de safrinha. Faltam o pousio como opção de slot e o slot de cada cultura do histórico.
14. **Palhada dura até o próximo plantio.** O motor supõe que a palhada de uma cultura com `cobre_solo` = 1 cobre o solo até a cultura seguinte entrar, por mais tempo que leve, e que as outras não deixam nada. Não há taxa de decomposição nem quantidade de palhada por cultura. `cobre_solo` foi preenchido à mão.
15. **Índice de erosão não é perda de solo.** Usa o total de chuva, não a erosividade (fator R), e deixa de fora o tipo de solo (K), o comprimento da rampa (L) e o manejo (C, P). O fator S linear subestima em declives fortes, além dos dados de origem (até 18%). A declividade é a média do talhão.
16. **Solo descoberto no modo diário e na API.** O modo diário não devolve a chuva exposta de cada ano. A API rejeita `declividade_pct` (o modelo de entrada em `backend/app.py` não tem o campo); a tela já tem a declividade do talhão de demonstração em `/metadata`. Ligar é com o Gabriel.
