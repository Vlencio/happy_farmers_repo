# Culturas de Minas Gerais — PAM/IBGE cruzada com ECOCROP e clima da NASA

> 14/11/2026, Dev 1 (dados). O beta usa Minas Gerais. Este documento diz quais
> culturas o IBGE registra no estado, quais já estão no motor e como cada uma
> encaixa no clima do talhão de demonstração, hoje e em 2041–2060.
> **Trigo entrou no motor** em 14/11 (`data/culturas.csv` tem 10 culturas).
> Arroz, amendoim e aveia seguem como candidatas, fora do motor.

## Fonte

Produção Agrícola Municipal (PAM) do IBGE, ano de **2025**, nível estado (MG).
Página: ibge.gov.br → Estatísticas → Agricultura e pecuária → Produção Agrícola
Municipal. Os números vêm da API do SIDRA (`apisidra.ibge.gov.br`):

| Tabela SIDRA | Conteúdo | Arquivo |
|---|---|---|
| 5457 | Área, produção, rendimento e valor de todas as lavouras temporárias e permanentes | `data/ibge/pam_mg_2025.csv` (86 produtos) |
| 839 | Milho, 1ª e 2ª safra | `data/ibge/pam_mg_safras_2025.csv` |
| 1002 | Feijão, 1ª, 2ª e 3ª safra | mesmo arquivo |

Script: `scripts/puxar_pam.py` (três consultas pequenas, sem chave). Na PAM o
ano é o ano civil da colheita. A PAM não é dado da NASA: entra como referência
de área, rendimento e preço, igual à Conab e ao CEPEA.

`python scripts/puxar_pam.py` foi rodado em 14/11 e deu os mesmos arquivos.

## Quais culturas entram

`scripts/montar_culturas_mg.py` junta as culturas do motor com todo produto
da PAM que tem pelo menos 10 mil hectares em MG (12 produtos novos, fora o trigo). O script
para com erro se aparecer um produto acima do corte sem espécie definida.
Saída: `data/culturas_mg.csv`, 22 linhas. As 19 culturas com PAM somam 98,6%
da área plantada do estado.

| Cultura | Área em MG (ha) | % da área | Rendimento (t/ha) | Preço PAM (R$/t) | Situação |
|---|---|---|---|---|---|
| soja | 2.373.724 | 34,2 | 3,87 | 1.955 | no motor |
| cana | 1.172.417 | 16,9 | 70,02 | 156 | fora: semiperene |
| milho | 1.108.809 | 16,0 | 6,45 | 1.131 | no motor |
| café (99% arábica) | 1.088.561 | 15,7 | 1,44 | 32.107 | fora: permanente |
| sorgo | 355.839 | 5,1 | 4,00 | 703 | no motor |
| feijão | 285.693 | 4,1 | 1,68 | 3.599 | no motor |
| trigo | 138.661 | 2,0 | 3,34 | 1.353 | **no motor** (desde 14/11) |
| banana | 51.557 | 0,7 | 16,92 | 2.500 | fora: permanente |
| algodão (em caroço) | 43.266 | 0,6 | 4,32 | 3.362 | no motor |
| laranja | 42.121 | 0,6 | 27,81 | 1.529 | fora: permanente |
| batata-inglesa | 41.068 | 0,6 | 36,30 | 1.342 | fora: hortaliça irrigada |
| mandioca | 40.995 | 0,6 | 15,25 | 764 | fora: ciclo de 12 a 18 meses |
| seringueira (látex) | 23.298 | 0,3 | 2,18 | 5.472 | fora: permanente |
| arroz (em casca) | 21.503 | 0,3 | 4,12 | 1.407 | **candidata** |
| amendoim (em casca) | 16.786 | 0,2 | 3,62 | 3.632 | **candidata** |
| aveia | 13.760 | 0,2 | 1,66 | 660 | **candidata** |
| tangerina | 13.425 | 0,2 | 17,23 | 1.991 | fora: permanente |
| abóbora | 12.467 | 0,2 | 15,68 | 1.344 | fora: hortaliça |
| girassol | 5.763 | 0,1 | 1,73 | 2.038 | no motor |
| milheto, braquiária, crotalária | — | — | — | — | no motor; a PAM não levanta culturas de cobertura |

- As 7 culturas do motor que aparecem na PAM cobrem 62% da área de MG. Cana e
  café somam 33% e não cabem em safra + safrinha.
- **Preço PAM** = valor da produção ÷ quantidade produzida. É o preço médio
  pago ao produtor em MG no ano, não uma cotação.
