"""Testes do motor. Rodar da raiz do repo: python -m unittest discover tests

Usam as tabelas fixas de tests/dados/ (4 culturas, valores de teste), para nao
quebrarem quando os numeros de data/ mudarem. So TestDadosReais le data/.
"""
import json
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

from motor import carregar_clima_seco, carregar_dados, carregar_diario, diario_do_power, recomendar
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
        self.assertIsNone(saida["atual"])

    def test_rotacao_atual_sao_as_culturas_mais_recentes(self):
        casos = [  # historico, horizonte -> rotacao atual
            (["soja", "milho"], 2, ("soja", "milho")),
            (["algodao", "soja", "milho"], 2, ("soja", "milho")),  # a mais antiga nao entra
            (["milho", "algodao", "crotalaria", "soja", "milho"], 2, ("soja", "milho")),
            (["algodao", "soja", "milho"], 1, ("soja",)),  # proximo slot = o da penultima, um ano antes
            (["soja"], 2, ("soja", "soja")),  # uma cultura so: repete em todo slot
            (["soja"], 1, ("soja",)),
            ([], 2, None),
        ]
        for historico, horizonte, esperado in casos:
            self.assertEqual(motor.rotacao_atual(historico, horizonte), esperado, (historico, horizonte))

    def test_campo_atual_viavel_aponta_para_a_sequencia(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": ["algodao", "soja", "milho"]}, *self.dados)
        self.assertEqual(saida["atual"], {"id": "soja>milho", "culturas": ["soja", "milho"], "viavel": True, "motivo": None})
        marcadas = [s for s in saida["sequencias"] + saida["descartadas"] if s["atual"]]
        self.assertEqual(ids(marcadas), ["soja>milho"])
        # os numeros para comparar com as outras estao no item da propria sequencia
        self.assertGreater(marcadas[0]["hoje"]["receita_ha"], 0)
        self.assertIn("rank_futuro", marcadas[0])
        # a cultura anterior continua sendo a ultima do historico: o milho na safra repetiria
        self.assertEqual(cultura_de(saida, "milho>crotalaria", "hoje", 0)["fator_sequencia"], 0.85)

    def test_campo_atual_fora_de_epoca_traz_o_motivo(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": ["soja"]}, *self.dados)
        atual = saida["atual"]
        self.assertEqual((atual["id"], atual["viavel"]), ("soja>soja", False))
        # soja nao tem plantio de safrinha na tabela de teste
        self.assertEqual(atual["motivo"], {"cultura": "soja", "posicao": 2, "slot": "safrinha", "mes_livre": 2, "mes_plantio": None})
        descartada = next(s for s in saida["descartadas"] if s["atual"])
        self.assertEqual(descartada["motivo"], atual["motivo"])

    def test_campo_atual_com_uma_cultura(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": ["milho", "soja"], "horizonte": 1}, *self.dados)
        self.assertEqual(saida["atual"]["id"], "milho")  # o proximo slot repete a penultima
        self.assertTrue(saida["atual"]["viavel"])

    def test_solo_descoberto(self):
        # soja 1/out a 28/jan (120 d), colheita 10 d, milho 8/fev a 17/jun (130 d): 250 dias com cultura
        seq = next(s for s in self.saida["sequencias"] if s["id"] == "soja>milho")
        d = seq["hoje"]["descoberto"]
        self.assertEqual(d["dias"], 365 - 250)
        self.assertEqual(sum(m["dias"] for m in d["meses"]), d["dias"])
        self.assertEqual([m["mes"] for m in d["meses"]], [1, 2, 6, 7, 8, 9])  # ordem a partir de outubro
        self.assertEqual(d["meses"][0], {**d["meses"][0], "mes": 1, "dias": 3})  # 29 a 31 de janeiro
        self.assertEqual(d["meses"][3]["dias"], 31)  # julho inteiro
        # depois da soja nao ha palhada (10 dias expostos); o milho de teste tambem nao deixa
        self.assertEqual(d["dias_expostos"], d["dias"])
        self.assertAlmostEqual(d["chuva_mm"], sum(m["chuva_mm"] for m in d["meses"]), places=2)
        _, hoje, _ = self.dados
        chuva_julho = float(hoje.loc[hoje["mes"] == 7, "chuva_mm"].iloc[0])
        self.assertAlmostEqual(d["meses"][3]["chuva_mm"], chuva_julho, places=2)
        # os dias sao do calendario, iguais nos dois climas; a chuva muda
        self.assertEqual(seq["futuro"]["descoberto"]["dias"], d["dias"])
        self.assertNotEqual(seq["futuro"]["descoberto"]["chuva_mm"], d["chuva_mm"])
        self.assertNotIn("indice_erosao", d)

    def test_palhada_tira_os_dias_expostos(self):
        # a crotalaria (cobre_solo = 1) deixa palhada: depois dela, o solo sem cultura nao conta como exposto
        com = next(s for s in self.saida["sequencias"] if s["id"] == "soja>crotalaria")["hoje"]["descoberto"]
        sem = next(s for s in self.saida["sequencias"] if s["id"] == "soja>milho")["hoje"]["descoberto"]
        # soja ate 28/jan; crotalaria de 1/mar a 8/jun: expostos so os 31 dias entre as duas
        self.assertEqual(com["dias_expostos"], 31)
        self.assertEqual(com["dias"], 365 - 220)
        self.assertLess(com["dias_expostos"], sem["dias_expostos"])  # 31 contra 115
        self.assertLess(com["chuva_exposta_mm"], com["chuva_mm"])

    def test_palhada_do_historico_vale_antes_da_primeira_cultura(self):
        # algodao so e plantado em dezembro: de outubro ate la o solo fica com o que a cultura anterior deixou
        def antes(historico):
            saida = recomendar({**ENTRADA, "rotacao_atual": historico, "horizonte": 1}, *self.dados)
            d = next(s for s in saida["sequencias"] if s["id"] == "algodao")["hoje"]["descoberto"]
            return [(m["mes"], m["dias"], m["dias_expostos"]) for m in d["meses"][:2]]

        self.assertEqual(antes(["crotalaria"]), [(10, 31, 0), (11, 30, 0)])
        self.assertEqual(antes(["soja"]), [(10, 31, 31), (11, 30, 30)])
        self.assertEqual(antes([]), [(10, 31, 31), (11, 30, 30)])  # sem historico: conta como exposto

    def test_indice_de_erosao_com_declividade(self):
        self.assertIsNone(self.saida["entrada"]["declividade_pct"])
        saida = recomendar({**ENTRADA, "declividade_pct": 4.05}, *self.dados)
        self.assertEqual(saida["entrada"]["declividade_pct"], 4.05)
        s = motor.fator_declividade(4.05)
        for seq in saida["sequencias"]:
            for cen in ("hoje", "futuro"):
                d = seq[cen]["descoberto"]
                self.assertAlmostEqual(d["indice_erosao"], d["chuva_exposta_mm"] * s, delta=0.01)
        # o resto da saida nao muda com a declividade
        self.assertEqual(ids(saida["sequencias"]), ids(self.saida["sequencias"]))
        self.assertEqual(saida["sequencias"][0]["hoje"]["score"], self.saida["sequencias"][0]["hoje"]["score"])

    def test_fator_de_declividade(self):
        self.assertAlmostEqual(motor.fator_declividade(0), 0.03)
        self.assertAlmostEqual(motor.fator_declividade(9), 1.0, delta=0.01)  # 9% e a referencia da RUSLE
        self.assertAlmostEqual(motor.fator_declividade(4.05), 0.467, delta=0.001)
        self.assertLess(motor.fator_declividade(8.99), motor.fator_declividade(9.01) + 0.01)
        self.assertGreater(motor.fator_declividade(20), motor.fator_declividade(10))

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
        for declividade in (-1, 101):
            with self.assertRaises(ValueError):
                recomendar({**ENTRADA, "declividade_pct": declividade}, *self.dados)
        with self.assertRaises(ValueError):
            recomendar({**ENTRADA, "rotacao_atual": ["abacaxi"]}, *self.dados)
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, self.dados[0], self.dados[1].head(11), self.dados[2])
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, self.dados[0].drop(columns=["mes_plantio_safra"]), self.dados[1], self.dados[2])


class TestAnoSeco(unittest.TestCase):
    """Terceiro cenario, opcional. A tabela de teste e a de hoje com metade da chuva."""

    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados(FIXOS)
        cls.seco = cls.dados[1].assign(chuva_mm=cls.dados[1]["chuva_mm"] * 0.5)
        cls.sem = recomendar(ENTRADA, *cls.dados)
        cls.com = recomendar(ENTRADA, *cls.dados, cls.seco)

    def test_sem_a_tabela_a_saida_nao_muda(self):
        self.assertEqual(list(self.sem["clima"]), ["hoje", "futuro"])
        for s in self.sem["sequencias"]:
            self.assertNotIn("seco", s)
            self.assertNotIn("rank_seco", s)
        self.assertEqual(recomendar(ENTRADA, *self.dados, None), self.sem)

    def test_hoje_e_futuro_nao_mudam_com_a_tabela(self):
        self.assertEqual(self.com["clima"]["hoje"], self.sem["clima"]["hoje"])
        self.assertEqual(self.com["descartadas"], self.sem["descartadas"])
        self.assertEqual(ids(self.com["sequencias"]), ids(self.sem["sequencias"]))
        for com, sem in zip(self.com["sequencias"], self.sem["sequencias"]):
            for k in ("rank_hoje", "rank_futuro", "hoje", "futuro"):
                self.assertEqual(com[k], sem[k], (com["id"], k))

    def test_bloco_seco(self):
        self.assertEqual(list(self.com["clima"]), ["hoje", "futuro", "seco"])
        self.assertEqual([m["mes"] for m in self.com["clima"]["seco"]], list(range(1, 13)))
        seqs = self.com["sequencias"]
        self.assertEqual(sorted(s["rank_seco"] for s in seqs), list(range(1, len(seqs) + 1)))
        for s in seqs:
            self.assertEqual(set(s["seco"]), set(s["hoje"]))
            self.assertTrue(0 <= s["seco"]["score"] <= 100)
            for k in ("agua", "solo", "renda"):
                self.assertTrue(0 <= s["seco"][k] <= 1, (s["id"], k))
            self.assertLessEqual(s["seco"]["agua"], s["hoje"]["agua"])  # metade da chuva
            # mesma epoca de plantio: o calendario e igual nos tres cenarios
            self.assertEqual([c["mes_plantio"] for c in s["seco"]["culturas"]],
                             [c["mes_plantio"] for c in s["hoje"]["culturas"]])
        self.assertLess(sum(s["seco"]["agua"] for s in seqs), sum(s["hoje"]["agua"] for s in seqs))
        json.dumps(self.com)

    def test_renda_do_seco_para_em_1(self):
        # hoje e futuro com pouca chuva, "seco" com a chuva normal: a receita do seco passa do teto
        pouca = self.dados[1].assign(chuva_mm=self.dados[1]["chuva_mm"] * 0.3)
        saida = recomendar(ENTRADA, self.dados[0], pouca, pouca, self.dados[1])
        seqs = saida["sequencias"]
        teto = max(s[cen]["receita_ha"] for s in seqs for cen in ("hoje", "futuro"))
        self.assertGreater(max(s["seco"]["receita_ha"] for s in seqs), teto)
        self.assertEqual(max(s["seco"]["renda"] for s in seqs), 1.0)
        self.assertEqual(max(s["hoje"]["renda"] for s in seqs), 1.0)

    def test_falta_coluna_de_calor_no_seco(self):
        with self.assertRaises(ValueError):
            recomendar(ENTRADA, *self.dados, self.seco.drop(columns=["dias_acima_35"]))

    def test_carregar_clima_seco(self):
        self.assertIsNone(carregar_clima_seco(FIXOS))  # tests/dados nao tem a tabela


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


def serie_das_medias(clima, primeiro_ano, ultimo_ano, lat=ENTRADA["lat"]):
    """Serie diaria em que todo dia vale a media do mes da tabela de clima (chuva, temperaturas e ET0)."""
    tabela = motor._tabela_clima(clima)
    et0 = motor.et0_do_clima(tabela, lat)  # mm/dia
    datas = pd.date_range(f"{primeiro_ano}-01-01", f"{ultimo_ano}-12-31", freq="D")
    meses = [tabela[d.month - 1] for d in datas]
    return pd.DataFrame({
        "data": datas,
        "chuva_mm": [m["chuva_mm"] / motor.DIAS_MES[m["mes"] - 1] for m in meses],
        "tmin_c": [m["tmin_c"] for m in meses],
        "tmax_c": [m["tmax_c"] for m in meses],
        "et0_mm": [et0[m["mes"] - 1] for m in meses],
    })  # fmt: skip


class TestDiario(unittest.TestCase):
    """Modo diario: a mesma conta do modo mensal, ano a ano, com Ky na perda por falta de agua."""

    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados(FIXOS)
        cls.serie = serie_das_medias(cls.dados[1], 2001, 2010)
        cls.saida = recomendar(ENTRADA, *cls.dados, diario=cls.serie)

    def bloco(self, seq_id, cenario="hoje", saida=None):
        return next(s for s in (saida or self.saida)["sequencias"] if s["id"] == seq_id)["diario"][cenario]

    def test_sem_a_serie_a_saida_nao_muda(self):
        sem = recomendar(ENTRADA, *self.dados)
        self.assertNotIn("diario", sem)
        self.assertNotIn("diario", sem["sequencias"][0])
        com = json.loads(json.dumps(self.saida))
        com.pop("diario")
        so_no_diario = ("ky_padrao", "queda_no_ano_ruim")  # avisos que dependem da serie
        for s in com["sequencias"]:
            s.pop("diario")
            s["avisos"] = [a for a in s["avisos"] if a["codigo"] not in so_no_diario]
        self.assertEqual(com, json.loads(json.dumps(sem)))

    def test_serializa_e_resume_os_anos(self):
        json.dumps(self.saida)
        geral = self.saida["diario"]
        # talhao livre em outubro: a serie de 2001 a 2010 comporta as safras de 2001 a 2009
        self.assertEqual(geral["anos"], list(range(2001, 2010)))
        self.assertEqual(geral["n_anos"], 9)
        self.assertEqual(geral["quantil_ruim"], motor.QUANTIL_RUIM)
        for s in self.saida["sequencias"]:
            for cen in ("hoje", "futuro"):
                b = s["diario"][cen]
                self.assertEqual([a["ano"] for a in b["anos"]], geral["anos"])
                self.assertEqual([c["cultura"] for c in b["culturas"]], s["culturas"])
                self.assertIn(b["pior_ano"]["ano"], geral["anos"])

    def test_serie_das_medias_repete_o_modo_mensal(self):
        # 2001 a 2003 nao tem 29 de fevereiro: o calendario do modo diario e o mesmo do mensal
        serie = serie_das_medias(self.dados[1], 2001, 2003)
        with mock.patch.object(motor, "MIN_ANOS_DIARIO", 1):
            saida = recomendar(ENTRADA, *self.dados, diario=serie)
        self.assertEqual(saida["diario"]["anos"], [2001, 2002])
        for s in saida["sequencias"]:
            b = s["diario"]["hoje"]
            self.assertAlmostEqual(b["mediano"]["agua"], s["hoje"]["agua"], places=3)
            self.assertAlmostEqual(b["ruim"]["agua"], s["hoje"]["agua"], places=3)  # todo ano e igual
            for mensal, diaria in zip(s["hoje"]["culturas"], b["culturas"]):
                self.assertAlmostEqual(diaria["mediano"]["atendimento_hidrico"], mensal["atendimento_hidrico"], places=3)

    def test_ky_na_perda_por_falta_de_agua(self):
        milho = self.bloco("soja>milho")["culturas"][1]["mediano"]  # milho safrinha: falta agua no fim do ciclo
        self.assertLess(milho["atendimento_hidrico"], 0.95)
        self.assertAlmostEqual(milho["fator_agua"], 1 - motor.KY["milho"] * (1 - milho["atendimento_hidrico"]), delta=0.002)
        self.assertLess(milho["fator_agua"], milho["atendimento_hidrico"])  # Ky > 1: perde mais que a agua que faltou
        self.assertLessEqual(milho["fator"], milho["fator_agua"] * motor.BONUS_APOS_FIXADORA + 0.001)

    def test_ky_padrao_e_coluna_ky(self):
        self.assertEqual(motor._tabela_culturas(self.dados[0])["crotalaria"]["ky"], motor.KY_PADRAO)
        self.assertEqual(motor._tabela_culturas(self.dados[0])["milho"]["ky"], motor.KY["milho"])
        culturas = self.dados[0].assign(ky=[0.5, 2.0, None, 0.5])  # soja, milho, crotalaria, algodao
        self.assertEqual(motor._tabela_culturas(culturas)["crotalaria"]["ky"], motor.KY_PADRAO)
        saida = recomendar(ENTRADA, culturas, *self.dados[1:], diario=self.serie)
        milho = self.bloco("soja>milho", saida=saida)["culturas"][1]["mediano"]
        self.assertAlmostEqual(milho["fator_agua"], max(0, 1 - 2.0 * (1 - milho["atendimento_hidrico"])), delta=0.003)

    def test_ano_seco_aparece_como_pior_ano(self):
        serie = self.serie.copy()
        seca = (serie["data"] >= "2005-10-01") & (serie["data"] < "2006-10-01")
        serie.loc[seca, "chuva_mm"] *= 0.2
        saida = recomendar(ENTRADA, *self.dados, diario=serie)
        b = self.bloco("soja>milho", saida=saida)
        normal = self.bloco("soja>milho")
        self.assertEqual(b["pior_ano"]["ano"], 2005)
        self.assertLess(b["pior_ano"]["agua"], 0.6 * normal["mediano"]["agua"])
        self.assertLess(b["pior_ano"]["receita_ha"], b["ruim"]["receita_ha"])
        # um ano seco em nove nao mexe no ano mediano
        self.assertAlmostEqual(b["mediano"]["agua"], normal["mediano"]["agua"], delta=0.01)
        ano = next(a for a in b["anos"] if a["ano"] == 2005)
        self.assertEqual(ano["agua"], b["pior_ano"]["agua"])

    def test_ruim_nunca_e_melhor_que_o_mediano(self):
        serie = self.serie.copy()
        for ano, fator in [(2002, 0.5), (2005, 0.3), (2007, 0.7)]:
            serie.loc[(serie["data"] >= f"{ano}-10-01") & (serie["data"] < f"{ano + 1}-10-01"), "chuva_mm"] *= fator
        saida = recomendar(ENTRADA, *self.dados, diario=serie)
        for s in saida["sequencias"]:
            for cen in ("hoje", "futuro"):
                b = s["diario"][cen]
                for parte in ("agua", "solo", "receita_ha", "renda"):
                    self.assertLessEqual(b["ruim"][parte], b["mediano"][parte], (s["id"], cen, parte))
                self.assertLessEqual(b["pior_ano"]["receita_ha"], b["ruim"]["receita_ha"])

    def test_score_e_ranks(self):
        n = len(self.saida["sequencias"])
        pesos = {p: 1 / 3 for p in ("agua", "solo", "renda")}  # os de ENTRADA; na saida vem arredondados
        for cen in ("hoje", "futuro"):
            for nivel in ("mediano", "ruim"):
                blocos = [s["diario"][cen][nivel] for s in self.saida["sequencias"]]
                self.assertEqual(sorted(b["rank"] for b in blocos), list(range(1, n + 1)))
                for b in blocos:
                    self.assertTrue(0 <= b["renda"] <= 1)
                    esperado = 100 * sum(pesos[p] * b[p] for p in ("agua", "solo", "renda"))
                    self.assertAlmostEqual(b["score"], esperado, delta=0.1)
                melhor = min(blocos, key=lambda b: b["rank"])
                self.assertEqual(melhor["score"], max(b["score"] for b in blocos))
        # a maior receita do ano mediano, hoje ou no futuro, vale renda 1
        self.assertEqual(max(s["diario"][c]["mediano"]["renda"] for s in self.saida["sequencias"] for c in ("hoje", "futuro")), 1.0)

    def test_prioridades_valem_no_modo_diario(self):
        saida = recomendar({**ENTRADA, "prioridades": {"agua": 1}}, *self.dados, diario=self.serie)
        for s in saida["sequencias"]:
            b = s["diario"]["hoje"]["mediano"]
            self.assertAlmostEqual(b["score"], 100 * b["agua"], delta=0.1)

    def test_serie_futura(self):
        hoje, futuro = motor._tabela_clima(self.dados[1]), motor._tabela_clima(self.dados[2])
        serie = motor._serie_diaria(self.serie, ENTRADA["lat"])
        et0_h, et0_f = motor.et0_do_clima(hoje, ENTRADA["lat"]), motor.et0_do_clima(futuro, ENTRADA["lat"])
        fut = motor._serie_futura(serie, hoje, futuro, et0_h, et0_f)
        i = 40  # 10 de fevereiro de 2001
        self.assertEqual(serie["datas"][i].month, 2)
        self.assertAlmostEqual(fut["tmax"][i] - serie["tmax"][i], futuro[1]["tmax_c"] - hoje[1]["tmax_c"])
        self.assertAlmostEqual(fut["tmin"][i] - serie["tmin"][i], futuro[1]["tmin_c"] - hoje[1]["tmin_c"])
        self.assertAlmostEqual(fut["chuva"][i] / serie["chuva"][i], futuro[1]["chuva_mm"] / hoje[1]["chuva_mm"])
        self.assertAlmostEqual(fut["et0"][i] / serie["et0"][i], et0_f[1] / et0_h[1])
        # dia sem chuva continua sem chuva; a serie de hoje nao e alterada
        seca = {**serie, "chuva": [0.0] * len(serie["chuva"])}
        self.assertEqual(set(motor._serie_futura(seca, hoje, futuro, et0_h, et0_f)["chuva"]), {0.0})
        self.assertEqual(serie["tmax"][i], hoje[1]["tmax_c"])

    def test_calor_conta_os_dias_da_fase_sensivel(self):
        c = {**motor._tabela_culturas(self.dados[0])["milho"], "ciclo_dias": 100, "temp_calor_c": 35}
        n = 100
        serie = {"chuva": [10.0] * n, "et0": [4.0] * n, "tmin": [20.0] * n, "tmax": [30.0] * n}
        for d in (10, 50, 60, 79, 80, 95):  # fase sensivel: dias 45 a 79
            serie["tmax"][d] = 36.0
        r, _ = motor.simular_cultura_diaria(c, 0, serie, 0.0)
        self.assertEqual(r["dias_calor"], 3)
        self.assertAlmostEqual(r["encaixe_calor"], 1 - 3 / 35)
        sem_limiar, _ = motor.simular_cultura_diaria({**c, "temp_calor_c": None}, 0, serie, 0.0)
        self.assertEqual(sem_limiar["encaixe_calor"], 1.0)

    def test_sem_et0_calcula_hargreaves_do_dia(self):
        serie = motor._serie_diaria(self.serie.drop(columns=["et0_mm"]), ENTRADA["lat"])
        for v in serie["et0"]:
            self.assertTrue(1.5 < v < 8.0, v)  # mm/dia
        saida = recomendar(ENTRADA, *self.dados, diario=self.serie.drop(columns=["et0_mm"]))
        self.assertEqual(saida["diario"]["n_anos"], 9)

    def test_sem_sequencia_viavel(self):
        saida = recomendar({**ENTRADA, "mes_plantio": 4, "horizonte": 1}, *self.dados, diario=self.serie)
        self.assertEqual(saida["sequencias"], [])
        self.assertIn("n_anos", saida["diario"])

    def test_series_invalidas(self):
        casos = [
            self.serie.drop(columns=["chuva_mm"]),
            self.serie.drop(index=100),  # um dia faltando
            pd.concat([self.serie, self.serie.iloc[[5]]]),  # um dia repetido
            self.serie.assign(tmax_c=[None] + list(self.serie["tmax_c"][1:])),
            serie_das_medias(self.dados[1], 2001, 2003),  # so 2 safras completas
        ]
        for caso in casos:
            with self.assertRaises(ValueError):
                recomendar(ENTRADA, *self.dados, diario=caso)

    def test_diario_do_power(self):
        power = pd.DataFrame({
            "data": pd.date_range("2020-01-30", periods=4, freq="D"),
            "PRECTOTCORR": [0.0, 5.5, 12.0, 1.0], "T2M_MIN": [20.0] * 4, "T2M_MAX": [30.0] * 4,
        })  # fmt: skip
        correcoes = pd.DataFrame({"mes": range(1, 13), "off_tmin": [-1.0] * 12, "off_tmax": [1.0, 2.0] + [0.0] * 10})
        sem, com = diario_do_power(power, -20.0), diario_do_power(power, -20.0, correcoes)
        self.assertEqual(list(sem.columns), ["data", "chuva_mm", "tmin_c", "tmax_c", "et0_mm"])
        self.assertEqual(list(sem["chuva_mm"]), [0.0, 5.5, 12.0, 1.0])
        self.assertEqual(list(com["tmin_c"]), [19.0] * 4)
        self.assertEqual(list(com["tmax_c"]), [31.0, 31.0, 32.0, 32.0])  # janeiro +1, fevereiro +2
        self.assertEqual(list(com["et0_mm"]), list(sem["et0_mm"]))  # o ET0 nao leva a correcao
        self.assertTrue(4.0 < sem["et0_mm"][0] < 7.0)  # mm/dia, verao a 20 graus S

    def test_carregar_diario_sem_arquivo(self):
        self.assertIsNone(carregar_diario(FIXOS))


class TestAvisos(unittest.TestCase):
    """Lacunas e riscos por sequencia, gerados dos numeros da propria sequencia."""

    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados(FIXOS)
        cls.saida = recomendar(ENTRADA, *cls.dados)

    def avisos(self, seq_id, saida=None, codigo=None):
        seq = next(s for s in (saida or self.saida)["sequencias"] if s["id"] == seq_id)
        return [a for a in seq["avisos"] if codigo in (None, a["codigo"])]

    def test_formato(self):
        json.dumps(self.saida)
        for s in self.saida["sequencias"]:
            for a in s["avisos"]:
                self.assertEqual(set(a), {"tipo", "codigo", "cultura", "cenario", "dados", "texto"})
                self.assertIn(a["tipo"], ("risco", "lacuna"))
                self.assertTrue(a["texto"].endswith("."))
                self.assertIn(a["cultura"], [None, *s["culturas"]])
        self.assertNotIn("avisos", self.saida["descartadas"][0])

    def test_nao_muda_score_nem_ordem(self):
        with mock.patch.object(motor, "AVISO_FATOR", 2.0):  # tudo vira aviso
            saida = recomendar(ENTRADA, *self.dados)
        self.assertEqual([(s["id"], s["hoje"]["score"]) for s in saida["sequencias"]],
                         [(s["id"], s["hoje"]["score"]) for s in self.saida["sequencias"]])  # fmt: skip

    def test_fator_limitante_aponta_o_dado(self):
        # algodao (limiar de 32 graus C) na safra: o calor e o que mais limita, e piora no futuro
        avisos = self.avisos("algodao", recomendar({**ENTRADA, "horizonte": 1}, *self.dados), "fator_limitante")
        self.assertEqual([(a["cultura"], a["cenario"], a["dados"]["fator"]) for a in avisos],
                         [("algodao", "hoje", "calor"), ("algodao", "futuro", "calor")])  # fmt: skip
        saida = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        for a in avisos:
            self.assertEqual(a["dados"]["valor"], cultura_de(saida, "algodao", a["cenario"], 0)["encaixe_calor"])
            self.assertLess(a["dados"]["valor"], motor.AVISO_FATOR)
        self.assertLess(avisos[1]["dados"]["valor"], avisos[0]["dados"]["valor"])

    def test_sem_fator_abaixo_do_limite_nao_avisa(self):
        with mock.patch.object(motor, "AVISO_FATOR", 0.0):
            saida = recomendar(ENTRADA, *self.dados)
        self.assertFalse(any(a["codigo"] == "fator_limitante" for s in saida["sequencias"] for a in s["avisos"]))

    def test_queda_no_futuro(self):
        saida = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        seq = next(s for s in saida["sequencias"] if s["id"] == "algodao")
        (a,) = self.avisos("algodao", saida, "queda_no_futuro")
        self.assertAlmostEqual(a["dados"]["queda"], 1 - seq["futuro"]["receita_ha"] / seq["hoje"]["receita_ha"], places=3)
        self.assertGreater(a["dados"]["queda"], motor.AVISO_QUEDA_FUTURO)
        self.assertEqual(self.avisos("soja", saida, "queda_no_futuro"), [])

    def test_repeticao(self):
        # historico soja, milho: o milho na safra repete a cultura anterior
        (a,) = self.avisos("milho>crotalaria", codigo="repete_a_cultura")
        self.assertEqual((a["cultura"], a["dados"]["fator_sequencia"]), ("milho", 0.85))
        self.assertEqual(self.avisos("soja>milho", codigo="repete_a_cultura"), [])

    def test_solo_exposto(self):
        (a,) = self.avisos("soja>milho", codigo="solo_exposto")  # o milho de teste nao deixa palhada: 115 dias
        self.assertEqual(a["dados"]["dias_expostos"], 115)
        self.assertEqual(self.avisos("soja>crotalaria", codigo="solo_exposto"), [])  # 31 dias

    def test_lacunas_da_tabela(self):
        codigos = lambda cultura: {a["codigo"] for a in self.avisos("soja>crotalaria") if a["cultura"] == cultura}  # noqa: E731
        self.assertEqual(codigos("crotalaria"), {"sem_limiar_de_calor", "sem_valor_de_mercado"})
        self.assertEqual(codigos("soja"), set())
        saida = recomendar({**ENTRADA, "horizonte": 1}, *self.dados)
        (a,) = self.avisos("algodao", saida, "limiar_de_calor_pouco_confiavel")
        self.assertEqual(a["dados"], {"temp_calor_c": 32})
        # preco editado para a crotalaria tira o aviso de preco zero
        saida = recomendar({**ENTRADA, "precos": {"crotalaria": 500}}, *self.dados)
        self.assertEqual(self.avisos("soja>crotalaria", saida, "sem_valor_de_mercado"), [])

    def test_sem_historico(self):
        saida = recomendar({**ENTRADA, "rotacao_atual": []}, *self.dados)
        for s in saida["sequencias"]:
            self.assertEqual(len([a for a in s["avisos"] if a["codigo"] == "sem_historico"]), 1)
        self.assertEqual(self.avisos("soja>milho", codigo="sem_historico"), [])

    def test_coluna_de_status(self):
        # soja, milho, crotalaria, algodao
        culturas = self.dados[0].assign(preco_status=[None, "memoria", "", None], temp_calor_c_status=["sem fonte", None, None, None])
        saida = recomendar(ENTRADA, culturas, *self.dados[1:])
        avisos = self.avisos("soja>milho", saida, "valor_a_conferir")
        self.assertEqual([(a["cultura"], a["dados"]) for a in avisos], [
            ("soja", {"campo": "temp_calor_c", "status": "sem fonte", "valor": 38}),
            ("milho", {"campo": "preco", "status": "memoria", "valor": 1000.0}),
        ])  # fmt: skip
        self.assertEqual(self.avisos("soja>milho", codigo="valor_a_conferir"), [])  # sem as colunas, sem aviso

    def test_avisos_do_modo_diario(self):
        serie = serie_das_medias(self.dados[1], 2001, 2010)
        seca = (serie["data"] >= "2003-10-01") & (serie["data"] < "2005-10-01")  # 2 anos secos em 9
        serie.loc[seca, "chuva_mm"] *= 0.2
        saida = recomendar(ENTRADA, *self.dados, diario=serie)
        seq = next(s for s in saida["sequencias"] if s["id"] == "soja>milho")
        (a,) = [a for a in seq["avisos"] if a["codigo"] == "queda_no_ano_ruim" and a["cenario"] == "hoje"]
        b = seq["diario"]["hoje"]
        self.assertAlmostEqual(a["dados"]["queda"], 1 - b["ruim"]["receita_ha"] / b["mediano"]["receita_ha"], places=3)
        ky = self.avisos("soja>crotalaria", saida, "ky_padrao")
        self.assertEqual([(a["cultura"], a["dados"]["ky"]) for a in ky], [("crotalaria", motor.KY_PADRAO)])
        self.assertEqual(self.avisos("soja>milho", saida, "ky_padrao"), [])
        # sem a serie, esses dois avisos nao existem
        self.assertEqual(self.avisos("soja>crotalaria", codigo="ky_padrao"), [])


class TestBeneficios(unittest.TestCase):
    """Beneficios por sequencia, so com o que entra na conta do motor (regra 18)."""

    @classmethod
    def setUpClass(cls):
        cls.dados = carregar_dados(FIXOS)
        cls.saida = recomendar(ENTRADA, *cls.dados)

    def seq(self, seq_id, saida=None):
        return next(s for s in (saida or self.saida)["sequencias"] if s["id"] == seq_id)

    def codigos(self, seq_id, saida=None, cultura=False):
        return [(b["codigo"], b["cultura"]) if cultura else b["codigo"] for b in self.seq(seq_id, saida)["beneficios"]]

    def test_formato(self):
        json.dumps(self.saida)
        for s in self.saida["sequencias"]:
            for b in s["beneficios"]:
                self.assertEqual(set(b), {"codigo", "cultura", "cenario", "dados", "texto"})
                self.assertTrue(b["texto"].endswith("."))
                self.assertIn(b["cultura"], [None, *s["culturas"]])
        self.assertNotIn("beneficios", self.saida["descartadas"][0])

    def test_atributos_da_tabela_em_cada_cultura(self):
        r = cultura_de(self.saida, "soja>crotalaria", "hoje", 1)
        self.assertEqual((r["fixa_n"], r["cobre_solo"]), (True, True))
        r = cultura_de(self.saida, "soja>milho", "futuro", 1)
        self.assertEqual((r["fixa_n"], r["cobre_solo"]), (False, False))

    def test_beneficios_por_cultura(self):
        self.assertEqual(
            [c for c in self.codigos("soja>crotalaria", cultura=True) if c[1]],
            [("fixa_nitrogenio", "soja"), ("fixa_nitrogenio", "crotalaria"), ("deixa_palhada", "crotalaria")],
        )
        (b,) = [b for b in self.seq("soja>milho")["beneficios"] if b["codigo"] == "bonus_apos_fixadora"]
        self.assertEqual((b["cultura"], b["dados"]["fator_sequencia"]), ("milho", motor.BONUS_APOS_FIXADORA))
        self.assertEqual(cultura_de(self.saida, "soja>milho", "hoje", 1)["fator_sequencia"], motor.BONUS_APOS_FIXADORA)

    def test_cultura_repetida_conta_uma_vez(self):
        culturas = self.dados[0].copy()
        culturas.loc[culturas["cultura"] == "milho", ["fixa_n", "cobre_solo"]] = 1
        codigos = self.codigos("milho>milho", recomendar(ENTRADA, culturas, *self.dados[1:]), cultura=True)
        self.assertEqual(codigos.count(("fixa_nitrogenio", "milho")), 1)
        self.assertEqual(codigos.count(("deixa_palhada", "milho")), 1)

    def test_complementa_os_avisos(self):
        # cada sequencia tem o aviso ou o beneficio, nunca os dois nem nenhum
        pares = [("solo_exposto", "pouco_solo_exposto"), ("queda_no_futuro", "estavel_no_futuro")]
        for s in self.saida["sequencias"]:
            avisos = {a["codigo"] for a in s["avisos"]}
            beneficios = {b["codigo"] for b in s["beneficios"]}
            for aviso, beneficio in pares:
                if beneficio == "estavel_no_futuro" and s["hoje"]["receita_ha"] == 0:
                    continue
                self.assertNotEqual(aviso in avisos, beneficio in beneficios, (s["id"], aviso))
            limitado = any(a["codigo"] == "fator_limitante" and a["cenario"] in ("hoje", "futuro") for a in s["avisos"])
            self.assertNotEqual(limitado, "clima_favoravel" in beneficios, s["id"])

    def test_numeros_apontam_o_dado(self):
        s = self.seq("soja>crotalaria")
        (b,) = [b for b in s["beneficios"] if b["codigo"] == "pouco_solo_exposto"]
        self.assertEqual(b["dados"]["dias_expostos"], s["hoje"]["descoberto"]["dias_expostos"])
        (b,) = [b for b in s["beneficios"] if b["codigo"] == "estavel_no_futuro"]
        self.assertAlmostEqual(b["dados"]["queda"], 1 - s["futuro"]["receita_ha"] / s["hoje"]["receita_ha"], places=3)

    def test_nao_muda_score_nem_ordem(self):
        with mock.patch.object(motor, "AVISO_FATOR", 0.0), mock.patch.object(motor, "AVISO_DIAS_EXPOSTOS", 999):
            saida = recomendar(ENTRADA, *self.dados)
        self.assertEqual([(s["id"], s["hoje"]["score"]) for s in saida["sequencias"]],
                         [(s["id"], s["hoje"]["score"]) for s in self.saida["sequencias"]])  # fmt: skip


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

    def test_roda_com_o_ano_seco_de_data(self):
        dados = carregar_dados()
        seco = carregar_clima_seco()
        self.assertEqual(len(seco), 12)
        for mes in (10, 2):
            saida = recomendar({**ENTRADA, "mes_plantio": mes}, *dados, seco)
            json.dumps(saida)
            for s in saida["sequencias"]:
                self.assertTrue(0 <= s["seco"]["score"] <= 100)
                self.assertTrue(0 <= s["seco"]["renda"] <= 1)

    def test_roda_com_a_serie_diaria_de_data(self):
        dados = carregar_dados()
        diario = carregar_diario()
        self.assertEqual(list(diario.columns), ["data", "chuva_mm", "tmin_c", "tmax_c", "et0_mm"])
        # a serie e a origem de clima_hoje.csv: a chuva media por ano tem que bater
        anos = diario["data"].dt.year.nunique()
        self.assertAlmostEqual(diario["chuva_mm"].sum() / anos, dados[1]["chuva_mm"].sum(), delta=5)
        self.assertAlmostEqual(diario["et0_mm"].sum() / anos, dados[1]["et0_mm"].sum(), delta=30)
        for mes, horizonte in [(10, 2), (10, 1), (2, 2), (2, 1)]:
            saida = recomendar({**ENTRADA, "mes_plantio": mes, "horizonte": horizonte}, *dados, diario=diario)
            json.dumps(saida)
            self.assertGreaterEqual(saida["diario"]["n_anos"], 15, (mes, horizonte))
            for s in saida["sequencias"]:
                for cen in ("hoje", "futuro"):
                    b = s["diario"][cen]
                    self.assertTrue(0 <= b["ruim"]["score"] <= b["mediano"]["score"] + 100)
                    self.assertTrue(0 <= b["ruim"]["agua"] <= b["mediano"]["agua"] <= 1)
                    self.assertLessEqual(b["ruim"]["receita_ha"], b["mediano"]["receita_ha"])


if __name__ == "__main__":
    unittest.main()
