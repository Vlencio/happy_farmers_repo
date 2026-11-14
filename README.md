# Happy Farmers — Field Shift

NASA Space Apps Challenge 2026, challenge **"Field Shift: Adapting Farms with
NASA Data"**.

A decision-support tool for crop rotation. The farmer draws a field, enters the
current rotation and priorities (water / soil / income), and the app ranks the
possible next rotations under today's climate and under the projected climate
for 2041–2060.

**Status:** work in progress. The data below is collected. A first version of
the scoring engine runs on a provisional three-crop table; the final crop
table and the front end are not built yet.

## Layout

```
data/
  talhao_demo_2.geojson   demo field (~219 ha)
  power/                  historical climate, monthly
  nexgddp/                projected climate, monthly (+ cache/ with the daily series)
  appeears/               NDVI (MOD13Q1) and elevation (SRTM) for the field
  ecocrop/                FAO ECOCROP crop requirements
  provisorio/             placeholder crop and climate tables for testing the engine
docs/
  colunas_dados.md        column reference for every source
  contrato_motor.md       engine inputs, output JSON and rules
motor/                    scoring engine (rules and arithmetic, no ML)
scripts/
  puxar_power.py          downloads NASA POWER
  puxar_nexgddp.py        downloads NEX-GDDP-CMIP6
tests/                    engine tests
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
