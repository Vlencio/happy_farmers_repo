"""Read-only presentation data. This module does not collect data or score crops."""
import csv
import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"


def numeric_rows(path, columns):
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    converted = []
    for row in rows:
        item = {key: float(row[key]) for key in columns}
        if not all(math.isfinite(value) for value in item.values()):
            raise ValueError(f"Valores não finitos em {path.name}")
        converted.append(item)
    return converted


def load_demo_field(folder=DATA):
    folder = Path(folder)
    paths = [folder / "talhao_demo_2.geojson", folder / "talhao/ndvi_climatologia.csv",
             folder / "talhao/declividade.csv", folder / "clima_correcoes.csv"]
    if not all(path.exists() for path in paths):
        return None
    ndvi = numeric_rows(paths[1], ["mes", "ndvi_medio", "ndvi_min", "ndvi_max", "freq_solo"])
    if len(ndvi) != 12 or {row["mes"] for row in ndvi} != set(range(1, 13)):
        raise ValueError("A climatologia NDVI precisa dos 12 meses")
    for row in ndvi:
        if not -1 <= row["ndvi_min"] <= row["ndvi_medio"] <= row["ndvi_max"] <= 1 or not 0 <= row["freq_solo"] <= 1:
            raise ValueError("NDVI ou frequência fora da faixa")
    terrain = numeric_rows(paths[2], ["area_ha", "decl_media_pct", "decl_p90_pct", "decl_max_pct"])
    if len(terrain) != 1 or not 0 <= terrain[0]["decl_media_pct"] <= terrain[0]["decl_p90_pct"] <= terrain[0]["decl_max_pct"]:
        raise ValueError("Resumo de declividade inválido")
    corrections = numeric_rows(paths[3], ["mes", "off_tmin", "off_tmax"])
    if len(corrections) != 12 or {row["mes"] for row in corrections} != set(range(1, 13)):
        raise ValueError("Correções da estação precisam dos 12 meses")
    return {
        "id": "talhao_demo_2", "name": "Talhão de demonstração",
        "boundary": json.loads(paths[0].read_text(encoding="utf-8")),
        "ndvi": sorted(ndvi, key=lambda row: row["mes"]), "terrain": terrain[0],
        "station": {"name": "INMET A520 · Conceição das Alagoas", "distance_km": 40,
                    "corrections": sorted(corrections, key=lambda row: row["mes"])},
        "sources": "NDVI: MOD13Q1, 250 m, série 2014–2024; relevo: SRTM, 30 m; clima: POWER e correção local da INMET A520. Escopo: um talhão. As resoluções são diferentes.",
    }


def load_model_spread(folder=DATA):
    """Optional D2 delivery: one row per model/month, with monthly climate deltas."""
    path = Path(folder) / "clima_modelos.csv"
    if not path.exists():
        return None
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = list(csv.DictReader(source))
    models = {}
    for row in rows:
        name, month = row["modelo"].strip(), int(row["mes"])
        delta = {key: float(row[key]) for key in ["delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"]}
        if not name or not 1 <= month <= 12 or not all(math.isfinite(v) for v in delta.values()):
            raise ValueError("Delta por modelo inválido")
        months = models.setdefault(name, {})
        if month in months:
            raise ValueError("Mês duplicado nos deltas por modelo")
        months[month] = delta
    if not models or any(len(months) != 12 for months in models.values()):
        raise ValueError("Cada modelo precisa dos 12 meses")
    annual = [{"model": name,
               "rain_delta_mm": sum(row["delta_chuva_mm"] for row in months.values()),
               "tmax_delta_c": sum(row["delta_tmax_c"] for row in months.values()) / 12}
              for name, months in sorted(models.items())]
    return {"models": annual, "source": "data/clima_modelos.csv", "scope": "talhao_demo_2",
            "method": "Chuva: soma dos deltas mensais; máxima: média dos 12 deltas mensais. Futuro menos histórico."}
