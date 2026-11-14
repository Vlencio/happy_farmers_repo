import csv
import tempfile
import unittest
from pathlib import Path

from backend.field_context import load_demo_field, load_model_spread


class TestFieldContext(unittest.TestCase):
    def test_demo_observations_are_read_from_repository_files(self):
        field = load_demo_field()
        self.assertEqual([row["mes"] for row in field["ndvi"]], list(range(1, 13)))
        self.assertEqual([row["freq_solo"] for row in field["ndvi"][7:10]], [0.5, 0.6, 0.4])
        self.assertEqual(field["terrain"]["decl_p90_pct"], 7.07)
        self.assertEqual(field["terrain"]["decl_max_pct"], 17.82)
        offsets = [row["off_tmin"] for row in field["station"]["corrections"]]
        self.assertEqual((min(offsets), max(offsets)), (-2.48, -1.16))

    def test_missing_optional_deliveries_are_not_fabricated(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertIsNone(load_demo_field(folder))
            self.assertIsNone(load_model_spread(folder))

    def write_models(self, folder, rows):
        path = Path(folder) / "clima_modelos.csv"
        with path.open("w", encoding="utf-8", newline="") as output:
            writer = csv.writer(output)
            writer.writerow(["modelo", "mes", "delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"])
            writer.writerows(rows)

    def test_model_deltas_aggregate_only_complete_monthly_series(self):
        rows = [[model, month, rain, 1, temp]
                for model, rain, temp in [("A", -8, 1.3), ("B", 2, 2.3)]
                for month in range(1, 13)]
        with tempfile.TemporaryDirectory() as folder:
            self.write_models(folder, rows)
            spread = load_model_spread(folder)
            self.assertEqual(spread["scope"], "talhao_demo_2")
            self.assertEqual([m["rain_delta_mm"] for m in spread["models"]], [-96, 24])
            self.assertAlmostEqual(spread["models"][0]["tmax_delta_c"], 1.3)
            self.assertAlmostEqual(spread["models"][1]["tmax_delta_c"], 2.3)
            for invalid in [rows[:-1], rows + [rows[0]], rows + [["C", 1, "NaN", 1, 2]]]:
                self.write_models(folder, invalid)
                with self.assertRaises(ValueError):
                    load_model_spread(folder)


if __name__ == "__main__":
    unittest.main()
