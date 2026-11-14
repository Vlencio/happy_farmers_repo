# Colunas de cada fonte de dados — Happy Farmers

> Nomes de colunas conferidos nos arquivos reais em 14/11/2026.

## 1. NASA POWER — clima histórico

Script: `scripts/puxar_power.py` · arquivo em `data/power/` · uma linha por mês (média dos valores diários)

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

Script: `scripts/montar_culturas.py` · arquivo `data/culturas.csv` · uma linha por cultura (9). Fonte e status de cada valor em `docs/culturas_fontes.md`.

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

## 6. Tabelas de clima do motor

Script: `scripts/montar_clima.py` · 12 linhas cada, uma por mês

| Arquivo | Conteúdo |
|---|---|
| `data/clima_hoje.csv` | POWER 2005–2024 em média por mês; `tmin_c` e `tmax_c` corrigidos pela estação INMET A520 |
| `data/clima_futuro.csv` | hoje + (NEX `ssp245` − `historical`), média dos 3 modelos |
| `data/clima_correcoes.csv` | offsets da A520 e deltas do NEX por mês, para conferência |

Colunas: `mes`, `chuva_mm`, `tmin_c`, `tmax_c`, `et0_mm` (Hargreaves, mm no mês).

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
