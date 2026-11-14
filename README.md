# Happy Farmers — Field Shift

NASA Space Apps Challenge 2026, challenge **"Field Shift: Adapting Farms with
NASA Data"**.

A decision-support tool for crop rotation. The farmer draws a boundary on a
satellite map or imports GeoJSON, optionally supplies planting history, and
compares three paths: income, soil health and climate resilience. Each path
opens its own timeline. The engine uses observed and projected
climate; the current interface uses explicitly labeled demonstration results.

**Status:** the first local front-end prototype is functional, the crop and
climate tables are built, and a first version of the Python scoring engine
exists. Integration through FastAPI is still pending; engine development
remains a separate team workstream.

The chosen front end is [Rune](https://github.com/anomalyco/rune) (Rust), using
`rune-kit` components and an API adapter for the planned Python/FastAPI
backend. This replaces the earlier Streamlit/React proposal. Rune has now been compiled to WebAssembly
and tested locally in the browser. Its exact revision, four required dependency
patches and a small additional WASM compatibility patch are pinned in `frontend/`.

## Run the front end

On the prepared Windows workspace:

```powershell
cd D:\NasaSpaceApps\frontend
npm run dev
```

Open [Happy Farmers locally](http://127.0.0.1:4173/). For a fresh clone, follow
[frontend setup and architecture](frontend/README.md). The [proposed API contract](frontend/docs/API.md)
is ready for the backend teammate; no scoring logic or Python backend is implemented by this front end.

## Layout

```
data/
  talhao_demo_2.geojson   demo field (~219 ha)
  power/                  historical climate, monthly
  nexgddp/                projected climate, monthly (+ cache/ with the daily series)
  appeears/               NDVI (MOD13Q1) and elevation (SRTM) for the field
  ecocrop/                FAO ECOCROP crop requirements
  inmet/                  INMET A520 station vs POWER, monthly (used to correct Tmin/Tmax)
  talhao/                 monthly NDVI, bare-soil months and slope of the field
  culturas.csv            crop table used by the engine
  clima_hoje.csv          today's climate, 12 months
  clima_futuro.csv        2041-2060 climate, 12 months
docs/
  colunas_dados.md        column reference for every source
  culturas_fontes.md      source and status of every value in culturas.csv
  contrato_motor.md       engine inputs, output JSON and rules
frontend/                Rune + rune-kit web app, map bridge and API adapter
motor/                    scoring engine (rules and arithmetic, no ML)
scripts/
  puxar_power.py          downloads NASA POWER
  puxar_nexgddp.py        downloads NEX-GDDP-CMIP6
  montar_culturas.py      builds culturas.csv (ECOCROP + hand-filled values)
  montar_clima.py         builds the two climate tables
  processar_appeears.py   NDVI and slope from the AppEEARS files
tests/                    engine tests, with fixed test tables in tests/dados/
```

Run the engine demo with `python -m motor` and the tests with
`python -m unittest discover tests`, both from the repository root.

## Data

Demo field: lat -20.032, lon -48.526 (Brazil, about 125 km south of
Uberlândia). Every source was pulled for this point or for the field polygon.

| Source | What | Period | How it was obtained |
|---|---|---|---|
| NASA POWER | Rain, temperature, radiation, humidity, wind. Daily values averaged by month | 2005–2024 | `scripts/puxar_power.py` |
| NASA NEX-GDDP-CMIP6 | Rain, Tmin, Tmax from MIROC6, ACCESS-CM2 and MRI-ESM2-0 | `historical` 1995–2014, `ssp245` 2041–2060 | `scripts/puxar_nexgddp.py` |
| MODIS MOD13Q1 v061 | NDVI and EVI every 16 days, with pixel reliability | Dec 2014–Dec 2024 | AppEEARS area request |
| SRTMGL1 v003 | Elevation | 2000 | Same AppEEARS request |
| FAO ECOCROP | Temperature, rain and cycle ranges per crop | — | `EcoCrop_DB.csv` from github.com/OpenCLIM/ecocrop |

The AppEEARS request is named "Uberlandia", but it uses the demo field polygon.
Product citations are in `data/appeears/README.md`. ECOCROP is cited as "FAO
ECOCROP via GAEZ".

Future climate is not read directly from NEX-GDDP. The difference between
`ssp245` and `historical`, averaged over the three models, is added to the
POWER values.

## Setup

```
python -m venv venv
venv\Scripts\activate        # Linux/macOS: source venv/bin/activate
pip install -r requirements.txt
```

The data is already in the repository, so the scripts only need to be run to
change the location or the period:

```
python scripts/puxar_power.py [lat] [lon] [start_year] [end_year]
python scripts/puxar_nexgddp.py [lat] [lon]
```

`puxar_nexgddp.py` makes about 360 small requests and takes a few minutes; what
it has already downloaded stays in `data/nexgddp/cache/`.

## Disclaimer

This is a hackathon prototype. Recommendations must be validated with an
agronomist. Crop prices are historical averages, not forecasts.
