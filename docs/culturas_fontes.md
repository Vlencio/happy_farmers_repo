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

**Chuva: comparar com a chuva do ciclo, não com a anual.** As duas leituras existem:
- a FAO descreve `RMIN`/`RMAX` como chuva anual;
- o modelo EcoCrop do pacote `dismo` (Hijmans), que é a implementação de
  referência, compara com a chuva acumulada no ciclo. A duração usada é
  (GMIN + GMAX) / 2, em meses, mais o mês anterior ao plantio.

A leitura do ciclo bate com o ZARC da soja em MG (Portaria SPA/MAPA nº 370/2025),
que pede de 450 a 800 mm por ciclo; o `RMIN` da soja é 450. Recomendação para o
motor: somar a chuva dos meses do ciclo (`ciclo_dias`) e comparar com `chuva_*`.
Consequência: o sorgo (`chuva_max` = 700 mm) fica fora na safra (nov–fev, cerca
de 790 mm) e cabe na safrinha (fev–mai, cerca de 440 mm). É coerente com a
prática no Cerrado.

## Ciclo e janela de plantio — sistemas do Cerrado

| cultura | ciclo_dias | safra | safrinha | observação |
|---|---|---|---|---|
| soja | 115 | out | — | soja sobre soja é barrada pelo calendário de semeadura (vazio sanitário) |
| milho | 135 | out | fev | |
| sorgo | 110 | nov | fev | uso principal é safrinha |
| milheto | 90 | — | fev | cobertura |
| braquiária | 120 | — | fev | solteira ou em consórcio com o milho safrinha; ciclo até a dessecação |
| crotalária | 100 | — | fev | cobertura logo após a soja (Embrapa Agropecuária Oeste, Circular Técnica 44, 2018) |
| feijão | 90 | nov | fev | feijão das águas e da seca |
| girassol | 110 | — | fev | |
| algodão | 170 | dez | — | ciclo longo: não sobra safrinha depois dele |
| trigo | 120 | — | mar | trigo tropical de sequeiro, depois da soja |

Status:
- Ciclo da soja: **conferido**. O ZARC da soja em MG 2025/26 simula cultivares de 100, 115 e 130 dias.
- Meses de plantio e demais ciclos: **memória** (práticas típicas no Triângulo Mineiro), exceto a crotalária.
- Crotalária em fevereiro (era março): **conferido**, com ressalva de local. Garcia e Staut, *Como inserir crotalária em sistemas de produção de grãos*, Embrapa Agropecuária Oeste, Circular Técnica 44, dez. 2018. Em Dourados (MS), após a soja, fevereiro é "o período mais favorável": a juncea fez 8,4 t/ha de matéria seca semeada em 22/2/2017 e 3,6 t/ha em 5/4/2017. Crotalária é planta de dia curto; quanto mais tarde, menos biomassa. O ensaio é de MS, não de MG.
- Trigo de sequeiro: a Embrapa recomenda acima de 800 m no Cerrado (cultivar BRS 404 para DF, GO e MG; uma nota técnica mais recente admite 700 m em solo com mais de 35% de argila). O talhão de demonstração está a 484 m (`data/talhao/declividade.csv`). Vai na coluna `altitude_min_m` = 800; o trigo continua na tabela, e tirar ou avisar fica com o motor.

A portaria do ZARC traz só as regras gerais. Os decêndios de cada município
ficam no Painel de Indicação de Riscos do MAPA, consultado à mão. O ECOCROP
(`ciclo_ecocrop_*`) dá faixas largas demais para servir de ciclo.

Regra para o motor: só combinar uma cultura em um slot se ela tiver mês de
plantio naquele slot e se a cultura da safra terminar antes do plantio da safrinha.

## Kc — FAO-56, tabela 12

`kc_med` e `kc_fim` foram conferidos na tabela 12 (fao.org/4/x0490e/x0490e0b.htm).
Os `kc_ini` aparecem como imagem na página e não foram lidos: são os valores
típicos por grupo (cereais 0,30; leguminosas 0,40; fibras e oleaginosas 0,35),
de **memória**.

