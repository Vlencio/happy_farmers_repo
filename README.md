# Happy Farmers — Field Shift

NASA Space Apps Challenge 2026, challenge **"Field Shift: Adapting Farms with NASA Data"**.

A decision-support tool for crop rotation in the Brazilian Cerrado (Minas Gerais). The farmer
draws a field on a satellite map or imports GeoJSON, gives the crop history, picks priorities
(water, soil, income) and a soil texture, and gets the three best rotations for today's climate,
each with its rank in the climate projected for around 2060. The hook: **the rotation that wins
today may not win in the future.**

The ranking comes from rules and arithmetic on NASA data (no machine learning). An optional AI
chat only explains the numbers on screen; it never produces them.

## Run it

Requirements: Python 3.11+, Node.js 22.12+, Git. The front end is Rust/WebAssembly
([Rune](https://github.com/anomalyco/rune)); building it also needs Rust via rustup
(the toolchain is pinned in `frontend/rust-toolchain.toml`).

```bash
# from the repository root
python -m venv .venv
.venv/Scripts/python -m pip install -r backend/requirements-dev.txt   # Linux/macOS: .venv/bin/python
cd frontend
npm ci
npm run dev        # starts the API (FastAPI, port 8000) and the web app (port 4173)
```

Open <http://127.0.0.1:4173>. A fresh clone must build the WebAssembly first: see
[frontend/README.md](frontend/README.md). The API alone: `uvicorn backend.app:app --port 8000`
(OpenAPI at `/docs`). A Docker image is defined in `Dockerfile`.

Tests, from the repository root:

```bash
python -m unittest discover -s tests            # engine
python -m unittest discover -s backend/tests    # API
python -m backend.export_fixture                # front-end fixtures; must not change
npm test --prefix frontend                      # front end (JS)
```

CI runs these plus the Rust tests and a Docker smoke test ([docs/CI.md](docs/CI.md)).
The engine also runs alone: `python -m motor`.

## Data

All preprocessed tables for the demo field are in the repository; nothing has to be downloaded
to run the app. The download scripts under `scripts/` are maintenance tools.

| Source | Agency | What we use | Resolution | How it reaches the field |
|---|---|---|---|---|
| **NASA POWER** (daily, community AG) | NASA | Rain, Tmin, Tmax 2005–2024; daily series for the daily mode | ~0.5° cell | The cell containing the field, averaged by month. Tmin/Tmax corrected with the INMET A520 station |
| **NEX-GDDP-CMIP6** (MIROC6, ACCESS-CM2, MRI-ESM2-0) | NASA | Change between `historical` 1995–2014 and `ssp245` 2041–2060 | 0.25° cell | Delta method: today × rain ratio, today + temperature delta. Never compared directly to POWER. Future centred around 2060 |
| **MODIS MOD13Q1** (AppEEARS) | NASA | NDVI every 16 days, 2014–2024 | 250 m | Mean of the pixels inside the field polygon, cloudy dates removed |
| **SRTMGL1** (AppEEARS) | NASA | Elevation and slope | 30 m | Statistics over the field polygon (slope ~4%, altitude ~484 m) |
| **GLDAS2/Noah soil parameters** | NASA | Clay/sand/silt fractions → suggested texture | 0.25° cell | The cell containing the point; shown as a suggestion the farmer confirms |
| FAO ECOCROP (via GAEZ) | FAO | Temperature, rain and cycle ranges per crop | — | Crop table |
| FAO-56 | FAO | Kc and Ky per crop, ET0 method (Hargreaves) | — | Crop table and engine constants |
| ZARC / IN SPA-MAPA 1/2022 | MAPA (Brazil) | Soil available-water classes (30/45/60 mm by texture) | — | Engine constant |
| CEPEA/Conab, IBGE PAM | Brazil | Prices and yields | State / national | Crop table (`docs/culturas_fontes.md` marks values still to check) |
| Embrapa technical notes | Brazil | Shared pests (white mould, whitefly), wheat altitude, sunn hemp planting month | — | Engine rules and crop table, with the source in the code |

Point climate outside the demo uses POWER for the point and the regional NEX-GDDP delta grid
(cached). NDVI, slope, the dry year (2020/21) and the per-model range are demo-only.
Column reference: [docs/colunas_dados.md](docs/colunas_dados.md).

**Datasets the challenge lists that we did not use, and why:** SMAP (9–36 km, top 5 cm, short
record; we model soil water with a daily bucket and treat SMAP as the natural next check),
GPM/IMERG (POWER already gives a consistent 20-year rain series for the method; IMERG would be the
upgrade for extremes), GRACE/GRACE-FO (hundreds of km: regional context, not field level),
ECOSTRESS and Landsat (field-scale heat and NDVI would feed a zone map, which we did not build).

## How the engine decides

Engine contract, every rule and every open question: [docs/contrato_motor.md](docs/contrato_motor.md).

- Every sequence of one or two crops is simulated day by day in its planting window
  (safra/safrinha), with a water balance (rain − Kc × ET0, soil storage by texture), climate fit
  (FAO ECOCROP ranges), a heat rule (days above each crop's threshold during flowering) and
  sequence rules (repetition, shared pests, nitrogen credit only after a green manure).
- **Score** = weighted mean of three parts, with the farmer's weights:
  water (share of the crop water demand met), soil (nitrogen fixation, straw cover, diversity)
  and income (revenue per year of field use ÷ the loss-free revenue of soybean + second-season
  corn). The three cards are the three best scores today; each shows its future rank and, at the
  demo field, the range across the three climate models.
- Each strategy lists **benefits, risks and information gaps** derived from its own numbers.
- Optional: "what if" rain/temperature sliders, a daily mode (one run per year, 2005–2023) and a
  dry-year scenario.

## Limitations (from an independent statistics and agronomy review, 15 Nov)

- Scores within ~2 points are a **tie** (year-to-year noise is 1–1.3 points); the screen marks
  them. Weights are not shares of the result: with equal weights income drives about half of it.
- The robust today-vs-future signal is the **fall of bean sequences** in the future; it depends on
  the 32 °C heat threshold, the least certain value.
- Future rain change is **not significant** (0 of 36 model-month deltas with |t| > 2); the models
  agree on warming. Three models give a min–max range, not a confidence interval.
- The monthly mode is optimistic on water (averages hide dry spells); the daily mode shows them.
- Revenue is gross: no production cost (out of scope). Several crop values are provisional and
  marked in the code and in `docs/culturas_fontes.md`.
- Outside Minas Gerais and outside the demo field, the analysis is exploratory.

### Yields are not the field's

The yields in `data/culturas.csv` are Conab averages for **Brazil**, 10th survey of the 2024/25
season (first and second season separately), and for wheat the IBGE PAM 2025 average for
**Minas Gerais**. None is the demo field's yield. The PAM yields for Minas Gerais are in
`data/culturas_mg.csv`, but the engine does not read them (they are higher than Brazil's for
soybean, first-season corn, sorghum, beans and sunflower, and lower for second-season corn).
Sources: `docs/culturas_fontes.md`.

These are observed yields of a real season, so they already include that season's heat and
water losses. The engine applies its heat and water losses on top of them, so the same losses
are counted twice: absolute revenue is understated, more for the crops the engine penalises most.

### Provisional engine constants

These constants at the top of `motor/motor.py` have no solid source or come from memory. They
are provisional and need calibration with an agronomist.

| Constant | Value | What it does |
|---|---|---|
| `PESO_SOLO` | 0.4 / 0.4 / 0.2 | Weights of nitrogen fixation, straw cover and diversity inside the soil part of the score |
| `PENALIDADE_REPETICAO` | 0.85 | Yield factor when a crop repeats the previous one |
| `BONUS_APOS_FIXADORA` | 1.10 | Yield factor for a non-fixing crop after a green manure |
| `JANELA_BONUS_N_DIAS` | 60 | The bonus above only applies if the next crop is planted within 60 days of the green manure's end |
| `PENALIDADE_HOSPEDEIRO` | 0.92 | Yield factor when the crop shares a pest or disease with the previous one (the pairs have Embrapa sources; the size of the effect does not) |
| `PENALIDADE_MOSCA_BRANCA` | 0.75 | Yield factor for beans after soybean (whitefly, golden mosaic). Embrapa cites 40–100% losses in susceptible cultivars; 0.75 is from memory |
| `PERDA_CALOR` | 1.0 | Share of yield lost if every day of the sensitive phase is above the crop's heat threshold (loss is proportional to the share of hot days) |
| `FASES_KC` / `FASE_SENSIVEL` | 20% / 45% / 80% of the cycle | Kc stages; heat counts between 45% and 80% (flowering and grain filling) |
| `DIAS_COLHEITA` | 10 | Days from the end of a cycle until the field is free, the same for every crop |
| `ESPERA_MAX_DIAS` | 182 | Longest wait for a slot's planting month; beyond it the season has passed and the sequence is discarded |
| `CAD_POR_TEXTURA` (sandy) | 30 mm | Soil water storage for sandy soil. The medium and clay classes were checked against ZARC; the sandy range and the texture-to-class mapping are from memory |

`PESO_SOLO` is the one that changes the ranking most: in the 15 Nov statistical review, plausible
sub-weights change the first place in October, February and January (demo field, equal priority
weights). The warning thresholds (`AVISO_*`) and the accepted input ranges are also team choices,
but they only decide when to warn or reject input and do not enter the score. Full list:
[docs/contrato_motor.md](docs/contrato_motor.md), "Constantes provisórias".

This is a hackathon prototype. **It supports, and does not replace, the farmer's judgment and a
local agronomist.**

## Layout

```
motor/      scoring engine (rules and arithmetic) and its contract in docs/contrato_motor.md
backend/    FastAPI transport (/analyze, /metadata, optional /chat)
frontend/   Rune (Rust/WASM) web app, map bridge and API adapter
data/       preprocessed tables for the demo field and regional grids
scripts/    data download and preprocessing (maintenance only)
tests/      engine tests (fixed tables in tests/dados/)
docs/       contract, data columns, sources, reviews and the challenge checklist
```

Team: three developers (data, engine, front end and API).
