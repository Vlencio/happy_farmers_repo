# culturas.csv — fontes e status de cada valor

Gerado por `scripts/montar_culturas.py`. Os valores manuais ficam no dicionário
`MANUAL` do script; para mudar um número, edite lá e rode de novo.

Legenda de status: **conferido** (lido na fonte), **aproximação** (valor
adaptado de outra cultura) e **memória** (valor típico conhecido, ainda sem
fonte aberta — conferir antes do pitch).

## Faixas de clima — FAO ECOCROP via GAEZ

`temp_*`, `chuva_*`, `ciclo_ecocrop_*` saem direto de `data/ecocrop/EcoCrop_DB.csv`
(colunas `TMIN, TMAX, TOPMN, TOPMX, RMIN, RMAX, ROPMN, ROPMX, GMIN, GMAX`).
Status: **conferido**.

Espécie escolhida quando há mais de uma entrada:

| cultura | espécie | motivo |
|---|---|---|
| milho | *Zea mays* | a ssp. *saccharata* é milho-doce |
| sorgo | *Sorghum bicolor* | a var. *sweet* é sorgo sacarino |
| braquiária | *Brachiaria brizantha* | a *B. decumbens* tem TMIN 19 °C e falharia em junho–julho no talhão |
| crotalária | *Crotalaria juncea* | a mais usada como cobertura no Cerrado |

Atenção: no ECOCROP, `RMIN`/`RMAX` são de chuva **anual**, não do ciclo
(**memória**, conferir na documentação da FAO). Se for anual, comparar com o
talhão inteiro (1.242 mm/ano), não com a chuva do ciclo. Exemplo: o sorgo tem
`chuva_max` = 700 mm e seria penalizado na safra.

## Ciclo e janela de plantio — sistemas do Cerrado

| cultura | ciclo_dias | safra | safrinha | observação |
|---|---|---|---|---|
| soja | 115 | out | — | soja sobre soja é barrada pelo calendário de semeadura (vazio sanitário) |
| milho | 135 | out | fev | |
| sorgo | 110 | nov | fev | uso principal é safrinha |
| milheto | 90 | — | fev | cobertura |
| braquiária | 120 | — | fev | solteira ou em consórcio com o milho safrinha; ciclo até a dessecação |
| crotalária | 100 | — | mar | cobertura após a soja |
| feijão | 90 | nov | fev | feijão das águas e da seca |
| girassol | 110 | — | fev | |
| algodão | 170 | dez | — | ciclo longo: não sobra safrinha depois dele |

Status: **memória** (práticas típicas Embrapa/ZARC para o Triângulo Mineiro).
O certo é conferir no ZARC do município. O ECOCROP (`ciclo_ecocrop_*`) dá faixas
largas demais para servir de ciclo.

Regra para o motor: só combinar uma cultura em um slot se ela tiver mês de
plantio naquele slot e se a cultura da safra terminar antes do plantio da safrinha.

## Kc — FAO-56, tabela 12

| cultura | kc_ini | kc_med | kc_fim | status |
|---|---|---|---|---|
| soja | 0,40 | 1,15 | 0,50 | memória (FAO-56) |
| milho grão | 0,30 | 1,20 | 0,35 | memória (FAO-56; 0,35 = colheita com grão seco) |
| sorgo grão | 0,30 | 1,05 | 0,55 | memória (FAO-56) |
| milheto | 0,30 | 1,00 | 0,30 | memória (FAO-56) |
| feijão seco | 0,40 | 1,15 | 0,35 | memória (FAO-56) |
| girassol | 0,35 | 1,05 | 0,35 | memória (FAO-56) |
| algodão | 0,35 | 1,18 | 0,60 | memória (FAO-56) |
| braquiária | 0,40 | 0,95 | 0,85 | aproximação: pastagem em pastejo rotacionado |
| crotalária | 0,40 | 1,05 | 0,90 | aproximação: leguminosa cortada na floração |

## fixa_n e cobre_solo

- `fixa_n` = 1: soja, feijão, crotalária (leguminosas).
- `cobre_solo` = 1: milho, sorgo, milheto, braquiária, crotalária (deixam palhada).

Preenchido à mão.

## Produtividade — Conab, 10º levantamento da safra 2024/25 (jul/2025), média Brasil

Lida na tabela "Grãos de verão" do relatório FAESP com dados da Conab
(faespsenar.com.br, "2025.07 10o Levantamento da safra de grãos"). O PDF não
traz a tabela de Minas Gerais, então os valores são **médias do Brasil**.

| cultura | produtividade (t/ha) | produtividade_safrinha | status |
|---|---|---|---|
| soja | 3,56 | — | conferido |
| milho | 6,61 (1ª safra) | 6,10 (2ª safra) | conferido |
| sorgo | 3,53 | 3,53 | conferido |
| feijão | 1,17 (1ª safra) | 0,98 (2ª safra) | conferido |
| girassol | 1,57 | 1,57 | conferido |
| algodão | 1,90 (pluma) | — | **memória**: a Conab traz caroço (2,66 t/ha); a receita vem da pluma |
| milheto, braquiária, crotalária | 0 | 0 | cobertura, sem venda no MVP |

## Preço — R$/t

| cultura | preço | origem | status |
|---|---|---|---|
| soja | 2.340 | R$ 140,50/sc 60 kg, média CEPEA/Esalq de ago/2025 (relatório Agro em Dados, gov. de Goiás) | conferido, mas é preço de referência portuário |
| milho | 1.083 | R$ 65/sc, Indicador ESALQ/BM&FBovespa em out/2025 | conferido |
| sorgo | 870 | ~80% do milho | memória |
| feijão | 3.500 | ~R$ 210/sc de feijão carioca | memória, preço muito volátil |
| girassol | 2.000 | | memória |
| algodão | 9.000 | ~R$ 135/@ de pluma | memória |

O preço é editável na tela. Para o pitch, troque os valores de **memória** por
médias anuais do CEPEA (cepea.esalq.usp.br).
