"""Resume o NEX-GDDP do retangulo em uma tabela pequena: a mudanca do clima por quadrado e mes.

Uso: python scripts/montar_nex_regiao.py
Requer: pip install pandas numpy xarray netCDF4

Le os NetCDF de data/nexgddp/regiao_mg/bruto/ (puxar_nexgddp_regiao.py) e grava
data/nexgddp/regiao_mg/delta_mensal.csv, com uma linha por quadrado e mes:
ssp245 (2041-2060) menos historical (1995-2014), por modelo, e depois a media dos
modelos. E o mesmo metodo de montar_clima.py, que faz isso para um ponto so.

Colunas: lat, lon (centro do quadrado de 0,25 grau), mes, delta_chuva_mm,
delta_tmin_c, delta_tmax_c e delta_dias_acima_NN para cada limiar de calor
(os de temp_calor_c em culturas.csv, mais o geral de 35).
"""
from pathlib import Path

import pandas as pd
import xarray as xr

from puxar_nexgddp import MODELOS, PERIODOS

RAIZ = Path(__file__).resolve().parent.parent
PASTA = RAIZ / "data" / "nexgddp" / "regiao_mg"
CULTURAS = RAIZ / "data" / "culturas.csv"
CORRECOES = RAIZ / "data" / "clima_correcoes.csv"
LIMIAR_GERAL_C = 35
PONTO_DEMO = (-20.125, -48.625)  # quadrado do talhao de demonstracao, para conferir


def limiares_de_calor():
    lim = {LIMIAR_GERAL_C}
    if CULTURAS.exists():
        lim |= {int(v) for v in pd.read_csv(CULTURAS)["temp_calor_c"].dropna()}
    return sorted(lim)


def media_mensal(bruto, modelo, cenario, anos, limiares):
    """Media, entre os anos, do valor de cada mes: um Dataset (month, lat, lon).

    Chuva e o total do mes; temperaturas sao a media dos dias; dias_acima_NN e a
    contagem de dias do mes com maxima acima do limiar. Quadrado sem dado (mar) fica NaN.
    """
    por_ano = []
    for ano in anos:
        campos = {}
        for var in ("pr", "tasmin", "tasmax"):
            arq = bruto / f"{var}_{modelo}_{cenario}_{ano}.nc"
            if not arq.exists():
                raise SystemExit(f"falta {arq.name}: rode scripts/puxar_nexgddp_regiao.py")
            with xr.open_dataset(arq) as ds:
                campos[var] = ds[var].load()
        mes = "time.month"
        tmax_c = campos["tasmax"] - 273.15
        d = xr.Dataset({
            "chuva_mm": (campos["pr"] * 86400).groupby(mes).sum(min_count=1),  # kg m-2 s-1 -> mm no mes
            "tmin_c": (campos["tasmin"] - 273.15).groupby(mes).mean(),
            "tmax_c": tmax_c.groupby(mes).mean(),
        })
        for lim in limiares:
            quente = (tmax_c > lim).where(tmax_c.notnull())
            d[f"dias_acima_{lim}"] = quente.groupby(mes).sum(min_count=1)
        por_ano.append(d)
    return xr.concat(por_ano, dim="ano").mean("ano")


def montar(bruto, modelos=MODELOS, periodos=PERIODOS, limiares=None):
    """DataFrame com o delta (ssp245 - historical) por quadrado e mes, media dos modelos."""
    limiares = limiares_de_calor() if limiares is None else limiares
    deltas = []
    for modelo in modelos:
        m = {c: media_mensal(Path(bruto), modelo, c, range(ini, fim + 1), limiares) for c, (ini, fim) in periodos.items()}
        deltas.append(m["ssp245"] - m["historical"])
        print(f"  {modelo} ok")
    delta = xr.concat(deltas, dim="modelo").mean("modelo")

    df = delta.to_dataframe().reset_index().rename(columns={"month": "mes"})
    df = df.dropna(subset=["tmax_c"])  # tira os quadrados de mar
    df["lon"] = ((df["lon"] + 180) % 360) - 180  # os arquivos usam 0 a 360
    df = df.rename(columns={c: f"delta_{c}" for c in df.columns if c not in ("lat", "lon", "mes")})
    return df.sort_values(["lat", "lon", "mes"]).round(3).reset_index(drop=True)


def conferir(df):
    """Compara o quadrado do talhao de demonstracao com os deltas de montar_clima.py."""
    if not CORRECOES.exists():
        return
    lat, lon = PONTO_DEMO
    aqui = df[(df["lat"].sub(lat).abs() < 0.01) & (df["lon"].sub(lon).abs() < 0.01)].set_index("mes")
    if len(aqui) != 12:
        print(f"\nquadrado do talhao de demonstracao {PONTO_DEMO} nao esta na tabela: confira o retangulo")
        return
    ref = pd.read_csv(CORRECOES).set_index("mes")
    print("\nconferencia no quadrado do talhao de demonstracao (maior diferenca contra clima_correcoes.csv):")
    for col in ("delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"):
        print(f"  {col}: {(aqui[col] - ref[col]).abs().max():.3f}")


if __name__ == "__main__":
    tabela = montar(PASTA / "bruto")
    saida = PASTA / "delta_mensal.csv"
    tabela.to_csv(saida, index=False)
    print(f"\n{tabela[['lat', 'lon']].drop_duplicates().shape[0]} quadrados, {len(tabela)} linhas salvas em {saida}")
    conferir(tabela)
