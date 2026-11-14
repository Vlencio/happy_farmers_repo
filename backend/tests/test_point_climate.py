"""Regional integration tests; POWER is always replaced by delivered daily data."""
import unittest
from unittest.mock import patch

import pandas as pd

from backend.point_climate import PointClimate, in_ring
from scripts.clima_ponto import mc


class TestPointClimate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.provider = PointClimate()

    def test_minas_uses_state_polygon_not_rectangular_climate_coverage(self):
        for lat, lon in [(-20.032, -48.526), (-19.92, -43.94), (-16.73, -43.86), (-21.55, -45.43)]:
            self.assertTrue(self.provider.inside_minas(lat, lon), (lat, lon))
        # Inside the climate rectangle, but in SP, GO and DF respectively.
        for lat, lon in [(-21.17, -47.81), (-16.68, -49.25), (-15.79, -47.88)]:
            self.assertFalse(self.provider.inside_minas(lat, lon), (lat, lon))

    def test_ring_boundary_is_included(self):
        ring = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]
        self.assertTrue(in_ring(1, 1, ring))
        self.assertTrue(in_ring(0, 1, ring))
        self.assertTrue(in_ring(2, 2, ring))
        self.assertFalse(in_ring(3, 1, ring))

    def test_cell_is_local_has_all_months_and_never_extrapolates(self):
        cell, table = self.provider.select_cell(-20.032, -48.526)
        self.assertEqual(cell, (-20.125, -48.625))
        self.assertEqual(table["mes"].tolist(), list(range(1, 13)))
        with self.assertRaisesRegex(ValueError, "cobertura"):
            self.provider.select_cell(-30, -51)

    def test_delivered_regional_delta_reaches_real_provider_without_a520(self):
        daily = pd.read_csv(mc.POWER_DIARIO, parse_dates=["data"])
        lat, lon = -19.5, -47.9
        with patch("scripts.clima_ponto._diario", return_value=(daily, "power_arquivo")):
            result = self.provider.get(lat, lon)
        cell, delta = self.provider.select_cell(lat, lon)
        self.assertEqual(result["origem"]["delta"], "nex_regional")
        self.assertFalse(result["origem"]["correcao_a520"])
        self.assertEqual(result["origem"]["celula_nex"]["lat"], cell[0])
        self.assertEqual(len(result["clima_hoje"]), 12)
        change = result["clima_futuro"]["tmax_c"] - result["clima_hoje"]["tmax_c"]
        self.assertLess((change - delta["delta_tmax_c"]).abs().max(), 0.011)

    def test_outside_minas_and_provider_warning_are_both_preserved(self):
        origin = {"hoje": "fallback_tabela_demo", "delta": "nex_talhao_demo", "aviso": "POWER fora do ar."}
        with patch("backend.point_climate.clima_por_ponto", return_value={"origem": origin}) as provider:
            result = self.provider.get(-21.17, -47.81)
        self.assertIn("fora de Minas Gerais", result["origem"]["aviso"])
        self.assertIn(origin["aviso"], result["origem"]["aviso"])
        self.assertEqual(provider.call_args.kwargs["origem_delta"], "nex_regional")
        self.assertNotIn("celula_nex", result["origem"])

    def test_demo_does_not_fetch_power(self):
        with patch("scripts.clima_ponto._puxar_api") as fetch:
            result = self.provider.get(-20.032, -48.526)
        fetch.assert_not_called()
        self.assertEqual(result["origem"]["hoje"], "tabela_demo")


if __name__ == "__main__":
    unittest.main()
