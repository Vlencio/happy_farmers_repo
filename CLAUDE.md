# Happy Farmers — Field Shift (NASA Space Apps 2026)

## What this is

Hackathon project for the NASA Space Apps Challenge, 14–15 Nov 2026 (48h).
Challenge: **"Field Shift: Adapting Farms with NASA Data"** — a decision-support
tool for crop rotation.

Our angle: recommend the rotation that best holds up under **observed and
projected climate**. The pitch hook is "today vs. future": the rotation that
wins today may not win in 2050.

Team: 3 developers (Pedro + 2), stronger in back-end and data.

## How to work with me

- Keep answers short and direct. No flattery.
- **Do not run the data-download scripts without asking.** I run them myself.
- Don't expand scope. If something is in "Out of scope", don't build it.
- Say clearly when something is untested or from memory.

## MVP scope

One screen:

1. User draws a field (talhão) on a map.
2. User enters the current rotation (planting history), priorities
   (water / soil / income) and horizon: next crop, or next two (safra +
   safrinha).
3. App ranks every one- or two-crop sequence from the crop table (9 or 81
   options), under today's and future climate.

Output:

- Three cards for the top three rotations by today's score: score today,
  score under future climate, estimated revenue, LLM explanation (why, risks,
  gaps).
- Table with the full ranking: rank today, rank under future climate, and
  where the current rotation sits.
- 12-month timeline: rain, NDVI, crops.
- Crop price editable by the user.
- Visible disclaimers: "validate with an agronomist"; price is a historical
  average, not a forecast.

## Out of scope

SMAP, GPM, SoilGrids, multiple fields per farmer, KML/CAR upload, live prices,
production cost, demos in other countries, login, crop search, extra filters
(the priorities already do this), horizon in months, win rates or
probabilities.

## Data

Demo field: around lat **-20.032**, lon **-48.526** (about 125 km south of
Uberlândia). Polygon: `data/talhao_demo_2.geojson` (~219 ha). The smaller
`talhao_demo.geojson` (~78 ha) is not in the repo and nothing was extracted
for it.

Every source below was checked on 14 Nov and points at this field. The
AppEEARS request is only named "Uberlandia"; it uses the field polygon.

| Source | Gives | How | Where | Status |
|---|---|---|---|---|
| NASA POWER | Historical monthly climate | `scripts/puxar_power.py` | `data/power/` | Downloaded |
| NEX-GDDP-CMIP6 | Projected monthly climate | `scripts/puxar_nexgddp.py` | `data/nexgddp/` | Downloaded |
| MOD13Q1 (AppEEARS) | NDVI every 16 days | Manual request | `data/appeears/` | Downloaded |
| SRTMGL1 (AppEEARS) | Elevation | Same request | `data/appeears/` | Downloaded |
| Crop table | Crop requirements, Kc, planting month, price, yield | `scripts/montar_culturas.py` | `data/culturas.csv` | Done; values marked "memória" in `docs/culturas_fontes.md` still to check |
| Climate tables | Today / future / dry year (2020/21), 12 months each, with ET0 and `dias_quentes` (days above 35 °C) | `scripts/montar_clima.py` | `data/clima_hoje.csv`, `data/clima_futuro.csv`, `data/clima_seco.csv` | Done; the engine does not read `dias_quentes` or the dry year yet |
| NDVI + slope | Monthly NDVI, bare-soil months, slope | `scripts/processar_appeears.py` | `data/talhao/` | Done |

Column reference: `docs/colunas_dados.md`.

Notes per source:

- **POWER:** parameters `PRECTOTCORR, T2M, T2M_MAX, T2M_MIN, ALLSKY_SFC_SW_DWN,
  RH2M, WS2M`, community `AG`, **daily** endpoint averaged by month. Do not
  use the monthly endpoint: its `T2M_MAX` / `T2M_MIN` are the month's
  extremes, not averages of daily values. `PRECTOTCORR` is mm/day (confirmed
  in the JSON header); `chuva_mm` is the month total. `-999` means no data.
