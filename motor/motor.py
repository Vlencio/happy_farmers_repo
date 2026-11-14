"""Motor de recomendacao de rotacao: regras e aritmetica, sem ML.

Uso:
    from motor import carregar_dados, recomendar
    saida = recomendar(entrada, *carregar_dados())

Demo: python -m motor
Contrato de entrada e saida: docs/contrato_motor.md
"""
import itertools
import math
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "data"

DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
MES_DO_DIA = [m + 1 for m, d in enumerate(DIAS_MES) for _ in range(d)]  # dia do ano (0-364) -> mes
SLOTS = ("safra", "safrinha")

# Valores provisorios, sem fonte: ajustar com um agronomo.
CAD_MM = 100  # agua que o solo guarda de um dia para o outro (mm)
PENALIDADE_REPETICAO = 0.85  # fator na produtividade ao repetir a cultura anterior
BONUS_APOS_FIXADORA = 1.10  # fator na produtividade de uma nao fixadora apos uma fixadora de N
PESO_SOLO = {"fixa_n": 0.4, "cobre_solo": 0.4, "diversidade": 0.2}
FASES_KC = (0.20, 0.45, 0.80)  # fracoes do ciclo: fim do Kc inicial, inicio e fim do Kc medio
DIAS_COLHEITA = 10  # dias para colher e liberar o talhao depois do fim do ciclo
ESPERA_MAX_DIAS = 182  # meio ano: se o mes de plantio do slot esta mais longe que isso, a epoca ja passou

COLUNAS_CLIMA = ["mes", "chuva_mm", "tmin_c", "tmax_c"]  # et0_mm e opcional
COLUNAS_NUMERICAS = [
    "ciclo_dias", "temp_min", "temp_max", "temp_otima_min", "temp_otima_max",
    "chuva_min", "chuva_max", "kc_ini", "kc_med", "kc_fim", "preco", "produtividade",
]  # fmt: skip
COLUNAS_CULTURA = [
    "cultura", *COLUNAS_NUMERICAS, "fixa_n", "cobre_solo",
    "mes_plantio_safra", "mes_plantio_safrinha", "produtividade_safrinha",
]  # fmt: skip


def carregar_dados(pasta=DADOS):
    """Le culturas.csv, clima_hoje.csv e clima_futuro.csv de uma pasta."""
    pasta = Path(pasta)
    return (
        pd.read_csv(pasta / "culturas.csv", encoding="utf-8"),
        pd.read_csv(pasta / "clima_hoje.csv"),
        pd.read_csv(pasta / "clima_futuro.csv"),
    )


def radiacao_extraterrestre(lat, dia_do_ano):
    """Ra em MJ/m2/dia (FAO-56, eq. 21)."""
    phi = math.radians(lat)
    dr = 1 + 0.033 * math.cos(2 * math.pi * dia_do_ano / 365)
    delta = 0.409 * math.sin(2 * math.pi * dia_do_ano / 365 - 1.39)
    ws = math.acos(-math.tan(phi) * math.tan(delta))
    return (24 * 60 / math.pi) * 0.0820 * dr * (
        ws * math.sin(phi) * math.sin(delta) + math.cos(phi) * math.cos(delta) * math.sin(ws)
    )


def et0_hargreaves(clima, lat):
    """ET0 em mm/dia para cada um dos 12 meses (Hargreaves, com Ra no dia 15)."""
    et0 = []
    for m in clima:
        ra = 0.408 * radiacao_extraterrestre(lat, sum(DIAS_MES[: m["mes"] - 1]) + 15)  # MJ -> mm/dia
        tmed = (m["tmin_c"] + m["tmax_c"]) / 2
        et0.append(0.0023 * (tmed + 17.8) * max(m["tmax_c"] - m["tmin_c"], 0) ** 0.5 * ra)
    return et0


