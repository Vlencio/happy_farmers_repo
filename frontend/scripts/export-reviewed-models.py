"""Export reviewed-engine examples for browser QA; never downloads or changes data.

From the repository: .venv/Scripts/python.exe frontend/scripts/export-reviewed-models.py
The browser test simulates API transport for per-model and daily results that the
current API does not yet provide. All numerical outputs come from the actual engine.
"""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from motor import carregar_clima_modelos, carregar_clima_seco, carregar_dados, carregar_diario, recomendar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "output/playwright/reviewed-models.json")
    destination = parser.parse_args().output.resolve()
    tables = carregar_dados(ROOT / "data")
    dry = carregar_clima_seco(ROOT / "data")
    models = carregar_clima_modelos(ROOT / "data")
    daily = carregar_diario(ROOT / "data")
    if models is None or daily is None:
        raise RuntimeError("These browser cases require the delivered demonstration model and daily tables.")
    base = {"lat": -20.032, "rotacao_atual": ["soja", "milho"],
            "prioridades": {"agua": 1, "solo": 1, "renda": 1},
            "horizonte": 2, "mes_plantio": 10, "precos": {}, "declividade_pct": 4.05}
    cases = {}
    for name, changes, use_daily, use_models in [
        ("october", {}, False, True),
        ("february", {"mes_plantio": 2}, False, True),
        ("daily_hosts", {"rotacao_atual": ["soja", "feijao"]}, True, True),
        ("rank_warning", {"mes_plantio": 2, "rotacao_atual": ["crotalaria", "algodao"]}, False, True),
        ("without_models", {}, False, False),
    ]:
        request = {**base, **changes}
        cases[name] = {"request": request, "result": recomendar(
            request, *tables, dry, diario=daily if use_daily else None,
            clima_modelos=models if use_models else None)}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{len(cases)} real-engine cases written to {destination}")


if __name__ == "__main__":
    main()
