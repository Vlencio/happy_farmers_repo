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

```python
# com o futuro rodado uma vez por modelo climático (opcional, regra 20)
from motor import carregar_clima_modelos
modelos = carregar_clima_modelos()   # data/clima_modelos.csv + off_* de clima_correcoes.csv; None se não existe
saida = recomendar(entrada, culturas, clima_hoje, clima_futuro, clima_modelos=modelos)
```

Sem `clima_modelos` (ou com `None`), nada muda. Com ele, cada sequência viável ganha o bloco `modelos` e a saída ganha `modelos` no topo (ver "Futuro por modelo" na saída). Score, rank e os blocos que já existiam continuam idênticos; só pode aparecer o aviso novo `rank_varia_entre_modelos`. Só vale para o talhão de demonstração: `clima_futuro` precisa ser a média dos mesmos modelos.

- Demo: `python -m motor` (tabela, com o resumo do modo diário) ou `python -m motor --json` (JSON completo). `--mes 2` troca o mês em que o talhão fica livre.
- Tamanho do JSON sem indentação, com as 10 culturas, histórico soja, milho e outubro (medido em 15/11): ~199 KB só com hoje e futuro; ~405 KB com o modo diário (fevereiro: ~257 KB e ~543 KB). O `descoberto` de cada ano soma ~70 KB em outubro e ~95 KB em fevereiro.
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
  "declividade_pct": 4.05,
  "ajuste": {"chuva_pct": -20, "temp_c": 2},
  "solo_textura": "argiloso",
  "altitude_m": 484.41
}
```

| Campo | Obrigatório | Significado |
|---|---|---|
| `lat` | sim | Latitude do centro do talhão (graus, sul negativo). Só é usada se a tabela de clima vier sem `et0_mm` |
| `rotacao_atual` | não | Histórico, na ordem de plantio, uma cultura por slot. A última cultura conta como "cultura anterior", e as mais recentes definem a rotação atual (ver "Rotação atual"). Lista vazia = sem histórico |
| `prioridades` | não | Pesos de `agua`, `solo` e `renda`. Qualquer escala; o motor normaliza para somar 1. Sem nada = pesos iguais |
| `horizonte` | não (padrão 2) | 1 = próxima cultura, 2 = próximas duas |
| `mes_plantio` | não (padrão 10) | Mês em que o talhão fica livre (dia 1). Define o primeiro slot: de julho a dezembro é a safra; de janeiro a junho, a safrinha |
| `precos` | não | Preço editado pelo usuário, por cultura, em R$/t. Substitui o `preco` da tabela na receita (não no teto da `renda`, regra 12). Negativo ou não finito gera `ValueError` |
| `declividade_pct` | não | Declividade média do talhão, em %. Se vier, cada sequência ganha `descoberto.indice_erosao`. Não muda score nem rank. Para o talhão de demonstração: 4,05 (`data/talhao/declividade.csv`) |
| `ajuste` | não | Cenário "e se" (regra 19): `chuva_pct` de −50 a +30 (% sobre a chuva de cada mês) e `temp_c` de 0 a +4 (°C somados à mínima e à máxima). Campo ausente vale 0. Vale para todos os climas e para a série diária. Sem `ajuste`, a saída não muda; com ele, `entrada.ajuste` volta na saída e `clima` traz as tabelas já ajustadas |
| `solo_textura` | não | `arenoso`, `medio` ou `argiloso` (sem acento). Define a água que o solo guarda (`CAD_POR_TEXTURA`: 30, 45 e 60 mm). Vale para todos os climas e para o modo diário. Sem o campo, 60 mm (`CAD_MM`), igual a `argiloso`. Com ele, `entrada.solo_textura` e `entrada.cad_mm` voltam na saída. Outro valor gera `ValueError` |
| `altitude_m` | não | Altitude do talhão, em metros (−100 a 6000, `ALTITUDE_M`). Com ela, sequência com cultura cuja `altitude_min_m` passa dessa altitude vai para `descartadas` (regra 21). Sem o campo, a saída não muda. Com ele, `entrada.altitude_m` volta na saída. Não número, não finito ou fora da faixa gera `ValueError`. A API passa a média do SRTM do talhão de demonstração (484,41 m, `alt_media` de `data/talhao/declividade.csv`) só quando usa as tabelas da demonstração; o cliente não envia o campo |

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

**`data/clima_modelos.csv`** (opcional, regra 20): os deltas do NEX-GDDP (`ssp245` 2041–2060 − `historical` 1995–2014) por modelo e mês, antes da média. Só do talhão de demonstração.

| Coluna | Uso no motor |
|---|---|
| `modelo`, `mes` | Um modelo por grupo, 12 meses cada |
| `delta_chuva_mm`, `delta_tmin_c`, `delta_tmax_c` | Mudança do modelo no mês (mm do modelo, °C) |
| `razao_chuva` | Opcional, ainda não existe no arquivo. Chuva `ssp245` ÷ `historical` do modelo no mês. Se vier, a chuva do modelo é hoje × razão, o método de `clima_futuro.csv` |
| `off_tmin`, `off_tmax` | Opcionais. `carregar_clima_modelos` junta de `clima_correcoes.csv` (correção da estação A520). Servem para o ET0 usar as temperaturas sem a correção, como `scripts/montar_clima.py` |

**Que ano o futuro representa.** O delta do futuro vai de 1995–2014 (histórico dos modelos) a 2041–2060 (ssp245): 46 anos entre os centros dos dois períodos. Somado ao POWER de 2005–2024 (centro em 2014,5), o resultado fica centrado em **cerca de 2060**, não em 2050. Na tela e no pitch, chamar de "por volta de 2060". A outra saída, escalar o delta por 36/46, é com quem monta as tabelas (`scripts/montar_clima.py`).

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
| `altitude_min_m` | Opcional. Altitude mínima (m) recomendada para a cultura (regra 21). Só vale com `entrada.altitude_m`. Vazio, ou tabela sem a coluna = sem restrição. `culturas.csv` traz 800 para o trigo de sequeiro (Embrapa, `docs/culturas_fontes.md`) e vazio para as outras |
| `<campo>_status` | Opcional, uma coluna por campo (por exemplo `preco_status`, `temp_calor_c_status`). Texto livre, como `memoria` ou `sem fonte`. Se estiver preenchida, a sequência com aquela cultura ganha o aviso `valor_a_conferir`. Vazio = valor conferido. `culturas.csv` traz `preco_status` e `temp_calor_c_status` |

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
        "score": 70.096,
        "agua": 0.687,
        "atendimento_hidrico": 0.875,
        "solo": 0.513,
        "renda": 0.903,
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
            "fator_sequencia": 1.0,
            "hospedeiro_comum": null,
            "dias_apos_anterior": 10,
            "fator": 0.819,
            "receita_ha": 5412.548,
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
    },
    {
      "id": "soja>trigo",
      "culturas": ["soja", "trigo"],
      "atual": false,
      "motivo": {"cultura": "trigo", "posicao": 2, "slot": "safrinha", "mes_livre": 2, "mes_plantio": 3,
                 "altitude_min_m": 800.0, "altitude_m": 484.41}
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
| `agua`, `solo`, `renda` | As três partes do score, de 0 a 1 (regra 12). `agua` é o atendimento hídrico da sequência (`AGUA_REF_MIN` = 0) |
| `atendimento_hidrico` (na sequência) | 1 − déficit total ÷ demanda total das culturas da sequência, de 0 a 1. É o número que `agua` reescala; serve para explicar a parte `agua` ("a sequência atende 88% da demanda de água") |
| `receita_ha` | R$ por hectare, somando as culturas da sequência. O front multiplica pela área |
| `anos_ocupados` | Anos de talhão que a sequência usa, do dia em que fica livre até o fim da última colheita. No mínimo 1 (regra 12) |
| `receita_ano_ha` | `receita_ha` ÷ `anos_ocupados`, em R$/ha/ano. É o que entra na `renda` |
| `encaixe` | Pior encaixe de clima (temperatura, chuva ou calor) entre as culturas, de 0 a 1 |
| `descoberto` | Solo sem cultura nos 365 dias a partir do talhão livre (regra 15). `dias` e `chuva_mm`: dias sem cultura em pé e a chuva que cai neles. `dias_expostos` e `chuva_exposta_mm`: a parte desses dias sem palhada da cultura anterior. `indice_erosao` só existe se a entrada trouxe `declividade_pct`. `meses[]`: os mesmos quatro números por mês, na ordem do calendário a partir do talhão livre; só os meses com algum dia sem cultura |
| `culturas[]` | Uma entrada por cultura, na ordem de plantio, com os números que explicam o score |
| `avisos[]` | Em cada item de `sequencias`: lacunas de informação e riscos daquela sequência (regra 17). Não existe em `descartadas` |
| `beneficios[]` | Em cada item de `sequencias`: benefícios daquela sequência, só com o que entra na conta (regra 18). Não existe em `descartadas` |
| `fixa_n`, `cobre_solo` | Em cada item de `culturas[]`: os atributos da tabela que entram na parte `solo` (`true` ou `false`) |
| `encaixe_calor` | 1 = sem dias acima do limiar na fase sensível; cai com a fração desses dias. Sempre 1 em cultura sem limiar |
| `dias_calor` | Dias esperados acima do limiar da cultura dentro da fase sensível |
| `espera_dias` | Dias que o talhão ficou sem cultura esperando o mês de plantio |
| `dias_apos_anterior` | Dias do fim do ciclo da cultura anterior até o plantio desta (regra 10). Para a 1ª cultura, conta a partir do fim suposto da última do histórico (10 dias antes do talhão livre); `null` sem histórico |
| `meses[]` | Balanço hídrico mês a mês da cultura. Serve para a timeline |
| `descartadas[].motivo` | A cultura que não coube, sua posição (1 ou 2), o slot, o mês em que o talhão ficou livre e o mês de plantio dela no slot. Sem `altitude_min_m` (fora da época): `mes_plantio` nulo = a cultura não é plantada naquele slot; preenchido = o talhão só ficou livre depois desse mês. Com `altitude_min_m` e `altitude_m` (fora da altitude, regra 21): a sequência cabe no calendário, mas a cultura pede altitude maior que a do talhão; `mes_plantio` e `mes_livre` são os do calendário, sem conflito entre eles. A presença de `altitude_min_m` é o que distingue os dois casos |

### Futuro por modelo (só com `clima_modelos`)

Cada item de `sequencias` ganha:

```json
"modelos": {
  "por_modelo": [
    {"modelo": "ACCESS-CM2", "score": 73.4, "rank": 2, "receita_ano_ha": 12810.0},
    {"modelo": "MIROC6", "score": 74.1, "rank": 1, "receita_ano_ha": 13030.0},
    {"modelo": "MRI-ESM2-0", "score": 79.2, "rank": 1, "receita_ano_ha": 13919.0}
  ],
  "rank_min": 1, "rank_max": 2,
  "receita_ano_ha_min": 12810.0, "receita_ano_ha_max": 13919.0
}
```

E o topo da saída ganha:

| Campo | Significado |
|---|---|
| `modelos.nomes` | Os modelos, em ordem alfabética (a mesma de `por_modelo`) |
| `modelos.chuva` | `"razao"` se a tabela trouxe `razao_chuva` (método do script); `"aproximada"` se não (regra 20) |
| `modelos.et0_sem_correcao` | `true` se o ET0 usou as temperaturas sem a correção A520 (`off_tmin`/`off_tmax` presentes) |
| `modelos.aviso_faixa_rank` | O limite do aviso `rank_varia_entre_modelos` |
| `modelos.primeiro` | `{modelo: id}` da sequência em 1º no futuro de cada modelo |
| `modelos.clima` | `{modelo: 12 meses}`, no formato de `clima.futuro` |

`rank` vai de 1 ao número de sequências viáveis, em cada modelo. `rank_futuro` (o do futuro médio) não entra na faixa: a faixa é só entre os modelos.

Os três cards da tela são as três primeiras de `sequencias` (`rank_hoje` 1, 2 e 3), com o score ponderado pelas `prioridades` do produtor; cada card mostra também o `rank_futuro`. Até 14/11 cada card escolhia por um objetivo (renda, solo, clima); Pedro trocou em 15/11 (Parte 5). Em empate de score, vence a maior média simples de `agua`, `solo` e `renda`; com pesos iguais o desempate não muda nada. O chat com LLM (`POST /chat`, `docs/chat.md`) só explica esta saída: lê `avisos`, `beneficios` e os números das sequências na tela, e não produz número nenhum.

## Regras

1. **ET0:** a coluna `et0_mm` da tabela de clima; sem ela, Hargreaves.
2. **Slots:** cada posição da sequência é um slot. Talhão livre de julho a dezembro: safra e depois safrinha. Livre de janeiro a junho: safrinha e depois a safra seguinte. Se nenhuma sequência cabe nessa ordem, o motor tenta a outra, começando pelo outro slot, e `slots` mostra a ordem usada. Com as tabelas de 14/11, isso vale para maio e junho (a safrinha de fevereiro e março já passou; a safra de outubro cabe) e para dezembro com duas culturas (depois do algodão, único de safra em dezembro, a safrinha já passou). Abril continua sem sequência: a safrinha passou e a safra de outubro fica a 183 dias, um a mais que o limite de meio ano (regra 3).
3. **Época de plantio:** a cultura entra no mês de plantio dela naquele slot: no dia em que o talhão fica livre, se cair dentro do mês, ou no dia 1 do mês, se ainda não chegou. Enquanto espera, o solo só acumula chuva. A sequência é descartada se a cultura não tem mês naquele slot ou se o talhão só fica livre depois do mês (espera de mais de meio ano).
4. **Tempo de colheita:** o talhão fica livre 10 dias depois do fim do ciclo.
5. **Kc** ao longo do ciclo: `kc_ini` nos primeiros 20%, sobe até `kc_med` aos 45%, fica até 80%, desce até `kc_fim`.
6. **Balanço hídrico** dia a dia: demanda = Kc × ET0. A cultura usa a chuva do dia e a água guardada no solo (até `CAD_MM`, 60 mm, ou o valor de `CAD_POR_TEXTURA` quando a entrada traz `solo_textura`). `deficit_mm` é a demanda não atendida; `atendimento_hidrico` = 1 − déficit / demanda.
7. **Encaixe de temperatura:** 1 dentro da faixa ótima, 0 fora dos limites absolutos, linear entre os dois. Média sobre os dias do ciclo, com a temperatura média do mês.
8. **Encaixe de chuva:** chuva do ciclo contra `chuva_min` e `chuva_max`. Cai em proporção à falta ou ao excesso.
9. **Calor:** a fase sensível é o meio do ciclo, de 45% a 80% (florescimento e enchimento de grãos, a mesma fase do Kc médio). O motor soma os dias acima do limiar da cultura (`dias_acima_<temp_calor_c>`) que caem nessa fase. `encaixe_calor` = 1 − dias de calor / dias da fase. Exemplo: 10 dias de calor em 40 dias de fase dá 0,75.
10. **Regras de sequência** (`fator_sequencia`): 0,85 se repete a cultura anterior; 1,10 (`BONUS_APOS_FIXADORA`) se é não fixadora plantada até 60 dias (`JANELA_BONUS_N_DIAS`) depois do fim do ciclo de um **adubo verde**; 1 nos outros casos. Vezes 0,92 (`PENALIDADE_HOSPEDEIRO`) se divide praga ou doença relevante com a anterior (hospedeiro comum). Os dois valores valem igual nos modos mensal e diário.
    - **Adubo verde** = cultura com `fixa_n` e produtividade zero na tabela nos dois slots (`produtividade` e `produtividade_safrinha`): fixa N e não exporta grão. Na tabela de 15/11 só a `crotalaria` passa. Soja e feijão fixam N, mas levam quase todo o N fixado nos grãos; e a produtividade de referência da Conab para o milho safrinha já é a do milho depois da soja, então o bônus contava esse efeito duas vezes. O critério usa a produtividade, não o preço: o preço pode ser editado em `precos`; uma cultura de preço zero e produtividade acima de zero continua sem bônus.
    - **Prazo:** dias do fim do ciclo do adubo verde (plantio + `ciclo_dias`) até o plantio da cultura seguinte, no máximo 60. A palhada de leguminosa se decompõe em semanas no Cerrado; o valor veio da revisão agronômica de 15/11, sem fonte conferida.
    - **Cultura do histórico:** a última do histórico é a anterior da 1ª cultura (regra 14). Não há data do fim do ciclo dela: o motor supõe que acabou 10 dias (`DIAS_COLHEITA`) antes do talhão livre, como as culturas da sequência. Assim, o prazo da 1ª cultura é `espera_dias` + 10. Exemplo: crotalária no histórico e milho de outubro com o talhão livre em outubro = 10 dias, ganha o bônus; com o talhão livre em julho = 102 dias, não ganha.
    - Até 15/11 o bônus valia depois de qualquer fixadora (soja, feijão) e sem prazo.
    - **Hospedeiro comum** (desde 15/11): tabela `HOSPEDEIRO_COMUM` no topo de `motor/motor.py`, com a praga e a fonte de cada par. Pares de culturas diferentes; a cultura idêntica continua só com a repetição (0,85), sem somar as duas. Com o bônus após adubo verde, os dois multiplicam (1,10 × 0,92 = 1,012); com a tabela atual isso não acontece, porque a crotalária não está em nenhum par. O fator 0,92 (`PENALIDADE_HOSPEDEIRO`) é provisório, sem fonte para o tamanho do efeito. A mosca-branca de soja para feijão tem fator próprio, 0,75 (`PENALIDADE_MOSCA_BRANCA`): a Embrapa cita perdas de 40% a 100% do feijão por mosaico-dourado em cultivar suscetível; o valor é provisório, de memória da revisão agronômica. Com mais de uma praga em comum vale o menor fator, sem multiplicar. Vale no modo mensal e no diário.
    - Cada cultura traz `hospedeiro_comum`: `null` ou `{"anterior": "soja", "pragas": ["mofo-branco (Sclerotinia sclerotiorum)", ...]}`.

    | Anterior → seguinte | Praga ou doença | Fonte |
    |---|---|---|
    | Qualquer ordem entre soja, feijão, girassol e algodão | Mofo-branco (*Sclerotinia sclerotiorum*) | Embrapa Algodão, Comunicado Técnico 336 (2007): hospedeiras feijão, soja, girassol (...) e algodão. https://www.infoteca.cnptia.embrapa.br/bitstream/doc/276699/1/COMTEC336.pdf |
    | Soja → feijão | Mosca-branca (*Bemisia tabaci*), vetora do mosaico-dourado do feijoeiro | Embrapa Arroz e Feijão, Circular Técnica 91: soja hospedeira da mosca-branca; "evitar a semeadura escalonada do feijão após feijão ou após a soja". https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1130832/1/CNPAF-circ-tec-91.pdf |

    Ficaram de fora: *Pratylenchus brachyurus* e *Macrophomina phaseolina*, que atacam quase todas as culturas da tabela e não diferenciam sequências; crotalária como hospedeira de mofo-branco, sem fonte conferida.
11. **Receita** = preço × produtividade do slot × `fator`, onde `fator` = menor entre encaixe de temperatura, encaixe de chuva, encaixe de calor e atendimento hídrico, vezes `fator_sequencia`.
12. **Partes do score:**
    - `agua` = o atendimento hídrico da sequência (`atendimento_hidrico` = 1 − déficit total / demanda total), levado da faixa fixa [`AGUA_REF_MIN`, 1] para [0, 1]. Com `AGUA_REF_MIN` = 0, é o próprio atendimento. Por algumas horas de 15/11 o piso foi 0,6; as revisões estatística e agronômica mostraram que isso multiplicava o peso da água por 2,5, num número que já entra na receita (pelo fator de crescimento), e punha `soja>feijao` em 1º e `soja>milho` em 6º em outubro. A faixa é fixa: não depende das outras sequências avaliadas. Vale igual em hoje, futuro, ano seco e no modo diário.
    - `solo` = média, por cultura, de (0,4 se fixa N + 0,4 se cobre o solo + 0,2 se é diferente da anterior) × o encaixe de clima da cultura (o menor entre temperatura, chuva e calor). A água não entra aqui desde 15/11: ela já está na parte `agua` e na receita. Cada cultura traz `repete` (é a mesma da anterior), `bonus_n` (ganhou o bônus da regra 10) e `penalidade_hospedeiro` (o fator de hospedeiro comum aplicado, 1 sem par).
    - `renda` = `receita_ano_ha` ÷ teto, no máximo 1. `receita_ano_ha` é a receita dividida pelos anos de talhão que a sequência ocupa (no mínimo 1): uma sequência que passa de um ano, como crotalária e depois algodão de dezembro com o talhão livre em fevereiro (1,3 ano), não pode comparar a receita dela com a de quem libera o talhão em 12 meses. O teto é a receita potencial do sistema de referência da região, soja na safra e milho na safrinha, com o preço e a produtividade da tabela e sem perda (`SISTEMA_REFERENCIA`; 14.936 R$/ha/ano com a tabela de 15/11). O teto soma só os slots que as sequências ocupam (`REFERENCIA_POR_SLOT`): com duas culturas, soja safra + milho safrinha; com uma, só a cultura de referência daquele slot (soja na safra, milho safrinha na safrinha). Até 15/11 o teto era sempre o de duas culturas, e com uma cultura só a renda ficava entre 0 e 0,28, espremida contra o solo (0,39 a 1,0): em janeiro, com renda e solo no mesmo peso, a crotalária, sem receita, ficava em 1º (50,0 contra 39,2 do sorgo). Com o teto do slot, fica em 3º (sorgo 51,2, milho 51,1, crotalária 50,0, empate técnico). O teto usa o preço da tabela, não o editado em `precos`: o preço editado muda a receita das sequências, não a referência. Assim, soja e milho a preço zero não zeram o teto. O teto é o mesmo em todos os climas e não depende das outras sequências: tirar uma cultura da tabela não muda a `renda` das que ficam. Sem soja ou milho na tabela, ou com o teto da tabela igual a zero, o teto volta a ser a maior `receita_ano_ha` avaliada.
    - Antes de 15/11 o teto era a maior receita entre as sequências avaliadas. A revisão estatística mostrou que, assim, tirar o algodão da tabela trocava o 1º e o 2º lugar entre outras sequências.
13. **Época de plantio no ano seco:** a mesma. As sequências viáveis e as descartadas não dependem do clima.
14. **Rotação atual:** são as culturas mais recentes do histórico. O motor supõe uma cultura por slot, sem pular: a última ocupou o slot anterior ao próximo, e a penúltima, o mesmo slot do próximo, um ano antes. Com horizonte 2, a rotação atual é penúltima > última; com horizonte 1, é a penúltima. Com uma cultura só no histórico, ela se repete em todo slot. Exemplo: histórico algodão, soja, milho e talhão livre em outubro dá `soja>milho`. A rotação atual entra no ranking como qualquer outra sequência; se não couber na época de plantio, vai para `descartadas` e o campo `atual` do topo traz o motivo.
15. **Solo descoberto:** o motor olha os 365 dias a partir do dia em que o talhão fica livre. Dia sem cultura = nenhuma cultura em pé: a espera pelo mês de plantio, os dias de colheita e o tempo depois da última cultura. Dia exposto = dia sem cultura em que a cultura anterior não deixa palhada (`cobre_solo` = 0). Antes da primeira cultura vale a última do histórico; sem histórico, o dia conta como exposto. A chuva de cada dia é a média do mês. Os dias são os mesmos em todos os climas; a chuva muda.
16. **Índice de erosão** (só com `declividade_pct`): `chuva_exposta_mm` × fator S da RUSLE (McCool et al., 1987). S = 10,8 × sen θ + 0,03 abaixo de 9% de declividade e 16,8 × sen θ − 0,50 a partir de 9%, com θ = ângulo da declividade. S vale 1 em 9% e 0,47 em 4,05%. É um índice para comparar sequências no mesmo talhão, não uma perda de solo em t/ha. Não entra no score.
17. **Avisos:** cada sequência viável traz a lista `avisos`, gerada dos números dela. A lista explica o resultado; não muda score nem rank.

```json
{"tipo": "risco", "codigo": "fator_limitante", "cultura": "algodao", "cenario": "hoje",
 "dados": {"fator": "calor", "valor": 0.744, "slot": "safra"},
 "texto": "algodao na safra, clima hoje: o calor limita a produtividade a 74%."}
