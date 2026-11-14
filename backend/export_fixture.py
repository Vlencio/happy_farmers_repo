"""Refresh a test fixture from the real engine; never fetches or changes data."""
import json
from pathlib import Path
from motor import carregar_dados, recomendar
from backend.app import LABELS, DATA_NOTICE

tables = carregar_dados()
request = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "horizonte": 2, "mes_plantio": 10}
destination = Path(__file__).resolve().parents[1] / "frontend/tests/fixtures"
destination.mkdir(parents=True, exist_ok=True)
(destination / "motor.json").write_text(json.dumps(recomendar(request, *tables), ensure_ascii=False, indent=2), encoding="utf-8")
(destination / "metadata.json").write_text(json.dumps({
    "cultures": [{"id": name, "label": LABELS.get(name, name.capitalize())} for name in tables[0]["cultura"].tolist()],
    "data_notice": DATA_NOTICE,
}, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Fixtures atualizadas em {destination}")
