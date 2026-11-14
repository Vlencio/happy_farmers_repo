"""Testes do motor. Rodar da raiz do repo: python -m unittest discover tests

Usam as tabelas fixas de tests/dados/ (4 culturas, valores de teste), para nao
quebrarem quando os numeros de data/ mudarem. So TestDadosReais le data/.
"""
import json
import unittest
from pathlib import Path
from unittest import mock

from motor import carregar_dados, recomendar
from motor import motor

FIXOS = Path(__file__).resolve().parent / "dados"
ENTRADA = {
    "lat": -20.032,
    "rotacao_atual": ["soja", "milho"],
    "prioridades": {"agua": 1, "solo": 1, "renda": 1},
    "horizonte": 2,
    "mes_plantio": 10,
}


def cultura_de(saida, seq_id, cenario, posicao):
    seq = next(s for s in saida["sequencias"] if s["id"] == seq_id)
    return seq[cenario]["culturas"][posicao]


def ids(lista):
    return [s["id"] for s in lista]


class TestClima(unittest.TestCase):
    def test_ra_exemplo_fao56(self):
        # FAO-56, exemplo 8: 20 graus S em 3 de setembro (dia 246) -> 32.2 MJ/m2/dia
        self.assertAlmostEqual(motor.radiacao_extraterrestre(-20, 246), 32.2, delta=0.1)

    def test_et0_faixa_plausivel(self):
        _, hoje, futuro = carregar_dados(FIXOS)
        et0_hoje = motor.et0_hargreaves(motor._tabela_clima(hoje), -20.032)
        et0_futuro = motor.et0_hargreaves(motor._tabela_clima(futuro), -20.032)
        self.assertEqual(len(et0_hoje), 12)
        for v in et0_hoje:
            self.assertTrue(2.0 < v < 7.0, v)  # mm/dia
        self.assertGreater(sum(et0_futuro), sum(et0_hoje))  # futuro mais quente pede mais agua

    def test_usa_et0_da_tabela_se_vier(self):
        _, hoje, _ = carregar_dados(FIXOS)
        sem = motor._tabela_clima(hoje)
        self.assertEqual(motor.et0_do_clima(sem, -20.032), motor.et0_hargreaves(sem, -20.032))
        com = motor._tabela_clima(hoje.assign(et0_mm=[d * 4.0 for d in motor.DIAS_MES]))
        for v in motor.et0_do_clima(com, -20.032):
            self.assertAlmostEqual(v, 4.0)  # mm/dia


