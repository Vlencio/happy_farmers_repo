import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.app import app
from motor import recomendar


def demo_engine(request):
    """What /analyze computes on the demo tables: dry year, per-model deltas and the demo elevation."""
    return recomendar({**request, "altitude_m": app.state.demo_altitude}, *app.state.tables, app.state.dry_climate,
                      clima_modelos=app.state.model_climates)


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
        expected = demo_engine(request)
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
        self.assertTrue(metadata["capabilities"]["declividade_pct"])
        self.assertTrue(metadata["capabilities"]["ajuste"])
        self.assertIsInstance(metadata["capabilities"]["chat"], bool)

    def test_validation_and_unknown_culture(self):
        for request in [
            {"lat": 91}, {"lat": 0, "mes_plantio": 13}, {"lat": 0, "horizonte": 3},
            {"lat": 0, "rotacao_atual": ["cafe"]}, {"lat": 0, "precos": {"soja": -1}},
            {"lat": 0, "prioridades": {"agua": -1}}, {"farm": {}},
            {"lat": 0, "lon": 181}, {"lat": 0, "lon": -181}, {"lat": 0, "lon": "NaN"},
            {"lat": 0, "declividade_pct": -1}, {"lat": 0, "declividade_pct": 101},
            {"lat": 0, "declividade_pct": "NaN"}, {"lat": 0, "declividade_pct": "Infinity"},
            {"lat": 0, "ajuste": {"chuva_pct": -51}}, {"lat": 0, "ajuste": {"chuva_pct": 31}},
            {"lat": 0, "ajuste": {"temp_c": -1}}, {"lat": 0, "ajuste": {"temp_c": 4.5}},
            {"lat": 0, "ajuste": {"temp_c": "NaN"}}, {"lat": 0, "ajuste": {"vento": 1}}, {"lat": 0, "ajuste": [10, 2]},
        ]:
            self.assertEqual(self.client.post("/analyze", json=request).status_code, 422, request)

    def test_optional_input_and_single_crop(self):
        result = self.client.post("/analyze", json={"lat": -20, "mes_plantio": 2, "horizonte": 1}).json()
        self.assertEqual(result["slots"], ["safrinha"])
        self.assertEqual(result["entrada"]["rotacao_atual"], [])
        self.assertEqual(len(result["sequencias"]) + len(result["descartadas"]), 10)

    def test_slope_reaches_engine_and_adds_erosion_index(self):
        request = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "horizonte": 2, "declividade_pct": 4.05}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result, demo_engine(request))
        self.assertEqual(result["entrada"]["declividade_pct"], 4.05)
        self.assertIn("indice_erosao", result["sequencias"][0]["hoje"]["descoberto"])
        without = self.client.post("/analyze", json={k: v for k, v in request.items() if k != "declividade_pct"}).json()
        self.assertIsNone(without["entrada"]["declividade_pct"])
        self.assertNotIn("indice_erosao", without["sequencias"][0]["hoje"]["descoberto"])

    def test_adjustment_reaches_engine(self):
        request = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "ajuste": {"chuva_pct": -20, "temp_c": 2}}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result, demo_engine(request))
        self.assertEqual(result["entrada"]["ajuste"], {"chuva_pct": -20.0, "temp_c": 2.0})
        self.assertEqual(sorted(result["clima"]), ["futuro", "hoje", "seco"])  # the dry year is adjusted too
        partial = self.client.post("/analyze", json={"lat": -20.032, "ajuste": {"chuva_pct": -10}}).json()
        self.assertEqual(partial["entrada"]["ajuste"], {"chuva_pct": -10.0, "temp_c": 0.0})
        without = self.client.post("/analyze", json={"lat": -20.032, "rotacao_atual": ["soja", "milho"]}).json()
        self.assertNotIn("ajuste", without["entrada"])

    def test_soil_texture_reaches_engine(self):
        self.assertTrue(self.client.get("/metadata").json()["capabilities"]["solo_textura"])
        request = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "solo_textura": "arenoso"}
        result = self.client.post("/analyze", json=request).json()
        self.assertEqual((result["entrada"]["solo_textura"], result["entrada"]["cad_mm"]), ("arenoso", 30))
        without = self.client.post("/analyze", json={"lat": -20.032, "rotacao_atual": ["soja", "milho"]}).json()
        self.assertNotIn("solo_textura", without["entrada"])
        for bad in ("argila", "ARENOSO", 30):
            self.assertEqual(self.client.post("/analyze", json={"lat": -20.032, "solo_textura": bad}).status_code, 422)

    def test_metadata_suggests_soil_for_the_point(self):
        plain = self.client.get("/metadata").json()
        self.assertNotIn("solo", plain)
        solo = self.client.get("/metadata", params={"lat": -20.032, "lon": -48.526}).json()["solo"]
        self.assertEqual((solo["lat"], solo["lon"]), (-20.032, -48.526))  # the point asked, not the cell centre
        self.assertEqual(solo["textura_sugerida"], "argiloso")  # demo cell: 51.8% clay
        self.assertIn("GLDAS", solo["fonte"])
        far = self.client.get("/metadata", params={"lat": 10.0, "lon": 10.0}).json()["solo"]
        self.assertEqual((far["textura_sugerida"], far["fonte"]), (None, None))
        for params in ({"lat": -20.0}, {"lon": -48.5}, {"lat": 91, "lon": 0}, {"lat": 0, "lon": "NaN"}):
            self.assertEqual(self.client.get("/metadata", params=params).status_code, 422, params)

    def test_model_range_only_on_the_demo_tables(self):
        demo = self.client.post("/analyze", json={"lat": -20.032, "rotacao_atual": ["soja", "milho"]}).json()
        self.assertIn("modelos", demo)
        self.assertIn("modelos", demo["sequencias"][0])
        # another point: the regional grid only has the model average, so no per-model block
        other = {"clima_hoje": app.state.tables[1], "clima_futuro": app.state.tables[2],
                 "origem": {"hoje": "power_ponto", "aviso": None}}
        with patch.object(app.state.point_climate, "get", return_value=other):
            result = self.client.post("/analyze", json={"lat": -19.0, "lon": -45.0}).json()
        self.assertNotIn("modelos", result)
        self.assertNotIn("seco", result["clima"])

    def test_wheat_below_its_minimum_altitude_is_discarded_on_the_demo(self):
        self.assertAlmostEqual(app.state.demo_altitude, 484.41)  # SRTM mean, data/talhao/declividade.csv
        for request in ({"lat": -20.032, "rotacao_atual": ["soja", "milho"]},
                        {"lat": -20.032, "lon": -48.526, "rotacao_atual": ["soja", "milho"]}):
            result = self.client.post("/analyze", json=request).json()
            self.assertEqual(result["entrada"]["altitude_m"], 484.41)
            self.assertFalse([s["id"] for s in result["sequencias"] if "trigo" in s["culturas"]])
            by_altitude = {s["id"]: s["motivo"] for s in result["descartadas"] if "altitude_min_m" in s["motivo"]}
            self.assertIn("soja>trigo", by_altitude)
            self.assertEqual(by_altitude["soja>trigo"], {
                "cultura": "trigo", "posicao": 2, "slot": "safrinha", "mes_livre": 2, "mes_plantio": 3,
                "altitude_min_m": 800.0, "altitude_m": 484.41,
            })
            self.assertTrue(all(m["cultura"] == "trigo" for m in by_altitude.values()))
        # the engine without altitude still ranks soja>trigo: the API is what removes it
        plain = recomendar({"lat": -20.032, "rotacao_atual": ["soja", "milho"]}, *app.state.tables)
        self.assertIn("soja>trigo", [s["id"] for s in plain["sequencias"]])

    def test_no_demo_altitude_for_other_points(self):
        other = {"clima_hoje": app.state.tables[1], "clima_futuro": app.state.tables[2],
                 "origem": {"hoje": "power_ponto", "aviso": None}}
        with patch.object(app.state.point_climate, "get", return_value=other):
            result = self.client.post("/analyze", json={"lat": -19.0, "lon": -45.0, "rotacao_atual": ["soja", "milho"]}).json()
        self.assertNotIn("altitude_m", result["entrada"])
        self.assertIn("soja>trigo", [s["id"] for s in result["sequencias"]])
        self.assertFalse([s for s in result["descartadas"] if "altitude_min_m" in s["motivo"]])
        # the client cannot send an elevation: the /analyze input contract is unchanged
        self.assertEqual(self.client.post("/analyze", json={"lat": -20.032, "altitude_m": 900}).status_code, 422)

    def test_cors_for_local_frontend(self):
        response = self.client.options("/analyze", headers={"Origin": "http://127.0.0.1:4173", "Access-Control-Request-Method": "POST"})
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:4173")

    def test_partial_priorities_preserve_engine_semantics(self):
        request = {"lat": -20.032, "prioridades": {"agua": 1}, "horizonte": 1}
        self.assertEqual(self.client.post("/analyze", json=request).json(), demo_engine(request))

    def test_demo_keeps_delivered_tables_and_adds_real_dry_year_and_provenance(self):
        request = {"lat": -20.032, "lon": -48.526, "mes_plantio": 10, "horizonte": 2}
        response = self.client.post("/analyze", json=request)
        self.assertEqual(response.status_code, 200)
        result = response.json()
        origin = result.pop("origem")
        self.assertEqual(origin["hoje"], "tabela_demo")
        self.assertIn("25 km", origin["aviso"])
        self.assertEqual(result, demo_engine({k: v for k, v in request.items() if k != "lon"}))
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
        self.assertNotIn("altitude_m", engine.call_args.args[0])  # SRTM only for the demo field
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
