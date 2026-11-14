"""Demo do motor com as tabelas de data/.

Uso: python -m motor            (tabela resumida)
     python -m motor --json     (JSON completo)
     python -m motor --mes 2    (talhao livre em fevereiro; padrao: outubro)
"""
import json
import sys

from . import carregar_clima_seco, carregar_dados, carregar_diario, recomendar

ENTRADA = {
    "lat": -20.032,
    "rotacao_atual": ["soja", "milho"],
    "prioridades": {"agua": 1, "solo": 1, "renda": 1},
    "horizonte": 2,
    "mes_plantio": int(sys.argv[sys.argv.index("--mes") + 1]) if "--mes" in sys.argv else 10,
}

saida = recomendar(ENTRADA, *carregar_dados(), carregar_clima_seco(), carregar_diario())
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

    if "diario" in saida:  # so se data/power/ tem a serie diaria do talhao de demonstracao
        anos = saida["diario"]["anos"]
        print(f"\nModo diario: {len(anos)} anos ({anos[0]} a {anos[-1]}). Receita em R$/ha; rank do ano mediano e do ano ruim.")
        print(f"{'sequencia':24s} {'hoje: mediano':>14s} {'ruim':>7s} {'pior ano':>14s}   {'futuro: mediano':>15s} {'ruim':>7s}   rank hoje -> futuro")
        for s in sorted(saida["sequencias"], key=lambda s: s["diario"]["hoje"]["mediano"]["rank"]):
            h, f = s["diario"]["hoje"], s["diario"]["futuro"]
            pior = f"{h['pior_ano']['receita_ha']:7.0f} ({h['pior_ano']['ano']})"
            ranks = f"{h['mediano']['rank']} -> {f['mediano']['rank']}  (ruim: {h['ruim']['rank']} -> {f['ruim']['rank']})"
            print(
                f"{s['id']:24s} {h['mediano']['receita_ha']:14.0f} {h['ruim']['receita_ha']:7.0f} {pior:>14s}   "
                f"{f['mediano']['receita_ha']:15.0f} {f['ruim']['receita_ha']:7.0f}   {ranks}"
            )
