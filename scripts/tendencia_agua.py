"""Tendencia da chuva e do balanco hidrico por ano agricola no POWER 2005-2024 (talhao de demonstracao).

Uso: python scripts/tendencia_agua.py
Requer: pip install pandas numpy

Le o arquivo mensal do POWER (sem baixar nada) e grava:
- data/power/agua_por_ano.csv: um ano agricola (julho a junho) por linha.
- data/power/agua_tendencia.csv: uma variavel por linha, com a tendencia e o teste.

Ano agricola de julho a junho, igual ao ano seco de montar_clima.py: "2020" = jul/2020 a jun/2021.
Ficam so os anos com 12 meses: 2005/06 a 2023/24, 19 anos.

ET0 por Hargreaves com as temperaturas do POWER sem a correcao da A520, como em
montar_clima.py. Balanco = chuva - ET0 (sem cultura, sem solo): mede a oferta de agua
do clima, nao o deficit de uma cultura.

Tendencia: inclinacao de Theil-Sen (mediana das inclinacoes entre todos os pares de anos)
e teste de Mann-Kendall, os dois sem suposicao de normalidade. Com 19 anos o teste tem
pouco poder: p alto nao prova que nao ha tendencia.
"""

import math
from pathlib import Path

import numpy as np
import pandas as pd

from montar_clima import POWER, ra_mm_dia

RAIZ = Path(__file__).resolve().parent.parent
SAIDA_ANOS = RAIZ / "data" / "power" / "agua_por_ano.csv"
SAIDA_TENDENCIA = RAIZ / "data" / "power" / "agua_tendencia.csv"
CHUVOSO = (10, 11, 12, 1, 2, 3)  # estacao das chuvas: a safra
SECO = (4, 5, 6, 7, 8, 9)


def et0_mensal(p):
    """ET0 (mm no mes) por Hargreaves, linha a linha, com os dias reais de cada mes."""
    ra = ra_mm_dia(-20.032)[p["mes"] - 1]
    tmed = (p["T2M_MIN"] + p["T2M_MAX"]) / 2
    dias = pd.to_datetime({"year": p["ano"], "month": p["mes"], "day": 1}).dt.days_in_month
    return 0.0023 * ra * (tmed + 17.8) * np.sqrt((p["T2M_MAX"] - p["T2M_MIN"]).clip(lower=0)) * dias


def por_ano(p):
    """Uma linha por ano agricola completo."""
    p = p.assign(
        safra=np.where(p["mes"] >= 7, p["ano"], p["ano"] - 1),
        et0_mm=et0_mensal(p),
    )
    p["balanco_mm"] = p["chuva_mm"] - p["et0_mm"]
    p = p.groupby("safra").filter(lambda g: len(g) == 12)
    g = p.groupby("safra")
    anos = pd.DataFrame({
        "chuva_mm": g["chuva_mm"].sum(),
        "et0_mm": g["et0_mm"].sum(),
        "balanco_mm": g["balanco_mm"].sum(),
        "chuva_safra_mm": p[p["mes"].isin(CHUVOSO)].groupby("safra")["chuva_mm"].sum(),
        "chuva_seca_mm": p[p["mes"].isin(SECO)].groupby("safra")["chuva_mm"].sum(),
        "meses_balanco_negativo": g["balanco_mm"].apply(lambda b: int((b < 0).sum())),
        "tmax_c": g["T2M_MAX"].mean(),
    })  # fmt: skip
    if "GWETROOT" in p:  # umidade do solo, se o arquivo ja tiver as colunas GWET
        anos["gwetroot"] = g["GWETROOT"].mean()
    anos.index.name = "safra"
    anos.insert(0, "ano_agricola", [f"{a}/{str(a + 1)[2:]}" for a in anos.index])
    return anos.reset_index()


def theil_sen(x, y):
    """Mediana das inclinacoes entre todos os pares de pontos."""
    i, j = np.triu_indices(len(x), k=1)
    return float(np.median((y[j] - y[i]) / (x[j] - x[i])))


def mann_kendall(y):
    """(S, p bilateral) do teste de Mann-Kendall, aproximacao normal com correcao de empates."""
    n = len(y)
    i, j = np.triu_indices(n, k=1)
    s = float(np.sign(y[j] - y[i]).sum())
    _, empates = np.unique(y, return_counts=True)
    var = (n * (n - 1) * (2 * n + 5) - sum(t * (t - 1) * (2 * t + 5) for t in empates)) / 18
    z = 0.0 if s == 0 else (s - math.copysign(1, s)) / math.sqrt(var)
    return s, math.erfc(abs(z) / math.sqrt(2))


def tendencias(anos):
    x = anos["safra"].to_numpy(float)
    linhas = []
    for col in [c for c in anos.columns if c not in ("safra", "ano_agricola")]:
        y = anos[col].to_numpy(float)
        sen = theil_sen(x, y)
        s, p = mann_kendall(y)
        linhas.append({
            "variavel": col,
            "media": y.mean(),
            "desvio": y.std(ddof=1),
            "sen_por_decada": sen * 10,
            "sen_por_decada_pct": 100 * sen * 10 / y.mean() if y.mean() else float("nan"),
            "mk_s": s,
            "mk_p": p,
            "primeira_metade": y[: len(y) // 2].mean(),
            "segunda_metade": y[len(y) - len(y) // 2:].mean(),
        })  # fmt: skip
    return pd.DataFrame(linhas)


if __name__ == "__main__":
    anos = por_ano(pd.read_csv(POWER))
    tend = tendencias(anos)
    anos.round(3).to_csv(SAIDA_ANOS, index=False)
    tend.round(4).to_csv(SAIDA_TENDENCIA, index=False)
    print(anos.drop(columns="safra").round(2).to_string(index=False))
    print(f"\n{len(anos)} anos agricolas. Tendencia (Theil-Sen por decada; p de Mann-Kendall):")
    print(tend.round(3).to_string(index=False))
    print(f"\nsalvo em {SAIDA_ANOS} e {SAIDA_TENDENCIA}")