- Batata e abóbora são anuais, mas ficam fora: sem custo de produção (fora do
  escopo), a receita bruta delas (R$ 49 mil/ha na batata) dominaria o ranking.

## Cruzamento com o clima da NASA

Para cada cultura, as faixas do ECOCROP são comparadas com `clima_hoje.csv`
(POWER 2005–2024) e `clima_futuro.csv` (POWER + diferença do NEX-GDDP,
2041–2060), com as mesmas funções do motor (`encaixe_temperatura`,
`encaixe_chuva`).

- **Anuais e cobertura:** janela de `ciclo_dias / 30` meses, arredondado para
  cima (o milho, de 135 dias, usa 5 meses). Temperatura =
  média do encaixe da temperatura média de cada mês; chuva = soma da janela
  contra `chuva_min`/`chuva_max`. `melhor_mes_plantio` é o mês de início com o
  maior encaixe hoje; o futuro é calculado no mesmo mês.
- **Semiperenes e permanentes:** os 12 meses, com a chuva anual.
- `encaixe` = o menor entre temperatura e chuva (fator limitante, como no motor).

É uma conta mais simples que a do motor: usa meses inteiros, sem balanço
hídrico, sem dias quentes e sem os meses de plantio de `culturas.csv`. Serve
para comparar culturas, não para ranquear rotações. NDVI e declividade
descrevem o talhão e não mudam de uma cultura para outra, então não entram.

Culturas em que o encaixe fica abaixo de 1 (as outras ficam em 1,00 nos dois climas):

| Cultura | Mês | Encaixe hoje | Encaixe 2041–2060 | Limita |
|---|---|---|---|---|
| trigo | mar | 0,79 | 0,60 | temperatura (máxima do ECOCROP: 27 °C) |
| aveia | mar | 0,71 | 0,56 | temperatura |
| feijão | fev | 0,95 | 0,78 | temperatura |
| batata | mar | 0,99 | 0,90 | temperatura |
| arroz | dez | 0,79 | 0,80 | chuva: o ECOCROP pede 1.000 mm no ciclo (arroz irrigado) |
| café | ano | 1,00 | 0,99 | temperatura |
| cana | ano | 0,90 | 0,95 | melhora: os meses frios ficam mais perto do ótimo (24 °C) |
| banana | ano | 0,87 | 0,93 | idem |
| seringueira | ano | 0,94 | 0,97 | idem |
| tangerina | ano | 0,95 | 0,99 | idem |

Leitura para o pitch: as culturas de inverno (trigo, aveia) e o feijão perdem
encaixe com o aquecimento; as tropicais perenes ganham um pouco. O café fica
em 1,00 porque a conta usa a temperatura **média** do mês; o risco conhecido
do arábica é o calor na florada, que esta conta não vê.

## Trigo no motor e candidatas à rotação

Todas ficam no `MANUAL` de `scripts/montar_culturas.py`. As que estão no
conjunto `CANDIDATAS` (arroz, amendoim, aveia) vão para
`data/culturas_candidatas.csv`, nas mesmas colunas; as outras, como o trigo,
vão para `data/culturas.csv`. **O motor não lê o arquivo das candidatas.**

| cultura | ciclo | safra | safrinha | kc_ini / med / fim | fixa_n | cobre_solo | calor (°C) |
|---|---|---|---|---|---|---|---|
| trigo | 120 | — | mar | 0,30 / 1,15 / 0,30 | 0 | 1 | 32 |
| arroz (terras altas) | 120 | nov | — | 0,30 / 1,20 / 0,75 | 0 | 1 | 35 |
| amendoim | 125 | out | — | 0,40 / 1,15 / 0,60 | 1 | 0 | 35 |
| aveia | 120 | — | abr | 0,30 / 1,15 / 0,25 | 0 | 1 | 32 |

Status dos valores:
- Faixas de clima: ECOCROP, **conferido**.
- Preço e produtividade: PAM 2025 em MG, **conferido**. Amendoim e arroz são
  "em casca".
- `kc_med` e `kc_fim`: FAO-56 tabela 12, **conferido** (trigo 1,15 / 0,25–0,40;
  aveia 1,15 / 0,25; amendoim 1,15 / 0,60; arroz 1,20 / 0,90–0,60).
- `kc_ini`: **memória** (valor do grupo). O 1,05 do arroz na FAO-56 é para arroz
  inundado; para terras altas foi usado o dos cereais.
- Ciclo, meses de plantio e limiar de calor: **memória**. O limiar da aveia
  repete o do trigo.