| cultura | kc_ini | kc_med | kc_fim | tabela 12 |
|---|---|---|---|---|
| soja | 0,40 | 1,15 | 0,50 | 1,15 / 0,50 |
| milho grão | 0,30 | 1,20 | 0,35 | 1,20 / 0,60–0,35; 0,35 = grão seco no campo |
| sorgo grão | 0,30 | 1,05 | 0,55 | 1,00–1,10 / 0,55 |
| milheto | 0,30 | 1,00 | 0,30 | 1,00 / 0,30 |
| feijão seco | 0,40 | 1,15 | 0,35 | 1,15 / 0,35 |
| girassol | 0,35 | 1,00 | 0,35 | 1,0–1,15 / 0,35; o menor valor vale para sequeiro |
| algodão | 0,35 | 1,18 | 0,60 | 1,15–1,20 / 0,70–0,50 |
| braquiária | 0,40 | 0,95 | 0,85 | aproximação: "Grazing Pasture, Rotated" 0,40 / 0,85–1,05 / 0,85 |
| crotalária | 0,40 | 0,90 | 0,85 | aproximação: "Clover hay, averaged cutting" 0,40 / 0,90 / 0,85 |
| trigo | 0,30 | 1,15 | 0,30 | 1,15 / 0,25–0,40 |

## fixa_n e cobre_solo

- `fixa_n` = 1: soja, feijão, crotalária (leguminosas).
- `cobre_solo` = 1: milho, sorgo, milheto, braquiária, crotalária, trigo (deixam palhada).

Preenchido à mão.

## Limiar de calor (`temp_calor_c`)

Máxima diária, em °C, a partir da qual o florescimento ou a formação de grãos é
prejudicada. Fonte: Luo (2011), "Temperature thresholds and crop production: a
review", Climatic Change 109:583–598, lido no PDF.

| cultura | temp_calor_c | o que a revisão diz | status |
|---|---|---|---|
| milho | 35 | acima de 35 °C o pólen perde a viabilidade | conferido |
| feijão | 32 | produção falha a 32 °C; 32/27 °C (dia/noite) reduz muito a formação de vagens | conferido |
| algodão | 35 | Luo (2011): acima de 32 °C o pólen perde viabilidade; 40/32 °C zera a produção. Mudado de 32 para 35 em 15/11, a pedido da revisão agronômica; ver abaixo | conferido (Reddy et al. 1992; FAO) |
| sorgo | 36 | acima de 36/26 °C a emissão da panícula atrasa; a 44/34 °C não forma panícula | conferido |
| soja | 38 | o regime 38/30 °C reduz a produção de pólen em 34%; média de 39 °C é letal | conferido; é a cultura com o limiar menos direto |
| girassol | 35 | não aparece na revisão | **sem fonte**: usa o limiar geral |
| trigo | 32 | | **memória**, não conferido na revisão |
| milheto, braquiária, crotalária | vazio | culturas de cobertura, sem grãos | a regra de calor não se aplica |

Algodão a 35 °C (15/11). Com 32 °C e a perda 1 para 1 do motor, o encaixe de calor do algodão de dezembro no talhão de demonstração era 0,74 hoje, o que implicaria perda de 26% ou mais também no algodão do MT e da BA, de onde vem a produtividade média da Conab usada na tabela. Fontes do novo valor:
- Reddy, K. R.; Reddy, V. R.; Hodges, H. F. (1992). Temperature effects on early season cotton growth and development. Agronomy Journal 84(2):229–237, doi:10.2134/agronj1992.00021962008400020021x (resumo lido no AGRIS/FAO). Câmara, dia/noite: a 30/22 °C todos os botões e maçãs ficam; a 35/27 °C cai 10%; a 40/32 °C caem todos os botões. Ou seja, 35 °C de máxima é onde a perda começa a aparecer.
- FAO, Land & Water, Crop information: cotton (base: Doorenbos e Kassam, FAO Irrigação e Drenagem 33). Para botão e florescimento, máxima diurna até 40 °C e noturna até 27 °C; maçã com ótimo de 27–32 °C e produtividade menor acima de 38 °C. Lido em trechos de busca das versões fr/es; a página retornou 404 em 15/11.
- Contra: revisões de câmara apontam sensibilidade do pólen a partir de 28–32 °C (Luo 2011; Zahid et al. 2016, Frontiers in Plant Science 7:937). 35 °C é a máxima do ar a 2 m, não a do dossel, e fica no meio entre as duas leituras. Os experimentos são em câmara; a lavoura de MT/BA convive com máximas acima de 32 °C sem perder um quarto da produção.