```

`cultura` e `cenario` são `null` quando o aviso vale para a sequência inteira. `dados` traz os números que geraram o aviso. `texto` é uma frase pronta, com o nome da cultura como está na tabela (sem acento); a tela pode montar a sua a partir de `codigo` e `dados`.

| `codigo` | `tipo` | Quando aparece | `dados` |
|---|---|---|---|
| `fator_limitante` | risco | Por cultura e clima: o menor entre encaixe de temperatura, de chuva, de calor e atendimento hídrico está abaixo de 0,8 | `fator` (`temperatura`, `chuva`, `calor` ou `agua`), `valor`, `slot` |
| `queda_no_futuro` | risco | A receita da sequência cai mais de 10% de hoje para o futuro | `queda`, `receita_hoje`, `receita_futuro` |
| `fator_agua_diario` | risco | Só no modo diário, por cultura e clima: o `fator_agua` do ano mediano (com Ky, regra 6 do modo diário) está abaixo de 0,8. É o lado diário de `fator_limitante`, que olha o mensal: os dois podem sair para a mesma cultura, com números diferentes | `fator_agua`, `atendimento_hidrico` (os dois do ano mediano), `ky`, `slot` |
| `queda_no_ano_ruim` | risco | Só no modo diário, por clima: a receita do ano ruim fica mais de 20% abaixo da do ano mediano | `queda`, `receita_mediano`, `receita_ruim` |
| `repete_a_cultura` | risco | A cultura repete a anterior (fator de sequência 0,85) | `fator_sequencia`, `slot` |
| `hospedeiro_comum` | risco | A cultura divide praga ou doença com a anterior (regra 10; fator 0,92, ou 1,012 com o bônus após fixadora). Clima de hoje, como a repetição | `fator_sequencia` (o aplicado), `penalidade`, `anterior`, `pragas` (lista de textos), `slot` |
| `solo_exposto` | risco | 60 dias ou mais sem cultura e sem palhada, no clima de hoje | `dias_expostos`, `chuva_exposta_mm` |
| `sem_historico` | lacuna | A entrada veio sem histórico: a primeira cultura fica sem as regras de sequência | — |
| `sem_limiar_de_calor` | lacuna | Cultura sem `temp_calor_c`: o motor não desconta calor dela | — |
| `limiar_de_calor_pouco_confiavel` | lacuna | Cultura com limiar de 32 °C, em que POWER e NEX mais diferem | `temp_calor_c` |
| `sem_valor_de_mercado` | lacuna | Cultura com preço zero (as de cobertura), já contando o preço editado | — |
| `ky_padrao` | lacuna | Só no modo diário: cultura fora da tabela de Ky da FAO | `ky` |
| `rank_varia_entre_modelos` | risco | Só com `clima_modelos`: o rank do futuro varia mais de 5 posições entre os modelos (`AVISO_FAIXA_RANK`, provisório) | `rank_min`, `rank_max`, `por_modelo` (`{modelo: rank}`), `limite` |
| `geada` | risco | Só no modo diário, por cultura e clima: mínima de 3 °C ou menos no ciclo em algum ano | `anos`, `n_anos`, `dias_total`, `max_no_ano`, `limiar_c`, `slot` |
| `valor_a_conferir` | lacuna | A tabela de culturas tem `<campo>_status` preenchido para a cultura | `campo`, `status`, `valor` |

18. **Benefícios:** cada sequência viável traz a lista `beneficios`, no formato dos avisos sem `tipo`. Cada benefício sai de um atributo ou número que o motor usa: nada de benefício agronômico que não entre na conta. A lista explica o resultado; não muda score nem rank. Uma cultura repetida na sequência conta uma vez em `fixa_nitrogenio` e `deixa_palhada`.

| `codigo` | Quando aparece | `dados` |
|---|---|---|
| `fixa_nitrogenio` | Cultura com `fixa_n` na tabela | — |
| `bonus_apos_fixadora` | Não fixadora plantada até 60 dias depois de um adubo verde (fator de sequência 1,10, regra 10; 1,012 se a cultura também leva o desconto de hospedeiro comum, e o texto diz isso) | `fator_sequencia`, `slot`, `dias_apos_anterior` |
| `deixa_palhada` | Cultura com `cobre_solo`: o motor conta o solo coberto até o próximo plantio | — |
| `pouco_solo_exposto` | Menos de 60 dias sem cultura e sem palhada, no clima de hoje. É o contrário do aviso `solo_exposto` | `dias_expostos`, `chuva_exposta_mm` |
| `estavel_no_futuro` | Receita de hoje acima de zero e queda de até 10% (ou alta) para o futuro. É o contrário do aviso `queda_no_futuro` | `queda` (negativa = alta), `receita_hoje`, `receita_futuro` |
| `clima_favoravel` | Hoje e no futuro, nenhuma cultura tem fator de clima ou água abaixo de 0,8. É o contrário do aviso `fator_limitante` nesses dois climas e, no modo diário, também de `fator_agua_diario`: com esse aviso, o benefício não sai | `menor_fator` (só do mensal) |

"Menor demanda de água" ficou de fora: seria uma comparação entre sequências e precisaria de um limite sem fonte.

19. **Ajuste de cenário** (só com `ajuste`, Parte 6 de `docs/pendencias_desafio.md`): antes de qualquer conta, cada tabela de clima (hoje, futuro e ano seco) muda assim:
    - `chuva_mm` × (1 + `chuva_pct`/100), em todos os meses.
    - `tmin_c` e `tmax_c` + `temp_c`, em todos os meses.
    - `et0_mm`, se vier na tabela, × (T média + `temp_c` + 17,8) / (T média + 17,8). É o que muda no Hargreaves quando as duas temperaturas sobem igual: a amplitude e a radiação ficam as mesmas. Sem a coluna, o Hargreaves do motor já usa as temperaturas novas. +2 °C dá cerca de 5% a mais de ET0.
    - `dias_acima_NN` (com `temp_c` acima de 0): dias acima de NN com a máxima `temp_c` mais alta = dias acima de NN − `temp_c` na tabela original. Desde 15/11 as tabelas têm uma coluna por grau, de 26 a 40 °C: com ajuste inteiro, o motor lê a coluna exata (+3 °C no limiar 35 = `dias_acima_32`). Com ajuste fracionário, ou com tabelas que só tenham alguns limiares, o motor interpola entre os dois vizinhos e, fora da faixa, estende a reta dos dois mais próximos, entre 0 e os dias do mês.
    - Modo diário: o mesmo, dia a dia, na série de hoje; o futuro sai das tabelas já ajustadas (regra 7 do modo diário). O limiar de chuva extrema fica o da série observada, para a contagem mostrar a mudança.
    - É um "e se", não uma previsão: o mesmo ajuste em todos os meses, sem fonte para a combinação escolhida.
20. **Futuro por modelo** (só com `clima_modelos`, Parte 7 de `docs/pendencias_desafio.md`): o motor monta um futuro para cada modelo com o método de `clima_futuro.csv`, trocando o delta médio pelo do modelo, e roda as sequências viáveis nele. Por mês:
    - `tmin_c`, `tmax_c`: hoje + `delta_tmin_c` / `delta_tmax_c` do modelo. Igual ao script.
    - `chuva_mm`: com `razao_chuva`, hoje × razão do modelo (igual ao script). **Sem ela (o arquivo de hoje)**, aproximação: futuro médio × (hoje + `delta_chuva_mm` do modelo) ÷ (hoje + delta médio dos modelos). A média dos modelos fica igual ao futuro médio; a diferença entre eles usa os mm do modelo, ~20% mais úmidos que o POWER, e por isso sai um pouco maior que a do método exato. Medido contra o método exato (razão por modelo tirada de `data/nexgddp/`): até 6 mm num mês, e no ano ACCESS-CM2 1.257 contra 1.249 mm, MIROC6 1.167 contra 1.182, MRI-ESM2-0 1.278 contra 1.280. O ranking pode mudar entre as duas contas: a revisão estatística de 15/11 mostrou que, com a razão exata, o 1º do MIROC6 em fevereiro troca. Por isso a coluna `razao_chuva` deve vir do dono dos dados.
    - `et0_mm` (se hoje traz a coluna): ET0 de hoje × Hargreaves(temperaturas sem a correção A520 + delta do modelo) ÷ Hargreaves(sem a correção). Igual ao script, a menos de 0,1 mm/mês. Sem `off_tmin`/`off_tmax`, usa as temperaturas de hoje como estão (erro de até 1,3 mm/mês). Sem a coluna em hoje, o Hargreaves do motor usa as temperaturas novas.
    - `dias_acima_NN`: as colunas por grau de hoje deslocadas pelo `delta_tmax_c` do modelo (`dias_acima_deslocado`, a mesma conta do ajuste de temperatura). O script conta os dias do POWER com a Tmax diária + delta; a interpolação entre graus erra até 0,34 dia/mês nos limiares das culturas (32 a 38 °C).
    - Renda com o mesmo teto (regra 12), score com os mesmos pesos, ranking com a mesma ordem (`_chave_rank`) entre as sequências viáveis. Nada disso entra no score, no rank nem nos avisos do futuro médio.
    - `ajuste` (regra 19) vale também para os futuros por modelo, depois de montados.
    - Média dos três futuros por modelo contra `clima_futuro.csv` (talhão de demonstração): chuva +0,08 mm/ano (no máximo 0,08 mm num mês, onde a chuva de um modelo chega a zero), Tmin e Tmax até 0,01 °C (arredondamento), ET0 −0,1 mm/ano, dias acima de 35 °C +2,6 por ano (69,5 no futuro médio). Os dias quentes não são lineares no delta: a média das contagens exatas por modelo já dá +1,6 dia/ano; a interpolação soma o resto.
21. **Altitude mínima** (só com `entrada.altitude_m`, desde 15/11): uma sequência que cabe no calendário mas tem cultura com `altitude_min_m` maior que `altitude_m` vai para `descartadas`. Altitude igual à mínima não descarta. O motivo leva os campos de época (`cultura`, `posicao`, `slot`, `mes_livre`, `mes_plantio`) mais `altitude_min_m` e `altitude_m`; vale a primeira cultura da sequência abaixo da mínima. O calendário vem antes: sequência que já não cabia na época continua com o motivo de época, então as descartadas novas são só as que saem do ranking. Se nenhuma sequência sobra na ordem do semestre (por época ou altitude), o motor tenta o outro slot, como na regra 2. A altitude não depende do clima: as descartadas são as mesmas em hoje, futuro, ano seco, modo diário e futuros por modelo. Hoje só o trigo tem mínima (800 m, sequeiro no Cerrado, Embrapa); o talhão de demonstração está a 484 m. Talhão de demonstração, histórico soja, milho, pesos iguais, com o ano seco e os modelos: **outubro** — 25 viáveis sem altitude, 21 com 484,41 m (saem `soja>trigo`, `milho>trigo`, `sorgo>trigo` e `feijao>trigo`, que cabiam no calendário); top 5 de hoje sem altitude `soja>crotalaria` 78,2, `soja>milho` 77,9, `soja>sorgo` 76,5, `soja>feijao` 73,7, `soja>trigo` 71,8; com altitude, o trigo sai e `soja>milheto` (71,2) entra em 5º. **Fevereiro** — 35 viáveis sem altitude, 30 com (saem `trigo>soja`, `trigo>milho`, `trigo>sorgo`, `trigo>feijao` e `trigo>algodao`); o top 5 de hoje não muda (`crotalaria>soja` 78,1, `sorgo>soja` 76,7, `feijao>soja` 73,6, `crotalaria>milho` 73,5, `milho>soja` 73,3), só ranks do futuro (por exemplo, `feijao>soja` 10º → 9º).

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

1. **Anos:** o talhão fica livre no dia 1 de `mes_plantio` de cada ano da série. Entram os anos em que cabem inteiros a sequência mais longa e os 365 dias do solo descoberto (regra 11). Com a série de 2005 a 2024: 19 anos, de 2005 a 2023, na maioria dos meses; janeiro com uma cultura: 20 (até 2024, que é bissexto); dezembro com duas culturas: 18 (até 2022). Fevereiro e março com uma cultura perderam 2024 quando entrou o solo descoberto (antes eram 20 anos). O `ano` é o do dia em que o talhão fica livre (outubro de 2020 = safra 2020/21).
2. **Calendário:** o mesmo do modo mensal, em dias contados a partir do talhão livre. As sequências viáveis e as descartadas não mudam.
3. **Balanço hídrico:** as regras 5 e 6, com a chuva e o ET0 de cada dia.
4. **Encaixe de temperatura e de chuva:** as regras 7 e 8, com a temperatura média de cada dia e a chuva do ciclo naquele ano.
5. **Calor:** conta os dias da fase sensível com `tmax_c` acima do limiar da cultura. Não usa as colunas `dias_acima_NN`.
6. **Perda por falta de água (Ky):** `fator_agua` = 1 − Ky × (1 − `atendimento_hidrico`), a função de resposta da FAO (FAO-56, equação 90). No modo diário ele entra no lugar do atendimento hídrico no "menor fator" da regra 11. Com Ky acima de 1, a cultura perde mais produtividade do que a água que faltou.
7. **Futuro:** a série de hoje com a mudança mensal entre `clima_futuro` e `clima_hoje`. Nas temperaturas, soma a diferença do mês; na chuva e no ET0, multiplica pela razão do mês (dia sem chuva continua sem chuva). Funciona para qualquer ponto que tenha as duas tabelas.
8. **Resumo:** o ano mediano e o ano ruim são anos reais. O motor calcula o score de cada ano (renda pela regra 9) e ordena os anos do pior para o melhor score; o ano mediano é o do meio (com número par de anos, o de baixo) e o ano ruim é o da posição 20% (com 19 anos, o 4º pior). `agua`, `atendimento_hidrico`, `solo`, `receita_ha`, `renda`, `score` e os números de cada cultura vêm desse mesmo ano, e `ano` diz qual é. Antes de 15/11 cada parte tinha o seu quantil, e o score do ano ruim era de um ano que não existiu. O ano escolhido depende dos pesos, porque depende do score. `anos[]` traz `renda` e `score` de cada ano.
9. **Renda, score e rank:** `renda` = receita do ano ÷ `anos_ocupados` da sequência (o calendário é o do modo mensal) ÷ o mesmo teto do modo mensal, no máximo 1. O `score` usa os mesmos pesos da entrada. Há um rank para o ano mediano e outro para o ano ruim, em cada clima.
10. **Geada e chuva extrema (Parte 4):** em cada ano, o motor conta os dias do ciclo de cada cultura com `tmin_c` de 3 °C ou menos (geada) e com chuva acima do limiar de chuva extrema. Geada com mínima no abrigo de até 3 °C é o critério usual no Brasil (Grodzki et al., 1996; Embrapa Trigo): o ar no abrigo fica de 3 a 6 °C mais quente que a superfície das plantas. Chuva extrema é o dia acima do percentil 95 dos dias com pelo menos 1 mm na série de hoje (índice R95p do ETCCDI); o mesmo limiar vale no futuro, para a contagem mostrar a mudança. As contagens não mudam produtividade, score nem rank. Geada em algum ano vira o aviso `geada`; chuva extrema não vira aviso, porque por definição acontece todo ano no período chuvoso, e fica só como número.
11. **Solo descoberto (regras 15 e 16, Parte 2):** os dias sem cultura e os dias expostos são os do modo mensal: o mesmo calendário, contado a partir do talhão livre, igual em todo ano e nos dois climas. Muda a chuva: em cada ano, a soma da chuva de cada dia da série nesses dias (no futuro, a série da regra 7). Com `declividade_pct`, `indice_erosao` = `chuva_exposta_mm` × fator S, como na regra 16. O resumo traz a mediana e o ano ruim de cada número. Aqui o ano ruim é o de **mais** chuva, porque mais chuva sobre solo sem cultura é mais risco de erosão: o valor na posição 20% da lista ordenada do mais chuvoso para o menos (com 19 anos, o 4º mais chuvoso), a mesma posição de `QUANTIL_RUIM` das outras partes, do outro lado. Cada número tem o seu ano ruim. Não muda score, rank nem avisos.

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
{"diario": {"anos": [2005, 2006, "...", 2023], "n_anos": 19, "quantil_ruim": 0.2,
            "limiar_geada_c": 3.0, "limiar_chuva_extrema_mm": 24.67}}
```