- **NEX-GDDP:** models MIROC6, ACCESS-CM2, MRI-ESM2-0; `historical` 1995–2014
  and `ssp245` 2041–2060; columns `chuva_mm`, `tmin_c`, `tmax_c`. No humidity
  or wind pulled. NEX-GDDP is not on the challenge's official resource list;
  it is still NASA data.
- **NDVI:** use `MOD13Q1-061-Statistics.csv` (already aggregated per date),
  filtered to `Dataset == "_250m_16_days_NDVI"`; the file holds 10 layers.
  Drop cloudy dates with the pixel-reliability CSV (0 = good, 1 = marginal,
  3 = cloud).
- **SRTM:** the CSV has elevation stats only. Slope must be computed from the
  raster, or approximated as (max − min) / field width.
- **Crop table** (`culturas.csv`): climate ranges from FAO ECOCROP
  (`data/ecocrop/EcoCrop_DB.csv`, latin-1 encoded, from
  github.com/OpenCLIM/ecocrop; cite as "FAO ECOCROP via
  GAEZ"), Kc from FAO-56, price and yield from CEPEA/Conab. Crops: soja,
  milho, sorgo, milheto, braquiária, crotalária, feijão, girassol, algodão.
  Crop names in the table have no accents (`feijao`, `crotalaria`). Columns:
  `docs/colunas_dados.md` section 5; source and status of each value:
  `docs/culturas_fontes.md`. Planting months and second-season yield are per
  slot: `mes_plantio_safra`, `mes_plantio_safrinha`, `produtividade_safrinha`.

## Engine (rules, no ML)

The score comes from rules and arithmetic. **The LLM only explains the
numbers; it never produces them.**

Code: `motor/` (`recomendar`). Inputs, output JSON, rules and open questions:
`docs/contrato_motor.md`. Demo: `python -m motor`. Tests:
`python -m unittest discover tests`. It reads `data/culturas.csv`,
`data/clima_hoje.csv` and `data/clima_futuro.csv`; the tests use fixed tables
in `tests/dados/`.

1. **Two climate tables**, 12 rows each (one per month):
   - Today: POWER averaged by month.
   - Future: today + (NEX-GDDP `ssp245` − `historical`), difference averaged
     across the three models. Never compare NEX-GDDP future directly to POWER.
2. **ET0** per month by Hargreaves (Tmin, Tmax, latitude), so today and future
   use the same method. It is computed in `scripts/montar_clima.py` and
   delivered as `et0_mm`; the engine uses that column and only computes
   Hargreaves itself if the column is missing.
3. **Water balance** per crop: rain − Kc × ET0.
4. **Climate fit** per crop against its temperature and rain ranges.
5. **Revenue** per hectare: price × yield × fit factor.
6. **Sequence rules**, so that order and history matter: penalty for repeating
   a crop, bonus for the crop that follows a nitrogen fixer (`fixa_n`). The
   last crop of the current rotation counts as the previous crop. Each
   position in a sequence is a slot (safra, then safrinha, or the reverse if
   the field is free from January to June). A crop is planted in its
   planting month for that slot (`mes_plantio_safra`, `mes_plantio_safrinha`),
   and the field is free 10 days after a crop's cycle ends (harvest time). A
   sequence with a crop that has no month in its slot, or whose month has
   passed when the field becomes free, is dropped from the ranking and listed
   as discarded.
7. **Score** per rotation, weighted by the user's priorities, for every
   sequence in the horizon. Run on both climate tables and rank each. Rank
   rotations, not single crops in isolation.

## Stack

- Back end: Python, FastAPI, pandas, xarray.
- Front end: Streamlit + folium (draw plugin). React + Leaflet only if time
  allows.
- Data is pre-downloaded and cached for the demo area. No live API calls
  during the demo.

## Next steps

1. ~~Build `culturas.csv`.~~ Done; check the "memória" values.
2. ~~Script for the two climate tables.~~ Done.
3. Engine (ET0, water balance, fit, sequence rules, score, ranking). First
   version done and running on the real tables; open questions are at the end
   of `docs/contrato_motor.md`.
4. Front end, on fake data until the engine returns real numbers.

## Submission

Public repository with a README explaining the data used. Leave the last
hours for the pitch and upload; the platform gets slow near the deadline.
