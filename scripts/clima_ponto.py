"""Tabelas de clima (hoje e futuro) para um ponto qualquer. D1 de docs/plano_gap.md.

Uso em codigo:
    from scripts.clima_ponto import clima_por_ponto
    r = clima_por_ponto(-19.5, -47.9)
    r["clima_hoje"], r["clima_futuro"], r["origem"]

Uso no terminal (chama a API do POWER se o ponto nao estiver em data/power/):
    python scripts/clima_ponto.py -19.5 -47.9

Contrato completo: docs/clima_por_ponto.md.

De onde vem cada tabela:
- Perto do talhao de demonstracao (ate RAIO_DEMO_KM): as tabelas prontas de
  data/, com a correcao da estacao A520. Os numeros da demonstracao nao mudam.
- Outro ponto: POWER diario 2005-2024 daquele ponto, sem a correcao da A520
  (a estacao so vale perto do talhao). Le de data/power/ se o arquivo existir;
  senao chama a API e guarda o arquivo.
- Futuro: hoje + delta do NEX-GDDP. O delta padrao e o do talhao de demonstracao
  (data/clima_correcoes.csv); o regional entra pelo parametro `deltas`.
  `origem["delta"]` diz qual foi usado.
  - Dias quentes: os dias do POWER do ponto com a Tmax somada ao delta_tmax_c do mes.
  - Chuva: hoje x razao_chuva quando `deltas` tem essa coluna; senao hoje +
    delta_chuva_mm. `origem["chuva_futuro"]` diz qual ("razao" ou "delta_somado").
- Se o POWER falhar: devolve as tabelas da demonstracao e avisa em `origem`.
"""
import math
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import montar_clima as mc  # noqa: E402

RAIO_DEMO_KM = 25  # ate aqui valem as tabelas (e a correcao A520) do talhao de demonstracao
ANO_INICIO, ANO_FIM = 2005, 2024
MIN_ANOS = 10  # menos anos completos que isso: nao confiar na media
PERIODOS = {"hoje": f"{ANO_INICIO}-{ANO_FIM}", "futuro": "2041-2060"}
COLUNAS_DELTA = ["delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"]