Em cada item de `sequencias` (exemplo: `milho>soja`, talhão livre em fevereiro, histórico soja, milho):

```json
{
  "diario": {
    "hoje": {
      "mediano": {"agua": 0.528, "atendimento_hidrico": 0.811, "solo": 0.402, "receita_ha": 11216.125, "renda": 0.747, "score": 55.883, "rank": 11},
      "ruim":    {"agua": 0.307, "atendimento_hidrico": 0.723, "solo": 0.358, "receita_ha": 9959.451, "renda": 0.663, "score": 44.272, "rank": 13},
      "pior_ano": {"ano": 2020, "agua": 0.133, "atendimento_hidrico": 0.653, "receita_ha": 8825.713},
      "culturas": [
        {
          "cultura": "milho",
          "slot": "safrinha",
          "mediano": {"atendimento_hidrico": 0.777, "fator_agua": 0.721, "encaixe_calor": 1.0, "fator": 0.613, "receita_ha": 4050.442},
          "ruim":    {"atendimento_hidrico": 0.625, "fator_agua": 0.532, "encaixe_calor": 1.0, "fator": 0.452, "receita_ha": 2984.592},
          "eventos": {"geada": {"anos": 0, "dias_total": 0.0, "max_no_ano": 0.0},
                      "chuva_extrema": {"anos": 15, "dias_total": 45.0, "max_no_ano": 9.0}}
        },
        { "...": "soja, na safra" }
      ],
      "anos": [{"ano": 2005, "agua": 0.528, "atendimento_hidrico": 0.811, "solo": 0.399, "receita_ha": 11112.719}, "... um por ano"],
      "descoberto": {
        "dias": 115, "dias_expostos": 8,
        "mediano": {"chuva_mm": 130.26, "chuva_exposta_mm": 53.31, "indice_erosao": 24.898},
        "ruim":    {"chuva_mm": 196.41, "chuva_exposta_mm": 103.76, "indice_erosao": 48.46},
        "anos": [{"ano": 2005, "chuva_mm": 196.41, "chuva_exposta_mm": 73.13, "indice_erosao": 34.155}, "... um por ano"]
      }
    },
    "futuro": { "...": "mesma estrutura" }
  }
}
```

