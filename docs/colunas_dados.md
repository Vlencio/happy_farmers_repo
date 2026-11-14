# Colunas de cada fonte de dados — Happy Farmers

> Nomes de colunas conferidos nos arquivos reais em 14/11/2026.

## 1. NASA POWER — clima histórico

Script: `scripts/puxar_power.py` · arquivo em `data/power/` · uma linha por mês (média dos valores diários)

Também há `power_diario_-20.032_-48.526_2005_2024.csv`: uma linha por dia, com `data, PRECTOTCORR, T2M, T2M_MAX, T2M_MIN`. Ele é usado para contar dias quentes. O arquivo atual veio do download da pasta de exploração (mesma célula do POWER: as médias mensais batem com o arquivo mensal, diferença máxima de 0,005 °C). O `puxar_power.py` passou a salvar esse arquivo também, mas ainda não foi rodado de novo.

| Coluna | Significado |
|---|---|
| `ano`, `mes` | Ano e mês |
| `PRECTOTCORR` | Chuva média do mês em mm/dia (unidade conferida no cabeçalho do JSON) |
| `chuva_mm` | Chuva total do mês (mm) = `PRECTOTCORR` × dias do mês |
| `T2M` | Temperatura média (°C) |
| `T2M_MAX`, `T2M_MIN` | Média das máximas e das mínimas diárias (°C). O endpoint mensal do POWER devolve os extremos do mês, por isso o script usa o diário |
| `ALLSKY_SFC_SW_DWN` | Radiação solar (MJ/m²/dia) |
| `RH2M` | Umidade relativa a 2 m (%) |
| `WS2M` | Velocidade do vento a 2 m (m/s) |

O motor usa ET0 por Hargreaves (só Tmin e Tmax), porque o NEX não tem umidade nem vento. `RH2M` e `WS2M` serviriam só para um Penman-Monteith de conferência.

## 2. NEX-GDDP-CMIP6 — clima projetado

Script: `scripts/puxar_nexgddp.py` · arquivo em `data/nexgddp/` · uma linha por modelo, cenário e mês

| Coluna | Significado |
|---|---|
| `modelo` | MIROC6, ACCESS-CM2 ou MRI-ESM2-0 |
| `cenario` | `historical` (1995–2014) ou `ssp245` (2041–2060) |
| `ano`, `mes` | Ano e mês |
| `chuva_mm` | Chuva total do mês (mm) |
| `tmin_c`, `tmax_c` | Média das mínimas e das máximas diárias (°C) |

Comparar `ssp245` com o `historical` do mesmo modelo e aplicar a diferença sobre os números do POWER.

O script ainda não puxa umidade (`hurs`) nem vento (`sfcWind`). Sem eles, o ET0 futuro só sai por Hargreaves.

## 3. AppEEARS — NDVI (MOD13Q1)

`data/appeears/MOD13Q1-061-Statistics.csv` · uma linha por data (a cada 16 dias) **e por camada**

O arquivo traz 10 camadas (NDVI, EVI, reflectâncias, ângulos). Filtrar `Dataset == "_250m_16_days_NDVI"`.

| Coluna | Significado |
|---|---|
| `Dataset` | Camada |
| `Date` | Data da imagem |
| `Mean`, `Median` | NDVI do talhão. Usar `Mean` na timeline |
| `Minimum`, `Maximum`, `Standard Deviation` | Variação dentro do polígono |
| `Count` | Número de pixels usados |

A camada `pixel_reliability` vem em um CSV próprio (`MOD13Q1-061-250m-16-days-pixel-reliability-Statistics-QA.csv`), com outra estrutura: colunas `Date`, `0`, `1` e `3`, cada uma com o número de pixels naquela classe (0 = bom, 1 = marginal, 3 = nuvem; vazio = zero). Serve para descartar datas com nuvem: das 231 datas, 18 têm menos de 50% de pixels bons.

## 4. AppEEARS — SRTM

O CSV traz só estatísticas de elevação do polígono (mínima, máxima, média).

**Declividade não é uma coluna.** Ela é calculada do raster por `scripts/processar_appeears.py` (seção 7).

## 5. Tabela de culturas

Script: `scripts/montar_culturas.py` · arquivo `data/culturas.csv` · uma linha por cultura (10). As candidatas (arroz, amendoim, aveia) saem do mesmo script em `data/culturas_candidatas.csv`. Fonte e status de cada valor em `docs/culturas_fontes.md`.

