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
- Gabriel's current work is the front end. Another teammate owns the scoring
  engine; consume its results through Python/FastAPI without implementing or
  revising the engine here.
- Gabriel supplied the first front-end requirements on 14 Nov 2026 and
  authorized implementation. Improve the local prototype in stages.

## MVP scope

Current front-end requirements (supersede the previous one-screen/top-three-score proposal):

1. Define one farm by drawing on a satellite map or importing existing GeoJSON.
   Drawing produces downloadable GeoJSON; imports are previewed before use.
2. Optionally add previous crops/seasons and observations as context for the engine.
3. Show exactly three objective cards: highest income, best soil health and
   greatest climate resilience. These are objectives, not the top three overall ranks.
4. Each card opens a detailed relative 12-month timeline with selectable stages.

The first implementation lives in `frontend/`. It also shows approximate area,
validates the boundary and saves a local browser draft. Main UI, forms, cards
and timeline are Rune/rune-kit; the satellite dialog uses Leaflet/Geoman through
a small browser bridge. Fixed demo responses are explicitly labeled and do
not use, replace or approximate the agronomic engine. Do not add weights,
ranking tables, editable prices or further screens without a new requirement.

The future engine's climate comparison remains a separate workstream. Coordinate
the response shape with its owner using `frontend/docs/API.md`.

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
| Crop table | Crop requirements, Kc, price, yield | Built by hand | `data/culturas.csv` | **To do** |

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
  Columns: `cultura, ciclo_dias, temp_min, temp_max, temp_otima_min,
  temp_otima_max, chuva_min, chuva_max, kc_ini, kc_med, kc_fim, fixa_n,
  cobre_solo, preco, produtividade`.

## Engine (rules, no ML)

The score comes from rules and arithmetic. **The LLM only explains the
numbers; it never produces them.**

1. **Two climate tables**, 12 rows each (one per month):
   - Today: POWER averaged by month.
   - Future: today + (NEX-GDDP `ssp245` − `historical`), difference averaged
     across the three models. Never compare NEX-GDDP future directly to POWER.
2. **ET0** per month by Hargreaves (Tmin, Tmax, latitude), so today and future
   use the same method.
3. **Water balance** per crop: rain − Kc × ET0.
4. **Climate fit** per crop against its temperature and rain ranges.
5. **Revenue** per hectare: price × yield × fit factor.
6. **Sequence rules**, so that order and history matter: penalty for repeating
   a crop, bonus for the crop that follows a nitrogen fixer (`fixa_n`). The
   last crop of the current rotation counts as the previous crop.
7. **Score** per rotation, weighted by the user's priorities, for every
   sequence in the horizon. Run on both climate tables and rank each. Rank
   rotations, not single crops in isolation.

## Stack

- Back end: Python, FastAPI, pandas, xarray.
- Front end: [Rune](https://github.com/anomalyco/rune) in Rust, using
  `rune-kit` components and consuming results from the Python/FastAPI backend.
  This decision supersedes the earlier Streamlit/React proposal.
- Rune revision selected for the first implementation:
  `56f01cb88e629db2c8b8877631cde00de7f37bd5` (the revision studied on 14 Nov 2026).
  `frontend/rune-revision.json` pins both `rune` and `rune-kit` to this revision.
  The app workspace must also declare `[patch.crates-io]` entries for `winit`,
  `parley_engine`, `wgpu-hal` and `accesskit_windows`, all from the same Rune
  repository and revision; dependency patches are not inherited.
- Start from `examples/hello`, `examples/web-hello` and
  [crates/rune/README.md](https://github.com/anomalyco/rune/blob/56f01cb88e629db2c8b8877631cde00de7f37bd5/crates/rune/README.md#depending-on-rune).
  That revision specifies Rust `1.99.1` and the `wasm32-unknown-unknown` target.
  Rune was built and tested locally on 14 Nov 2026. `frontend/scripts/setup-rune.mjs`
  checks out the pin under ignored `.cache/rune`; Cargo points to that checkout.
  `patches/rune-wasm-instance-cache.patch` additionally makes the browser's
  wgpu instance cache thread-local, fixing this revision's WASM compile error
  without enabling fragile Send/Sync. Do not edit the generated cache.
- Agronomic data is pre-downloaded and cached for the demo area. Satellite
  imagery is fetched from Esri when the map is opened. Demo analysis is local;
  only an explicit `VITE_API_BASE_URL` enables POST requests to the backend.

## Next steps

The list below is the team-wide backlog. Gabriel's first front-end prototype
is implemented; next steps are feedback on the flow and agreement with the
backend owner on the API contract. Do not implement items 1–3 in this chat.

1. Build `culturas.csv`.
2. Script for the two climate tables.
3. Engine (ET0, water balance, fit, sequence rules, score, ranking).
4. Iterate on the Rune front end and connect the real engine when available.

## Submission

Public repository with a README explaining the data used. Leave the last
hours for the pitch and upload; the platform gets slow near the deadline.