| Campo | Significado |
|---|---|
| `mediano`, `ruim` | Mediana e ano ruim de cada parte entre os anos, com `renda`, `score` e `rank` próprios |
| `pior_ano` | O ano de menor receita da sequência (em empate, o de menos água), com `agua`, `atendimento_hidrico` e `receita_ha` desse ano |
| `culturas[]` | Por cultura: mediana e ano ruim do atendimento hídrico, do `fator_agua`, do encaixe de calor, do `fator` e da receita |
| `culturas[].eventos` | Por cultura, `geada` e `chuva_extrema` no ciclo (regra 10 do modo diário): `anos` com pelo menos um dia, `dias_total` somando os anos e `max_no_ano`. Os números da `eventos` acima são ilustrativos |
| `limiar_geada_c`, `limiar_chuva_extrema_mm` | No topo de `diario`: os limiares usados. O de chuva sai da série de hoje (24,67 mm no talhão de demonstração) |
| `anos[]` | `agua`, `atendimento_hidrico`, `solo` e `receita_ha` de cada ano. Serve para um gráfico |
| `descoberto` | Solo sem cultura (regra 11 do modo diário). `dias` e `dias_expostos`: os do `descoberto` mensal. `mediano` e `ruim`: `chuva_mm` e `chuva_exposta_mm` (e `indice_erosao`, só com `declividade_pct`); o ruim é o lado mais chuvoso. `anos[]`: os mesmos números de cada ano. Os números do exemplo saem do talhão de demonstração, com `declividade_pct` = 4,05 |

