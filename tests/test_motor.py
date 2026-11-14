"""Testes do motor. Rodar da raiz do repo: python -m unittest discover tests"""
import json
import unittest
from unittest import mock

import pandas as pd

from motor import carregar_dados, recomendar
from motor import motor

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


class TestClima(unittest.TestCase):
    def test_ra_exemplo_fao56(self):
        # FAO-56, exemplo 8: 20 graus S em 3 de setembro (dia 246) -> 32.2 MJ/m2/dia
        self.assertAlmostEqual(motor.radiacao_extraterrestre(-20, 246), 32.2, delta=0.1)

    def test_et0_faixa_plausivel(self):
        _, hoje, futuro = carregar_dados()
        et0_hoje = motor.et0_hargreaves(motor._tabela_clima(hoje), -20.032)
        et0_futuro = motor.et0_hargreaves(motor._tabela_clima(futuro), -20.032)
        self.assertEqual(len(et0_hoje), 12)
        for v in et0_hoje:
            self.assertTrue(2.0 < v < 7.0, v)  # mm/dia
        self.assertGreater(sum(et0_futuro), sum(et0_hoje))  # futuro mais quente pede mais agua


class TestRecomendar(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados()
        cls.saida = recomendar(ENTRADA, *cls.dados)
        cls.n = len(cls.dados[0])

    def test_numero_de_sequencias(self):
        self.assertEqual(len(self.saida["sequencias"]) + len(self.saida["descartadas"]), self.n**2)
        uma = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        self.assertEqual(len(uma["sequencias"]) + len(uma["descartadas"]), self.n)

    def test_janela_de_plantio(self):
        # soja depois de soja cairia em fevereiro, fora da janela (10 a 12)
        fora = {s["id"]: s["motivo"] for s in self.saida["descartadas"]}
        self.assertIn("soja>soja", fora)
        self.assertEqual(fora["soja>soja"]["cultura"], "soja")
        self.assertEqual(fora["soja>soja"]["posicao"], 2)
        self.assertEqual(fora["soja>soja"]["mes_livre"], 2)
        self.assertNotIn("soja>soja", [s["id"] for s in self.saida["sequencias"]])
        # milho na safrinha esta dentro da janela (9 a 3)
        self.assertIn("soja>milho", [s["id"] for s in self.saida["sequencias"]])

    def test_tempo_de_colheita(self):
        # soja: plantio em 1/out, 120 dias -> ciclo acaba em 28/jan; com 10 dias de colheita, milho entra em 8/fev
        milho = cultura_de(self.saida, "soja>milho", "hoje", 1)
        self.assertEqual(milho["mes_plantio"], 2)
        self.assertEqual(milho["meses"][0]["dias"], 21)  # 8 a 28 de fevereiro
        with mock.patch.object(motor, "DIAS_COLHEITA", 0):
            sem = recomendar(ENTRADA, *self.dados)
        self.assertEqual(cultura_de(sem, "soja>milho", "hoje", 1)["mes_plantio"], 1)

    def test_rotacao_atual_fora_da_janela(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": ["soja"]}, *self.dados)
        self.assertEqual([s["id"] for s in saida["descartadas"] if s["atual"]], ["soja>soja"])
        self.assertFalse(any(s["atual"] for s in saida["sequencias"]))

    def test_nenhuma_sequencia_viavel(self):
        saida = recomendar({**ENTRADA, "mes_plantio": 6}, *self.dados)  # nenhuma janela abre ate julho
        self.assertEqual(saida["sequencias"], [])
        self.assertEqual(len(saida["descartadas"]), self.n**2)

    def test_espera_a_janela_abrir(self):
        saida = recomendar({**ENTRADA, "horizonte": 1, "mes_plantio": 9}, *self.dados)
        soja = cultura_de(saida, "soja", "hoje", 0)  # talhao livre em setembro, janela abre em outubro
        self.assertEqual(soja["espera_dias"], 30)
        self.assertEqual(soja["mes_plantio"], 10)
        milho = cultura_de(saida, "milho", "hoje", 0)  # janela ja aberta
        self.assertEqual(milho["espera_dias"], 0)

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

    def test_marca_a_rotacao_atual(self):
        atuais = [s["id"] for s in self.saida["sequencias"] if s["atual"]]
        self.assertEqual(atuais, ["soja>milho"])

    def test_sem_historico(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": []}, *self.dados)
        self.assertFalse(any(s["atual"] for s in saida["sequencias"]))

    def test_regras_de_sequencia(self):
        # repetir a cultura anterior
        self.assertEqual(cultura_de(self.saida, "milho>milho", "hoje", 1)["fator_sequencia"], motor.PENALIDADE_REPETICAO)
        # nao fixadora depois de fixadora
        self.assertEqual(cultura_de(self.saida, "soja>milho", "hoje", 1)["fator_sequencia"], motor.BONUS_APOS_FIXADORA)
        # o historico conta: a rotacao atual termina em milho, entao milho na 1a posicao repete
        self.assertEqual(cultura_de(self.saida, "milho>crotalária", "hoje", 0)["fator_sequencia"], motor.PENALIDADE_REPETICAO)
        # fixadora depois de fixadora nao ganha bonus
        self.assertEqual(cultura_de(self.saida, "soja>crotalária", "hoje", 1)["fator_sequencia"], 1.0)

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


class TestEncaixe(unittest.TestCase):
    C = {"temp_min": 10, "temp_otima_min": 20, "temp_otima_max": 30, "temp_max": 40, "chuva_min": 400, "chuva_max": 1000}

    def test_temperatura(self):
        for t, esperado in [(5, 0), (10, 0), (15, 0.5), (25, 1), (35, 0.5), (40, 0), (45, 0)]:
            self.assertAlmostEqual(motor.encaixe_temperatura(t, self.C), esperado)

    def test_chuva(self):
        for chuva, esperado in [(200, 0.5), (400, 1), (700, 1), (1500, 0.5), (2500, 0)]:
            self.assertAlmostEqual(motor.encaixe_chuva(chuva, self.C), esperado)

    def test_janela_que_vira_o_ano(self):
        c = {"plantio_ini": 9, "plantio_fim": 3}
        self.assertEqual([m for m in range(1, 13) if motor.na_janela(m, c)], [1, 2, 3, 9, 10, 11, 12])
        c = {"plantio_ini": 10, "plantio_fim": 12}
        self.assertEqual([m for m in range(1, 13) if motor.na_janela(m, c)], [10, 11, 12])

    def test_solo_seca_sem_chuva(self):
        clima = [{"mes": m, "chuva_mm": 0.0, "tmin_c": 18.0, "tmax_c": 30.0} for m in range(1, 13)]
        c = motor._tabela_culturas(pd.read_csv(motor.PROVISORIO / "culturas.csv"))["soja"]
        r, agua = motor.simular_cultura(c, 0, clima, motor.et0_hargreaves(clima, -20), 0.0)
        self.assertAlmostEqual(r["atendimento_hidrico"], 0.0)
        self.assertEqual(agua, 0.0)


if __name__ == "__main__":
    unittest.main()
