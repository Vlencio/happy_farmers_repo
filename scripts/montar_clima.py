"""Monta as duas tabelas de clima do motor (12 linhas cada, uma por mes).

Uso: python scripts/montar_clima.py
Requer: pip install pandas numpy

- clima_hoje.csv:   POWER 2005-2024 em media por mes, com Tmin e Tmax corrigidos
                    pela estacao INMET A520 (Conceicao das Alagoas, 40 km do talhao).
- clima_futuro.csv: hoje + (NEX-GDDP ssp245 2041-2060 - historical 1995-2014),
                    diferenca calculada por modelo e mes e depois media dos 3 modelos.
- clima_correcoes.csv: os offsets da A520 e os deltas do NEX, para conferencia.

ET0 por Hargreaves (FAO-56 eq. 52), igual nos dois lados, calculado com as
temperaturas do POWER SEM a correcao da A520 (+ deltas do NEX no futuro). Motivo:
com o POWER bruto, Hargreaves da 1.635 mm/ano, igual ao Penman-Monteith do POWER
(1.640 mm); com a correcao a amplitude termica cresce e o ET0 sobe ~9%, quase todo
nos meses umidos, onde Hargreaves ja tende a superestimar. A correcao vale para
tmin_c/tmax_c (encaixe das culturas), nao para o ET0.
A chuva do POWER nao e corrigida: no talhao o vies contra a A520 e de ~-5% (r = 0,90).
"""
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"
POWER = DADOS / "power" / "power_-20.032_-48.526_2005_2024.csv"
NEX = DADOS / "nexgddp" / "nexgddp_-20.032_-48.526.csv"
INMET = DADOS / "inmet" / "a520_vs_power_mensal.csv"
LAT = -20.032
DIAS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
DIA_JULIANO_MEIO = np.array([15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349])


def ra_mm_dia(lat_graus):
    """Radiacao extraterrestre (mm/dia equivalentes) no meio de cada mes, FAO-56 eqs. 21-25."""
    phi = np.radians(lat_graus)
    j = DIA_JULIANO_MEIO
    dr = 1 + 0.033 * np.cos(2 * np.pi * j / 365)
    dec = 0.409 * np.sin(2 * np.pi * j / 365 - 1.39)
    ws = np.arccos(-np.tan(phi) * np.tan(dec))
    ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    return 0.408 * ra  # MJ/m2/dia -> mm/dia


def et0_hargreaves(tmin, tmax):
    """ET0 mensal (mm) por Hargreaves; tmin/tmax indexados por mes 1..12."""
    tmed = (tmin + tmax) / 2
    diario = 0.0023 * ra_mm_dia(LAT) * (tmed + 17.8) * np.sqrt((tmax - tmin).clip(lower=0))
    return diario * DIAS


def offsets_a520():
    """INMET - POWER por mes do ano, so nos meses com os dois valores."""
    m = pd.read_csv(INMET, parse_dates=["mes"])
    m["m"] = m["mes"].dt.month
    off = pd.DataFrame({
        "off_tmin": (m["tmin_c_inmet"] - m["tmin_c_power"]),
        "off_tmax": (m["tmax_c_inmet"] - m["tmax_c_power"]),
        "m": m["m"],
    }).dropna()
    g = off.groupby("m")
    return g[["off_tmin", "off_tmax"]].mean(), g.size().rename("n_meses_a520")


def deltas_nex():
    n = pd.read_csv(NEX)
    d = n.groupby(["modelo", "cenario", "mes"])[["chuva_mm", "tmin_c", "tmax_c"]].mean().unstack("cenario")
    delta = pd.DataFrame({v: d[(v, "ssp245")] - d[(v, "historical")] for v in ["chuva_mm", "tmin_c", "tmax_c"]})
    return delta.groupby("mes").mean().add_prefix("delta_")


def main():
    p = pd.read_csv(POWER)
    base = p.groupby("mes").agg(chuva_mm=("chuva_mm", "mean"), tmin_c=("T2M_MIN", "mean"), tmax_c=("T2M_MAX", "mean"))

    off, n = offsets_a520()
    hoje = base.copy()
    hoje["tmin_c"] = base["tmin_c"] + off["off_tmin"]
    hoje["tmax_c"] = base["tmax_c"] + off["off_tmax"]
    hoje["et0_mm"] = et0_hargreaves(base["tmin_c"], base["tmax_c"])

    dl = deltas_nex()
    fut = pd.DataFrame(index=hoje.index)
    fut["chuva_mm"] = (hoje["chuva_mm"] + dl["delta_chuva_mm"]).clip(lower=0)
    fut["tmin_c"] = hoje["tmin_c"] + dl["delta_tmin_c"]
    fut["tmax_c"] = hoje["tmax_c"] + dl["delta_tmax_c"]
    fut["et0_mm"] = et0_hargreaves(base["tmin_c"] + dl["delta_tmin_c"], base["tmax_c"] + dl["delta_tmax_c"])

    corr = pd.concat([off, n, dl], axis=1)
    corr["et0_se_corrigisse"] = et0_hargreaves(hoje["tmin_c"], hoje["tmax_c"])

    for nome, df in [("clima_hoje", hoje), ("clima_futuro", fut), ("clima_correcoes", corr)]:
        df.index.name = "mes"
        df.round(2).to_csv(DADOS / f"{nome}.csv")

    print("Hoje:\n", hoje.round(1).to_string())
    print("\nFuturo:\n", fut.round(1).to_string())
    print("\nCorrecoes:\n", corr.round(2).to_string())
    print(f"\nAnual  hoje: chuva {hoje.chuva_mm.sum():.0f} mm, ET0 {hoje.et0_mm.sum():.0f} mm"
          f"  | futuro: chuva {fut.chuva_mm.sum():.0f} mm, ET0 {fut.et0_mm.sum():.0f} mm"
          f"  | ET0 se usasse a correcao A520: {corr.et0_se_corrigisse.sum():.0f} mm")


if __name__ == "__main__":
    main()
