"""Demo do motor com as tabelas de data/.

Uso: python -m motor            (tabela resumida)
     python -m motor --json     (JSON completo)
"""
import json
import sys

from . import carregar_clima_seco, carregar_dados, recomendar

ENTRADA = {
    "lat": -20.032,
    "rotacao_atual": ["soja", "milho"],
    "prioridades": {"agua": 1, "solo": 1, "renda": 1},
    "horizonte": 2,
    "mes_plantio": 10,
}

saida = recomendar(ENTRADA, *carregar_dados(), carregar_clima_seco())
if "--json" in sys.argv:
    print(json.dumps(saida, ensure_ascii=False, indent=2))
else:
    cenarios = list(saida["clima"])  # hoje, futuro e, se data/clima_seco.csv existe, seco
    print(f"slots: {' > '.join(saida['slots'])}")
    print(f"{'sequencia':24s} " + " ".join(f"{c:>6s}" for c in cenarios) + "  rank " + " -> ".join(cenarios))
    for s in saida["sequencias"]:
        marca = "  (atual)" if s["atual"] else ""
        scores = " ".join(f"{s[c]['score']:6.1f}" for c in cenarios)
        ranks = " -> ".join(str(s[f"rank_{c}"]) for c in cenarios)
        print(f"{s['id']:24s} {scores}  {ranks}{marca}")
    print(f"\n{len(saida['descartadas'])} descartadas por epoca de plantio")