| Coluna | Fonte |
|---|---|
| `cultura`, `especie_ecocrop` | Nome e espécie usada no ECOCROP |
| `temp_min`, `temp_max` | ECOCROP (`TMIN`, `TMAX`), °C |
| `temp_otima_min`, `temp_otima_max` | ECOCROP (`TOPMN`, `TOPMX`), °C |
| `chuva_min`, `chuva_max` | ECOCROP (`RMIN`, `RMAX`), mm |
| `chuva_otima_min`, `chuva_otima_max` | ECOCROP (`ROPMN`, `ROPMX`), mm |
| `ciclo_ecocrop_min`, `ciclo_ecocrop_max` | ECOCROP (`GMIN`, `GMAX`); só referência |
| `ciclo_dias` | Ciclo típico no Cerrado (dias do plantio à colheita) |
| `kc_ini`, `kc_med`, `kc_fim` | FAO-56, tabela 12 |
| `fixa_n`, `cobre_solo` | Preenchido à mão (1/0) |
| `mes_plantio_safra`, `mes_plantio_safrinha` | Mês típico de plantio em cada slot; vazio = não entra naquele slot |
| `preco` | R$/t (0 = cobertura) |
| `produtividade`, `produtividade_safrinha` | t/ha, Conab 2024/25 (média Brasil) |
| `temp_calor_c` | Máxima diária (°C) que prejudica o florescimento (Luo 2011). Vazio = cobertura, regra de calor não se aplica |

## 6. Tabelas de clima do motor

Script: `scripts/montar_clima.py` · 12 linhas cada, uma por mês

| Arquivo | Conteúdo |
|---|---|
| `data/clima_hoje.csv` | POWER 2005–2024 em média por mês; `tmin_c` e `tmax_c` corrigidos pela estação INMET A520 |
| `data/clima_futuro.csv` | hoje + (NEX `ssp245` − `historical`), média dos 3 modelos |
| `data/clima_seco.csv` | o ano agrícola (jul–jun) com menos chuva no POWER 2005–2024: a safra **2020/21** |
| `data/clima_correcoes.csv` | offsets da A520 e deltas do NEX por mês, para conferência |

**Ano seco.** É um ano real, não uma média, no mesmo formato das outras tabelas, então o motor roda nele sem mudança. O script escolhe sozinho o ano agrícola completo com menos chuva.

- Safra 2020/21: 813 mm de chuva, contra 1.236 mm na média das 19 safras. ET0 de 1.796 mm e 84 dias acima de 35 °C.
- Temperaturas com a correção da A520; ET0 por Hargreaves com as temperaturas do POWER sem correção, como em `clima_hoje.csv`.
- Para que serve: com o clima médio, a nota de água do motor fica entre 0,88 e 1,00 em todas as sequências e quase não pesa. No ano seco ela cai para 0,57–0,80, a receita de `soja>milho` cai de R$ 14,3 mil para R$ 10,3 mil por hectare e `soja>feijao` passa à frente.
- É um cenário, não uma probabilidade: não diz com que frequência um ano assim acontece.
- O motor ainda não lê esta tabela por conta própria. Ela pode ser passada no lugar de `clima_hoje` ou `clima_futuro`.

Colunas: `mes`, `chuva_mm`, `tmin_c`, `tmax_c`, `et0_mm` (Hargreaves, mm no mês), `dias_quentes`.

- `dias_quentes`: média de dias do mês com máxima acima de 35 °C.
  - Hoje: POWER diário 2005–2024, com a correção da A520 no Tmax.
  - Futuro: hoje + (dias no `ssp245` − dias no `historical`) do NEX diário, por modelo e mês, média dos 3 modelos. Limitado entre 0 e os dias do mês.
  - Total: **34 dias por ano hoje e 84 no futuro**. Setembro: 10,5 → 18,9. Outubro: 10,1 → 16,5.
  - O POWER hoje (34) e o NEX histórico (33) quase coincidem, o que valida usar a diferença.
  - O limiar de 35 °C é uma convenção comum para estresse de calor em grãos (**memória**, sem fonte aberta). Está na constante `LIMIAR_CALOR_C` do script.
  - O motor ainda não lê esta coluna.
