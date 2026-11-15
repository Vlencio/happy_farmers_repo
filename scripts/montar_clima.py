"""Monta as duas tabelas de clima do motor (12 linhas cada, uma por mes).

Uso: python scripts/montar_clima.py
Requer: pip install pandas numpy

- clima_hoje.csv:   POWER 2005-2024 em media por mes, com Tmin e Tmax corrigidos
                    pela estacao INMET A520 (Conceicao das Alagoas, 40 km do talhao).
- clima_futuro.csv: hoje + (NEX-GDDP ssp245 2041-2060 - historical 1995-2014),
                    diferenca calculada por modelo e mes e depois media dos 3 modelos.
                    Chuva: hoje x (ssp245 / historical), nao a soma (ver razao_chuva_nex).
- clima_seco.csv:   o ano agricola (jul-jun) com menos chuva no POWER 2005-2024.
                    Ano real, mesmo formato das outras; mostra o que a media esconde.
- clima_correcoes.csv: os offsets da A520 e os deltas do NEX, para conferencia.
                    scripts/clima_ponto.py le os deltas daqui para outros pontos.
- clima_modelos.csv: os mesmos deltas do NEX antes da media, um por modelo e mes.
                    Mostra a faixa entre os modelos (backend/field_context.py).

ET0 por Hargreaves (FAO-56 eq. 52), igual nos dois lados, calculado com as
temperaturas do POWER SEM a correcao da A520 (+ deltas do NEX no futuro). Motivo:
com o POWER bruto, Hargreaves da 1.635 mm/ano, igual ao Penman-Monteith do POWER
(1.640 mm); com a correcao a amplitude termica cresce e o ET0 sobe ~9%, quase todo
nos meses umidos, onde Hargreaves ja tende a superestimar. A correcao vale para
tmin_c/tmax_c (encaixe das culturas), nao para o ET0.
A chuva do POWER nao e corrigida: no talhao o vies contra a A520 e de ~-5% (r = 0,90).

dias_quentes: media de dias por mes com maxima acima de LIMIAR_CALOR_C.
- hoje: POWER diario 2005-2024, com a correcao da A520 no Tmax de cada mes;
- futuro: os mesmos dias do POWER, com a Tmax de cada dia somada ao delta_tmax_c do
  mes (e a correcao da A520). E o que o modo diario do motor faz. O delta de contagem
  do NEX (dias no ssp245 - dias no historical) fica em clima_correcoes.csv, so para
  conferencia: somado a contagem de hoje ele dava mais dias quentes.
A media mensal da temperatura esconde o calor; esta coluna mostra quantos dias
passam do limiar. POWER hoje (34/ano) e NEX historico (33/ano) quase coincidem.
Alem de dias_quentes (limiar geral), sai uma coluna dias_acima_NN por grau, de 26 a
40, mais os limiares de temp_calor_c de culturas.csv que cairem fora dessa faixa.
"""
import glob
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"
POWER = DADOS / "power" / "power_-20.032_-48.526_2005_2024.csv"
POWER_DIARIO = DADOS / "power" / "power_diario_-20.032_-48.526_2005_2024.csv"
NEX = DADOS / "nexgddp" / "nexgddp_-20.032_-48.526.csv"
NEX_CACHE = DADOS / "nexgddp" / "cache"
INMET = DADOS / "inmet" / "a520_vs_power_mensal.csv"
CULTURAS = DADOS / "culturas.csv"
LAT, LON = -20.032, -48.526
LIMIAR_CALOR_C = 35.0  # maxima diaria acima disso = dia quente (convencao, ver docs/colunas_dados.md)
LIMIARES_GRAU = range(26, 41)  # uma coluna dias_acima_NN por grau: o ajuste de temperatura do motor nao interpola
DIAS_INT = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
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


def et0_hargreaves(tmin, tmax, lat=LAT):
    """ET0 mensal (mm) por Hargreaves; tmin/tmax indexados por mes 1..12."""
    tmed = (tmin + tmax) / 2
    diario = 0.0023 * ra_mm_dia(lat) * (tmed + 17.8) * np.sqrt((tmax - tmin).clip(lower=0))
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


def deltas_por_modelo():
    """(media ssp245 2041-2060 - media historical 1995-2014) por modelo e mes."""
    n = pd.read_csv(NEX)
    d = n.groupby(["modelo", "cenario", "mes"])[["chuva_mm", "tmin_c", "tmax_c"]].mean().unstack("cenario")
    delta = pd.DataFrame({v: d[(v, "ssp245")] - d[(v, "historical")] for v in ["chuva_mm", "tmin_c", "tmax_c"]})
    return delta.add_prefix("delta_")


def deltas_nex():
    """Media dos 3 modelos, por mes: e o delta usado em clima_futuro."""
    return deltas_por_modelo().groupby("mes").mean()