Não há bloco `seco` no modo diário: o ano seco já é um dos anos da série (2020).

## Constantes com fonte

| Constante | Valor | Fonte |
|---|---|---|
| `CAD_MM` | 60 | Água que o solo guarda (mm). ZARC da soja: profundidade efetiva de raiz de 60 cm × água disponível de latossolo (classes AD3 e AD4 da IN SPA/MAPA 1/2022, 0,61 a 1,06 mm/cm) = 37 a 64 mm; 60 corresponde a AD4 (latossolo argiloso). A classe real do talhão não é conhecida. Fonte conferida pelo resumo da busca, PDF não aberto. Era 100 mm, sem fonte, até 15/11 |
| `CAD_POR_TEXTURA` | arenoso 30, médio 45, argiloso 60 | Mesma raiz de 60 cm × água disponível da classe do ZARC correspondente à textura: arenoso ~ AD2 (0,46 a 0,61 mm/cm = 28 a 37 mm), médio ~ AD3 (0,61 a 0,80 = 37 a 48 mm), argiloso ~ AD4 (0,80 a 1,06 = 48 a 64 mm). AD3 e AD4 conferidas pelo resumo da IN SPA/MAPA 1/2022; a faixa de AD2 e a correspondência textura → classe são de memória, a conferir |
| `SISTEMA_REFERENCIA` | soja safra + milho safrinha | Teto da `renda` (regra 12): o sistema dominante da região. Preço e produtividade da tabela de culturas |