class TestRecomendar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados(FIXOS)
        cls.saida = recomendar(ENTRADA, *cls.dados)
        cls.n = len(cls.dados[0])

    def test_numero_de_sequencias(self):
        self.assertEqual(len(self.saida["sequencias"]) + len(self.saida["descartadas"]), self.n**2)
        uma = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        self.assertEqual(len(uma["sequencias"]) + len(uma["descartadas"]), self.n)

    def test_serializa_em_json(self):
        json.dumps(self.saida)

    def test_ranks_e_scores(self):
        seqs = self.saida["sequencias"]
        self.assertEqual([s["rank_hoje"] for s in seqs], list(range(1, len(seqs) + 1)))
        self.assertEqual(sorted(s["rank_futuro"] for s in seqs), list(range(1, len(seqs) + 1)))
        for s in seqs:
            for cen in ("hoje", "futuro"):
                self.assertTrue(0 <= s[cen]["score"] <= 100)
                for k in ("agua", "solo", "renda"):
                    self.assertTrue(0 <= s[cen][k] <= 1, (s["id"], cen, k))
        scores = [s["hoje"]["score"] for s in seqs]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_slots(self):
        # talhao livre em outubro: safra e depois safrinha
        self.assertEqual(self.saida["slots"], ["safra", "safrinha"])
        self.assertEqual(sorted(ids(self.saida["sequencias"])),
                         ["milho>crotalaria", "milho>milho", "soja>crotalaria", "soja>milho"])
        self.assertEqual(cultura_de(self.saida, "soja>milho", "hoje", 0)["slot"], "safra")
        self.assertEqual(cultura_de(self.saida, "soja>milho", "hoje", 1)["slot"], "safrinha")
        # talhao livre em fevereiro: safrinha e depois a safra seguinte
        fev = recomendar({**ENTRADA, "mes_plantio": 2}, *self.dados)
        self.assertEqual(fev["slots"], ["safrinha", "safra"])
        self.assertEqual(sorted(ids(fev["sequencias"])),
                         ["crotalaria>algodao", "crotalaria>milho", "crotalaria>soja",
                          "milho>algodao", "milho>milho", "milho>soja"])

    def test_descarta_fora_da_epoca(self):
        fora = {s["id"]: s["motivo"] for s in self.saida["descartadas"]}
        # soja nao tem mes de plantio na safrinha
        self.assertEqual(fora["soja>soja"], {"cultura": "soja", "posicao": 2, "slot": "safrinha", "mes_livre": 2, "mes_plantio": None})
        # crotalaria nao tem mes de plantio na safra
        self.assertEqual(fora["crotalaria>milho"]["posicao"], 1)
        self.assertIsNone(fora["crotalaria>milho"]["mes_plantio"])
        # algodao (plantio em dezembro, 170 dias) so libera o talhao em maio: o milho de fevereiro ja passou
        self.assertEqual(fora["algodao>milho"], {"cultura": "milho", "posicao": 2, "slot": "safrinha", "mes_livre": 5, "mes_plantio": 2})

    def test_epoca_que_ja_passou(self):
        nov = recomendar({**ENTRADA, "horizonte": 1, "mes_plantio": 11}, *self.dados)
        self.assertEqual(ids(nov["sequencias"]), ["algodao"])  # soja e milho sao de outubro
        jun = recomendar({**ENTRADA, "mes_plantio": 6}, *self.dados)  # safrinha de fev/mar ja passou
        self.assertEqual(jun["sequencias"], [])
        self.assertEqual(len(jun["descartadas"]), self.n**2)

    def test_espera_o_mes_de_plantio(self):
        uma = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        algodao = cultura_de(uma, "algodao", "hoje", 0)  # talhao livre em outubro, plantio em dezembro
        self.assertEqual((algodao["espera_dias"], algodao["mes_plantio"]), (61, 12))
        self.assertEqual(cultura_de(uma, "soja", "hoje", 0)["espera_dias"], 0)

    def test_tempo_de_colheita(self):
        # soja: plantio em 1/out, 120 dias -> ciclo acaba em 28/jan; com 10 dias de colheita, milho entra em 8/fev
        milho = cultura_de(self.saida, "soja>milho", "hoje", 1)
        self.assertEqual((milho["mes_plantio"], milho["meses"][0]["dias"], milho["espera_dias"]), (2, 21, 0))
        with mock.patch.object(motor, "DIAS_COLHEITA", 0):
            sem = recomendar(ENTRADA, *self.dados)
        milho = cultura_de(sem, "soja>milho", "hoje", 1)  # talhao livre em 29/jan, espera 1/fev
        self.assertEqual((milho["mes_plantio"], milho["meses"][0]["dias"], milho["espera_dias"]), (2, 28, 3))

    def test_produtividade_por_slot(self):
        safra = cultura_de(self.saida, "milho>crotalaria", "hoje", 0)
        safrinha = cultura_de(self.saida, "soja>milho", "hoje", 1)
        self.assertAlmostEqual(safra["receita_ha"], 1000 * 5.5 * safra["fator"], delta=5)
        self.assertAlmostEqual(safrinha["receita_ha"], 1000 * 5.0 * safrinha["fator"], delta=5)

    def test_calor(self):
        for s in self.saida["sequencias"]:
            for cen in ("hoje", "futuro"):
                for c in s[cen]["culturas"]:
                    self.assertTrue(0 <= c["encaixe_calor"] <= 1)
                    # a saida vem arredondada em 3 casas
                    self.assertLessEqual(c["fator"], c["encaixe_calor"] * c["fator_sequencia"] + 2e-3)
        # milho (limiar 35): mais dias quentes na fase sensivel no futuro
        hoje = cultura_de(self.saida, "soja>milho", "hoje", 1)
        futuro = cultura_de(self.saida, "soja>milho", "futuro", 1)
        self.assertGreater(futuro["dias_calor"], hoje["dias_calor"])
        self.assertLess(futuro["encaixe_calor"], hoje["encaixe_calor"])
        # crotalaria nao tem limiar: a regra nao se aplica
        crot = cultura_de(self.saida, "soja>crotalaria", "futuro", 1)
        self.assertEqual((crot["encaixe_calor"], crot["dias_calor"]), (1.0, 0.0))

    def test_calor_e_opcional_na_tabela_de_culturas(self):
        sem = recomendar(ENTRADA, self.dados[0].drop(columns=["temp_calor_c"]), self.dados[1], self.dados[2])
        for s in sem["sequencias"]:
            for c in s["futuro"]["culturas"]:
                self.assertEqual(c["encaixe_calor"], 1.0)

    def test_falta_coluna_de_calor_no_clima(self):
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, self.dados[0], self.dados[1].drop(columns=["dias_acima_35"]), self.dados[2])

    def test_marca_a_rotacao_atual(self):
        self.assertEqual([s["id"] for s in self.saida["sequencias"] if s["atual"]], ["soja>milho"])

    def test_rotacao_atual_descartada(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": ["soja"]}, *self.dados)
        self.assertEqual([s["id"] for s in saida["descartadas"] if s["atual"]], ["soja>soja"])
        self.assertFalse(any(s["atual"] for s in saida["sequencias"]))

    def test_sem_historico(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": []}, *self.dados)
        self.assertFalse(any(s["atual"] for s in saida["sequencias"] + saida["descartadas"]))

    def test_regras_de_sequencia(self):
        # repetir a cultura anterior
        self.assertEqual(cultura_de(self.saida, "milho>milho", "hoje", 1)["fator_sequencia"], motor.PENALIDADE_REPETICAO)
        # nao fixadora depois de fixadora
        self.assertEqual(cultura_de(self.saida, "soja>milho", "hoje", 1)["fator_sequencia"], motor.BONUS_APOS_FIXADORA)
        # o historico conta: a rotacao atual termina em milho, entao milho na 1a posicao repete
        self.assertEqual(cultura_de(self.saida, "milho>crotalaria", "hoje", 0)["fator_sequencia"], motor.PENALIDADE_REPETICAO)
        # fixadora depois de fixadora nao ganha bonus
        self.assertEqual(cultura_de(self.saida, "soja>crotalaria", "hoje", 1)["fator_sequencia"], 1.0)

    def test_balanco_hidrico(self):
        for s in self.saida["sequencias"]:
            for cen in ("hoje", "futuro"):
                for c in s[cen]["culturas"]:
                    self.assertTrue(0 <= c["atendimento_hidrico"] <= 1)
                    self.assertEqual(sum(m["dias"] for m in c["meses"]), c["ciclo_dias"])
                    for m in c["meses"]:
                        self.assertGreaterEqual(m["deficit_mm"], 0)
                        self.assertLessEqual(m["deficit_mm"], m["etc_mm"] + 1e-6)

    def test_preco_editavel(self):
        base = cultura_de(self.saida, "soja>milho", "hoje", 0)["receita_ha"]
        dobro = recomendar({**ENTRADA, "precos": {"soja": 4200}}, *self.dados)
        self.assertAlmostEqual(cultura_de(dobro, "soja>milho", "hoje", 0)["receita_ha"], 2 * base, delta=0.01)

    def test_prioridades_mudam_o_ranking(self):
        renda = recomendar({**ENTRADA, "prioridades": {"renda": 1}}, *self.dados)
        solo = recomendar({**ENTRADA, "prioridades": {"solo": 1}}, *self.dados)
        self.assertNotEqual(renda["sequencias"][0]["id"], solo["sequencias"][0]["id"])
        self.assertEqual(renda["entrada"]["prioridades"], {"agua": 0.0, "solo": 0.0, "renda": 1.0})

    def test_entradas_invalidas(self):
        with self.assertRaises(ValueError):
            recomendar({**ENTRADA, "horizonte": 3}, *self.dados)
        with self.assertRaises(ValueError):
            recomendar({**ENTRADA, "rotacao_atual": ["abacaxi"]}, *self.dados)
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, self.dados[0], self.dados[1].head(11), self.dados[2])
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, self.dados[0].drop(columns=["mes_plantio_safra"]), self.dados[1], self.dados[2])