def et0_do_clima(clima, lat):
    """ET0 em mm/dia por mes: a coluna et0_mm da tabela, se vier; senao Hargreaves com tmin_c e tmax_c.

    As tabelas de scripts/montar_clima.py trazem et0_mm calculado com as temperaturas
    do POWER sem a correcao da estacao, entao o motor nao recalcula.
    """
    if all("et0_mm" in m for m in clima):
        return [m["et0_mm"] / DIAS_MES[i] for i, m in enumerate(clima)]
    return et0_hargreaves(clima, lat)


def kc_do_dia(c, fracao):
    """Kc na fracao (0-1) do ciclo: inicial, rampa, medio, rampa ate o final."""
    ini, cres, med = FASES_KC
    if fracao < ini:
        return c["kc_ini"]
    if fracao < cres:
        return c["kc_ini"] + (c["kc_med"] - c["kc_ini"]) * (fracao - ini) / (cres - ini)
    if fracao < med:
        return c["kc_med"]
    return c["kc_med"] + (c["kc_fim"] - c["kc_med"]) * (fracao - med) / (1 - med)


def encaixe_temperatura(t, c):
    """0 fora da faixa absoluta, 1 dentro da faixa otima, linear entre as duas."""
    if t <= c["temp_min"] or t >= c["temp_max"]:
        return 0.0
    if t < c["temp_otima_min"]:
        return (t - c["temp_min"]) / (c["temp_otima_min"] - c["temp_min"])
    if t > c["temp_otima_max"]:
        return (c["temp_max"] - t) / (c["temp_max"] - c["temp_otima_max"])
    return 1.0


def encaixe_chuva(chuva, c):
    """1 dentro da faixa de chuva do ciclo; cai em proporcao a falta ou ao excesso."""
    if c["chuva_min"] > 0 and chuva < c["chuva_min"]:
        return chuva / c["chuva_min"]
    if chuva > c["chuva_max"]:
        return max(0.0, 1 - (chuva - c["chuva_max"]) / c["chuva_max"])
    return 1.0


def ordem_dos_slots(mes_plantio, horizonte):
    """Talhao livre de julho a dezembro: a proxima epoca e a safra; de janeiro a junho, a safrinha."""
    slots = ["safra", "safrinha"] if mes_plantio >= 7 else ["safrinha", "safra"]
    return slots[:horizonte]


def dia_de_plantio(mes, dia_livre):
    """Dia em que a cultura entra, dado o mes tipico de plantio dela no slot.

    E o proprio dia livre, se cair dentro do mes, ou o dia 1 da proxima vez que o mes chegar.
    None se a cultura nao tem mes naquele slot ou se a espera passa de ESPERA_MAX_DIAS.
    """
    if mes is None:
        return None
    inicio = sum(DIAS_MES[: mes - 1])
    while inicio + DIAS_MES[mes - 1] - 1 < dia_livre:  # esse mes ja acabou: so no ano seguinte
        inicio += 365
    plantio = max(inicio, dia_livre)
    return plantio if plantio - dia_livre <= ESPERA_MAX_DIAS else None


