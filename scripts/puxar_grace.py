"""Puxa o GRACE/GRACE-FO (mascons da CSR) e monta a serie mensal de agua armazenada em Minas Gerais.

Uso: python scripts/puxar_grace.py           (baixa ~114 MB se faltar, depois extrai)
     python scripts/puxar_grace.py --arquivo CAMINHO.nc   (usa um NetCDF ja baixado)
Requer: pip install requests pandas numpy xarray h5netcdf h5py

Fonte: CSR RL06.3 mascons, GRACE e GRACE-FO, abril de 2002 em diante. Arquivo publico,
sem login. Grade de 0,25 grau, mas a resolucao real e a do mascon (~1 grau, cerca de
110 km) e o sinal so e confiavel em areas de centenas de km. E contexto regional,
nao dado do talhao.

Variavel: lwe_thickness, anomalia de agua armazenada (solo, subsolo, aquiferos, rios,
reservatorios), em cm de lamina d'agua, em relacao a media 2004-2009.

Saida: data/grace/grace_mg.csv, um mes por linha:
- data: meio do periodo de cada solucao (as solucoes nao sao meses-calendario exatos);
- lwe_cm_mg: media em MG, ponderada pela area de cada quadrado (cos da latitude);
- lwe_cm_celula_demo: o quadrado de 0,25 grau do talhao de demonstracao (mesmo sinal
  regional, so para conferencia).
Ha meses faltando: a lacuna entre as missoes (jul/2017 a mai/2018) e meses isolados.
O arquivo bruto fica em data/grace/bruto/, fora do Git.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
BRUTO = RAIZ / "data" / "grace" / "bruto"
SAIDA = RAIZ / "data" / "grace" / "grace_mg.csv"
LIMITE_MG = RAIZ / "backend" / "geo" / "minas_gerais.geojson"
URL = (
    "https://download.csr.utexas.edu/outgoing/grace/RL0603_mascons/"
    "CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc"
)
PONTO_DEMO = (-20.032, -48.526)


def baixar(destino=BRUTO / Path(URL).name):
    """Baixa o NetCDF se ainda nao existe. Devolve o caminho."""
    import requests

    if destino.exists():
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(".part")
    with requests.get(URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(parcial, "wb") as f:
            for bloco in r.iter_content(1 << 20):
                f.write(bloco)
    with open(parcial, "rb") as f:
        if not f.read(4) in (b"\x89HDF", b"CDF\x01", b"CDF\x02"):
            raise SystemExit(f"{parcial} nao e NetCDF: confira a URL")
    parcial.replace(destino)
    return destino


def dentro_de_mg(lat, lon, limite=LIMITE_MG):
    """Mascara (lat x lon) com os centros de quadrado dentro do poligono de MG."""
    geo = json.loads(Path(limite).read_text(encoding="utf-8"))
    itens = geo["features"] if geo.get("type") == "FeatureCollection" else [geo]
    poligonos = []
    for g in (i.get("geometry", i) for i in itens):
        poligonos += g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    lo, la = np.meshgrid(lon, lat)
    mascara = np.zeros(lo.shape, bool)
    for poligono in poligonos:
        fora = ~_no_anel(lo, la, poligono[0])
        for buraco in poligono[1:]:
            fora |= _no_anel(lo, la, buraco)
        mascara |= ~fora
    return mascara


def _no_anel(x, y, anel):
    """Ray casting vetorizado: True nos pontos dentro do anel."""
    dentro = np.zeros(x.shape, bool)
    a = np.asarray(anel)
    for (x1, y1), (x2, y2) in zip(a, np.roll(a, -1, axis=0)):
        cruza = (y1 > y) != (y2 > y)
        with np.errstate(divide="ignore", invalid="ignore"):
            xc = (x2 - x1) * (y - y1) / (y2 - y1) + x1
        dentro ^= cruza & (x < xc)
    return dentro


def montar(arquivo, limite=LIMITE_MG):
    import xarray as xr

    # h5netcdf com o arquivo aberto pelo Python: a biblioteca C do netCDF4 nao abre
    # caminhos com acento no Windows (o repositorio fica em "Area de Trabalho").
    # O arquivo da CSR grava a unidade como "Units" (U maiusculo): o xarray nao decodifica o
    # tempo sozinho. Le sem decodificar e converte a mao.
    with open(arquivo, "rb") as f, xr.open_dataset(f, engine="h5netcdf", decode_times=False) as ds:
        nome = next((v for v in ds.data_vars if "lwe" in v.lower()), None)
        if nome is None:
            raise SystemExit(f"nenhuma variavel lwe_* em {arquivo}: {list(ds.data_vars)}")
        da = ds[nome]
        unidade = da.attrs.get("units", da.attrs.get("Units", "?"))
        tempo = ds["time"].attrs.get("units", ds["time"].attrs.get("Units", ""))
        if not tempo.startswith("days since "):
            raise SystemExit(f"unidade de tempo inesperada: '{tempo}'")
        origem = pd.Timestamp(tempo.removeprefix("days since ")).tz_localize(None)
        da = da.assign_coords(lon=((da["lon"] + 180) % 360) - 180).sortby("lon")  # 0-360 -> -180-180
        # recorte com folga antes de carregar (o arquivo inteiro tem ~1 GB na memoria):
        # MG fica entre lat -23 e -14, lon -51,1 e -39,8
        da = da.sel(lat=slice(*sorted((-23.5, -13.5), reverse=bool(da["lat"][0] > da["lat"][-1]))), lon=slice(-51.5, -39.5)).load()
    da = da.assign_coords(time=origem + pd.to_timedelta(da["time"].values, unit="D"))
    if unidade not in ("cm", "centimeters"):
        print(f"  aviso: unidade de {nome} e '{unidade}', nao cm")
    mascara = dentro_de_mg(da["lat"].values, da["lon"].values, limite)
    if not mascara.any():
        raise SystemExit("nenhum quadrado do GRACE dentro de MG: confira o recorte")
    peso = xr.DataArray(np.cos(np.radians(da["lat"].values))[:, None] * mascara, coords={"lat": da["lat"], "lon": da["lon"]})
    peso_valido = peso.where(da.notnull(), 0)  # mes sem solucao: NaN, nao zero
    mg = (da * peso).sum(["lat", "lon"], min_count=1) / peso_valido.sum(["lat", "lon"]).where(lambda p: p > 0)
    demo = da.sel(lat=PONTO_DEMO[0], lon=PONTO_DEMO[1], method="nearest")
    df = pd.DataFrame({
        "data": pd.to_datetime(da["time"].values).strftime("%Y-%m-%d"),
        "lwe_cm_mg": mg.values,
        "lwe_cm_celula_demo": demo.values,
    }).round(2)  # fmt: skip
    print(f"  {nome} ({unidade}), {int(mascara.sum())} quadrados de 0,25 grau em MG")
    return df.dropna(subset=["lwe_cm_mg"]).reset_index(drop=True)


if __name__ == "__main__":
    arq = Path(sys.argv[sys.argv.index("--arquivo") + 1]) if "--arquivo" in sys.argv else baixar()
    df = montar(arq)
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(SAIDA, index=False)
    datas = pd.to_datetime(df["data"])
    print(f"\n{len(df)} meses, {df['data'].iloc[0]} a {df['data'].iloc[-1]}, salvos em {SAIDA}")
    anual = df.groupby(datas.dt.year)["lwe_cm_mg"].agg(["mean", "size"]).round(2)
    print("\nmedia anual em MG (cm) e meses com dado:\n" + anual.to_string())
