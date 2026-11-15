import json
import unittest
from pathlib import Path
from types import SimpleNamespace

import anthropic
import httpx2
from fastapi.testclient import TestClient

from backend.app import app
from backend.chat import MODELO_PADRAO, RESPOSTA_RECUSADA, Chat, chat_disponivel, montar_contexto

ANALISE = json.loads((Path(__file__).resolve().parents[2] / "frontend" / "tests" / "fixtures" / "motor.json").read_text(encoding="utf-8"))


class FakeClient:
    """Stands in for anthropic.Anthropic: records the request and returns a canned reply."""

    def __init__(self, texto="Resposta.", stop_reason="end_turn", erro=None):
        self.chamadas = []
        self.texto, self.stop_reason, self.erro = texto, stop_reason, erro
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self.create))

    def create(self, **kwargs):
        self.chamadas.append(kwargs)
        if self.erro is not None:
            raise self.erro
        content = [SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=self.texto)]
        return SimpleNamespace(stop_reason=self.stop_reason, model=kwargs["model"], content=content)


def erro_http(classe, status):
    request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    return classe("erro", response=httpx2.Response(status, request=request), body=None)


class TestContexto(unittest.TestCase):
    def test_foco_padrao_sao_as_tres_melhores_e_a_atual(self):
        contexto = montar_contexto(ANALISE, [])
        ids = [s["id"] for s in contexto["sequencias_em_foco"]]
        ordem = [s["id"] for s in sorted(ANALISE["sequencias"], key=lambda s: s["rank_hoje"])]
        atual = [s["id"] for s in ANALISE["sequencias"] if s["atual"]]
        self.assertEqual(ids, list(dict.fromkeys(ordem[:3] + atual)))

    def test_foco_escolhido_e_sem_series_mensais(self):
        alvo = ANALISE["sequencias"][-1]["id"]
        (s,) = montar_contexto(ANALISE, [alvo, alvo])["sequencias_em_foco"]
        self.assertEqual(s["id"], alvo)
        self.assertNotIn("meses", s["hoje"]["descoberto"])
        self.assertTrue(all("meses" not in c for c in s["futuro"]["culturas"]))
        # os numeros que o chat pode citar continuam la, iguais aos do motor
        original = next(x for x in ANALISE["sequencias"] if x["id"] == alvo)
        self.assertEqual(s["hoje"]["receita_ha"], original["hoje"]["receita_ha"])
        self.assertEqual(s["avisos"], original["avisos"])
        self.assertEqual(s["beneficios"], original["beneficios"])

    def test_rejeita_analise_ou_foco_invalidos(self):
        with self.assertRaises(ValueError):
            montar_contexto({"sequencias": []}, [])
        with self.assertRaises(ValueError):
            montar_contexto(ANALISE, ["cafe>soja"])

    def test_disponivel_so_com_credencial(self):
        self.assertFalse(chat_disponivel({}))
        self.assertTrue(chat_disponivel({"ANTHROPIC_API_KEY": "x"}))
        self.assertTrue(chat_disponivel({"HAPPY_FARMERS_CHAT": "1"}))


class TestChatApi(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.client.__enter__()
        self.original = app.state.chat

    def tearDown(self):
        app.state.chat = self.original
        self.client.__exit__(None, None, None)

    def post(self, **corpo):
        return self.client.post("/chat", json={"analise": ANALISE, "pergunta": "Por que soja e milho?", **corpo})

    def test_sem_credencial_o_chat_fica_desligado(self):
        app.state.chat = None
        self.assertFalse(self.client.get("/metadata").json()["capabilities"]["chat"])
        self.assertEqual(self.post().status_code, 503)

    def test_resposta_e_requisicao(self):
        fake = FakeClient("A soja fixa nitrogênio.")
        app.state.chat = Chat(fake)
        self.assertTrue(self.client.get("/metadata").json()["capabilities"]["chat"])
        historico = [{"papel": "produtor", "texto": "Oi"}, {"papel": "assistente", "texto": "Olá!"}]
        response = self.post(historico=historico, foco=["soja>milho"])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"resposta": "A soja fixa nitrogênio.", "modelo": MODELO_PADRAO, "recusada": False})
        (chamada,) = fake.chamadas
        self.assertEqual(chamada["model"], MODELO_PADRAO)
        self.assertEqual(chamada["fallbacks"], "default")
        self.assertEqual([m["role"] for m in chamada["messages"]], ["user", "assistant", "user"])
        self.assertEqual(chamada["messages"][-1]["content"], "Por que soja e milho?")
        instrucoes, dados = (b["text"] for b in chamada["system"])
        self.assertIn("não calcule valores novos", instrucoes)
        contexto = json.loads(dados.removeprefix("<analise>\n").removesuffix("\n</analise>"))
        self.assertEqual([s["id"] for s in contexto["sequencias_em_foco"]], ["soja>milho"])

    def test_contexto_igual_entre_perguntas_para_o_cache(self):
        fake = FakeClient()
        app.state.chat = Chat(fake)
        self.post(pergunta="Primeira?")
        self.post(pergunta="Segunda?", historico=[{"papel": "produtor", "texto": "Primeira?"}, {"papel": "assistente", "texto": "Resposta."}])
        self.assertEqual(fake.chamadas[0]["system"], fake.chamadas[1]["system"])

    def test_recusa_vira_texto_fixo(self):
        app.state.chat = Chat(FakeClient(stop_reason="refusal"))
        self.assertEqual(self.post().json()["resposta"], RESPOSTA_RECUSADA)

    def test_validacao(self):
        app.state.chat = Chat(FakeClient())
        for corpo in [
            {"pergunta": ""}, {"pergunta": "x" * 1001}, {"foco": ["a"] * 7},
            {"historico": [{"papel": "assistente", "texto": "Olá"}]},
            {"historico": [{"papel": "agronomo", "texto": "Olá"}]}, {"extra": 1},
            {"foco": ["cafe>soja"]},
        ]:
            self.assertEqual(self.post(**corpo).status_code, 422, corpo)
        self.assertEqual(self.client.post("/chat", json={"analise": {}, "pergunta": "Oi?"}).status_code, 422)

    def test_falhas_do_modelo_sao_explicitas(self):
        request = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
        for erro, status in [
            (erro_http(anthropic.RateLimitError, 429), 503),
            (erro_http(anthropic.AuthenticationError, 401), 503),
            (erro_http(anthropic.InternalServerError, 500), 503),
            (anthropic.APIConnectionError(request=request), 503),
            (erro_http(anthropic.BadRequestError, 400), 502),
        ]:
            app.state.chat = Chat(FakeClient(erro=erro))
            self.assertEqual(self.post().status_code, status, type(erro).__name__)


if __name__ == "__main__":
    unittest.main()
