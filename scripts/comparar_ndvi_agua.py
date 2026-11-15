"""Compara, ano a ano, o indice de agua do modo diario do motor com o NDVI do talhao (Parte 11).

Uso: python scripts/comparar_ndvi_agua.py
Requer: pip install pandas numpy (sem scipy: as estatisticas sao calculadas aqui)

Sem dado novo e sem gravar nada: le data/culturas.csv, as tabelas de clima, a serie
diaria do POWER do talhao de demonstracao (via motor.carregar_diario) e o NDVI de
data/talhao/. Imprime a tabela ano a ano e as correlacoes. Resultado e limitacoes:
docs/ndvi_vs_agua.md.

Indices de agua (modo diario, clima de hoje, talhao livre em outubro):
- soja: horizonte 1, so a soja na safra. `agua` do ano = atendimento hidrico da soja
  (1 - deficit / ETc), plantio em 1 de outubro, ciclo de 115 dias.
- soja>milho: horizonte 2, soja na safra e milho na safrinha (a rotacao atual da demo).
  `agua` do ano = 1 - deficit / ETc somados nas duas culturas.
O `ano` do motor e o do talhao livre: 2014 = safra 2014/15.

NDVI do mesmo ano agricola (MOD13Q1, data/talhao/):
- dez-mar: media do NDVI mensal de dezembro a marco (canopia da safra).
- pico: maior NDVI de 16 dias de dezembro a marco.
- dez-mai: media do NDVI mensal de dezembro a maio (safra e safrinha).
O NDVI comeca em dez/2014: safras 2014/15 a 2023/24, 10 anos.

Referencia sem motor: chuva de outubro a marco do POWER (data/power/agua_por_ano.csv).

Estatistica: Pearson e Spearman, com p bilateral por permutacao (200 mil embaralhamentos,
semente fixa). Com 10 anos, so correlacoes acima de ~0,63 dao p < 0,05.
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from motor import carregar_dados, carregar_diario, recomendar  # noqa: E402

TALHAO = RAIZ / "data" / "talhao"
AGUA_POR_ANO = RAIZ / "data" / "power" / "agua_por_ano.csv"
N_PERMUTACOES = 200_000
SEMENTE = 2026

ENTRADA = {
    "lat": -20.032,
    "rotacao_atual": ["soja", "milho"],
    "prioridades": {"agua": 1, "solo": 1, "renda": 1},
    "mes_plantio": 10,
}


def agua_por_ano(sequencia, horizonte, dados, diario):
    """{ano: agua} do modo diario, clima de hoje, para uma sequencia."""
    saida = recomendar({**ENTRADA, "horizonte": horizonte}, *dados, None, diario)
    for s in saida["sequencias"]:
        if s["id"] == sequencia:
            return {a["ano"]: a["agua"] for a in s["diario"]["hoje"]["anos"]}
    raise ValueError(f"sequencia {sequencia} nao esta entre as viaveis")


def ndvi_por_ano():
    """NDVI por ano agricola (ano = o do mes de outubro que abre a safra)."""
    mensal = pd.read_csv(TALHAO / "ndvi_mensal.csv", parse_dates=["mes"])
    d16 = pd.read_csv(TALHAO / "ndvi_16d.csv", parse_dates=["data"])
    linhas = []
    for ano in range(2014, 2024):
        def media(inicio, fim):
            m = mensal[(mensal["mes"] >= inicio) & (mensal["mes"] <= fim)]
            return m["ndvi"].mean(), len(m)

        dez_mar, n1 = media(f"{ano}-12-01", f"{ano + 1}-03-01")
        dez_mai, n2 = media(f"{ano}-12-01", f"{ano + 1}-05-01")
        janela = d16[(d16["data"] >= f"{ano}-12-01") & (d16["data"] <= f"{ano + 1}-03-31")]
        if n1 != 4 or n2 != 6 or janela.empty:
            raise ValueError(f"NDVI incompleto na safra {ano}/{ano + 1}")
        linhas.append({"ano": ano, "ndvi_dez_mar": dez_mar, "ndvi_pico": janela["ndvi"].max(), "ndvi_dez_mai": dez_mai})
    return pd.DataFrame(linhas).set_index("ano")


def postos(x):
    """Postos com empate pela media (como no Spearman usual)."""
    return pd.Series(x).rank().to_numpy()


def correlacao(x, y, rng):
    """Pearson, Spearman e p bilateral por permutacao de cada um."""
    x, y = np.asarray(x, float), np.asarray(y, float)
    rx, ry = postos(x), postos(y)
    r = np.corrcoef(x, y)[0, 1]
    rho = np.corrcoef(rx, ry)[0, 1]
    perm = np.argsort(rng.random((N_PERMUTACOES, len(y))), axis=1)

    def p_perm(a, b, obs):
        a = (a - a.mean()) / a.std()
        bp = b[perm]
        bp = (bp - bp.mean(axis=1, keepdims=True)) / bp.std(axis=1, keepdims=True)
        nulas = (bp * a).mean(axis=1)
        return (np.sum(np.abs(nulas) >= abs(obs) - 1e-12) + 1) / (N_PERMUTACOES + 1)

    return r, p_perm(x, y, r), rho, p_perm(rx, ry, rho)


def main():
    dados = carregar_dados()
    diario = carregar_diario()
    if diario is None:
        sys.exit("falta data/power/power_diario_-20.032_-48.526_2005_2024.csv")

    tabela = ndvi_por_ano()
    tabela["agua_soja"] = pd.Series(agua_por_ano("soja", 1, dados, diario))
    tabela["agua_soja_milho"] = pd.Series(agua_por_ano("soja>milho", 2, dados, diario))
    chuva = pd.read_csv(AGUA_POR_ANO).set_index("safra")["chuva_safra_mm"]
    tabela["chuva_out_mar"] = chuva
    if tabela.isna().any().any():
        raise ValueError("ano sem valor:\n" + str(tabela[tabela.isna().any(axis=1)]))

    tabela.index = [f"{a}/{str(a + 1)[2:]}" for a in tabela.index]
    print(f"Ano a ano ({len(tabela)} safras)")
    print(tabela.round(3).to_string())

    pares = [
        ("agua_soja", "ndvi_dez_mar", "principal"),
        ("agua_soja", "ndvi_pico", ""),
        ("agua_soja_milho", "ndvi_dez_mai", ""),
        ("chuva_out_mar", "ndvi_dez_mar", "referencia sem motor"),
        ("agua_soja", "chuva_out_mar", "indice x chuva"),
    ]
    rng = np.random.default_rng(SEMENTE)
    print(f"\nCorrelacoes (n = {len(tabela)}; p bilateral por permutacao, {N_PERMUTACOES} embaralhamentos)")
    print(f"{'x':16s} {'y':14s} {'pearson':>8s} {'p':>6s} {'spearman':>9s} {'p':>6s}")
    for x, y, nota in pares:
        r, pr, rho, prho = correlacao(tabela[x], tabela[y], rng)
        print(f"{x:16s} {y:14s} {r:8.2f} {pr:6.3f} {rho:9.2f} {prho:6.3f}  {nota}")

    for col in ("agua_soja", "ndvi_dez_mar"):
        ordem = tabela[col].sort_values()
        print(f"\nOrdem de {col} (menor -> maior): " + ", ".join(ordem.index))


if __name__ == "__main__":
    main()