## Constantes provisórias (sem fonte, no topo de `motor/motor.py`)

| Constante | Valor | O que é |
|---|---|---|
| `PENALIDADE_REPETICAO` | 0,85 | Fator ao repetir a cultura |
| `BONUS_APOS_FIXADORA` | 1,10 | Fator depois de um adubo verde (fixa N e não exporta grão), regra 10 |
| `JANELA_BONUS_N_DIAS` | 60 | Prazo máximo do fim do ciclo do adubo verde até o plantio seguinte para o bônus valer. Sugestão da revisão agronômica de 15/11 |
| `PENALIDADE_HOSPEDEIRO` | 0,92 | Fator quando a cultura divide praga ou doença com a anterior (regra 10). Os pares têm fonte; o tamanho do efeito não |
| `PENALIDADE_MOSCA_BRANCA` | 0,75 | Fator da mosca-branca de soja para feijão (regra 10). Perdas citadas pela Embrapa de 40% a 100% em cultivar suscetível; o valor é de memória da revisão agronômica |
| `PESO_SOLO` | 0,4 / 0,4 / 0,2 | Pesos de fixa N, cobre solo, diversidade |
| `FASES_KC` | 20% / 45% / 80% | Fases do Kc no ciclo |
| `DIAS_COLHEITA` | 10 | Dias entre o fim do ciclo e o talhão livre, igual para todas as culturas |
| `ESPERA_MAX_DIAS` | 182 | Espera máxima pelo mês de plantio; mais que isso, a época do slot já passou |
| `FASE_SENSIVEL` | 45% a 80% | Parte do ciclo em que o calor conta |
| `PERDA_CALOR` | 1,0 | Fração da produtividade perdida se todos os dias da fase sensível passam do limiar |
| `AGUA_REF_MIN` | 0 | Piso da faixa fixa da parte `agua` (regra 12). Com 0, a parte `agua` é o atendimento hídrico. Foi 0,6 por algumas horas de 15/11 e voltou a 0 (ver a regra 12) |
| `QUANTIL_RUIM` | 0,2 | Modo diário: posição do "ano ruim" na lista ordenada dos anos |
| `MIN_ANOS_DIARIO` | 5 | Modo diário: mínimo de anos completos na série |
| `KY_PADRAO` | 1,0 | Modo diário: Ky das culturas que não estão na tabela da FAO |
| `AVISO_FATOR` | 0,8 | Fator de clima ou água abaixo disso vira aviso `fator_limitante`; no modo diário, `fator_agua` do ano mediano abaixo disso vira `fator_agua_diario` |
| `AVISO_QUEDA_FUTURO` | 0,10 | Queda de receita de hoje para o futuro que vira aviso |
| `AVISO_QUEDA_ANO_RUIM` | 0,20 | Queda de receita do ano mediano para o ano ruim que vira aviso |
| `AVISO_DIAS_EXPOSTOS` | 60 | Dias sem cultura e sem palhada que viram aviso |
| `AJUSTE_CHUVA_PCT` | −50 a +30 | Faixa aceita de `ajuste.chuva_pct` |
| `AJUSTE_TEMP_C` | 0 a +4 | Faixa aceita de `ajuste.temp_c` |
| `ALTITUDE_M` | −100 a 6000 | Faixa aceita de `altitude_m` (regra 21). Só barra erro de digitação ou de unidade |
| `AVISO_FAIXA_RANK` | 5 | Variação do rank do futuro entre os modelos (máx − mín) acima da qual sai o aviso `rank_varia_entre_modelos` |

Os valores de `KY` têm fonte (FAO-56, tabela 24) e não entram nesta lista. Os limites `AVISO_*` só decidem quando avisar; não entram em nenhuma conta.

> **Números das seções abaixo:** foram calculados em 14/11, com o solo de 100 mm e a `renda` antiga (dividida pela maior receita do conjunto). A partir de 15/11 o solo é de 60 mm e a `renda` é por ano ocupado com teto fixo: os números de água e os scores mudaram, e os rankings também (ver "O que mudou em 15/11"). Refazer.

## O que mudou com o bônus só depois de adubo verde (15/11, regra 10)

Histórico soja, milho, pesos iguais, tabelas de 15/11; score de hoje (rank no futuro entre parênteses).

| Talhão livre em | Antes: top 5 | Agora: top 5 |
|---|---|---|
| Outubro | `soja>milho` 76,4 (1), `soja>sorgo` 76,3 (2), `soja>feijao` 75,2 (6), `soja>crotalaria` 74,0 (3), `soja>girassol` 71,5 (5) | `soja>sorgo` 75,7 (1), `soja>milho` 75,3 (2), `soja>feijao` 75,2 (6), `soja>crotalaria` 74,0 (3), `soja>milheto` 71,2 (4) |
| Fevereiro | `sorgo>soja` 76,0 (1), `feijao>soja` 75,0 (7), `crotalaria>soja` 73,9 (2), `milho>soja` 71,6 (3), `feijao>milho` 71,5 (12) | `sorgo>soja` 76,0 (1), `feijao>soja` 75,0 (7), `crotalaria>soja` 73,9 (2), `milho>soja` 71,6 (3), `milheto>soja` 71,2 (4) |