def razao_chuva_nex():
    """Chuva do ssp245 / chuva do historical, por mes, com a media dos 3 modelos em cada lado.

    Os modelos sao ~20% mais umidos que o POWER; a razao leva a mudanca relativa, e nao os
    milimetros do modelo. Razao das medias, e nao media das razoes: nos meses secos a razao
    de um modelo sozinho vai de 0,5 a 1,5.
    """
    n = pd.read_csv(NEX)
    m = n.groupby(["modelo", "cenario", "mes"])["chuva_mm"].mean().groupby(["cenario", "mes"]).mean()
    return (m["ssp245"] / m["historical"]).rename("razao_chuva")


def limiares_de_calor():
    """Limiares (graus C) a contar: um por grau, o geral e os de temp_calor_c em culturas.csv."""
    lim = {int(LIMIAR_CALOR_C), *LIMIARES_GRAU}
    if CULTURAS.exists():
        lim |= {int(v) for v in pd.read_csv(CULTURAS)["temp_calor_c"].dropna()}
    return sorted(lim)


def dias_quentes_power(off_tmax, limiares):
    """Media de dias por mes com Tmax (corrigida pela A520) acima de cada limiar."""
    return contar_dias_quentes(pd.read_csv(POWER_DIARIO, parse_dates=["data"]), off_tmax, limiares)


def contar_dias_quentes(d, off_tmax, limiares):
    """O mesmo, para qualquer serie diaria do POWER. off_tmax: graus somados a Tmax, por mes
    (correcao da estacao, delta do futuro ou os dois); None = nada."""
    tmax = d["T2M_MAX"] if off_tmax is None else d["T2M_MAX"] + d["data"].dt.month.map(off_tmax)
    chaves = [d["data"].dt.year, d["data"].dt.month]
    return pd.DataFrame({
        lim: (tmax > lim).groupby(chaves).sum().groupby(level=1).mean() for lim in limiares
    }).rename_axis("mes")


def delta_dias_quentes_nex(limiares):
    """(dias quentes no ssp245 - no historical) por mes e limiar, media dos 3 modelos.

    Devolve tambem os dias por ano de cada cenario, para conferencia.
    """
    partes = []
    for arq in glob.glob(str(NEX_CACHE / f"tasmax_*_{LAT}_{LON}.csv")):
        _, modelo, cenario, ano = Path(arq).stem.split("_")[:4]
        d = pd.read_csv(arq)
        t = d.iloc[:, -1] - 273.15  # K -> graus C
        parte = pd.DataFrame({lim: t > lim for lim in limiares})
        parte["modelo"], parte["cenario"], parte["ano"] = modelo, cenario, int(ano)
        parte["mes"] = d.iloc[:, 0].str[5:7].astype(int)
        partes.append(parte)
    if not partes:
        raise SystemExit(f"nenhum arquivo tasmax em {NEX_CACHE}")
    x = pd.concat(partes)
    n = x.groupby(["modelo", "cenario", "ano", "mes"])[limiares].sum().groupby(["modelo", "cenario", "mes"]).mean()
    delta = n.xs("ssp245", level="cenario") - n.xs("historical", level="cenario")
    por_ano = n.groupby(["modelo", "cenario"]).sum().groupby("cenario").mean()
    return delta.groupby("mes").mean(), por_ano


def colunas_de_calor(contagem):
    """dias_quentes (limiar geral) + uma coluna dias_acima_NN por limiar."""
    out = pd.DataFrame({"dias_quentes": contagem[int(LIMIAR_CALOR_C)]})
    for lim in contagem.columns:
        out[f"dias_acima_{lim}"] = contagem[lim]
    return out


