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
        expected = recomendar(request, *app.state.tables, app.state.dry_climate)
        self.assertEqual(response.json(), expected)
        self.assertEqual(len(expected["sequencias"]) + len(expected["descartadas"]), 100)

    def test_catalog_comes_from_current_table(self):
        metadata = self.client.get("/metadata").json()
        self.assertEqual([c["id"] for c in metadata["cultures"]], app.state.tables[0]["cultura"].tolist())
        self.assertIn("talhão de demonstração", metadata["data_notice"])
        self.assertEqual(metadata["demo_field"]["ndvi"][7]["freq_solo"], 0.5)
        self.assertEqual(metadata["demo_field"]["terrain"]["decl_media_pct"], 4.05)
        self.assertEqual(metadata["demo_field"]["boundary"]["type"], "FeatureCollection")
        self.assertTrue(metadata["point_climate_available"])

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
        self.assertEqual(len(result["sequencias"]) + len(result["descartadas"]), 10)

    def test_cors_for_local_frontend(self):
        response = self.client.options("/analyze", headers={"Origin": "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:4173")

    def test_partial_priorities_preserve_engine_semantics(self):
        request = {"lat": -20.032, "prioridades": {"agua": 1}, "horizonte": 1}
        self.assertEqual(self.client.post("/analyze", json=request).json(), recomendar(request, *app.state.tables, app.state.dry_climate))

    def test_demo_keeps_delivered_tables_and_adds_real_dry_year_and_provenance(self):
        request = {"lat": -20.032, "lon": -48.526, "mes_plantio": 10, "horizonte": 2}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        origin = result.pop("origem")
        self.assertEqual(origin["hoje"], "tabela_demo")
        self.assertIn("25 km", origin["aviso"])
        self.assertEqual(result, recomendar({k: v for k, v in request.items() if k != "lon"}, *app.state.tables, app.state.dry_climate))
        self.assertEqual(len(result["clima"]["seco"]), 12)

    def test_optional_engine_tables_and_output_pass_through_without_recalculation(self):
        original_dry = app.state.dry_climate
        extension = object()
        # The API forwards Pedro's optional fifth argument without computing a dry year.
        expected = {"clima": {"seco": []}, "sequencias": []}
        try:
            app.state.dry_climate = extension
            with patch("backend.app.recomendar", return_value=expected) as engine:
                self.assertEqual(self.client.post("/analyze", json={"lat": -20}).json(), expected)
                self.assertIs(engine.call_args.args[-1], extension)
                self.assertNotIn("lon", engine.call_args.args[0])
        finally:
            app.state.dry_climate = original_dry

    def test_point_tables_and_original_warning_reach_response_without_demo_dry_year(self):
        _, today, future = app.state.tables
        origin = {"hoje": "power_api", "delta": "nex_regional", "aviso": "Aviso do provedor."}
        point = {"clima_hoje": today.copy(), "clima_futuro": future.copy(), "origem": origin}
        with patch.object(app.state.point_climate, "get", return_value=point) as provider:
            with patch("backend.app.recomendar", return_value={"sequencias": []}) as engine:
                result = self.client.post("/analyze", json={"lat": -19.5, "lon": -47.9}).json()
        provider.assert_called_once_with(-19.5, -47.9)
        self.assertIs(engine.call_args.args[1], app.state.tables[0])
        self.assertIs(engine.call_args.args[2], point["clima_hoje"])
        self.assertIs(engine.call_args.args[3], point["clima_futuro"])
        self.assertIsNone(engine.call_args.args[4])
        self.assertNotIn("lon", engine.call_args.args[0])
        self.assertEqual(result["origem"], origin)

    def test_power_failure_is_explicit_and_never_claims_a_local_dry_year(self):
        with patch("scripts.clima_ponto._puxar_api", side_effect=ConnectionError("POWER fora do ar")):
            with patch("scripts.clima_ponto.arquivo_power") as cache:
                cache.return_value.exists.return_value = False
                result = self.client.post("/analyze", json={"lat": -19.5, "lon": -47.9})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["origem"]["hoje"], "fallback_tabela_demo")
        self.assertIn("POWER fora do ar", result.json()["origem"]["aviso"])
        self.assertNotIn("seco", result.json()["clima"])

    def test_no_power_lookup_for_out_of_coverage_or_unknown_crop(self):
        with patch("backend.point_climate.clima_por_ponto") as provider:
            outside = self.client.post("/analyze", json={"lat": -30, "lon": -51})
            invalid = self.client.post("/analyze", json={"lat": -19.5, "lon": -47.9, "rotacao_atual": ["cafe"]})
        self.assertEqual(outside.status_code, 422)
        self.assertIn("cobertura", outside.json()["detail"])
        self.assertEqual(invalid.status_code, 422)
        provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