- Com essa entrada, nenhuma sequência fica com o bônus. Perderam: em outubro, as 12 com soja ou feijão na safra seguidos de não fixadora (`soja>milho`, `soja>sorgo`, `soja>girassol`, `soja>trigo`, `soja>milheto`, `soja>braquiaria`, `feijao>sorgo`, `feijao>milho`, `feijao>milheto`, `feijao>trigo`, `feijao>girassol`, `feijao>braquiaria`); em fevereiro, `feijao>milho`, `feijao>sorgo` e as três depois da crotalária, que acaba em junho e deixa 114 dias até o milho de outubro, 145 até o sorgo de novembro e 175 até o algodão de dezembro. Nenhuma ganhou.
- Milheto e braquiária têm preço zero: perder o bônus não muda o score delas.
- Outubro: `soja>sorgo` passa `soja>milho` hoje e no futuro, por 0,4 ponto (um empate). Fevereiro: `feijao>milho` cai de 5º para 9º; `crotalaria>algodao` de 9º para 11º (21º no futuro).
- O bônus continua para quem tem crotalária no fim do histórico e planta a 1ª cultura até 50 dias depois do talhão livre.

## O que mudou em 15/11 depois das duas revisões

Histórico soja, milho, pesos iguais, solo padrão (60 mm). Score de hoje; entre parênteses, o rank no futuro médio e a faixa entre os três modelos.

| Talhão livre em | 1º | 2º | 3º | Feijão |
|---|---|---|---|---|
| Outubro | `soja>milho` 77,9 (1º; 1–1) | `soja>sorgo` 76,5 (3º; 2–3) | `soja>crotalaria` 76,5 (2º; 2–3) | `soja>feijao` 4º hoje, 7º no futuro |
| Fevereiro | `sorgo>soja` 76,7 (1º; 1–2) | `crotalaria>soja` 76,4 (2º; 1–2) | `feijao>soja` 73,6 (10º; 9–10) | |

O que mudou: a parte `agua` voltou a ser o atendimento hídrico (sem o piso de 0,6), a parte `solo` não usa mais a água, a mosca-branca de soja para feijão tem fator próprio (0,75), os avisos de repetição e de bônus usam marcas e não comparam números quebrados, e o ano mediano e o ano ruim do modo diário são anos reais escolhidos pelo score.

Ressalvas das revisões, para a tela e o pitch:

- Os 1º lugares de hoje são empates: a diferença para o 2º é menor que 2 pontos, e o ruído entre anos é de 1 a 1,3 ponto por diferença. Mostrar como empate.
- O contraste hoje × futuro robusto é a queda das sequências com feijão (17 de 19 anos no modo diário, medido pela revisão estatística antes destes ajustes). Ele depende do limiar de calor de 32 °C e da perda de 1 para 1 (itens 2 e 3).
- Os valores 0,92, 0,75, 60 dias e 1,10 são provisórios.
- Trigo de sequeiro a 484 m e crotalária em março continuam (dono dos dados).

## O que mudou em 15/11 (solo de 60 mm, renda por ano ocupado)

Histórico soja, milho, pesos iguais, clima de hoje (futuro entre parênteses quando difere):

| Talhão livre em | Antes: 1º, 2º, 3º | Agora: 1º, 2º, 3º |
|---|---|---|
| Outubro | `soja>milho` 82,0, `soja>sorgo` 80,3, `soja>crotalaria` 79,2 | `soja>milho` 76,4, `soja>sorgo` 76,3, `soja>feijao` 75,2 (futuro: `soja>crotalaria` em 3º) |
| Fevereiro | `crotalaria>algodao` 79,2, `crotalaria>soja` 75,6, `sorgo>soja` 74,8 (futuro: `crotalaria>soja` em 1º) | `sorgo>soja` 76,0, `feijao>soja` 75,0, `crotalaria>soja` 73,9 (futuro: `sorgo>soja` em 1º) |

- Fevereiro: `crotalaria>algodao` ocupa 1,3 ano e caiu de 1º para 9º hoje (20º no futuro). A troca de vencedor entre hoje e o futuro em fevereiro deixou de existir: `sorgo>soja` vence nos dois.
- Outubro: `soja>milho` e `soja>sorgo` ficam a 0,1 ponto, um empate. Com o solo de 60 mm, o milho safrinha atende 72% da demanda de água no mensal (era 82%), e a parte `agua` de `soja>milho` cai de 0,918 para 0,875.

## O que mudou em 15/11 (hospedeiro comum de pragas)

A revisão agronômica apontou que `soja>feijao` e `feijao>soja` subiam sem custo, embora as duas culturas dividam mofo-branco e a soja multiplique a mosca-branca que leva o mosaico-dourado ao feijão. Regra 10, fator 0,92 (provisório). Histórico soja, milho, pesos iguais, clima de hoje (rank no futuro entre parênteses):

| Talhão livre em | Antes: 1º a 5º | Agora: 1º a 5º |
|---|---|---|
| Outubro | `soja>milho` 76,4, `soja>sorgo` 76,3, `soja>feijao` 75,2 (6º), `soja>crotalaria` 74,0, `soja>girassol` 71,5 | `soja>milho` 76,4, `soja>sorgo` 76,3, `soja>feijao` 74,8 (7º), `soja>crotalaria` 74,0, `soja>trigo` 71,4 |
| Fevereiro | `sorgo>soja` 76,0, `feijao>soja` 75,0 (7º), `crotalaria>soja` 73,9, `milho>soja` 71,6, `feijao>milho` 71,5 | `sorgo>soja` 76,0, `crotalaria>soja` 73,9, `feijao>soja` 73,6 (10º), `milho>soja` 71,6, `feijao>milho` 71,5 |

- Levam a penalidade: em outubro, `soja>feijao`, `soja>girassol` (1,10 × 0,92: cai de 5º para 7º) e `feijao>girassol`; em fevereiro, `feijao>soja`, `girassol>soja` e `girassol>feijao`.
- O efeito no score é pequeno: 0,92 só tira 8% da receita da cultura seguinte, e a receita é um terço do score com pesos iguais. `soja>feijao` continua em 3º em outubro. Com 0,85 continuaria em 3º; com 0,75 cairia para 4º. `feijao>soja` em fevereiro troca de lugar com `crotalaria>soja`.

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

No clima médio, a parte de `agua` do score quase não separa as sequências. Não é porque a água não importa: o modo mensal calcula o balanço no clima médio, e a média apaga os anos e os dias secos (o balde de 100 mm transborda nos meses chuvosos). Na média das sequências, `agua` mensal fica 0,07 a 0,08 acima da média dos anos do modo diário. No ano seco ela separa:

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

