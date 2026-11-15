"""Export soil cases from the real local engine; never downloads or changes data.

From the repository: .venv/Scripts/python.exe frontend/scripts/export-soil-fixtures.py
Optional: --output .cache/test-soil-export.json
The browser soil test simulates the proposed API transport, not engine calculations.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from motor import carregar_clima_seco, carregar_dados, recomendar


def demo_point():
    """Match buildRequest: the center of the demonstration polygon's bounding box."""
    geo = json.loads((ROOT / "frontend/public/demo-farm.geojson").read_text(encoding="utf-8"))
    if geo["type"] == "FeatureCollection":
        if len(geo["features"]) != 1:
            raise ValueError("The browser fixture requires one demonstration field.")
        geo = geo["features"][0]
    geometry = geo.get("geometry", geo)
    if geometry["type"] not in ("Polygon", "MultiPolygon"):
        raise ValueError("The demonstration field must be a polygon.")

    def positions(value):
        if isinstance(value[0], (int, float)):
            yield value
        else:
            for item in value:
                yield from positions(item)

    points = list(positions(geometry["coordinates"]))
    lat = (min(p[1] for p in points) + max(p[1] for p in points)) / 2
    lon = (min(p[0] for p in points) + max(p[0] for p in points)) / 2
    return lat, lon


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/playwright/soil-fixtures.json")
    destination = parser.parse_args().output.resolve()
    lat, lon = demo_point()
    tables = carregar_dados(ROOT / "data")
    dry = carregar_clima_seco(ROOT / "data")
    if dry is None:
        raise RuntimeError("The browser soil cases require the delivered demonstration dry-year table.")
    base = {"lat": lat, "rotacao_atual": ["soja", "milho"],
            "prioridades": {"agua": 1, "solo": 1, "renda": 1},
            "horizonte": 2, "mes_plantio": 10, "precos": {}, "declividade_pct": 4.05}
    cases = {}
    for name in ("baseline", "arenoso", "medio", "argiloso"):
        request = dict(base)
        if name != "baseline":
            request["solo_textura"] = name
        cases[name] = {"request": {**request, "lon": lon}, "result": recomendar(request, *tables, dry)}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(cases)} real-engine soil cases written to {destination}")


if __name__ == "__main__":
    main()