class TestPecas(unittest.TestCase):
    C = {"temp_min": 10, "temp_otima_min": 20, "temp_otima_max": 30, "temp_max": 40, "chuva_min": 400, "chuva_max": 1000}

    def test_temperatura(self):
        for t, esperado in [(5, 0), (10, 0), (15, 0.5), (25, 1), (35, 0.5), (40, 0), (45, 0)]:
            self.assertAlmostEqual(motor.encaixe_temperatura(t, self.C), esperado)

    def test_chuva(self):
        for chuva, esperado in [(200, 0.5), (400, 1), (700, 1), (1500, 0.5), (2500, 0)]:
            self.assertAlmostEqual(motor.encaixe_chuva(chuva, self.C), esperado)

    def test_dia_de_plantio(self):
        self.assertIsNone(motor.dia_de_plantio(None, 0))  # cultura sem mes naquele slot
        self.assertEqual(motor.dia_de_plantio(2, 0), 31)  # livre em 1/jan: espera 1/fev
        self.assertEqual(motor.dia_de_plantio(2, 40), 40)  # livre em 10/fev: planta no dia
        self.assertIsNone(motor.dia_de_plantio(2, 59))  # livre em 1/mar: fevereiro ja passou
        self.assertEqual(motor.dia_de_plantio(2, 365 - 30), 365 + 31)  # livre em dezembro: fevereiro do ano seguinte

    def clima_fixo(self, dias_quentes_por_mes=0.0):
        return [
            {"mes": m, "chuva_mm": 0.0, "tmin_c": 18.0, "tmax_c": 30.0, "dias_acima_38": dias_quentes_por_mes * motor.DIAS_MES[m - 1]}
            for m in range(1, 13)
        ]

    def test_solo_seca_sem_chuva(self):
        clima = self.clima_fixo()
        c = motor._tabela_culturas(carregar_dados(FIXOS)[0])["soja"]
        r, agua = motor.simular_cultura(c, 0, clima, motor.et0_hargreaves(clima, -20), 0.0)
        self.assertAlmostEqual(r["atendimento_hidrico"], 0.0)
        self.assertEqual(agua, 0.0)

    def test_encaixe_de_calor(self):
        soja = motor._tabela_culturas(carregar_dados(FIXOS)[0])["soja"]  # limiar 38, ciclo 120
        sensiveis = sum(1 for i in range(120) if motor.FASE_SENSIVEL[0] <= i / 120 < motor.FASE_SENSIVEL[1])
        for fracao, esperado in [(0.0, 1.0), (0.25, 0.75), (1.0, 0.0)]:  # fracao dos dias acima do limiar
            clima = self.clima_fixo(fracao)
            r, _ = motor.simular_cultura(soja, 0, clima, motor.et0_hargreaves(clima, -20), 0.0)
            self.assertAlmostEqual(r["encaixe_calor"], esperado)
            self.assertAlmostEqual(r["dias_calor"], fracao * sensiveis)
        with mock.patch.object(motor, "PERDA_CALOR", 0.5):
            clima = self.clima_fixo(1.0)
            r, _ = motor.simular_cultura(soja, 0, clima, motor.et0_hargreaves(clima, -20), 0.0)
            self.assertAlmostEqual(r["encaixe_calor"], 0.5)


class TestDadosReais(unittest.TestCase):
    """As tabelas de data/ carregam e produzem um ranking. Nao testa numeros."""

    def test_roda_com_as_tabelas_de_data(self):
        dados = carregar_dados()
        n = len(dados[0])
        for mes, horizonte in [(10, 2), (10, 1), (2, 2), (2, 1)]:
            saida = recomendar({**ENTRADA, "mes_plantio": mes, "horizonte": horizonte}, *dados)
            json.dumps(saida)
            self.assertEqual(len(saida["sequencias"]) + len(saida["descartadas"]), n**horizonte)
            self.assertGreater(len(saida["sequencias"]), 0, (mes, horizonte))
            for s in saida["sequencias"]:
                self.assertTrue(0 <= s["hoje"]["score"] <= 100)


if __name__ == "__main__":
    unittest.main()
