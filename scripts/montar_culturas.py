"""Monta data/culturas.csv: faixas do ECOCROP + parametros preenchidos a mao.

Uso: python scripts/montar_culturas.py
Requer: pip install pandas

As culturas em CANDIDATAS vao para data/culturas_candidatas.csv, com as mesmas
colunas, e nao para o motor. Para levar uma ao motor, tire o nome de CANDIDATAS.

Fontes de cada coluna em docs/culturas_fontes.md (e docs/ibge_pam.md para as
culturas com preco e produtividade da PAM/IBGE).
Unidades: temperatura em graus C, chuva em mm, preco em R$/t, produtividade em t/ha.
"""
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
ECOCROP = RAIZ / "data" / "ecocrop" / "EcoCrop_DB.csv"
SAIDA = RAIZ / "data" / "culturas.csv"
SAIDA_CANDIDATAS = RAIZ / "data" / "culturas_candidatas.csv"

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
    "trigo": "Triticum aestivum",  # trigo tropical de sequeiro do Cerrado; ver docs/ibge_pam.md
    "arroz": "Oryza sativa",  # arroz de terras altas (sequeiro)
    "amendoim": "Arachis hypogaea",
    "aveia": "Avena sativa",
}

# Anuais de MG (PAM/IBGE) que cabem na rotacao mas ainda nao entram no motor.
# Motivos em docs/ibge_pam.md (o amendoim lideraria o ranking sem custo de producao).
CANDIDATAS = {"arroz", "amendoim", "aveia"}

# Preenchido a mao. Ver docs/culturas_fontes.md.
# ciclo: dias do plantio a colheita/dessecacao (sistemas do Cerrado)
# kc: FAO-56 tabela 12 (crotalaria = "clover hay", braquiaria = "grazing pasture")
# mes_plantio_*: mes tipico de plantio no slot; vazio = cultura nao usada naquele slot
# preco R$/t (0 = cobertura, sem venda); produtividade t/ha (Conab, media Brasil 2024/25)
# calor: maxima diaria (graus C) a partir da qual o florescimento e prejudicado (Luo 2011);
#        None = cultura de cobertura, sem graos: a regra de calor nao se aplica
MANUAL = {
    #             ciclo  kc_ini kc_med kc_fim fixa_n cobre safra safrinha preco  prod  prod_safrinha calor
    "soja":       (115,  0.40,  1.15,  0.50,  1,     0,    10,   None,    2340,  3.56, None, 38),
    "milho":      (135,  0.30,  1.20,  0.35,  0,     1,    10,   2,       1083,  6.61, 6.10, 35),
    "sorgo":      (110,  0.30,  1.05,  0.55,  0,     1,    11,   2,       870,   3.53, 3.53, 36),
    "milheto":    (90,   0.30,  1.00,  0.30,  0,     1,    None, 2,       0,     0,    0, None),
    "braquiaria": (120,  0.40,  0.95,  0.85,  0,     1,    None, 2,       0,     0,    0, None),
    "crotalaria": (100,  0.40,  0.90,  0.85,  1,     1,    None, 3,       0,     0,    0, None),
    "feijao":     (90,   0.40,  1.15,  0.35,  1,     0,    11,   2,       3500,  1.17, 0.98, 32),
    "girassol":   (110,  0.35,  1.00,  0.35,  0,     0,    None, 2,       2000,  1.57, 1.57, 35),
    "algodao":    (170,  0.35,  1.18,  0.60,  0,     0,    12,   None,    9000,  1.89, None, 32),
    # preco e prod daqui para baixo: PAM/IBGE 2025, media de MG (valor da producao / quantidade)
    "trigo":      (120,  0.30,  1.15,  0.30,  0,     1,    None, 3,       1353,  3.34, 3.34, 32),
    "arroz":      (120,  0.30,  1.20,  0.75,  0,     1,    11,   None,    1407,  4.12, None, 35),  # em casca
    "amendoim":   (125,  0.40,  1.15,  0.60,  1,     0,    10,   None,    3632,  3.62, None, 35),  # em casca
    "aveia":      (120,  0.30,  1.15,  0.25,  0,     1,    None, 4,       660,   1.66, 1.66, 32),
}
# Valores ainda sem fonte conferida (docs/culturas_fontes.md). Vira a coluna <campo>_status;
# o motor avisa valor_a_conferir. Vazio = conferido.
STATUS = {
    "preco": {"feijao": "memoria", "girassol": "memoria", "algodao": "memoria"},
    "temp_calor_c": {"girassol": "sem fonte", "trigo": "memoria"},
}
COLS_MANUAL = ["ciclo_dias", "kc_ini", "kc_med", "kc_fim", "fixa_n", "cobre_solo",
               "mes_plantio_safra", "mes_plantio_safrinha", "preco", "produtividade",
               "produtividade_safrinha", "temp_calor_c"]


def ler_ecocrop():
    return pd.read_csv(ECOCROP, encoding="latin-1")


def faixas_ecocrop(eco, especie):
    """Faixas de clima e ciclo de uma especie do ECOCROP, com os nomes de coluna de culturas.csv."""
    r = eco[eco["ScientificName"] == especie]
    if len(r) != 1:
        raise SystemExit(f"{especie}: {len(r)} linhas no ECOCROP (esperado 1)")
    r = r.iloc[0]
    return {
        "especie_ecocrop": especie,
        "temp_min": r["TMIN"], "temp_max": r["TMAX"],
        "temp_otima_min": r["TOPMN"], "temp_otima_max": r["TOPMX"],
        "chuva_min": r["RMIN"], "chuva_max": r["RMAX"],
        "chuva_otima_min": r["ROPMN"], "chuva_otima_max": r["ROPMX"],
        "ciclo_ecocrop_min": r["GMIN"], "ciclo_ecocrop_max": r["GMAX"],
    }


def salvar(df, arquivo):
    df = df.copy()
    for c in ["mes_plantio_safra", "mes_plantio_safrinha", "temp_calor_c"]:
        df[c] = df[c].astype("Int64")
    df.to_csv(arquivo, index=False)
    return df


def main():
    eco = ler_ecocrop()
    df = pd.DataFrame([
        {"cultura": cultura, **faixas_ecocrop(eco, especie), **dict(zip(COLS_MANUAL, MANUAL[cultura]))}
        for cultura, especie in ESPECIE.items()
    ])
    for campo, por_cultura in STATUS.items():
        df[f"{campo}_status"] = df["cultura"].map(por_cultura)
    candidata = df["cultura"].isin(CANDIDATAS)
    motor = salvar(df[~candidata], SAIDA)
    cand = salvar(df[candidata], SAIDA_CANDIDATAS)
    print(motor.to_string(index=False))
    print(f"\n{len(motor)} culturas salvas em {SAIDA}")
    print(f"{len(cand)} candidatas (fora do motor) salvas em {SAIDA_CANDIDATAS}: {', '.join(cand['cultura'])}")


if __name__ == "__main__":
    main()