def simular_cultura(c, dia_inicio, clima, et0, agua):
    """Roda o ciclo de uma cultura dia a dia, com chuva e ET0 do mes.

    Devolve (resultado, agua que sobra no solo). O solo guarda ate CAD_MM.
    """
    ciclo = c["ciclo_dias"]
    meses = {}  # mes -> acumulados, na ordem do ciclo
    soma_temp = 0.0
    for i in range(ciclo):
        mes = MES_DO_DIA[(dia_inicio + i) % 365]
        m = clima[mes - 1]
        chuva = m["chuva_mm"] / DIAS_MES[mes - 1]
        kc = kc_do_dia(c, i / ciclo)
        etc = kc * et0[mes - 1]
        eta = min(etc, agua + chuva)  # a cultura so usa a agua que existe
        agua = min(CAD_MM, agua + chuva - eta)
        soma_temp += encaixe_temperatura((m["tmin_c"] + m["tmax_c"]) / 2, c)
        a = meses.setdefault(mes, {"mes": mes, "dias": 0, "kc": 0.0, "chuva_mm": 0.0, "etc_mm": 0.0, "deficit_mm": 0.0})
        a["dias"] += 1
        a["kc"] += kc
        a["chuva_mm"] += chuva
        a["etc_mm"] += etc
        a["deficit_mm"] += etc - eta
    for a in meses.values():
        a["kc"] /= a["dias"]

    lista = list(meses.values())
    chuva_ciclo = sum(a["chuva_mm"] for a in lista)
    etc_ciclo = sum(a["etc_mm"] for a in lista)
    deficit = sum(a["deficit_mm"] for a in lista)
    resultado = {
        "cultura": c["cultura"],
        "mes_plantio": lista[0]["mes"],
        "mes_colheita": lista[-1]["mes"],
        "ciclo_dias": ciclo,
        "encaixe_temp": soma_temp / ciclo,
        "encaixe_chuva": encaixe_chuva(chuva_ciclo, c),
        "atendimento_hidrico": 1 - deficit / etc_ciclo if etc_ciclo > 0 else 1.0,
        "chuva_mm": chuva_ciclo,
        "etc_mm": etc_ciclo,
        "deficit_mm": deficit,
        "meses": lista,
    }
    return resultado, agua


def avaliar_sequencia(nomes, slots, anterior, culturas, clima, et0, mes_plantio, precos):
    """Simula as culturas em fila, uma por slot, com o talhao livre no dia 1 de mes_plantio.

    Se uma cultura nao pode ser plantada no slot dela, devolve so {"fora_de_epoca": motivo}.
    """
    dia = sum(DIAS_MES[: mes_plantio - 1])  # dia em que o talhao fica livre
    sem_cultura = dia  # desde quando o solo esta sem cultura
    agua = 0.0  # o solo comeca vazio
    resultados = []
    for nome, slot in zip(nomes, slots):
        c = culturas[nome]
        mes = c[f"mes_plantio_{slot}"]
        plantio = dia_de_plantio(mes, dia)
        if plantio is None:
            return {
                "fora_de_epoca": {
                    "cultura": nome,
                    "posicao": len(resultados) + 1,
                    "slot": slot,
                    "mes_livre": MES_DO_DIA[dia % 365],
                    "mes_plantio": mes,
                }
            }
        for d in range(sem_cultura, plantio):  # colheita e espera: solo sem cultura so acumula chuva
            m = MES_DO_DIA[d % 365]
            agua = min(CAD_MM, agua + clima[m - 1]["chuva_mm"] / DIAS_MES[m - 1])
        r, agua = simular_cultura(c, plantio, clima, et0, agua)
        r["slot"] = slot
        r["espera_dias"] = plantio - dia
        sem_cultura = plantio + c["ciclo_dias"]
        dia = sem_cultura + DIAS_COLHEITA  # o talhao so fica livre depois da colheita

        if nome == anterior:
            fator_sequencia = PENALIDADE_REPETICAO
        elif anterior in culturas and culturas[anterior]["fixa_n"] and not c["fixa_n"]:
            fator_sequencia = BONUS_APOS_FIXADORA
        else:
            fator_sequencia = 1.0
        cresce = min(r["encaixe_temp"], r["encaixe_chuva"], r["atendimento_hidrico"])  # fator mais limitante
        produtividade = c["produtividade"] if slot == "safra" else c["produtividade_safrinha"]
        r["fator_sequencia"] = fator_sequencia
        r["fator"] = cresce * fator_sequencia
        r["receita_ha"] = precos.get(nome, c["preco"]) * produtividade * r["fator"]
        r["solo"] = cresce * (
            PESO_SOLO["fixa_n"] * c["fixa_n"]
            + PESO_SOLO["cobre_solo"] * c["cobre_solo"]
            + PESO_SOLO["diversidade"] * (nome != anterior)
        )
        resultados.append(r)
        anterior = nome

    etc = sum(r["etc_mm"] for r in resultados)
    return {
        "agua": 1 - sum(r["deficit_mm"] for r in resultados) / etc if etc > 0 else 1.0,
        "solo": sum(r["solo"] for r in resultados) / len(resultados),
        "receita_ha": sum(r["receita_ha"] for r in resultados),
        "encaixe": min(min(r["encaixe_temp"], r["encaixe_chuva"]) for r in resultados),
        "culturas": resultados,
    }


