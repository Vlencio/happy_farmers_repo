# Contrato do motor — entradas e saída

> Versão de 14/11/2026, com a regra de calor e o ano seco opcional. O motor lê `data/culturas.csv`, `data/clima_hoje.csv` e `data/clima_futuro.csv` como estão hoje, e `data/clima_seco.csv` se for pedido. Se o formato de alguma mudar, avisem.

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

- Demo: `python -m motor` (tabela) ou `python -m motor --json` (JSON completo, com os três cenários: ~300 KB com as 10 culturas; ~205 KB sem o ano seco).
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
| `atual` | `true` na sequência que repete a rotação atual. No máximo uma, e ela pode estar em `descartadas` |
| `rank_hoje`, `rank_futuro`, `rank_seco` | Posição (1 = melhor) em cada clima. `rank_seco` só existe se o ano seco foi passado |
| `score` | 0 a 100. Média de `agua`, `solo` e `renda` com os pesos do usuário |
| `agua`, `solo`, `renda` | As três partes do score, de 0 a 1 |
| `receita_ha` | R$ por hectare, somando as culturas da sequência. O front multiplica pela área |
| `encaixe` | Pior encaixe de clima (temperatura, chuva ou calor) entre as culturas, de 0 a 1 |
| `culturas[]` | Uma entrada por cultura, na ordem de plantio, com os números que explicam o score |
| `encaixe_calor` | 1 = sem dias acima do limiar na fase sensível; cai com a fração desses dias. Sempre 1 em cultura sem limiar |
| `dias_calor` | Dias esperados acima do limiar da cultura dentro da fase sensível |
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
9. **Calor:** a fase sensível é o meio do ciclo, de 45% a 80% (florescimento e enchimento de grãos, a mesma fase do Kc médio). O motor soma os dias acima do limiar da cultura (`dias_acima_<temp_calor_c>`) que caem nessa fase. `encaixe_calor` = 1 − dias de calor / dias da fase. Exemplo: 10 dias de calor em 40 dias de fase dá 0,75.
10. **Regras de sequência** (`fator_sequencia`): 0,85 se repete a cultura anterior; 1,10 se é não fixadora depois de fixadora de N; 1 nos outros casos.
11. **Receita** = preço × produtividade do slot × `fator`, onde `fator` = menor entre encaixe de temperatura, encaixe de chuva, encaixe de calor e atendimento hídrico, vezes `fator_sequencia`.
12. **Partes do score:**
    - `agua` = 1 − déficit total / demanda total da sequência.
    - `solo` = média, por cultura, de (0,4 se fixa N + 0,4 se cobre o solo + 0,2 se é diferente da anterior) × o quanto a cultura cresce.
    - `renda` = receita da sequência ÷ a maior receita entre as sequências viáveis, hoje e no futuro. O ano seco não entra nesse teto, para os números de hoje e futuro serem os mesmos com ou sem ele. Se uma sequência render mais no ano seco que o teto, a `renda` dela no ano seco fica em 1.
13. **Época de plantio no ano seco:** a mesma. As sequências viáveis e as descartadas não dependem do clima.

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
- **Talhão livre em fevereiro:** hoje ganha `crotalaria>algodao`; no futuro ela cai para 12º e ganha `milho>soja`.

## O que o ano seco mostra (tabelas de 14/11)

No clima médio, a parte de `agua` do score quase não separa as sequências. No ano seco ela separa:

| Talhão livre em | `agua` hoje | `agua` no ano seco |
|---|---|---|
| outubro | 0,88 a 1,00 | 0,66 a 0,90 |
| fevereiro | 0,91 a 1,00 | 0,63 a 0,90 |

- **Outubro, sem histórico:** hoje ganha `soja>milho`; no ano seco, `milho>crotalaria`. Com o histórico soja, milho, `soja>milho` continua em primeiro (o milho na safra repete a cultura anterior e perde 15%), com receita de R$ 10.337/ha contra R$ 14.171/ha hoje.
- **Fevereiro:** hoje ganha `crotalaria>algodao`; no ano seco, `crotalaria>milho`, com ou sem o histórico soja, milho.

## Em aberto

1. **Mês de plantio é um mês só.** Uma cultura de safra que libera o talhão no dia 1 de março já não deixa plantar nada de fevereiro. Hoje isso acontece com o sorgo de safra: só a crotalária (março) cabe depois dele.
2. **Limiar de 32 °C.** O feijão e o algodão são os que mais caem, e é nesse limiar que POWER e NEX mais diferem (20%, ver `docs/colunas_dados.md`). A troca de vencedor no caso de fevereiro depende dele.
3. **Perda de 1 para 1.** Cada dia de calor na fase sensível tira a mesma fração da produtividade. É um valor provisório (`PERDA_CALOR`), sem fonte.
4. **Calor de hoje pode estar contado duas vezes.** A produtividade da Conab já reflete o calor atual do Brasil; a regra desconta o calor de hoje de novo. O que a regra mostra bem é a diferença entre hoje e futuro.
5. **Ano seco na API e na tela.** O motor já devolve o terceiro cenário quando recebe `clima_seco`. A API (`backend/app.py`) ainda chama o motor sem ele, e o `Dockerfile` não copia `data/clima_seco.csv`. Ligar isso é com o Gabriel (`docs/plano_gap.md`, G4).
6. **Um ano seco só.** É a safra 2020/21, com o clima de hoje. Não há ano seco do clima futuro.