Cuidados:
- Os valores vêm de experimentos em câmara, com temperatura do ar no dossel. A Tmax de reanálise corrigida é uma aproximação.
- O dano acontece no florescimento, não no ciclo todo. As tabelas de clima contam dias por mês; o motor decide em que parte do ciclo aplicar.
- Dias acima do limiar dentro do ciclo, hoje → 2041–2060: milho safra 18 → 35; milho safrinha 4 → 20; soja 4 → 12; sorgo safrinha 2 → 8; feijão safra 33 → 61; algodão 45 → 99 (com o limiar antigo de 32 °C).

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
| algodão | 1,89 (pluma) | — | conferido por conta: 3,94 Mt de pluma (Conab 2024/25, via Agrolink) ÷ 2,08 Mha (área da tabela Conab). A tabela traz caroço (2,66 t/ha), mas a receita vem da pluma |
| trigo | 3,34 | 3,34 | conferido: PAM/IBGE 2025, **média de MG** (não Conab Brasil) |
| milheto, braquiária, crotalária | 0 | 0 | cobertura, sem venda no MVP |

## Preço — R$/t

| cultura | preço | origem | status |
|---|---|---|---|
| soja | 2.340 | R$ 140,50/sc 60 kg, média CEPEA/Esalq de ago/2025 (relatório Agro em Dados, gov. de Goiás) | conferido, mas é preço de referência portuário |
| milho | 1.083 | R$ 65/sc, Indicador ESALQ/BM&FBovespa em out/2025 | conferido |
| sorgo | 870 | R$ 52/sc (CEEMA/Unijuí, RS, ago/2025). Em Goiás o sorgo esteve perto do preço do milho | referência de outra região |
| feijão | 3.500 | ~R$ 210/sc de feijão carioca | memória, preço muito volátil. O CEPEA diz que o carioca "se sustentou" em 2025 |
| girassol | 2.000 | | memória, não achei cotação |
| trigo | 1.353 | valor da produção ÷ quantidade, PAM/IBGE 2025 em MG | conferido; preço ao produtor, não cotação |
| algodão | 9.000 | ~R$ 135/@ de pluma | memória. O CEPEA registrou em out/2025 o menor indicador em 16 anos, então este valor pode estar alto |

O preço não é editável na tela (fora do escopo); o motor aceita `precos` na entrada. Para o pitch, troque os valores de **memória** por
médias anuais do CEPEA (cepea.esalq.usp.br).

## Conferência com a PAM/IBGE (Minas Gerais, 2025)

A PAM dá rendimento e preço ao produtor em MG. A comparação com os valores
desta tabela, as culturas de MG que ainda não usamos e as candidatas à
rotação (trigo, arroz, amendoim, aveia) estão em `docs/ibge_pam.md`. Resumo:

- Os preços de **memória** do feijão (3.500) e do girassol (2.000) ficam a 3%
  do preço médio da PAM (3.599 e 2.038).
- A produtividade em MG é maior que a média do Brasil em soja, milho 1ª safra,
  sorgo, feijão e girassol, e menor no milho 2ª safra (5,63 contra 6,10).
- Os valores das 9 culturas anteriores não foram trocados. O trigo entrou com
  preço e produtividade da PAM.
