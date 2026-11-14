"""Demo do motor com as tabelas de data/.

Uso: python -m motor            (tabela resumida)
     python -m motor --json     (JSON completo)
"""
import json
import sys

from . import carregar_dados, recomendar

ENTRADA = {
    "lat": -20.032,
    "rotacao_atual": ["soja", "milho"],
    "prioridades": {"agua": 1, "solo": 1, "renda": 1},
    "horizonte": 2,
    "mes_plantio": 10,
}

saida = recomendar(ENTRADA, *carregar_dados())
if "--json" in sys.argv:
    print(json.dumps(saida, ensure_ascii=False, indent=2))
else:
    print(f"slots: {' > '.join(saida['slots'])}")
    print(f"{'sequencia':24s} {'hoje':>6s} {'futuro':>6s}  rank hoje -> futuro")
    for s in saida["sequencias"]:
        marca = "  (atual)" if s["atual"] else ""
        print(f"{s['id']:24s} {s['hoje']['score']:6.1f} {s['futuro']['score']:6.1f}  {s['rank_hoje']} -> {s['rank_futuro']}{marca}")
    print(f"\n{len(saida['descartadas'])} descartadas por epoca de plantio")
