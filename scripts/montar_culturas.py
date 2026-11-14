"""Monta data/culturas.csv: faixas do ECOCROP + parametros preenchidos a mao.

Uso: python scripts/montar_culturas.py
Requer: pip install pandas

Fontes de cada coluna em docs/culturas_fontes.md.
Unidades: temperatura em graus C, chuva em mm, preco em R$/t, produtividade em t/ha.
"""
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
ECOCROP = RAIZ / "data" / "ecocrop" / "EcoCrop_DB.csv"
SAIDA = RAIZ / "data" / "culturas.csv"

# cultura: nome cientifico exato no ECOCROP
ESPECIE = {
    "soja": "Glycine max",
    "milho": "Zea mays",
    "sorgo": "Sorghum bicolor",  # sorgo granifero; nao a var. sweet
    "milheto": "Pennisetum glaucum",
    "braquiaria": "Brachiaria brizantha",  # a decumbens tem TMIN 19 C e falharia no inverno
    "crotalaria": "Crotalaria juncea",
    "feijao": "Phaseolus vulgaris",
    "girassol": "Helianthus annuus",
    "algodao": "Gossypium hirsutum",
}

# Preenchido a mao. Ver docs/culturas_fontes.md.
# ciclo: dias do plantio a colheita/dessecacao (sistemas do Cerrado)
# kc: FAO-56 tabela 12 (crotalaria e braquiaria sao aproximacoes)
# mes_plantio_*: mes tipico de plantio no slot; vazio = cultura nao usada naquele slot
# preco R$/t (0 = cobertura, sem venda); produtividade t/ha (Conab, media Brasil 2024/25)
MANUAL = {
    #             ciclo  kc_ini kc_med kc_fim fixa_n cobre safra safrinha preco  prod  prod_safrinha
    "soja":       (115,  0.40,  1.15,  0.50,  1,     0,    10,   None,    2340,  3.56, None),
    "milho":      (135,  0.30,  1.20,  0.35,  0,     1,    10,   2,       1083,  6.61, 6.10),
    "sorgo":      (110,  0.30,  1.05,  0.55,  0,     1,    11,   2,       870,   3.53, 3.53),
    "milheto":    (90,   0.30,  1.00,  0.30,  0,     1,    None, 2,       0,     0,    0),
    "braquiaria": (120,  0.40,  0.95,  0.85,  0,     1,    None, 2,       0,     0,    0),
    "crotalaria": (100,  0.40,  1.05,  0.90,  1,     1,    None, 3,       0,     0,    0),
    "feijao":     (90,   0.40,  1.15,  0.35,  1,     0,    11,   2,       3500,  1.17, 0.98),
    "girassol":   (110,  0.35,  1.05,  0.35,  0,     0,    None, 2,       2000,  1.57, 1.57),
    "algodao":    (170,  0.35,  1.18,  0.60,  0,     0,    12,   None,    9000,  1.90, None),
}
COLS_MANUAL = ["ciclo_dias", "kc_ini", "kc_med", "kc_fim", "fixa_n", "cobre_solo",
               "mes_plantio_safra", "mes_plantio_safrinha", "preco", "produtividade",
               "produtividade_safrinha"]


def main():
    eco = pd.read_csv(ECOCROP, encoding="latin-1")
    linhas = []
    for cultura, especie in ESPECIE.items():
        r = eco[eco["ScientificName"] == especie]
        if len(r) != 1:
            raise SystemExit(f"{especie}: {len(r)} linhas no ECOCROP (esperado 1)")
        r = r.iloc[0]
        linha = {
            "cultura": cultura,
            "especie_ecocrop": especie,
            "temp_min": r["TMIN"], "temp_max": r["TMAX"],
            "temp_otima_min": r["TOPMN"], "temp_otima_max": r["TOPMX"],
            "chuva_min": r["RMIN"], "chuva_max": r["RMAX"],
            "chuva_otima_min": r["ROPMN"], "chuva_otima_max": r["ROPMX"],
            "ciclo_ecocrop_min": r["GMIN"], "ciclo_ecocrop_max": r["GMAX"],
        }
        linha.update(dict(zip(COLS_MANUAL, MANUAL[cultura])))
        linhas.append(linha)

    df = pd.DataFrame(linhas)
    for c in ["mes_plantio_safra", "mes_plantio_safrinha"]:
        df[c] = df[c].astype("Int64")
    df.to_csv(SAIDA, index=False)
    print(df.to_string(index=False))
    print(f"\n{len(df)} culturas salvas em {SAIDA}")


if __name__ == "__main__":
    main()