def distancia_km(lat1, lon1, lat2, lon2):
    """Distancia em linha reta sobre a esfera (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


def arquivo_power(lat, lon):
    return mc.DADOS / "power" / f"power_diario_{lat:.3f}_{lon:.3f}_{ANO_INICIO}_{ANO_FIM}.csv"


def deltas_demo():
    """Deltas do NEX-GDDP do talhao de demonstracao, por mes."""
    d = pd.read_csv(mc.DADOS / "clima_correcoes.csv", index_col="mes")
    if "razao_chuva" not in d.columns:
        raise ValueError("clima_correcoes.csv sem razao_chuva: rode scripts/montar_clima.py")
    return d


def _puxar_api(lat, lon):
    from puxar_power import puxar  # importa requests so se for chamar a API

    return puxar(lat, lon, ANO_INICIO, ANO_FIM)[1].reset_index()


def _diario(lat, lon, puxar):
    """Serie diaria do ponto: (tabela, origem) ou (None, motivo da falha)."""
    arq = arquivo_power(lat, lon)
    if arq.exists():
        return pd.read_csv(arq, parse_dates=["data"]), "power_arquivo"
    try:
        d = (puxar or _puxar_api)(lat, lon)
        d["data"] = pd.to_datetime(d["data"])
    except Exception as e:  # rede, API fora do ar, resposta inesperada
        return None, f"{type(e).__name__}: {e}"
    try:
        d.to_csv(arq, index=False)
    except OSError:
        pass  # disco so de leitura: segue sem guardar
    return d, "power_api"


def tabelas_do_diario(diario, lat, deltas):
    """clima_hoje e clima_futuro a partir do POWER diario, sem correcao de estacao."""
    datas = diario["data"]
    chaves = [datas.dt.year.rename("ano"), datas.dt.month.rename("mes")]
    m = diario.groupby(chaves)[["PRECTOTCORR", "T2M_MIN", "T2M_MAX"]].mean()
    m["chuva_mm"] = m["PRECTOTCORR"] * datas.dt.days_in_month.groupby(chaves).first()  # mm/dia -> mm no mes
    m = m.dropna()
    base = m.groupby("mes").agg(chuva_mm=("chuva_mm", "mean"), tmin_c=("T2M_MIN", "mean"), tmax_c=("T2M_MAX", "mean"))
    anos = m.groupby("mes").size()
    if len(base) < 12 or anos.min() < MIN_ANOS:
        raise ValueError(f"POWER com menos de {MIN_ANOS} anos de dados em algum mes")

    limiares = mc.limiares_de_calor()
    cont_hoje = mc.contar_dias_quentes(diario, None, limiares)
    cont_fut = mc.contar_dias_quentes(diario, deltas["delta_tmax_c"], limiares)  # Tmax de cada dia + delta do mes

    hoje = base.copy()
    hoje["et0_mm"] = mc.et0_hargreaves(base["tmin_c"], base["tmax_c"], lat)
    fut = pd.DataFrame(index=base.index)
    if "razao_chuva" in deltas.columns:
        fut["chuva_mm"] = base["chuva_mm"] * deltas["razao_chuva"]
    else:  # delta regional ainda sem a razao
        fut["chuva_mm"] = (base["chuva_mm"] + deltas["delta_chuva_mm"]).clip(lower=0)
    fut["tmin_c"] = base["tmin_c"] + deltas["delta_tmin_c"]
    fut["tmax_c"] = base["tmax_c"] + deltas["delta_tmax_c"]
    fut["et0_mm"] = mc.et0_hargreaves(fut["tmin_c"], fut["tmax_c"], lat)

    hoje = hoje.join(mc.colunas_de_calor(cont_hoje))
    fut = fut.join(mc.colunas_de_calor(cont_fut))
    return hoje.round(2).reset_index(), fut.round(2).reset_index()


def metodo_chuva(deltas):
    return "razao" if "razao_chuva" in deltas.columns else "delta_somado"


def clima_por_ponto(lat, lon, puxar=None, deltas=None, origem_delta="nex_talhao_demo"):
    """Devolve {"clima_hoje", "clima_futuro", "origem"} para o ponto.

    puxar:  funcao (lat, lon) -> serie diaria do POWER; padrao: a API. Serve para teste.
    deltas: tabela por mes com delta_chuva_mm, delta_tmin_c, delta_tmax_c e,
            se houver, razao_chuva. Padrao: os do talhao de demonstracao.
    origem_delta: rotulo de `deltas`, copiado para origem["delta"].
    """
    lat, lon = float(lat), float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("lat deve estar entre -90 e 90 e lon entre -180 e 180")
    dist = distancia_km(lat, lon, mc.LAT, mc.LON)
    origem = {
        "lat": lat, "lon": lon, "distancia_demo_km": round(dist, 1),
        "hoje": "tabela_demo", "delta": "nex_talhao_demo", "correcao_a520": True,
        "chuva_futuro": "razao", "periodos": PERIODOS, "aviso": None,
    }

    def demo():
        return {"clima_hoje": pd.read_csv(mc.DADOS / "clima_hoje.csv"),
                "clima_futuro": pd.read_csv(mc.DADOS / "clima_futuro.csv"), "origem": origem}

    if dist <= RAIO_DEMO_KM and deltas is None:
        return demo()

    diario, fonte = _diario(lat, lon, puxar)
    if diario is not None:
        try:
            if deltas is None:
                deltas = deltas_demo()
            else:
                deltas = deltas.set_index("mes") if "mes" in deltas.columns else deltas
            hoje, fut = tabelas_do_diario(diario, lat, deltas)
        except (KeyError, ValueError) as e:
            diario, fonte = None, f"{type(e).__name__}: {e}"
    if diario is None:
        origem["hoje"] = "fallback_tabela_demo"
        origem["aviso"] = (f"Sem clima do POWER para este ponto ({fonte}). "
                           f"Usando as tabelas do talhao de demonstracao, a {dist:.0f} km.")
        return demo()

    origem.update(hoje=fonte, delta=origem_delta, correcao_a520=False, chuva_futuro=metodo_chuva(deltas))
    if origem_delta == "nex_talhao_demo":
        origem["aviso"] = (f"A mudanca do clima (2041-2060) e a do talhao de demonstracao, a {dist:.0f} km, "
                           "aplicada ao clima de hoje deste ponto.")
    return {"clima_hoje": hoje, "clima_futuro": fut, "origem": origem}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("uso: python scripts/clima_ponto.py <lat> <lon>")
    r = clima_por_ponto(sys.argv[1], sys.argv[2])
    print(r["origem"])
    print("\nHoje:\n", r["clima_hoje"].to_string(index=False))
    print("\nFuturo:\n", r["clima_futuro"].to_string(index=False))
