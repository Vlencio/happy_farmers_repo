"""Testes de data/clima_modelos.csv (D2). Rodar da raiz: python -m unittest discover tests

Leem o arquivo gerado por scripts/montar_clima.py; nada e baixado.
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import montar_clima as mc  # noqa: E402

ARQ = RAIZ / "data" / "clima_modelos.csv"
COLUNAS = ["modelo", "mes", "delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"]


class TestClimaModelos(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = pd.read_csv(ARQ)

    def test_formato(self):
        self.assertEqual(list(self.m.columns), COLUNAS)
        self.assertEqual(sorted(self.m["modelo"].unique()), ["ACCESS-CM2", "MIROC6", "MRI-ESM2-0"])
        for _, g in self.m.groupby("modelo"):
            self.assertEqual(sorted(g["mes"]), list(range(1, 13)))
        self.assertFalse(self.m.isna().any().any())

    def test_media_dos_modelos_e_o_delta_do_futuro(self):
        media = self.m.groupby("mes")[COLUNAS[2:]].mean()
        corr = pd.read_csv(RAIZ / "data" / "clima_correcoes.csv", index_col="mes")
        for c in COLUNAS[2:]:
            self.assertLess((media[c] - corr[c]).abs().max(), 0.01, c)

    def test_totais_anuais(self):
        g = self.m.groupby("modelo")
        chuva, tmax = g["delta_chuva_mm"].sum(), g["delta_tmax_c"].mean()
        for modelo, c, t in [("MIROC6", -79.6, 1.34), ("ACCESS-CM2", 7.9, 2.31), ("MRI-ESM2-0", 32.7, 1.49)]:
            self.assertAlmostEqual(chuva[modelo], c, delta=0.15)
            self.assertAlmostEqual(tmax[modelo], t, delta=0.01)

    def test_igual_ao_calculo_do_script(self):
        d = mc.deltas_por_modelo().round(2).reset_index()
        pd.testing.assert_frame_equal(d, self.m, check_dtype=False)

    def test_backend_le_o_arquivo(self):
        try:
            sys.path.insert(0, str(RAIZ))
            from backend.field_context import load_model_spread
        except ImportError as e:
            self.skipTest(f"backend indisponivel: {e}")
        spread = load_model_spread(RAIZ / "data")
        self.assertEqual(len(spread["models"]), 3)
        self.assertEqual(spread["scope"], "talhao_demo_2")


if __name__ == "__main__":
    unittest.main()
