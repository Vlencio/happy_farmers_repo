"""Transport only: scoring, climate and scheduling remain in motor/."""
from contextlib import asynccontextmanager
import os
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import anthropic
from pydantic import BaseModel, ConfigDict, Field, model_validator

from motor import carregar_clima_modelos, carregar_clima_seco, carregar_dados, recomendar
from backend.chat import MAX_FOCO, MAX_MENSAGEM, Chat, RespostaVazia
from backend.field_context import load_demo_field, load_model_spread
from backend.point_climate import PointClimate
from backend.soil import SoilSuggestion

NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class Prioridades(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agua: NonNegative = 0
    solo: NonNegative = 0
    renda: NonNegative = 0


class Ajuste(BaseModel):
    """What-if scenario (engine rule 19). Ranges mirror AJUSTE_CHUVA_PCT and AJUSTE_TEMP_C in motor/."""
    model_config = ConfigDict(extra="forbid")
    chuva_pct: Annotated[float, Field(ge=-50, le=30, allow_inf_nan=False)] = 0
    temp_c: Annotated[float, Field(ge=0, le=4, allow_inf_nan=False)] = 0


class EntradaMotor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float | None, Field(ge=-180, le=180, allow_inf_nan=False)] = None
    rotacao_atual: Annotated[list[str], Field(max_length=12)] = Field(default_factory=list)
    prioridades: Prioridades = Field(default_factory=lambda: Prioridades(agua=1, solo=1, renda=1))
    horizonte: Literal[1, 2] = 2
    mes_plantio: Annotated[int, Field(ge=1, le=12)] = 10
    precos: dict[str, NonNegative] = Field(default_factory=dict)
    # Optional mean slope of the field (%); the engine then adds indice_erosao to descoberto.
    declividade_pct: Annotated[float | None, Field(ge=0, le=100, allow_inf_nan=False)] = None
    # Optional soil texture confirmed by the farmer: the engine sets the soil water storage from it.
    solo_textura: Literal["arenoso", "medio", "argiloso"] | None = None
    # Optional what-if: rain in % and temperature in degrees C, applied by the engine to every climate.
    ajuste: Ajuste | None = None


class MensagemChat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    papel: Literal["produtor", "assistente"]
    texto: Annotated[str, Field(min_length=1, max_length=MAX_MENSAGEM)]


class EntradaChat(BaseModel):
    model_config = ConfigDict(extra="forbid")
    analise: dict  # the /analyze response, as the screen received it
    foco: Annotated[list[str], Field(max_length=MAX_FOCO)] = Field(default_factory=list)
    historico: Annotated[list[MensagemChat], Field(max_length=20)] = Field(default_factory=list)
    pergunta: Annotated[str, Field(min_length=1, max_length=1000)]

    @model_validator(mode="after")
    def historico_comeca_pelo_produtor(self):
        if self.historico and self.historico[0].papel != "produtor":
            raise ValueError("O histórico começa por uma mensagem do produtor.")
        return self


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load delivered tables once. POWER is requested only when analyzing another point.
    app.state.tables = carregar_dados()
    app.state.dry_climate = carregar_clima_seco()
    app.state.model_climates = carregar_clima_modelos()  # per-model deltas: demo field only
    app.state.soil = SoilSuggestion()
    app.state.point_climate = PointClimate()
    app.state.demo_field = load_demo_field()
    app.state.model_spread = load_model_spread()
    app.state.chat = Chat.from_env()  # None without Claude credentials: the screen hides the chat
    yield


app = FastAPI(title="Happy Farmers · motor", version="1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("HAPPY_FARMERS_ORIGINS", "http://127.0.0.1:4173,http://localhost:4173").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

LABELS = {"feijao": "Feijão", "algodao": "Algodão", "braquiaria": "Braquiária", "crotalaria": "Crotalária"}
DATA_NOTICE = (
    "Clima de hoje: POWER 2005–2024; futuro: por volta de 2060, com deltas regionais. "
    "Perto do talhão de demonstração usamos tabelas prontas. Confira os avisos de origem no resultado. "
    "O calendário de plantio é do Triângulo Mineiro; valide a adequação local."
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "happy-farmers-motor", "contract": "2026-11-14"}


@app.get("/metadata")
def metadata(
    lat: Annotated[float | None, Query(ge=-90, le=90, allow_inf_nan=False)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180, allow_inf_nan=False)] = None,
):
    if (lat is None) != (lon is None):
        raise HTTPException(status_code=422, detail="Envie lat e lon juntos para a sugestão de solo.")
    result = {
        "contract": "2026-11-14",
        "cultures": [{"id": name, "label": LABELS.get(name, name.capitalize())}
                     for name in app.state.tables[0]["cultura"].tolist()],
        "data_notice": DATA_NOTICE,
        "climate_periods": {"hoje": "2005–2024", "futuro": "por volta de 2060"},
        "demo_field": app.state.demo_field,
        "model_spread": app.state.model_spread,
        "point_climate_available": True,
        "capabilities": {
            "declividade_pct": True, "ajuste": True, "solo_textura": app.state.soil.available,
            "chat": app.state.chat is not None,
        },
    }
    if lat is not None:  # suggested texture of the point, from the local table only (no POWER request)
        result["solo"] = app.state.soil.get(lat, lon)
    return result


@app.post("/analyze")
def analyze(entrada: EntradaMotor):
    try:
        request = entrada.model_dump(exclude={"lon"})
        cultures, today, future = app.state.tables
        # Reject invalid catalog IDs before making a potentially slow network request.
        unknown = sorted((set(entrada.rotacao_atual) | set(entrada.precos)) - set(cultures["cultura"]))
        if unknown:
            raise ValueError(f"Culturas fora da tabela: {unknown}.")
        dry = app.state.dry_climate
        models = app.state.model_climates
        origin = None
        if entrada.lon is not None:
            climate = app.state.point_climate.get(entrada.lat, entrada.lon)
            today, future, origin = climate["clima_hoje"], climate["clima_futuro"], climate["origem"]
            # P1's delivered dry year is local to the demo, not a dry year for other farms.
            # The same goes for the per-model deltas: the regional grid only has the model average.
            if origin["hoje"] != "tabela_demo":
                dry = None
                models = None
        result = recomendar(request, cultures, today, future, dry, clima_modelos=models)
        if origin is not None:
            result["origem"] = origin
        return result
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=503, detail="Não foi possível ler os dados climáticos. Tente novamente.") from error


@app.post("/chat")
def chat(entrada: EntradaChat):
    """Answers the farmer's question about one analysis. The LLM explains; the engine computes."""
    if app.state.chat is None:
        raise HTTPException(status_code=503, detail="O chat não está disponível neste servidor.")
    try:
        historico = [m.model_dump() for m in entrada.historico]
        return app.state.chat.responder(entrada.analise, entrada.foco, historico, entrada.pergunta)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except RespostaVazia as error:
        raise HTTPException(status_code=502, detail="O modelo não devolveu resposta. Tente de novo.") from error
    except anthropic.RateLimitError as error:
        raise HTTPException(status_code=503, detail="O chat está muito usado agora. Tente de novo em instantes.") from error
    except (anthropic.AuthenticationError, anthropic.PermissionDeniedError) as error:
        raise HTTPException(status_code=503, detail="O chat está sem credencial válida neste servidor.") from error
    except (anthropic.APIConnectionError, anthropic.InternalServerError) as error:
        raise HTTPException(status_code=503, detail="Não foi possível falar com o modelo. Tente de novo.") from error
    except anthropic.APIStatusError as error:
        raise HTTPException(status_code=502, detail="O modelo recusou a requisição do chat.") from error