- **Outubro:** no ano mediano, `soja>sorgo` fica 0,7 ponto à frente de `soja>milho` no score, um empate (bootstrap dos anos: 49% e 44% de vitórias); no ano ruim, `soja>milho` volta ao primeiro lugar. O milho safrinha atende 76% da demanda de água no ano mediano e, com Ky de 1,25, fica com `fator_agua` de 0,70 (0,53 no ano ruim).
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
7. ~~**Calor futuro no modo diário é menor que o das tabelas.**~~ Resolvido em 15/11 pelo dono dos dados: as tabelas passaram a contar os dias quentes do futuro na Tmax diária deslocada, como o modo diário. Os dois dão 69,5 dias por ano acima de 35 °C.
8. **O futuro diário repete os veranicos de hoje.** A mudança é aplicada mês a mês sobre os mesmos dias; uma mudança na frequência dos períodos secos não aparece.
9. **Água de hoje pode estar contada duas vezes.** É o mesmo problema do item 4: a produtividade da Conab já é a de um ano médio, e o modo diário desconta de novo a falta de água do ano mediano. A diferença entre ano mediano, ano ruim e futuro é o que ele mostra bem.
10. **Hargreaves dia a dia.** O método é indicado para médias de vários dias; o total anual bate com o da tabela, mas o valor de um dia isolado é ruidoso.
11. **Modo diário na API e na tela.** A API (`backend/app.py`) ainda chama o motor sem `diario`, e o `Dockerfile` não copia `data/power`. Para outros pontos, a função de clima por ponto teria de devolver a série diária que já baixa. "Ano ruim, 1 em 5" encosta em "win rates or probabilities", que está fora do escopo no `CLAUDE.md`: mostrar isso na tela depende de o time reabrir.
12. **Ky é o da estação inteira.** A FAO também dá Ky por fase da cultura; o motor usa um valor só por cultura.
13. **Rotação atual supõe uma cultura por slot.** O motor só recebe a ordem das culturas, sem a safra de cada uma. Quem planta uma cultura por ano e deixa a safrinha sem nada (pousio) não consegue informar isso: o histórico soja, soja vira `soja>soja`, que é descartada porque a soja não tem plantio de safrinha. Faltam o pousio como opção de slot e o slot de cada cultura do histórico.
14. **Palhada dura até o próximo plantio.** O motor supõe que a palhada de uma cultura com `cobre_solo` = 1 cobre o solo até a cultura seguinte entrar, por mais tempo que leve, e que as outras não deixam nada. Não há taxa de decomposição nem quantidade de palhada por cultura. `cobre_solo` foi preenchido à mão.
15. **Índice de erosão não é perda de solo.** Usa o total de chuva, não a erosividade (fator R), e deixa de fora o tipo de solo (K), o comprimento da rampa (L) e o manejo (C, P). O fator S linear subestima em declives fortes, além dos dados de origem (até 18%). A declividade é a média do talhão.
16. **Solo descoberto no modo diário e na API.** Desde 15/11 o modo diário devolve a chuva sobre solo sem cultura e exposto de cada ano, com mediana e ano ruim (o mais chuvoso) e o `indice_erosao` quando há `declividade_pct` (regra 11 do modo diário). Falta chegar à tela: a API ainda chama o motor sem `diario` (item 11). O índice continua usando o total de chuva, não a erosividade (item 15). A API aceita `declividade_pct` opcional (0 a 100, finito) e anuncia `capabilities.declividade_pct` em `/metadata`; o front só envia a declividade no contorno do talhão de demonstração.
17. **Aviso de preço e de limiar sem fonte depende dos dados.** O motor avisa `valor_a_conferir` quando `culturas.csv` traz colunas `<campo>_status`. Desde 15 nov `culturas.csv` traz `preco_status` (feijão, girassol e algodão: `memoria`) e `temp_calor_c_status` (girassol: `sem fonte`; trigo: `memoria`), preenchidas em `STATUS` de `scripts/montar_culturas.py` conforme `docs/culturas_fontes.md`. Ao conferir um valor, apague a entrada em `STATUS` e rode o script de novo.
18. ~~**`fator_limitante` olha o modo mensal.**~~ Resolvido em 15/11 com um código à parte, `fator_agua_diario` (regra 17), em vez de mudar `fator_limitante`: sem o modo diário a saída não muda, e o texto da tela para `fator_limitante` ("usa a avaliação mensal") continua certo. Com `diario=`, o milho safrinha de `soja>milho` (outubro, histórico soja, milho) atende 82% no mensal (sem aviso) e ganha o aviso com `fator_agua` 0,696 hoje e 0,693 no futuro (atendimento 0,757 e 0,755, Ky 1,25); `clima_favoravel` sai dessa sequência. No talhão de demonstração, em outubro: 14 avisos em 7 das 26 sequências, 10 deles sem aviso de água no mensal (milho safrinha de `soja>milho`, trigo safrinha), e `clima_favoravel` passa de 11 para 10 sequências. Em fevereiro: 20 avisos em 10 das 36 (milho safrinha 0,72, trigo safrinha 0,73), nenhum com aviso de água no mensal, e `clima_favoravel` passa de 18 para 15. Fica em aberto: o aviso olha só a água do ano mediano; o ano ruim e o calor do diário não viram aviso por cultura (o ano ruim já entra em `queda_no_ano_ruim`).
19. **Dias quentes no ajuste de temperatura.** Desde 15/11 as tabelas têm uma coluna `dias_acima_NN` por grau, de 26 a 40 °C (`scripts/montar_clima.py`). Com os limiares das culturas (32 a 38 °C) e `temp_c` até 4, todo ajuste inteiro cai numa coluna e é exato. Ajuste fracionário (por exemplo, +0,5 °C) interpola entre dois graus vizinhos, um erro pequeno. Antes, só havia 32/35/36/38, e a interpolação errava de −31% a +20% (revisão estatística). A API aceita `ajuste` desde 15/11 e anuncia `capabilities.ajuste` em `/metadata`.
20. **Pesos efetivos não são os nominais.** A faixa fixa de 0,6 na parte `agua` foi tentada em 15/11 e revertida (regra 12). Revisão estatística de 15/11, com a fração da variância do score de cada parte: com pesos iguais, a renda responde por cerca de metade; e a resposta aos pesos é amplificada (peso nominal de 60% numa parte dá de 72% a 100% do resultado). O controle é monótono, mas não linear. Declarar: os pesos não são frações do resultado. A tabela abaixo é da tentativa com 0,6 (histórico):

    | Clima | Antes: água / solo / renda | Depois |
    |---|---|---|
    | Outubro, hoje (26 sequências) | 14% / 32% / 54% (desvio 0,051 / 0,116 / 0,193) | 29% / 27% / 44% (0,127 / 0,116 / 0,193) |
    | Outubro, futuro | 13% / 34% / 53% | 27% / 28% / 45% |
    | Outubro, ano seco | 18% / 30% / 51% | 36% / 24% / 40% |
    | Fevereiro, hoje (36 sequências) | 14% / 32% / 54% (0,052 / 0,118 / 0,201) | 29% / 26% / 45% (0,129 / 0,118 / 0,201) |
    | Fevereiro, futuro | 14% / 36% / 50% | 29% / 29% / 41% |
    | Fevereiro, ano seco | 23% / 32% / 45% | 41% / 24% / 34% |
    | Modo diário, ano mediano e ano ruim, hoje e futuro, os dois meses | 12% a 16% / 30% a 35% / 50% a 56% | 26% a 31% / 25% a 29% / 41% a 46% |

    Com o piso de volta a 0, a água entra uma vez de forma direta (parte `agua`) e uma vez na receita (pelo fator de crescimento); não entra mais na parte `solo`.

    Três primeiras de hoje, pesos iguais (futuro entre parênteses): outubro passou de `soja>milho`, `soja>sorgo`, `soja>feijao` (`soja>milho`, `soja>sorgo`, `soja>crotalaria`) para `soja>feijao`, `soja>sorgo`, `soja>crotalaria` (`soja>sorgo`, `soja>milheto`, `soja>crotalaria`); fevereiro, de `sorgo>soja`, `feijao>soja`, `crotalaria>soja` (`sorgo>soja`, `crotalaria>soja`, `milho>soja`) para `feijao>soja`, `sorgo>soja`, `feijao>milho` (`sorgo>soja`, `milheto>soja`, `crotalaria>soja`). Em outubro `soja>milho` foi de 1º para 6º hoje e 5º no futuro: o milho safrinha atende 72% da demanda, a sequência atende 87,5%, e `agua` cai de 0,875 para 0,687. `soja>feijao` vence hoje e cai para 6º no futuro, pelo calor de 32 °C do feijão (item 2); `feijao>soja` faz o mesmo em fevereiro (1º hoje, 5º no futuro). Com água 3, solo 1, renda 1, os três primeiros de hoje mudam nos dois meses (outubro: `soja>feijao`, `soja>milheto`, `soja>sorgo`; fevereiro: `feijao>soja`, `feijao>milho`, `milheto>soja`). Antes da escala também mudavam, com o feijão subindo pela água.
21. **Textura do solo.** O motor recebe `solo_textura`; a sugestão por ponto vem de `data/solo/regiao_mg/textura.csv` (GLDAS2/Noah, 0,25°, do dono dos dados). A API ainda não lê o arquivo. A célula é muito maior que o talhão: a tela deve tratar a fonte como sugestão e deixar o produtor trocar. No talhão de demonstração (célula argilosa, 51,8% de argila), outubro, histórico soja, milho: argiloso dá `soja>milho` em 1º hoje e no futuro; arenoso dá `soja>milho` e `soja>crotalaria` empatadas em cima (75,8 e 75,2). Nos dois, `soja>feijao` é 4ª hoje e 7ª no futuro.
22. **Faixa entre modelos (regra 20).** Três modelos não são uma distribuição: a faixa é mín–máx entre eles, não um intervalo de confiança (um quarto modelo cairia fora dela em metade das vezes, se fossem intercambiáveis). Chuva por aproximação até o dono dos dados acrescentar `razao_chuva` por modelo a `clima_modelos.csv`; com a razão exata, a revisão estatística viu o 1º do MIROC6 em fevereiro trocar. Os deltas de chuva não são significativos (0 de 36 combinações modelo-mês com |t| > 2); os de Tmax são. Frase defensável: os modelos concordam no aquecimento; a diferença de chuva entre eles não se distingue da variabilidade natural. A interpolação dos dias quentes por modelo tem viés para cima de 0,3 a 1,3 dia por ano. Talhão de demonstração, histórico soja, milho, pesos iguais (motor de 15/11 depois das revisões): **outubro** — `soja>milho` é o 1º do futuro nos três modelos; `soja>sorgo` 2º a 3º; `soja>feijao` 6º a 8º. **Fevereiro** — `sorgo>soja` 1º no ACCESS-CM2 e no MRI-ESM2-0, `crotalaria>soja` 1º no MIROC6 (as duas empatam no futuro médio, 75,7); `feijao>soja` 9º a 10º.
