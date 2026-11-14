"""Processa o AppEEARS do talhao (MOD13Q1 NDVI + SRTMGL1) e salva em data/talhao/.

Uso: python scripts/processar_appeears.py
Requer: pip install pandas numpy xarray netCDF4 matplotlib

Saidas:
  ndvi_16d.csv           serie de 16 dias (media do talhao, so pixels bons)
  ndvi_mensal.csv        serie mensal + flag de solo descoberto (timeline)
  ndvi_climatologia.csv  NDVI medio por mes do ano e frequencia de solo descoberto
  declividade.csv        altitude e declividade do talhao (SRTM 30 m)

Adaptado de scripts/appeears_process.py do projeto de exploracao (pasta Brenno).
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr
from matplotlib.path import Path as MPath

RAIZ = Path(__file__).resolve().parent.parent
APPEEARS = RAIZ / "data" / "appeears"
POLIGONO = RAIZ / "data" / "talhao_demo_2.geojson"
SAIDA = RAIZ / "data" / "talhao"
LIMIAR_SOLO = 0.35  # NDVI abaixo disso = solo descoberto / palhada


def abrir_nc(path):
    """Le o NetCDF em memoria: a lib C do netCDF nao aceita acentos no caminho no Windows."""
    import netCDF4
    nc = netCDF4.Dataset(path.name, memory=path.read_bytes())
    return xr.open_dataset(xr.backends.NetCDF4DataStore(nc)).load()


def mascara(lat, lon):
    """Pixels cujo centro cai dentro do poligono do talhao."""
    geo = json.loads(POLIGONO.read_text(encoding="utf-8"))
    poly = MPath(np.array(geo["features"][0]["geometry"]["coordinates"][0]))
    LON, LAT = np.meshgrid(lon, lat)
    return poly.contains_points(np.c_[LON.ravel(), LAT.ravel()]).reshape(LAT.shape)


def ndvi():
    ds = abrir_nc(APPEEARS / "MOD13Q1.061_250m_aid0001.nc")
    nd, rel = ds["_250m_16_days_NDVI"], ds["_250m_16_days_pixel_reliability"]
    m = xr.DataArray(mascara(ds["lat"].values, ds["lon"].values), dims=("lat", "lon"))
    bons = nd.where((rel <= 1) & m)  # 0 = bom, 1 = marginal
    s = pd.DataFrame({
        "ndvi": bons.mean(("lat", "lon")).values,
        "pix_bons": bons.count(("lat", "lon")).values,
        "pix_total": int(m.sum()),
    }, index=pd.to_datetime([t.strftime("%Y-%m-%d") for t in ds["time"].values]))
    s.index.name = "data"
    s["frac_bons"] = s["pix_bons"] / s["pix_total"]
    s.loc[s["frac_bons"] < 0.5, "ndvi"] = np.nan  # data com muita nuvem
    s.to_csv(SAIDA / "ndvi_16d.csv", float_format="%.4f")

    mes = s["ndvi"].resample("MS").mean().interpolate(limit=1)
    mensal = pd.DataFrame({"ndvi": mes, "solo_descoberto": mes < LIMIAR_SOLO})
    mensal.index.name = "mes"
    mensal.to_csv(SAIDA / "ndvi_mensal.csv", float_format="%.4f")
    clim = mensal.groupby(mensal.index.month).agg(
        ndvi_medio=("ndvi", "mean"), ndvi_min=("ndvi", "min"), ndvi_max=("ndvi", "max"),
        freq_solo=("solo_descoberto", "mean"))
    clim.index.name = "mes"
    clim.to_csv(SAIDA / "ndvi_climatologia.csv", float_format="%.3f")
    print(f"NDVI: {len(s)} datas, {s['ndvi'].isna().sum()} descartadas por nuvem, {int(m.sum())} pixels")
    print(clim.round(2).to_string())


def declividade():
    dem = abrir_nc(APPEEARS / "SRTMGL1_NC.003_30m_aid0001.nc")["SRTMGL1_DEM"].squeeze()
    lat, lon = dem["lat"].values, dem["lon"].values
    m = mascara(lat, lon)
    z = dem.values.astype(float)
    dy = np.abs(np.gradient(lat).mean()) * 111_320
    dx = np.abs(np.gradient(lon).mean()) * 111_320 * np.cos(np.radians(lat.mean()))
    gy, gx = np.gradient(z, dy, dx)
    sl = (np.hypot(gx, gy) * 100)[m]  # %
    zz = z[m]
    r = pd.DataFrame([{
        "area_ha": m.sum() * dx * dy / 1e4, "pixels_30m": int(m.sum()),
        "alt_min": zz.min(), "alt_max": zz.max(), "alt_media": zz.mean(),
        "decl_media_pct": np.nanmean(sl), "decl_p90_pct": np.nanpercentile(sl, 90),
        "decl_max_pct": np.nanmax(sl),
    }])
    r.to_csv(SAIDA / "declividade.csv", index=False, float_format="%.2f")
    print("\nRelevo:\n", r.round(2).T.to_string(header=False))


if __name__ == "__main__":
    SAIDA.mkdir(parents=True, exist_ok=True)
    ndvi()
    declividade()