- `dias_acima_32`, `dias_acima_35`, `dias_acima_36`, `dias_acima_38`: a mesma contagem, uma coluna para cada limiar de calor de `temp_calor_c` em `culturas.csv`. O script lê os limiares da tabela de culturas, então rode `montar_culturas.py` antes.
  - Para uma cultura, usar a coluna do limiar dela: `dias_acima_<temp_calor_c>`. O motor lê estas colunas na regra de calor (`docs/contrato_motor.md`, regra 9).
  - Dias por ano, POWER hoje / NEX histórico / futuro: 32 °C: 111 / 134 / 208; 35 °C: 34 / 33 / 84; 36 °C: 21 / 21 / 54; 38 °C: 7 / 7 / 23.
  - A 32 °C o POWER e o NEX histórico diferem em 20%, então o número futuro desse limiar (feijão e algodão) é menos confiável que os outros.

- O `et0_mm` usa as temperaturas do POWER **sem** a correção da A520. Assim, o Hargreaves bate com o Penman-Monteith do POWER (1.635 contra 1.640 mm/ano); com a correção, subiria para 1.778 mm.
- A chuva não é corrigida: o viés do POWER contra a A520 é de cerca de −5%.
- `data/inmet/a520_vs_power_mensal.csv` é a comparação mensal INMET A520 × POWER, gerada no projeto de exploração.

## 7. Talhão: NDVI e declividade

Script: `scripts/processar_appeears.py` · arquivos em `data/talhao/`

| Arquivo | Conteúdo |
|---|---|
| `ndvi_mensal.csv` | `mes`, `ndvi`, `solo_descoberto` (NDVI < 0,35). Usar na timeline |
| `ndvi_climatologia.csv` | por mês do ano: `ndvi_medio`, `ndvi_min`, `ndvi_max`, `freq_solo` |
| `ndvi_16d.csv` | série de 16 dias com a fração de pixels bons |
| `declividade.csv` | área, altitude e declividade (`decl_media_pct` = 4,05%, `decl_p90_pct` = 7,07%) |

O NDVI usa só os pixels com centro dentro do polígono (41) e descarta datas com menos de 50% de pixels bons.

## 8. IBGE PAM — culturas de Minas Gerais

Scripts: `scripts/puxar_pam.py` e `scripts/montar_culturas_mg.py` · método e resultados: `docs/ibge_pam.md`

| Arquivo | Conteúdo |
|---|---|
| `data/ibge/pam_mg_2025.csv` | PAM 2025 em MG, uma linha por produto (86, mais a linha `Total`) |
| `data/ibge/pam_mg_safras_2025.csv` | milho (1ª e 2ª safra) e feijão (1ª, 2ª e 3ª), sem `valor_mil_reais` |
| `data/culturas_mg.csv` | 22 culturas: as 10 do motor + os outros produtos com 10 mil ha ou mais em MG |
| `data/culturas_candidatas.csv` | arroz, amendoim e aveia nas colunas da seção 5, gerado por `montar_culturas.py`. O motor não lê |

Colunas da PAM: `ano`, `produto_cod`, `produto`, `area_plantada_ha`, `area_colhida_ha`, `producao_t`, `rendimento_kg_ha`, `valor_mil_reais`. Vazio = sem dado ou não se aplica.

Colunas de `culturas_mg.csv`:

| Coluna | Significado |
|---|---|
| `cultura` | Nome sem acento |
| `tipo` | `anual`, `semiperene`, `permanente` ou `cobertura` |
| `situacao` | `no_motor`, `candidata` ou `fora_da_rotacao` |
| `motivo` | Por que fica fora da rotação |
| `produto_pam`, `ano_pam` | Nome do produto e ano na PAM |
| `area_plantada_ha`, `producao_t`, `valor_mil_reais` | Direto da PAM |
| `part_area_pct` | % da área plantada de MG |
| `rendimento_t_ha` | Rendimento médio da PAM em t/ha |
| `preco_pam` | R$/t = valor da produção ÷ quantidade produzida |
| `preco_motor`, `produtividade_motor` | Valores de `culturas.csv`, para comparar |
| `especie_ecocrop`, `temp_*`, `chuva_*`, `ciclo_ecocrop_*` | Como na seção 5 |
| `janela_meses` | Meses usados no encaixe: o ciclo nas anuais, 12 nas demais |
| `melhor_mes_plantio` | Mês de início com o maior encaixe hoje. Vazio nas perenes |
| `encaixe_temp_hoje`, `encaixe_chuva_hoje`, `encaixe_hoje` | 0 a 1, contra `clima_hoje.csv`. `encaixe` é o menor dos dois |
| `encaixe_temp_futuro`, `encaixe_chuva_futuro`, `encaixe_futuro` | O mesmo contra `clima_futuro.csv`, no mesmo mês |
