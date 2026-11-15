"""Teste de scripts/montar_solo_mg.py com NetCDF sinteticos. Nao baixa nada.

Rodar da raiz do repo: python -m unittest discover tests
Pulado se numpy/netCDF4 nao estiverem instalados.
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

TEM_NETCDF = all(importlib.util.find_spec(m) for m in ("numpy", "netCDF4"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

LATS = [-20.125, -19.875]
LONS = [-48.625, -48.375]
# (argila, areia, silte) por quadrado; o ultimo e agua (-9999)
FRACOES = [[(0.50, 0.30, 0.20), (0.10, 0.80, 0.10)], [(0.35, 0.45, 0.20), (-9999, -9999, -9999)]]
CLASSES = [[12, 3], [9, 14]]
QUADRADO_MG = [[-48.75, -20.25], [-48.5, -20.25], [-48.5, -19.75], [-48.75, -19.75], [-48.75, -20.25]]


def gravar_nc(caminho, campos):
    import netCDF4
    import numpy as np

    dados = Path(caminho)
    nc = netCDF4.Dataset("memoria", "w", memory=1024)
    for nome, tam in (("time", 1), ("lat", 2), ("lon", 2)):
        nc.createDimension(nome, tam)
    nc.createVariable("lat", "f4", ("lat",))[:] = LATS
    nc.createVariable("lon", "f4", ("lon",))[:] = LONS
    for nome, matriz in campos.items():
        nc.createVariable(nome, "f4", ("time", "lat", "lon"))[0] = np.array(matriz, dtype="float32")
    dados.write_bytes(bytes(nc.close()))


@unittest.skipUnless(TEM_NETCDF, "numpy e netCDF4 nao instalados")
class TestMontarSoloMg(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import montar_solo_mg

        cls.m = montar_solo_mg
        cls.tmp = tempfile.TemporaryDirectory()
        pasta = Path(cls.tmp.name)
        gravar_nc(pasta / cls.m.ARQ_FRACAO, {
            f"GLDAS_soilfraction_{p}": [[q[k] for q in linha] for linha in FRACOES]
            for k, p in enumerate(("clay", "sand", "silt"))
        })
        gravar_nc(pasta / cls.m.ARQ_TEXTURA, {"GLDAS_soiltex": CLASSES})
        cls.linhas = {(l["lat"], l["lon"]): l for l in cls.m.montar(pasta, aneis=[QUADRADO_MG])}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_cortes_de_argila(self):
        t = self.m.textura_por_argila
        self.assertEqual([t(v) for v in (14.9, 15, 35, 35.1)], ["arenoso", "medio", "medio", "argiloso"])

    def test_quadrado_sem_dado_fica_fora(self):
        self.assertEqual(len(self.linhas), 3)
        self.assertNotIn((-19.875, -48.375), self.linhas)

    def test_linha_do_talhao(self):
        demo = self.linhas[self.m.PONTO_DEMO]
        self.assertEqual((demo["textura"], demo["classe_gldas"], demo["em_mg"]), ("argiloso", "clay", 1))
        self.assertEqual((demo["argila_pct"], demo["areia_pct"], demo["silte_pct"]), (50.0, 30.0, 20.0))

    def test_textura_e_mascara(self):
        self.assertEqual(self.linhas[(-20.125, -48.375)]["textura"], "arenoso")
        self.assertEqual(self.linhas[(-20.125, -48.375)]["em_mg"], 0)
        self.assertEqual(self.linhas[(-19.875, -48.625)]["textura"], "medio")

    def test_csv_tem_as_colunas(self):
        saida = Path(self.tmp.name) / "saida" / "textura.csv"
        self.m.gravar(list(self.linhas.values()), saida)
        self.assertEqual(saida.read_text(encoding="utf-8").splitlines()[0], ",".join(self.m.COLUNAS))


if __name__ == "__main__":
    unittest.main()
