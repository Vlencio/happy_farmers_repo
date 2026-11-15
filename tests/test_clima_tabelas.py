"""Testes das tabelas de clima em data/ (pontos 3, 4 e 5 da revisao de 15/11).

Rodar da raiz: python -m unittest discover tests. Leem data/; nada e baixado.
"""
import sys
import unittest
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "scripts"))
import montar_clima as mc  # noqa: E402

GRAUS = list(range(26, 41))


def ler(nome):
    return pd.read_csv(RAIZ / "data" / f"{nome}.csv", index_col="mes")


class TestTabelasDeClima(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hoje, cls.fut, cls.seco, cls.corr = (ler(n) for n in ["clima_hoje", "clima_futuro", "clima_seco", "clima_correcoes"])

    def test_uma_coluna_de_dias_quentes_por_grau(self):
        for t in (self.hoje, self.fut, self.seco):
            cols = [f"dias_acima_{g}" for g in GRAUS]
            self.assertTrue(set(cols) <= set(t.columns))
            self.assertTrue((t[cols].diff(axis=1).iloc[:, 1:] <= 0.011).all().all())  # mais quente, menos dias
            self.assertTrue((t[cols].ge(0) & t[cols].le(31)).all().all())
            self.assertTrue((t["dias_quentes"] == t["dias_acima_35"]).all())

    def test_dias_quentes_do_futuro_sao_os_do_power_deslocados(self):
        d = pd.read_csv(mc.POWER_DIARIO, parse_dates=["data"])
        esperado = mc.contar_dias_quentes(d, self.corr["off_tmax"] + self.corr["delta_tmax_c"], GRAUS)
        for g in GRAUS:
            self.assertLess((esperado[g] - self.fut[f"dias_acima_{g}"]).abs().max(), 0.3, g)  # offsets lidos com 2 casas: alguns dias no limite trocam de lado
        self.assertTrue((self.fut["dias_acima_35"] >= self.hoje["dias_acima_35"]).all())
        self.assertAlmostEqual(self.fut["dias_acima_35"].sum(), 69.5, delta=0.5)

    def test_chuva_do_futuro_e_a_de_hoje_vezes_a_razao(self):
        self.assertLess((self.hoje["chuva_mm"] * self.corr["razao_chuva"] - self.fut["chuva_mm"]).abs().max(), 0.03)
        self.assertTrue(self.corr["razao_chuva"].between(0.5, 1.5).all())
        self.assertAlmostEqual(self.fut["chuva_mm"].sum(), 1234, delta=2)

    def test_temperaturas_do_futuro_continuam_hoje_mais_delta(self):
        for v in ("tmin_c", "tmax_c"):
            self.assertLess((self.hoje[v] + self.corr[f"delta_{v}"] - self.fut[v]).abs().max(), 0.02)


if __name__ == "__main__":
    unittest.main()
