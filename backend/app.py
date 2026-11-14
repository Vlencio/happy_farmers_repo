"""Transport only: scoring, climate and scheduling remain in motor/."""
from contextlib import asynccontextmanager
import os
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from motor import carregar_clima_seco, carregar_dados, recomendar
from backend.field_context import load_demo_field, load_model_spread
from backend.point_climate import PointClimate

NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class Prioridades(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agua: NonNegative = 0
    solo: NonNegative = 0
    renda: NonNegative = 0


class EntradaMotor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lat: Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)]
    lon: Annotated[float | None, Field(ge=-180, le=180, allow_inf_nan=False)] = None
    rotacao_atual: Annotated[list[str], Field(max_length=12)] = Field(default_factory=list)
    prioridades: Prioridades = Field(default_factory=lambda: Prioridades(agua=1, solo=1, renda=1))
    horizonte: Literal[1, 2] = 2
    mes_plantio: Annotated[int, Field(ge=1, le=12)] = 10
    precos: dict[str, NonNegative] = Field(default_factory=dict)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load delivered tables once. POWER is requested only when analyzing another point.
    app.state.tables = carregar_dados()
    app.state.dry_climate = carregar_clima_seco()
    app.state.point_climate = PointClimate()
    app.state.demo_field = load_demo_field()
    app.state.model_spread = load_model_spread()
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
    "Clima de hoje: POWER 2005–2024; futuro: 2041–2060, com deltas regionais. "
    "Perto do talhão de demonstração usamos tabelas prontas. Confira os avisos de origem no resultado. "
    "O calendário de plantio é do Triângulo Mineiro; valide a adequação local."
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
        "demo_field": app.state.demo_field,
        "model_spread": app.state.model_spread,
        "point_climate_available": True,
    }


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
        origin = None
        if entrada.lon is not None:
            climate = app.state.point_climate.get(entrada.lat, entrada.lon)
            today, future, origin = climate["clima_hoje"], climate["clima_futuro"], climate["origem"]
            # P1's delivered dry year is local to the demo, not a dry year for other farms.
            if origin["hoje"] != "tabela_demo":
                dry = None
        result = recomendar(request, cultures, today, future, dry)
        if origin is not None:
            result["origem"] = origin
        return result
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=503, detail="Não foi possível ler os dados climáticos. Tente novamente.") from error
