# Happy Farmers: uma imagem com a API do motor e o front-end compilado.
# Usada no deploy (Railway). Para rodar local, veja frontend/README.md.

# --- 1. Front-end: Rune (Rust -> WebAssembly) e depois Vite ---
FROM node:22-bookworm AS front
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain none
ENV PATH="/root/.cargo/bin:${PATH}"
WORKDIR /app/frontend

# Toolchain e wasm-bindgen primeiro: sao lentos e mudam pouco, entao ficam em cache.
COPY frontend/rust-toolchain.toml ./
RUN rustup show active-toolchain
RUN cargo install wasm-bindgen-cli --version 0.2.129 --locked

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# "/" faz o front-end chamar a API na mesma origem (/metadata, /analyze).
ENV VITE_API_BASE_URL=/
RUN npm run build -- --release

# --- 2. Execucao: FastAPI + motor + tabelas e contexto do talhao + site ---
FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY motor/ motor/
COPY backend/ backend/
COPY deploy/ deploy/
COPY scripts/ scripts/
COPY data/culturas.csv data/clima_*.csv data/talhao_demo_2.geojson data/
COPY data/nexgddp/regiao_mg/delta_mensal.csv data/nexgddp/regiao_mg/
COPY data/talhao/ndvi_climatologia.csv data/talhao/declividade.csv data/talhao/
RUN mkdir -p data/power
COPY --from=front /app/frontend/dist frontend/dist

ENV PORT=8000
CMD ["sh", "-c", "uvicorn deploy.serve:app --host 0.0.0.0 --port ${PORT}"]
