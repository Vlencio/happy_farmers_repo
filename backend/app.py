"""Transport only: scoring, climate and scheduling remain in motor/."""
from contextlib import asynccontextmanager
import os
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from motor import carregar_dados, recomendar

NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class Prioridades(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agua: NonNegative = 0
    solo: NonNegative = 0
    renda: NonNegative = 0


class EntradaMotor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    rotacao_atual: Annotated[list[str], Field(max_length=12)] = Field(default_factory=list)
    prioridades: Prioridades = Field(default_factory=lambda: Prioridades(agua=1, solo=1, renda=1))
    horizonte: Literal[1, 2] = 2
    mes_plantio: Annotated[int, Field(ge=1, le=12)] = 10
    precos: dict[str, NonNegative] = Field(default_factory=dict)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Read the existing tables once; no data collection or modifications.
    app.state.tables = carregar_dados()
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
    "Clima de hoje: 2005–2024; futuro: 2041–2060. As tabelas são do talhão de demonstração, perto de -20.032, -48.526. "
    "Desenhar outra área ainda não carrega o clima daquele local. A área multiplica a receita por hectare."
)


@app.get("/health")
def health():
    return {"status": "ok", "service": "happy-farmers-motor", "contract": "2026-11-14"}


@app.get("/metadata")
def metadata():
    return {
        "contract": "2026-11-14",
        "cultures": [{"id": name, "label": LABELS.get(name, name.capitalize())}
                     for name in app.state.tables[0]["cultura"].tolist()],
        "data_notice": DATA_NOTICE,
        "climate_periods": {"hoje": "2005–2024", "futuro": "2041–2060"},
    }


@app.post("/analyze")
def analyze(entrada: EntradaMotor):
    try:
        # Return the engine's documented dict unchanged, including discarded sequences.
        return recomendar(entrada.model_dump(), *app.state.tables)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
