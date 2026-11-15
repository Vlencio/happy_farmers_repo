"""Testes de scripts/clima_ponto.py. Rodar da raiz: python -m unittest discover tests

Nao chamam a API do POWER: a serie diaria vem do arquivo do talhao de
demonstracao em data/power/, e o arquivo de cache vai para uma pasta temporaria.
"""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import clima_ponto as cp  # noqa: E402
import montar_clima as mc  # noqa: E402

LONGE = (-19.5, -47.9)  # ~88 km do talhao de demonstracao


def diario_demo(lat=None, lon=None):
    return pd.read_csv(mc.POWER_DIARIO, parse_dates=["data"])


class TestClimaPorPonto(unittest.TestCase):
    def setUp(self):
        pasta = tempfile.TemporaryDirectory()
        self.addCleanup(pasta.cleanup)
        self.cache = Path(pasta.name) / "power.csv"
        p = mock.patch.object(cp, "arquivo_power", lambda lat, lon: self.cache)
        p.start()
        self.addCleanup(p.stop)

    def test_reproduz_clima_hoje_a_menos_da_a520(self):
        hoje, _ = cp.tabelas_do_diario(diario_demo(), mc.LAT, cp.deltas_demo())
        ref = pd.read_csv(mc.DADOS / "clima_hoje.csv")
        off = cp.deltas_demo().reset_index()
        self.assertEqual(list(hoje.columns), list(ref.columns))
        self.assertLess((hoje["chuva_mm"] - ref["chuva_mm"]).abs().max(), 0.2)
        self.assertLess((hoje["et0_mm"] - ref["et0_mm"]).abs().max(), 0.1)
        self.assertLess((hoje["tmin_c"] + off["off_tmin"] - ref["tmin_c"]).abs().max(), 0.03)
        self.assertLess((hoje["tmax_c"] + off["off_tmax"] - ref["tmax_c"]).abs().max(), 0.03)

    def test_perto_do_talhao_devolve_as_tabelas_da_demonstracao(self):
        r = cp.clima_por_ponto(mc.LAT + 0.05, mc.LON, puxar=self.fail)
        self.assertEqual(r["origem"]["hoje"], "tabela_demo")
        self.assertTrue(r["origem"]["correcao_a520"])
        self.assertIsNone(r["origem"]["aviso"])
        pd.testing.assert_frame_equal(r["clima_hoje"], pd.read_csv(mc.DADOS / "clima_hoje.csv"))

    def test_outro_ponto_usa_power_e_avisa_do_delta(self):
        r = cp.clima_por_ponto(*LONGE, puxar=diario_demo)
        o = r["origem"]
        self.assertEqual((o["hoje"], o["delta"], o["correcao_a520"]), ("power_api", "nex_talhao_demo", False))
        self.assertIn("talhao de demonstracao", o["aviso"])
        self.assertEqual(len(r["clima_hoje"]), 12)
        self.assertEqual(list(r["clima_futuro"].columns), list(pd.read_csv(mc.DADOS / "clima_futuro.csv").columns))
        self.assertFalse(r["clima_futuro"].isna().any().any())
        self.assertTrue((r["clima_futuro"]["tmax_c"] > r["clima_hoje"]["tmax_c"]).all())
        # segunda chamada le o arquivo guardado, sem chamar a API
        self.assertEqual(cp.clima_por_ponto(*LONGE, puxar=self.fail)["origem"]["hoje"], "power_arquivo")

    def test_power_fora_do_ar_cai_nas_tabelas_da_demonstracao(self):
        def falha(lat, lon):
            raise ConnectionError("sem rede")

        r = cp.clima_por_ponto(*LONGE, puxar=falha)
        self.assertEqual(r["origem"]["hoje"], "fallback_tabela_demo")
        self.assertIn("sem rede", r["origem"]["aviso"])
        pd.testing.assert_frame_equal(r["clima_futuro"], pd.read_csv(mc.DADOS / "clima_futuro.csv"))

    def test_poucos_anos_de_power_cai_no_fallback(self):
        r = cp.clima_por_ponto(*LONGE, puxar=lambda lat, lon: diario_demo().head(800))
        self.assertEqual(r["origem"]["hoje"], "fallback_tabela_demo")

    def test_delta_regional_entra_pelo_parametro(self):
        d = cp.deltas_demo().reset_index()
        d["delta_tmax_c"] = 5.0
        r = cp.clima_por_ponto(*LONGE, puxar=diario_demo, deltas=d, origem_delta="nex_regional")
        self.assertEqual(r["origem"]["delta"], "nex_regional")
        self.assertIsNone(r["origem"]["aviso"])
        self.assertTrue(((r["clima_futuro"]["tmax_c"] - r["clima_hoje"]["tmax_c"]).round(2) == 5.0).all())

    def test_chuva_por_razao_ou_delta_somado(self):
        r = cp.clima_por_ponto(*LONGE, puxar=diario_demo)
        self.assertEqual(r["origem"]["chuva_futuro"], "razao")
        razao = cp.deltas_demo()["razao_chuva"].to_numpy()
        self.assertLess(abs(r["clima_hoje"]["chuva_mm"] * razao - r["clima_futuro"]["chuva_mm"]).max(), 0.02)
        self.cache.unlink()
        sem = cp.deltas_demo().drop(columns=["razao_chuva"]).reset_index()  # como o delta regional de hoje
        r = cp.clima_por_ponto(*LONGE, puxar=diario_demo, deltas=sem, origem_delta="nex_regional")
        self.assertEqual(r["origem"]["chuva_futuro"], "delta_somado")
        soma = (r["clima_hoje"]["chuva_mm"] + sem["delta_chuva_mm"]).clip(lower=0)
        self.assertLess(abs(soma - r["clima_futuro"]["chuva_mm"]).max(), 0.02)

    def test_dias_quentes_do_futuro_pela_tmax_deslocada(self):
        r = cp.clima_por_ponto(*LONGE, puxar=diario_demo)
        esperado = mc.contar_dias_quentes(diario_demo(), cp.deltas_demo()["delta_tmax_c"], [35])[35].to_numpy()
        self.assertLess(abs(r["clima_futuro"]["dias_acima_35"] - esperado).max(), 0.01)
        self.assertIn("dias_acima_26", r["clima_hoje"].columns)
        self.assertIn("dias_acima_40", r["clima_futuro"].columns)

    def test_coordenada_invalida(self):
        with self.assertRaises(ValueError):
            cp.clima_por_ponto(-95, 0)


if __name__ == "__main__":
    unittest.main()
