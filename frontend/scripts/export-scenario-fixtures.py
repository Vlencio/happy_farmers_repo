"""Export real local-engine cases for browser QA; never downloads or changes data.

From the repository: .venv/Scripts/python.exe frontend/scripts/export-scenario-fixtures.py
Optional: --output .cache/test-scenario-export.json
The browser test simulates HTTP transport, not the engine calculations in these cases.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from motor import carregar_clima_seco, carregar_dados, recomendar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/playwright/scenario-fixtures.json")
    destination = parser.parse_args().output.resolve()
    tables = carregar_dados(ROOT / "data")
    dry = carregar_clima_seco(ROOT / "data")
    base = {"lat": -20.032, "rotacao_atual": ["soja", "milho"],
            "prioridades": {"agua": 1, "solo": 1, "renda": 1},
            "horizonte": 2, "mes_plantio": 10, "precos": {}, "declividade_pct": 4.05}
    fixtures = {}
    for name, adjustment in {"baseline": None, "rain-20": (-20, 0), "temp2": (0, 2),
                             "combined": (-20, 2), "bounds": (-50, 4), "zero": (0, 0)}.items():
        request = {**base}
        if adjustment is not None:
            request["ajuste"] = {"chuva_pct": adjustment[0], "temp_c": adjustment[1]}
        fixtures[name] = {"request": request, "result": recomendar(request, *tables, dry)}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(fixtures, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(fixtures)} local-engine scenarios written to {destination}")


if __name__ == "__main__":
    main()
