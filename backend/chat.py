"""Chat with the farmer about one analysis.

The LLM only explains the engine output that is already on screen. It never computes
scores, rankings or numbers: every figure it may quote is in the context built here.
"""
import json
import os

import anthropic

MODELO_PADRAO = "claude-opus-5-5"
BETA_FALLBACK = "server-side-fallback-2026-07-01"  # on a refusal the API retries on a fallback model
MAX_FOCO = 6
RESPOSTA_RECUSADA = (
    "Não consigo responder essa pergunta por aqui. Posso explicar os cards, o calendário, "
    "os avisos e os benefícios desta análise."
)

INSTRUCOES = """Você conversa com um produtor rural sobre a análise de rotação de culturas do talhão dele. A análise foi feita pelo app Happy Farmers com dados da NASA: clima observado do POWER (2005 a 2024), clima projetado do NEX-GDDP-CMIP6 (2041 a 2060, cenário SSP2-4.5), NDVI do MODIS e relevo do SRTM.

O resultado vem de um motor de regras e contas, sem IA. Seu papel é explicar esse resultado, não refazer a conta:
- Todo número que você citar precisa estar nos dados abaixo. Não estime, não calcule valores novos e não invente preço, produtividade, probabilidade ou porcentagem.
- Não crie score, ranking ou recomendação nova. Se o produtor perguntar sobre uma cultura ou sequência que não está nos dados, diga que esta análise não cobre isso e que ele pode rodar o app com outras escolhas.
- Benefícios e riscos de cada sequência estão em "beneficios" e "avisos". Não acrescente benefícios agronômicos que não estejam lá, como descompactar o solo ou controlar nematoides: o motor não os considera, e o texto ficaria em desacordo com os números.
- Você pode explicar termos (evapotranspiração, balanço hídrico, NDVI, palhada, fixação de nitrogênio, cenário climático) em linguagem simples.
- Quando a resposta depende de algo que os dados não têm, como o solo do talhão, pragas, mercado local ou crédito, diga isso e sugira confirmar com um agrônomo.
- Quando houver aviso do tipo "lacuna" ligado ao assunto, mencione que aquele valor ainda é provisório.

Como ler os dados:
- "hoje" é o clima médio de 2005 a 2024; "futuro" é 2041 a 2060; "seco", quando existe, é o ano agrícola 2020/21.
- "receita_ha" é a receita bruta em R$ por hectare, sem custo de produção. "score" vai de 0 a 100 e mistura "agua", "solo" e "renda", que vão de 0 a 1.
- "encaixe", "encaixe_temp", "encaixe_chuva", "encaixe_calor" e "atendimento_hidrico" vão de 0 a 1: 1 é sem perda.
- "descoberto" conta os dias do ano sem cultura; "dias_expostos" são os que também ficam sem palhada.
- Nos dados os nomes das culturas não têm acento (feijao, crotalaria, braquiaria, algodao). Escreva com acento.
- "sequencias_em_foco" são as estratégias que o produtor está vendo na tela; o id "soja>milho" significa soja e depois milho.

Responda em português do Brasil, de forma curta e direta: um ou dois parágrafos, ou uma lista curta com hífen. O app mostra texto simples, então não use títulos, negrito nem tabelas."""


def chat_disponivel(env=os.environ):
    """True when the server has Claude credentials (or the operator forces it with HAPPY_FARMERS_CHAT=1)."""
    return bool(env.get("ANTHROPIC_API_KEY") or env.get("ANTHROPIC_AUTH_TOKEN") or env.get("HAPPY_FARMERS_CHAT") == "1")


def _sequencia_compacta(s):
    """One sequence without the month-by-month series, which the chat does not need."""
    saida = {k: v for k, v in s.items() if k not in ("hoje", "futuro", "seco", "diario")}
    for cen in ("hoje", "futuro", "seco"):
        if cen in s:
            bloco = dict(s[cen])
            bloco["descoberto"] = {k: v for k, v in bloco.get("descoberto", {}).items() if k != "meses"}
            bloco["culturas"] = [{k: v for k, v in c.items() if k != "meses"} for c in bloco.get("culturas", [])]
            saida[cen] = bloco
    if "diario" in s:
        saida["diario"] = s["diario"]
    return saida


def montar_contexto(analise, foco):
    """The part of the engine output the chat may talk about.

    foco: ids of the sequences on screen (the three cards and the current rotation). Empty =
    the three best of today plus the current rotation.
    """
    sequencias = analise.get("sequencias")
    if not isinstance(sequencias, list) or not isinstance(analise.get("entrada"), dict):
        raise ValueError("A análise precisa ter 'entrada' e 'sequencias', como sai de /analyze.")
    por_id = {s.get("id"): s for s in sequencias if isinstance(s, dict)}
    if foco:
        desconhecidas = sorted(set(foco) - set(por_id))
        if desconhecidas:
            raise ValueError(f"Sequências fora da análise: {desconhecidas}.")
        ids = list(dict.fromkeys(foco))
    else:
        ordem = sorted(por_id.values(), key=lambda s: s.get("rank_hoje", 10**6))
        ids = [s["id"] for s in ordem[:3]] + [s["id"] for s in ordem if s.get("atual")]
        ids = list(dict.fromkeys(ids))
    clima = {
        cen: [{k: m.get(k) for k in ("mes", "chuva_mm", "tmin_c", "tmax_c", "et0_mm")} for m in meses]
        for cen, meses in (analise.get("clima") or {}).items()
    }
    contexto = {
        "entrada": analise["entrada"],
        "slots": analise.get("slots"),
        "atual": analise.get("atual"),
        "clima_mensal": clima,
        "total_de_sequencias_viaveis": len(sequencias),
        "sequencias_descartadas": len(analise.get("descartadas") or []),
        "sequencias_em_foco": [_sequencia_compacta(por_id[i]) for i in ids],
    }
    if "origem" in analise:
        contexto["origem_do_clima"] = analise["origem"]
    return contexto


class Chat:
    def __init__(self, client, model=MODELO_PADRAO):
        self.client = client
        self.model = model

    @classmethod
    def from_env(cls):
        if not chat_disponivel():
            return None
        return cls(anthropic.Anthropic(timeout=90.0, max_retries=2), os.getenv("HAPPY_FARMERS_CHAT_MODEL", MODELO_PADRAO))

    def responder(self, analise, foco, historico, pergunta):
        contexto = montar_contexto(analise, foco)
        dados = json.dumps(contexto, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        mensagens = [
            {"role": "user" if m["papel"] == "produtor" else "assistant", "content": m["texto"]} for m in historico
        ]
        mensagens.append({"role": "user", "content": pergunta})
        response = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            betas=[BETA_FALLBACK],
            fallbacks="default",
            output_config={"effort": "low"},
            # the instructions and the analysis do not change during a conversation: cache them
            cache_control={"type": "ephemeral"},
            system=[
                {"type": "text", "text": INSTRUCOES},
                {"type": "text", "text": f"<analise>\n{dados}\n</analise>"},
            ],
            messages=mensagens,
        )
        if response.stop_reason == "refusal":
            return {"resposta": RESPOSTA_RECUSADA, "modelo": response.model, "recusada": True}
        texto = "".join(b.text for b in response.content if b.type == "text").strip()
        return {"resposta": texto, "modelo": response.model, "recusada": False}
