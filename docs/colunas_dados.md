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

`RH2M` e `WS2M` entram no cálculo de ET0 por Penman-Monteith.

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

**Declividade não é uma coluna.** Calcular a partir do raster de elevação, ou aproximar por (máx − mín) / largura do talhão.

## 5. Tabela de culturas

Montada à mão · uma linha por cultura (8 a 10)

| Coluna | Fonte |
|---|---|
| `cultura` | — |
| `ciclo_dias` | ECOCROP (`GMIN`, `GMAX`) |
| `temp_min`, `temp_max` | ECOCROP (`TMIN`, `TMAX`) |
| `temp_otima_min`, `temp_otima_max` | ECOCROP (`TOPMN`, `TOPMX`) |
| `chuva_min`, `chuva_max` | ECOCROP (`RMIN`, `RMAX`) |
| `kc_ini`, `kc_med`, `kc_fim` | FAO-56 |
| `fixa_n`, `cobre_solo` | Preenchido à mão (sim/não) |
| `preco`, `produtividade` | CEPEA / Conab |