def recomendar(entrada, culturas, clima_hoje, clima_futuro):
    """Ranqueia as sequencias de 1 ou 2 culturas no clima de hoje e no futuro.

    Cada posicao da sequencia e um slot (safra ou safrinha). Sequencia com cultura
    fora da epoca de plantio do slot nao entra no ranking: vai para "descartadas".

    entrada: dict com lat, rotacao_atual, prioridades, horizonte, mes_plantio, precos.
    culturas, clima_hoje, clima_futuro: DataFrames (ver docs/contrato_motor.md).
    Devolve um dict pronto para json.dumps.
    """
    tabela = _tabela_culturas(culturas)
    climas = {"hoje": _tabela_clima(clima_hoje), "futuro": _tabela_clima(clima_futuro)}

    lat = float(entrada["lat"])
    horizonte = int(entrada.get("horizonte", 2))
    mes_plantio = int(entrada.get("mes_plantio", 10))
    historico = list(entrada.get("rotacao_atual") or [])
    precos = {k: float(v) for k, v in (entrada.get("precos") or {}).items()}
    if horizonte not in (1, 2):
        raise ValueError("horizonte deve ser 1 ou 2")
    if not 1 <= mes_plantio <= 12:
        raise ValueError("mes_plantio deve estar entre 1 e 12")
    desconhecidas = sorted({n for n in [*historico, *precos] if n not in tabela})
    if desconhecidas:
        raise ValueError(f"culturas fora da tabela: {desconhecidas}. Validas: {sorted(tabela)}")
    pesos = _normalizar_pesos(entrada.get("prioridades") or {})

    slots = ordem_dos_slots(mes_plantio, horizonte)
    anterior = historico[-1] if historico else None
    # "atual" = repetir a rotacao atual nas proximas safras
    atual = tuple(historico[i % len(historico)] for i in range(horizonte)) if historico else None

    todas = list(itertools.product(tabela, repeat=horizonte))
    et0 = {cen: et0_do_clima(clima, lat) for cen, clima in climas.items()}
    aval = {
        cen: {s: avaliar_sequencia(s, slots, anterior, tabela, clima, et0[cen], mes_plantio, precos) for s in todas}
        for cen, clima in climas.items()
    }
    # a epoca de plantio nao depende do clima: as descartadas sao as mesmas nos dois
    descartadas = [s for s in todas if "fora_de_epoca" in aval["hoje"][s]]
    sequencias = [s for s in todas if "fora_de_epoca" not in aval["hoje"][s]]

    # renda de 0 a 1: a maior receita entre as sequencias viaveis e os dois climas vale 1
    teto = max((aval[cen][s]["receita_ha"] for cen in aval for s in sequencias), default=0.0) or 1.0
    rank = {}
    for cen, porseq in aval.items():
        for s in sequencias:
            a = porseq[s]
            a["renda"] = a["receita_ha"] / teto
            a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
        ordem = sorted(sequencias, key=lambda s: -porseq[s]["score"])
        rank[cen] = {s: i + 1 for i, s in enumerate(ordem)}

    campos = ["score", "agua", "solo", "renda", "receita_ha", "encaixe", "culturas"]
    saida = {
        "entrada": {
            "lat": lat,
            "rotacao_atual": historico,
            "prioridades": pesos,
            "horizonte": horizonte,
            "mes_plantio": mes_plantio,
            "precos": precos,
        },
        "slots": slots,
        "clima": {
            cen: [{**m, "et0_mm": et0[cen][i] * DIAS_MES[i]} for i, m in enumerate(clima)]
            for cen, clima in climas.items()
        },
        "sequencias": [
            {
                "id": ">".join(s),
                "culturas": list(s),
                "atual": s == atual,
                "rank_hoje": rank["hoje"][s],
                "rank_futuro": rank["futuro"][s],
                "hoje": {k: aval["hoje"][s][k] for k in campos},
                "futuro": {k: aval["futuro"][s][k] for k in campos},
            }
            for s in sorted(sequencias, key=lambda s: rank["hoje"][s])
        ],
        "descartadas": [
            {"id": ">".join(s), "culturas": list(s), "atual": s == atual, "motivo": aval["hoje"][s]["fora_de_epoca"]}
            for s in descartadas
        ],
    }
    return _arredondar(saida)