def ano_seco(p, off, limiares):
    """Tabela de 12 meses do ano agricola (jul-jun) com menos chuva no POWER.

    E um ano real, nao uma media: chuva, temperaturas e dias quentes sao os daquele
    ano, com as mesmas correcoes e o mesmo metodo de ET0 da tabela de hoje.
    Devolve (tabela, rotulo do ano, chuva de cada ano agricola).
    """
    p = p.assign(safra=np.where(p["mes"] >= 7, p["ano"], p["ano"] - 1))
    completos = p.groupby("safra").filter(lambda g: len(g) == 12)
    chuva = completos.groupby("safra")["chuva_mm"].sum()
    y = int(chuva.idxmin())
    a = completos[completos["safra"] == y].set_index("mes").sort_index()

    seco = pd.DataFrame(index=a.index)
    seco["chuva_mm"] = a["chuva_mm"]
    seco["tmin_c"] = a["T2M_MIN"] + off["off_tmin"]
    seco["tmax_c"] = a["T2M_MAX"] + off["off_tmax"]
    seco["et0_mm"] = et0_hargreaves(a["T2M_MIN"], a["T2M_MAX"])

    d = pd.read_csv(POWER_DIARIO, parse_dates=["data"])
    d = d[((d["data"].dt.year == y) & (d["data"].dt.month >= 7)) | ((d["data"].dt.year == y + 1) & (d["data"].dt.month <= 6))]
    tmax = d["T2M_MAX"] + d["data"].dt.month.map(off["off_tmax"])
    contagem = pd.DataFrame({lim: (tmax > lim).groupby(d["data"].dt.month).sum() for lim in limiares})
    seco = seco.join(colunas_de_calor(contagem.rename_axis("mes")))
    return seco, f"{y}/{str(y + 1)[2:]}", chuva


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
    razao = razao_chuva_nex()
    fut["chuva_mm"] = hoje["chuva_mm"] * razao
    fut["tmin_c"] = hoje["tmin_c"] + dl["delta_tmin_c"]
    fut["tmax_c"] = hoje["tmax_c"] + dl["delta_tmax_c"]
    fut["et0_mm"] = et0_hargreaves(base["tmin_c"] + dl["delta_tmin_c"], base["tmax_c"] + dl["delta_tmax_c"])

    limiares = limiares_de_calor()
    cont_hoje = dias_quentes_power(off["off_tmax"], limiares)
    # futuro: os mesmos dias do POWER, com a Tmax de cada dia deslocada pelo delta do mes
    cont_fut = dias_quentes_power(off["off_tmax"] + dl["delta_tmax_c"], limiares)
    delta_calor, nex_ano = delta_dias_quentes_nex(limiares)  # so para conferencia
    hoje = hoje.join(colunas_de_calor(cont_hoje))
    fut = fut.join(colunas_de_calor(cont_fut))
    dl["delta_dias_quentes"] = delta_calor[int(LIMIAR_CALOR_C)]
    for lim in limiares:  # delta de contagem do NEX: conferencia, nao entra no futuro
        dl[f"delta_dias_acima_{lim}"] = delta_calor[lim]
    dl["razao_chuva"] = razao

    corr = pd.concat([off, n, dl], axis=1).copy()
    corr["et0_se_corrigisse"] = et0_hargreaves(hoje["tmin_c"], hoje["tmax_c"])

    seco, rotulo_seco, chuva_safras = ano_seco(p, off, limiares)

    for nome, df in [("clima_hoje", hoje), ("clima_futuro", fut), ("clima_seco", seco), ("clima_correcoes", corr)]:
        df.index.name = "mes"
        casas = {c: 4 if c == "razao_chuva" else 2 for c in df.columns}  # 2 casas na razao mudariam ate 1 mm
        df.round(casas).to_csv(DADOS / f"{nome}.csv")
    por_modelo = deltas_por_modelo()
    por_modelo.round(2).reset_index().to_csv(DADOS / "clima_modelos.csv", index=False)

    print("Hoje:\n", hoje.round(1).to_string())
    print("\nFuturo:\n", fut.round(1).to_string())
    print("\nCorrecoes:\n", corr.round(2).to_string())
    print(f"\nAnual  hoje: chuva {hoje.chuva_mm.sum():.0f} mm, ET0 {hoje.et0_mm.sum():.0f} mm"
          f"  | futuro: chuva {fut.chuva_mm.sum():.0f} mm, ET0 {fut.et0_mm.sum():.0f} mm"
          f"  | ET0 se usasse a correcao A520: {corr.et0_se_corrigisse.sum():.0f} mm")
    print(f"Dias com maxima > {LIMIAR_CALOR_C:.0f} C por ano  hoje: {hoje.dias_quentes.sum():.1f}"
          f"  | futuro: {fut.dias_quentes.sum():.1f}")
    print("Dias por ano acima de cada limiar:")
    for lim in limiares:
        print(f"  > {lim} C  POWER hoje {cont_hoje[lim].sum():5.1f} | NEX historico {nex_ano.loc['historical', lim]:5.1f}"
              f" | futuro {cont_fut[lim].sum():5.1f} (pelo delta de contagem do NEX: {(cont_hoje[lim] + delta_calor[lim]).clip(lower=0).sum():5.1f})"
              f" | ano seco {seco[f'dias_acima_{lim}'].sum():5.0f}")
    print(f"\nAno seco: safra {rotulo_seco} (jul-jun), chuva {seco.chuva_mm.sum():.0f} mm, ET0 {seco.et0_mm.sum():.0f} mm,"
          f" {seco.dias_quentes.sum():.0f} dias quentes. Media das safras: {chuva_safras.mean():.0f} mm")
    print("Chuva por ano agricola (mm):", {f"{y}/{str(y + 1)[2:]}": round(v) for y, v in chuva_safras.sort_values().items()})
    print(seco.round(1).to_string())


if __name__ == "__main__":
    main()
