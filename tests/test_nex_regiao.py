"""Teste de scripts/montar_nex_regiao.py com NetCDF sinteticos. Nao baixa nada.

Rodar da raiz do repo: python -m unittest discover tests
Pulado se xarray/netCDF4 nao estiverem instalados (pip install -r requirements.txt).
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

TEM_XARRAY = all(importlib.util.find_spec(m) for m in ("xarray", "netCDF4"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

PERIODOS = {"historical": (1995, 1996), "ssp245": (2041, 2042)}
LATS = [-20.125, -19.875]
LONS = [311.375, 311.625]  # 0 a 360, como nos arquivos do NEX; = -48,625 e -48,375


def gravar(pasta, modelo, cenario, ano, pr, tasmin, tasmax):
    """Um ano de dados constantes; o quadrado (lat 1, lon 1) e mar (NaN)."""
    import numpy as np
    import pandas as pd
    import xarray as xr

    dias = pd.date_range(f"{ano}-01-01", f"{ano}-12-31", freq="D")
    for var, valor in (("pr", pr), ("tasmin", tasmin), ("tasmax", tasmax)):
        dados = np.full((len(dias), 2, 2), valor, dtype="float32")
        dados[:, 1, 1] = np.nan
        da = xr.DataArray(dados, coords={"time": dias, "lat": LATS, "lon": LONS}, dims=("time", "lat", "lon"), name=var)
        da.to_netcdf(pasta / f"{var}_{modelo}_{cenario}_{ano}.nc")


@unittest.skipUnless(TEM_XARRAY, "xarray e netCDF4 nao instalados")
class TestMontarNexRegiao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import montar_nex_regiao

        cls.tmp = tempfile.TemporaryDirectory()
        pasta = Path(cls.tmp.name)
        # modelo A: +10 graus na maxima (26,85 -> 36,85 C), +2 na minima, chuva dobra
        # modelo B: +4 na maxima (26,85 -> 30,85 C), minima igual, chuva igual
        for modelo, d_tmax, d_tmin, fator in (("A", 10, 2, 2), ("B", 4, 0, 1)):
            for ano in (1995, 1996):
                gravar(pasta, modelo, "historical", ano, 1e-5, 290.0, 300.0)
            for ano in (2041, 2042):
                gravar(pasta, modelo, "ssp245", ano, 1e-5 * fator, 290.0 + d_tmin, 300.0 + d_tmax)
        cls.df = montar_nex_regiao.montar(pasta, modelos=["A", "B"], periodos=PERIODOS, limiares=[32, 35])

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def linha(self, mes, lat=-20.125, lon=-48.625):
        df = self.df
        return df[(df.mes == mes) & (df.lat == lat) & (df.lon == lon)].iloc[0]

    def test_quadrados_e_longitude(self):
        self.assertEqual(len(self.df), 3 * 12)  # 4 quadrados, 1 de mar
        self.assertEqual(sorted(self.df.lon.unique()), [-48.625, -48.375])
        self.assertFalse(((self.df.lat == -19.875) & (self.df.lon == -48.375)).any())
        self.assertFalse(self.df.isna().any().any())

    def test_temperatura_e_a_media_dos_modelos(self):
        jan = self.linha(1)
        self.assertAlmostEqual(jan.delta_tmax_c, (10 + 4) / 2, places=2)
        self.assertAlmostEqual(jan.delta_tmin_c, (2 + 0) / 2, places=2)

    def test_chuva_em_mm_no_mes(self):
        # 1e-5 kg m-2 s-1 = 0,864 mm/dia; o modelo A dobra, o B nao muda
        self.assertAlmostEqual(self.linha(1).delta_chuva_mm, 0.864 * 31 / 2, places=2)
        self.assertAlmostEqual(self.linha(4).delta_chuva_mm, 0.864 * 30 / 2, places=2)

    def test_dias_quentes(self):
        jan, fev = self.linha(1), self.linha(2)
        # acima de 35: so o modelo A no futuro (36,85 C), todos os dias
        self.assertAlmostEqual(jan.delta_dias_acima_35, 31 / 2, places=2)
        self.assertAlmostEqual(fev.delta_dias_acima_35, 28 / 2, places=2)  # 2041 e 2042 nao sao bissextos
        # acima de 32: o modelo B (30,85 C) tambem nao passa
        self.assertAlmostEqual(jan.delta_dias_acima_32, 31 / 2, places=2)


if __name__ == "__main__":
    unittest.main()
