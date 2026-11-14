import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import app
from motor import recomendar


class TestApi(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)

    def test_response_is_the_engine_output(self):
        request = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "horizonte": 2, "mes_plantio": 10}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        expected = recomendar(request, *app.state.tables)
        self.assertEqual(response.json(), expected)
        self.assertEqual(len(expected["sequencias"]) + len(expected["descartadas"]), 81)

    def test_catalog_comes_from_current_table(self):
        metadata = self.client.get("/metadata").json()
        self.assertEqual([c["id"] for c in metadata["cultures"]], app.state.tables[0]["cultura"].tolist())
        self.assertIn("talhão de demonstração", metadata["data_notice"])
        self.assertEqual(metadata["demo_field"]["ndvi"][7]["freq_solo"], 0.5)
        self.assertEqual(metadata["demo_field"]["terrain"]["decl_media_pct"], 4.05)
        self.assertEqual(metadata["demo_field"]["boundary"]["type"], "FeatureCollection")
        self.assertFalse(metadata["point_climate_available"])

    def test_validation_and_unknown_culture(self):
        for request in [
            {"lat": 91}, {"lat": 0, "mes_plantio": 13}, {"lat": 0, "horizonte": 3},
            {"lat": 0, "rotacao_atual": ["cafe"]}, {"lat": 0, "precos": {"soja": -1}},
            {"lat": 0, "prioridades": {"agua": -1}}, {"farm": {}},
            {"lat": 0, "lon": 181}, {"lat": 0, "lon": -181}, {"lat": 0, "lon": "NaN"},
        ]:
            self.assertEqual(self.client.post("/analyze", json=request).status_code, 422, request)

    def test_optional_input_and_single_crop(self):
        result = self.client.post("/analyze", json={"lat": -20, "mes_plantio": 2, "horizonte": 1}).json()
        self.assertEqual(result["slots"], ["safrinha"])
        self.assertEqual(result["entrada"]["rotacao_atual"], [])
        self.assertEqual(len(result["sequencias"]) + len(result["descartadas"]), 9)

    def test_cors_for_local_frontend(self):
        response = self.client.options("/analyze", headers={"Origin": "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:4173")

    def test_partial_priorities_preserve_engine_semantics(self):
        request = {"lat": -20.032, "prioridades": {"agua": 1}, "horizonte": 1}
        self.assertEqual(self.client.post("/analyze", json=request).json(), recomendar(request, *app.state.tables))

    def test_longitude_is_accepted_without_claiming_point_climate(self):
        request = {"lat": -20.032, "lon": -48.526, "mes_plantio": 10, "horizonte": 2}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), recomendar({k: v for k, v in request.items() if k != "lon"}, *app.state.tables))

    def test_optional_engine_tables_and_output_pass_through_without_recalculation(self):
        tables = app.state.tables
        extension = object()
        # Models the future P1 signature; does not compute or simulate agronomic results.
        expected = {"clima": {"seco": []}, "sequencias": []}
        try:
            app.state.tables = (*tables, extension)
            with patch("backend.app.recomendar", return_value=expected) as engine:
                self.assertEqual(self.client.post("/analyze", json={"lat": -20, "lon": -48}).json(), expected)
                self.assertIs(engine.call_args.args[-1], extension)
                self.assertNotIn("lon", engine.call_args.args[0])
        finally:
            app.state.tables = tables


if __name__ == "__main__":
    unittest.main()
