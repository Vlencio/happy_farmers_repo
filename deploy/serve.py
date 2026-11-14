"""Entrada de producao: a API do motor e o front-end compilado, no mesmo servico.

Uso: uvicorn deploy.serve:app --host 0.0.0.0 --port $PORT

O front-end precisa ser compilado com VITE_API_BASE_URL=/ (ver Dockerfile), para
chamar /metadata e /analyze na mesma origem, sem o proxy /api do Vite.
"""
from pathlib import Path

from fastapi.staticfiles import StaticFiles

from backend.app import app

SITE = Path(__file__).resolve().parent.parent / "frontend" / "dist"

# As rotas da API ja estao registradas e tem prioridade; todo o resto e o site.
app.mount("/", StaticFiles(directory=SITE, html=True), name="site")
