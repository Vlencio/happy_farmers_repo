"""Puxa clima projetado (NEX-GDDP-CMIP6) para um ponto, agrega por mes e salva em CSV.

Uso: python scripts/puxar_nexgddp.py [lat] [lon]
Requer: pip install requests pandas

Baixa so o pixel do ponto (via THREDDS/NCSS), nao os arquivos globais.
Sao ~360 requisicoes pequenas; leva alguns minutos. Se cair no meio,
rode de novo: o que ja foi baixado fica em cache em data/nexgddp/cache/.
"""
import io
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd
import requests

BASE = "https://ds.nccs.nasa.gov/thredds/ncss/grid/AMES/NEX/GDDP-CMIP6"
MODELOS = ["MIROC6", "ACCESS-CM2", "MRI-ESM2-0"]  # todos r1i1p1f1 / gn
VARIAVEIS = ["pr", "tasmin", "tasmax"]
PERIODOS = {  # cenario: (ano_inicio, ano_fim)
    "historical": (1995, 2014),  # linha de base do proprio modelo
    "ssp245": (2041, 2060),  # futuro, emissoes intermediarias
}
SAIDA = Path(__file__).resolve().parent.parent / "data" / "nexgddp"
CACHE = SAIDA / "cache"


def baixar(modelo, cenario, var, ano, lat, lon):
    """Retorna a serie diaria (DataFrame) de uma variavel/ano no pixel do ponto."""
    arq = CACHE / f"{var}_{modelo}_{cenario}_{ano}_{lat}_{lon}.csv"
    if not arq.exists():
        nome = f"{var}_day_{modelo}_{cenario}_r1i1p1f1_gn_{ano}_v2.0.nc"
        url = f"{BASE}/{modelo}/{cenario}/r1i1p1f1/{var}/{nome}"
        params = {
            "var": var,
            "latitude": lat,
            "longitude": lon,
            "time_start": f"{ano}-01-01T00:00:00Z",
            "time_end": f"{ano}-12-31T23:59:59Z",
            "accept": "csv",
        }
        for tentativa in range(5):
            try:
                r = requests.get(url, params=params, timeout=180)
                r.raise_for_status()
                arq.write_text(r.text)
                break
            except requests.RequestException as e:
                if tentativa == 4:
                    raise RuntimeError(f"falhou: {nome} ({e})")
                time.sleep(5 * (tentativa + 1))
    df = pd.read_csv(io.StringIO(arq.read_text()))
    df.columns = ["data", "estacao", "lat_pixel", "lon_pixel", var]
    df["ano"] = df["data"].str[:4].astype(int)
    df["mes"] = df["data"].str[5:7].astype(int)
    df["modelo"], df["cenario"] = modelo, cenario
    return df[["modelo", "cenario", "ano", "mes", var]]


def puxar(lat, lon):
    CACHE.mkdir(parents=True, exist_ok=True)
    tarefas = [
        (m, c, v, a, lat, lon)
        for m in MODELOS
        for c, (ini, fim) in PERIODOS.items()
        for v in VARIAVEIS
        for a in range(ini, fim + 1)
    ]
    print(f"{len(tarefas)} requisicoes...")
    with ThreadPoolExecutor(max_workers=4) as ex:
        partes = list(ex.map(lambda t: baixar(*t), tarefas))

    chaves = ["modelo", "cenario", "ano", "mes"]
    mensal = None
    for var in VARIAVEIS:
        d = pd.concat([p for p in partes if var in p.columns])
        if var == "pr":  # kg m-2 s-1 -> mm/mes
            s = (d.groupby(chaves)[var].sum() * 86400).rename("chuva_mm")
        else:  # K -> graus C, media do mes
            s = (d.groupby(chaves)[var].mean() - 273.15).rename(
                {"tasmin": "tmin_c", "tasmax": "tmax_c"}[var]
            )
        mensal = s.to_frame() if mensal is None else mensal.join(s)
    return mensal.round(2).reset_index()


if __name__ == "__main__":
    a = sys.argv[1:]
    lat = float(a[0]) if len(a) > 0 else -20.032  # talhao demo
    lon = float(a[1]) if len(a) > 1 else -48.526

    df = puxar(lat, lon)
    arquivo = SAIDA / f"nexgddp_{lat}_{lon}.csv"
    df.to_csv(arquivo, index=False)
    print(df.groupby("cenario")[["chuva_mm", "tmin_c", "tmax_c"]].mean().round(2))
    print(f"\n{len(df)} linhas salvas em {arquivo}")
