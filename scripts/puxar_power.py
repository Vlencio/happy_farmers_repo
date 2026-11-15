"""Puxa clima diario do NASA POWER para um ponto, agrega por mes e salva em CSV.

Uso: python scripts/puxar_power.py [lat] [lon] [ano_inicio] [ano_fim]
Requer: pip install requests pandas

Salva dois arquivos: o mensal e o diario (chuva e temperaturas), usado para
contar dias quentes. Usa o endpoint diario e tira a media por mes. No endpoint mensal, T2M_MAX e
T2M_MIN sao os extremos do mes, nao a media das maximas e minimas diarias,
e isso infla o ET0 por Hargreaves.
"""
import sys
from pathlib import Path

import pandas as pd
import requests

URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
# GWET*: umidade do solo, de 0 (seco) a 1 (saturado). Vao so para o arquivo mensal.
PARAMS = [
    "PRECTOTCORR", "T2M", "T2M_MAX", "T2M_MIN", "ALLSKY_SFC_SW_DWN", "RH2M", "WS2M",
    "GWETTOP", "GWETROOT", "GWETPROF",
]  # fmt: skip
SAIDA = Path(__file__).resolve().parent.parent / "data" / "power"


def puxar(lat, lon, inicio, fim):
    r = requests.get(
        URL,
        params={
            "parameters": ",".join(PARAMS),
            "community": "AG",
            "latitude": lat,
            "longitude": lon,
            "start": f"{inicio}0101",
            "end": f"{fim}1231",
            "format": "JSON",
        },
        timeout=300,
    )
    r.raise_for_status()
    resposta = r.json()
    for nome, info in resposta.get("parameters", {}).items():
        print(f"{nome}: {info.get('units')}")  # confere as unidades

    df = pd.DataFrame(resposta["properties"]["parameter"])  # indice = "AAAAMMDD", colunas = parametros
    df = df.replace(-999, float("nan"))  # -999 = sem dado
    datas = pd.to_datetime(df.index, format="%Y%m%d")
    diario = df[["PRECTOTCORR", "T2M", "T2M_MAX", "T2M_MIN"]].set_axis(datas).rename_axis("data")
    mensal = df.groupby([datas.year, datas.month]).mean()  # media dos dias do mes
    mensal.index.names = ["ano", "mes"]
    mensal = mensal.reset_index()
    dias = pd.to_datetime({"year": mensal["ano"], "month": mensal["mes"], "day": 1}).dt.days_in_month
    mensal["chuva_mm"] = mensal["PRECTOTCORR"] * dias  # mm/dia -> mm no mes
    return mensal.round(2), diario.round(2)


if __name__ == "__main__":
    a = sys.argv[1:]
    lat = float(a[0]) if len(a) > 0 else -20.032  # talhao demo
    lon = float(a[1]) if len(a) > 1 else -48.526
    inicio = int(a[2]) if len(a) > 2 else 2005
    fim = int(a[3]) if len(a) > 3 else 2024

    df, diario = puxar(lat, lon, inicio, fim)
    SAIDA.mkdir(parents=True, exist_ok=True)
    arquivo = SAIDA / f"power_{lat}_{lon}_{inicio}_{fim}.csv"
    df.to_csv(arquivo, index=False)
    diario.to_csv(SAIDA / f"power_diario_{lat}_{lon}_{inicio}_{fim}.csv")  # dias quentes em montar_clima.py
    print(df.head(12))
    print(f"\n{len(df)} meses salvos em {arquivo}")
