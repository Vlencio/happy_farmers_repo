"""Textura do solo sugerida por quadrado, a partir dos parametros de solo do GLDAS2/Noah (NASA).

Uso: python scripts/montar_solo_mg.py
Requer: pip install numpy netCDF4

Le os dois NetCDF de data/solo/bruto/ (puxar_solo.py) e grava
data/solo/regiao_mg/textura.csv, uma linha por quadrado de 0,25 grau do mesmo
retangulo de data/nexgddp/regiao_mg/delta_mensal.csv (mesmos centros de quadrado).

Colunas: lat, lon (centro do quadrado), em_mg (1 se o centro cai em Minas Gerais),
argila_pct, areia_pct, silte_pct, classe_gldas (classe de textura do Noah, 16 categorias
da FAO), textura (arenoso, medio ou argiloso, as tres classes do motor) e fonte.

A textura sai da fracao de argila, pelos cortes do ZARC antigo: arenoso abaixo de 15%,
medio de 15 a 35%, argiloso acima de 35%. Quadrado sem fracao (agua) fica fora.

E sugestao para o produtor confirmar: o quadrado tem ~27 km e as fracoes vem do mapa de
solos da FAO (Reynolds et al. 2000, camada de 0 a 30 cm), reamostrado para 0,25 grau.
"""
import csv
import json
from pathlib import Path

import netCDF4
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
BRUTO = RAIZ / "data" / "solo" / "bruto"
SAIDA = RAIZ / "data" / "solo" / "regiao_mg" / "textura.csv"
MASCARA_MG = RAIZ / "backend" / "geo" / "minas_gerais.geojson"
ARQ_FRACAO = "GLDASp4_soilfraction_025d.nc4"
ARQ_TEXTURA = "GLDASp5_soiltexture_025d.nc4"
RETANGULO = (-23.5, -13.25, -51.5, -39.25)  # lat min, lat max, lon min, lon max: o de delta_mensal.csv
PONTO_DEMO = (-20.125, -48.625)  # quadrado do talhao de demonstracao, para conferir
FONTE = "GLDAS2/Noah (NASA LDAS), 0,25 grau"
ARGILA_ARENOSO_PCT = 15
ARGILA_ARGILOSO_PCT = 35
CLASSES_GLDAS = {
    1: "sand", 2: "loamy sand", 3: "sandy loam", 4: "silt loam", 5: "silt", 6: "loam",
    7: "sandy clay loam", 8: "silty clay loam", 9: "clay loam", 10: "sandy clay",
    11: "silty clay", 12: "clay", 13: "organic materials", 14: "water", 15: "bedrock", 16: "other",
}
COLUNAS = ["lat", "lon", "em_mg", "argila_pct", "areia_pct", "silte_pct", "classe_gldas", "textura", "fonte"]


def textura_por_argila(argila_pct):
    if argila_pct < ARGILA_ARENOSO_PCT:
        return "arenoso"
    if argila_pct > ARGILA_ARGILOSO_PCT:
        return "argiloso"
    return "medio"


def ler_campos(caminho, variaveis):
    """Le o recorte do retangulo: (lats, lons, {variavel: matriz com NaN onde nao ha dado}).

    O arquivo e lido da memoria porque a biblioteca do NetCDF nao abre caminhos com acento no Windows.
    """
    if not caminho.exists():
        raise SystemExit(f"falta {caminho.name}: rode scripts/puxar_solo.py")
    lat_min, lat_max, lon_min, lon_max = RETANGULO
    with netCDF4.Dataset("memoria", memory=caminho.read_bytes()) as nc:
        nc.set_auto_mask(False)
        lats, lons = nc["lat"][:].astype(float), nc["lon"][:].astype(float)
        i = np.where((lats > lat_min) & (lats < lat_max))[0]
        j = np.where((lons > lon_min) & (lons < lon_max))[0]
        campos = {}
        for var in variaveis:
            m = nc[var][0, i[0]:i[-1] + 1, j[0]:j[-1] + 1].astype(float)
            m[m < 0] = np.nan  # -9999 = sem dado
            campos[var] = m
    return lats[i], lons[j], campos


def aneis_mg(caminho=MASCARA_MG):
    geo = json.loads(caminho.read_text(encoding="utf-8"))["features"][0]["geometry"]
    poligonos = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
    return [anel for pol in poligonos for anel in pol]


def dentro(lat, lon, aneis):
    """Ponto em poligono (regra par-impar; os buracos entram como aneis)."""
    dentro_ = False
    for anel in aneis:
        for (x1, y1), (x2, y2) in zip(anel, anel[1:]):
            if (y1 > lat) != (y2 > lat) and lon < x1 + (lat - y1) * (x2 - x1) / (y2 - y1):
                dentro_ = not dentro_
    return dentro_


def montar(bruto=BRUTO, aneis=None):
    aneis = aneis_mg() if aneis is None else aneis
    nomes = {p: f"GLDAS_soilfraction_{p}" for p in ("clay", "sand", "silt")}
    lats, lons, fr = ler_campos(bruto / ARQ_FRACAO, nomes.values())
    lats_t, lons_t, tex = ler_campos(bruto / ARQ_TEXTURA, ["GLDAS_soiltex"])
    if not (np.allclose(lats, lats_t) and np.allclose(lons, lons_t)):
        raise SystemExit("os dois arquivos do GLDAS nao estao na mesma grade")
    linhas = []
    for i, lat in enumerate(lats):
        for j, lon in enumerate(lons):
            argila, areia, silte = (fr[nomes[p]][i, j] * 100 for p in ("clay", "sand", "silt"))
            if np.isnan(argila):
                continue
            classe = tex["GLDAS_soiltex"][i, j]
            linhas.append({
                "lat": round(lat, 3), "lon": round(lon, 3), "em_mg": int(dentro(lat, lon, aneis)),
                "argila_pct": round(argila, 1), "areia_pct": round(areia, 1), "silte_pct": round(silte, 1),
                "classe_gldas": "" if np.isnan(classe) else CLASSES_GLDAS.get(int(round(classe)), ""),
                "textura": textura_por_argila(argila), "fonte": FONTE,
            })
    return linhas


def gravar(linhas, saida=SAIDA):
    saida.parent.mkdir(parents=True, exist_ok=True)
    with saida.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUNAS)
        w.writeheader()
        w.writerows(linhas)


def main():
    linhas = montar()
    gravar(linhas)
    mg = [l for l in linhas if l["em_mg"]]
    print(f"gravado {SAIDA.relative_to(RAIZ)}: {len(linhas)} quadrados, {len(mg)} em MG")
    for t in ("arenoso", "medio", "argiloso"):
        print(f"  {t}: {sum(l['textura'] == t for l in mg)} quadrados em MG")
    demo = next((l for l in linhas if (l["lat"], l["lon"]) == PONTO_DEMO), None)
    if demo is None:
        print("quadrado do talhao de demonstracao sem dado")
    else:
        print(f"talhao de demonstracao {PONTO_DEMO}: {demo['textura']} "
              f"(argila {demo['argila_pct']}%, classe GLDAS {demo['classe_gldas']})")
        if demo["textura"] != "argiloso":
            print("  ATENCAO: diferente do padrao do motor (argiloso). Avisar o Pedro.")


if __name__ == "__main__":
    main()