def _tabela_clima(df):
    faltam = [c for c in COLUNAS_CLIMA if c not in df.columns]
    if faltam:
        raise ValueError(f"tabela de clima sem as colunas: {faltam}")
    linhas = df.sort_values("mes").to_dict("records")
    if [int(m["mes"]) for m in linhas] != list(range(1, 13)):
        raise ValueError("tabela de clima precisa de 12 linhas, uma por mes (1 a 12)")
    colunas = COLUNAS_CLIMA[1:] + (["et0_mm"] if "et0_mm" in df.columns else [])
    return [{"mes": int(m["mes"]), **{k: float(m[k]) for k in colunas}} for m in linhas]


def _tabela_culturas(df):
    faltam = [c for c in COLUNAS_CULTURA if c not in df.columns]
    if faltam:
        raise ValueError(f"culturas.csv sem as colunas: {faltam}")
    tabela = {}
    for linha in df.to_dict("records"):
        nome = str(linha["cultura"]).strip()
        c = {k: float(linha[k]) for k in COLUNAS_NUMERICAS}
        vazias = [k for k, v in c.items() if math.isnan(v)]
        if vazias:
            raise ValueError(f"{nome}: colunas vazias: {vazias}")
        c["cultura"] = nome
        c["ciclo_dias"] = int(c["ciclo_dias"])
        c["fixa_n"] = _sim(linha["fixa_n"])
        c["cobre_solo"] = _sim(linha["cobre_solo"])
        if not 1 <= c["ciclo_dias"] <= 365:
            raise ValueError(f"{nome}: ciclo_dias deve estar entre 1 e 365")
        for slot in SLOTS:  # mes vazio = a cultura nao e plantada naquele slot
            mes = linha[f"mes_plantio_{slot}"]
            c[f"mes_plantio_{slot}"] = None if pd.isna(mes) else int(mes)
            if c[f"mes_plantio_{slot}"] is not None and not 1 <= c[f"mes_plantio_{slot}"] <= 12:
                raise ValueError(f"{nome}: mes_plantio_{slot} deve ser um mes de 1 a 12 ou vazio")
        safrinha = linha["produtividade_safrinha"]
        c["produtividade_safrinha"] = c["produtividade"] if pd.isna(safrinha) else float(safrinha)
        tabela[nome] = c
    if not tabela:
        raise ValueError("culturas.csv esta vazio")
    return tabela


def _sim(valor):
    return str(valor).strip().lower() in ("sim", "s", "1", "1.0", "true")


def _normalizar_pesos(prioridades):
    pesos = {k: max(float(prioridades.get(k, 0)), 0.0) for k in ("agua", "solo", "renda")}
    total = sum(pesos.values())
    if total == 0:  # sem prioridade informada: pesos iguais
        return {k: 1 / 3 for k in pesos}
    return {k: v / total for k, v in pesos.items()}


def _arredondar(x, casas=3):
    if isinstance(x, float):
        return round(x, casas)
    if isinstance(x, dict):
        return {k: _arredondar(v, casas) for k, v in x.items()}
    if isinstance(x, list):
        return [_arredondar(v, casas) for v in x]
    return x