### Trigo com o motor do `front-dev3` (regra de calor e ano seco)

Neste branch (`dados-calor`) o motor ainda não tem a regra de calor; os ranks
abaixo foram calculados com o motor do `front-dev3`.

Histórico soja → milho, horizonte 2. Com o trigo, as viáveis passam de 22 para
26 (outubro) e de 31 para 36 (fevereiro). Os três primeiros não mudam, e os
cards do front também não (`soja>milho`, `soja>crotalaria`, `soja>sorgo` em
outubro).

| Talhão livre em | Sequência | Rank hoje → futuro | Score hoje → futuro |
|---|---|---|---|
| outubro | `soja>trigo` | 4º → 5º | 76,8 → 72,0 |
| outubro | `milho>trigo` | 12º → 14º | 66,6 → 61,0 |
| fevereiro | `trigo>algodao` | 6º → 29º | 72,4 → 55,6 |
| fevereiro | `trigo>soja` | 10º → 8º | 70,9 → 66,8 |

`trigo>algodao` é o exemplo mais forte de "hoje vs. futuro": cai 23 posições.

### Teste das candidatas, com o motor antigo (sem a regra de calor)

Feito antes do trigo entrar, com o motor de `87cd7ec`. Os números servem para
comparar, não valem para o motor atual.

13 culturas (9 + trigo, arroz, amendoim, aveia), histórico soja → milho, horizonte 2:

| Talhão livre em | Viáveis | 1º com 9 culturas | 1º com 13 culturas |
|---|---|---|---|
| outubro | 22 → 42 | `soja>milho` (82,1) | `amendoim>crotalaria` (83,4) |
| fevereiro | 31 → 59 | `crotalaria>algodao` (81,9) | `crotalaria>algodao` (81,9); `crotalaria>amendoim` em 2º |

- O amendoim toma os 7 primeiros lugares em outubro: R$ 13,1 mil/ha contra
  R$ 8,3 mil da soja. Sem custo de produção, isso distorce o ranking. Ele
  ocupa 0,2% da área de MG.
- `soja>trigo` fica em 13º hoje e 18º no futuro (encaixe 0,78 → 0,59). É um
  exemplo limpo de "hoje vs. futuro".
- `soja>aveia` fica em 29º.
- A `renda` é dividida pela maior receita do ranking. Com o amendoim o teto
  sobe e os scores de todas as sequências mudam.

Para ligar outra candidata, tire o nome dela de `CANDIDATAS` em
`scripts/montar_culturas.py`, rode o script e depois `montar_culturas_mg.py` e
`python -m backend.export_fixture` para atualizar as fixtures do front (só no
`front-dev3`, onde o backend existe).

## Conferência das culturas que já estão no motor

O motor usa a produtividade média do Brasil (Conab 2024/25) e preços do CEPEA
ou de memória. A PAM dá os números de MG:

| Cultura | Produtividade no motor (t/ha) | PAM MG 2025 | Preço no motor (R$/t) | Preço PAM |
|---|---|---|---|---|
| soja | 3,56 | 3,87 | 2.340 | 1.955 |
| milho 1ª safra | 6,61 | 7,07 | 1.083 | 1.131 |
| milho 2ª safra | 6,10 | 5,63 | | |
| sorgo | 3,53 | 4,00 | 870 | 703 |
| feijão 1ª safra | 1,17 | 1,43 | 3.500 | 3.599 |
| feijão 2ª safra | 0,98 | 1,57 | | |
| girassol | 1,57 | 1,73 | 2.000 | 2.038 |
| algodão | 1,89 (pluma) | 4,32 (em caroço) | 9.000 (pluma) | 3.362 (em caroço) |

- Os preços de **memória** do feijão e do girassol ficam a 3% do preço da PAM.
- A soja no motor usa preço de porto; ao produtor em MG a PAM dá 16% menos.
- O algodão não é comparável: a PAM mede caroço e o motor, pluma.
- Os valores do motor **não foram trocados**. Trocar muda todas as receitas e scores.

## Em aberto

1. Ligar arroz, amendoim ou aveia? O amendoim precisa de custo de produção ou
   fica de fora.
2. Trocar produtividade e preço das 6 culturas pelos de MG?
3. Faltam fontes para o ciclo (120 dias), o plantio em março e o limiar de
   calor (32 °C) do trigo. A Embrapa Trigo tem o zoneamento do trigo tropical
   no Cerrado mineiro.
4. A PAM é do estado inteiro. O município do talhão (tabela 5457, nível
   município) daria rendimentos mais próximos; não foi puxado.
