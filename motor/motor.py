"""Motor de recomendacao de rotacao: regras e aritmetica, sem ML.

Uso:
    from motor import carregar_dados, recomendar
    saida = recomendar(entrada, *carregar_dados())

Demo: python -m motor
Contrato de entrada e saida: docs/contrato_motor.md

Modo diario (opcional): recomendar(..., diario=carregar_diario()) roda a mesma conta
com a serie diaria de cada ano, em vez da media mensal, e resume ano mediano e ano ruim.
"""
import datetime
import itertools
import math
import statistics
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
FASE_SENSIVEL = FASES_KC[1:]  # florescimento e enchimento de graos: a fase de Kc medio
PERDA_CALOR = 1.0  # fracao da produtividade perdida se todos os dias da fase sensivel passam do limiar

# Modo diario. Ky = queda relativa da produtividade por queda relativa da evapotranspiracao
# (FAO-56, eq. 90). Valores da FAO-56, tabela 24, que repete o FAO Irrigation and Drainage
# Paper 33. Trigo: "spring wheat" (trigo de sequeiro do Cerrado).
KY = {"soja": 0.85, "milho": 1.25, "sorgo": 0.90, "feijao": 1.15, "girassol": 0.95, "algodao": 0.85, "trigo": 1.15}
KY_PADRAO = 1.0  # cultura sem Ky na tabela da FAO: perda proporcional, como no modo mensal
QUANTIL_RUIM = 0.2  # "ano ruim": cerca de 1 em cada 5 anos fica nesse valor ou abaixo
MIN_ANOS_DIARIO = 5  # menos anos completos que isso: nao resumir
COLUNAS_DIARIO = ["data", "chuva_mm", "tmin_c", "tmax_c"]  # et0_mm (mm no dia) e opcional
DIARIO_DEMO = Path("power") / "power_diario_-20.032_-48.526_2005_2024.csv"  # talhao de demonstracao
LAT_DEMO = -20.032

# Avisos por sequencia (lacunas e riscos). Limites provisorios, sem fonte: so decidem quando avisar.
AVISO_FATOR = 0.8  # fator de clima ou agua abaixo disso vira aviso de risco
AVISO_QUEDA_FUTURO = 0.10  # queda da receita de hoje para o futuro acima disso
AVISO_QUEDA_ANO_RUIM = 0.20  # modo diario: queda da receita do ano mediano para o ano ruim acima disso
AVISO_DIAS_EXPOSTOS = 60  # dias sem cultura e sem palhada a partir dos quais avisar
LIMIARES_POUCO_CONFIAVEIS = {32}  # graus C: POWER e NEX diferem 20% na contagem (docs/colunas_dados.md)
NOME_FATOR = {"temperatura": "a temperatura", "chuva": "a chuva do ciclo", "calor": "o calor", "agua": "a falta de água"}

COLUNAS_CLIMA = ["mes", "chuva_mm", "tmin_c", "tmax_c"]  # et0_mm e dias_acima_NN sao opcionais
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


def carregar_clima_seco(pasta=DADOS):
    """Le clima_seco.csv (o ano agricola mais seco do POWER). None se a pasta nao tem o arquivo."""
    arquivo = Path(pasta) / "clima_seco.csv"
    return pd.read_csv(arquivo) if arquivo.exists() else None


def carregar_diario(pasta=DADOS):
    """Serie diaria do talhao de demonstracao (POWER 2005-2024). None se a pasta nao tem o arquivo.

    tmin_c e tmax_c levam a correcao da estacao A520 (clima_correcoes.csv), como em
    clima_hoje.csv; o ET0 usa as temperaturas sem a correcao, tambem como la.
    """
    pasta = Path(pasta)
    arquivo = pasta / DIARIO_DEMO
    if not arquivo.exists():
        return None
    correcoes = pasta / "clima_correcoes.csv"
    return diario_do_power(
        pd.read_csv(arquivo, parse_dates=["data"]), LAT_DEMO, pd.read_csv(correcoes) if correcoes.exists() else None
    )


def diario_do_power(power, lat, correcoes=None):
    """Serie diaria do POWER (data, PRECTOTCORR, T2M_MIN, T2M_MAX) nas colunas do modo diario.

    et0_mm: Hargreaves de cada dia, com as temperaturas do POWER.
    correcoes: opcional, tabela por mes com off_tmin e off_tmax (estacao em solo), somados
    em tmin_c e tmax_c depois do ET0.
    """
    datas = pd.to_datetime(power["data"])
    tmin, tmax = power["T2M_MIN"].astype(float), power["T2M_MAX"].astype(float)
    ra = [0.408 * radiacao_extraterrestre(lat, d.timetuple().tm_yday) for d in datas]  # MJ -> mm/dia
    et0 = 0.0023 * ((tmin + tmax) / 2 + 17.8) * (tmax - tmin).clip(lower=0) ** 0.5 * ra
    if correcoes is not None:
        off = correcoes.set_index("mes")
        tmin = tmin + datas.dt.month.map(off["off_tmin"])
        tmax = tmax + datas.dt.month.map(off["off_tmax"])
    return pd.DataFrame({
        "data": datas, "chuva_mm": power["PRECTOTCORR"].astype(float), "tmin_c": tmin, "tmax_c": tmax, "et0_mm": et0,
    })  # fmt: skip


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


def coluna_de_calor(c):
    """Coluna do clima com os dias acima do limiar de calor da cultura. None = a regra nao se aplica."""
    return f"dias_acima_{c['temp_calor_c']}" if c.get("temp_calor_c") is not None else None


def ordem_dos_slots(mes_plantio, horizonte):
    """Talhao livre de julho a dezembro: a proxima epoca e a safra; de janeiro a junho, a safrinha."""
    slots = ["safra", "safrinha"] if mes_plantio >= 7 else ["safrinha", "safra"]
    return slots[:horizonte]


def rotacao_atual(historico, horizonte):
    """A rotacao atual repetida nos proximos slots: as culturas mais recentes do historico.

    O historico vem na ordem de plantio, uma cultura por slot, sem pular slot. A ultima
    cultura ocupou o slot anterior ao proximo; a penultima, o mesmo slot do proximo, um
    ano antes. Entao, com duas ou mais culturas no historico, a proxima posicao repete a
    penultima e a seguinte repete a ultima. Com uma cultura so, ela se repete em todo slot.
    None sem historico.
    """
    if not historico:
        return None
    ciclo = min(len(historico), len(SLOTS))
    return tuple(historico[len(historico) - ciclo + i % ciclo] for i in range(horizonte))


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
    Calor: soma os dias acima do limiar da cultura que caem na fase sensivel do ciclo.
    """
    ciclo = c["ciclo_dias"]
    meses = {}  # mes -> acumulados, na ordem do ciclo
    soma_temp = 0.0
    calor = coluna_de_calor(c)
    dias_sensiveis = dias_calor = 0.0
    for i in range(ciclo):
        mes = MES_DO_DIA[(dia_inicio + i) % 365]
        m = clima[mes - 1]
        chuva = m["chuva_mm"] / DIAS_MES[mes - 1]
        kc = kc_do_dia(c, i / ciclo)
        etc = kc * et0[mes - 1]
        eta = min(etc, agua + chuva)  # a cultura so usa a agua que existe
        agua = min(CAD_MM, agua + chuva - eta)
        soma_temp += encaixe_temperatura((m["tmin_c"] + m["tmax_c"]) / 2, c)
        if calor and FASE_SENSIVEL[0] <= i / ciclo < FASE_SENSIVEL[1]:
            dias_sensiveis += 1
            dias_calor += m[calor] / DIAS_MES[mes - 1]  # chance de o dia ser quente
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
        "encaixe_calor": max(0.0, 1 - PERDA_CALOR * dias_calor / dias_sensiveis) if dias_sensiveis else 1.0,
        "dias_calor": dias_calor,
        "atendimento_hidrico": 1 - deficit / etc_ciclo if etc_ciclo > 0 else 1.0,
        "chuva_mm": chuva_ciclo,
        "etc_mm": etc_ciclo,
        "deficit_mm": deficit,
        "meses": lista,
    }
    return resultado, agua


def _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos):
    """Regras de sequencia, receita e parte de solo de uma cultura. Preenche r."""
    nome = c["cultura"]
    if nome == anterior:
        fator_sequencia = PENALIDADE_REPETICAO
    elif anterior in culturas and culturas[anterior]["fixa_n"] and not c["fixa_n"]:
        fator_sequencia = BONUS_APOS_FIXADORA
    else:
        fator_sequencia = 1.0
    produtividade = c["produtividade"] if slot == "safra" else c["produtividade_safrinha"]
    r["fixa_n"] = c["fixa_n"]  # atributos da tabela que entram na parte de solo, para explicar o numero
    r["cobre_solo"] = c["cobre_solo"]
    r["fator_sequencia"] = fator_sequencia
    r["fator"] = cresce * fator_sequencia
    r["receita_ha"] = precos.get(nome, c["preco"]) * produtividade * r["fator"]
    r["solo"] = cresce * (
        PESO_SOLO["fixa_n"] * c["fixa_n"]
        + PESO_SOLO["cobre_solo"] * c["cobre_solo"]
        + PESO_SOLO["diversidade"] * (nome != anterior)
    )


def avaliar_sequencia(nomes, slots, anterior, culturas, clima, et0, mes_plantio, precos):
    """Simula as culturas em fila, uma por slot, com o talhao livre no dia 1 de mes_plantio.

    Se uma cultura nao pode ser plantada no slot dela, devolve so {"fora_de_epoca": motivo}.
    """
    dia = dia_livre = sum(DIAS_MES[: mes_plantio - 1])  # dia em que o talhao fica livre
    sem_cultura = dia  # desde quando o solo esta sem cultura
    agua = 0.0  # o solo comeca vazio
    palhada_inicial = anterior in culturas and bool(culturas[anterior]["cobre_solo"])
    ciclos = []  # (dia do plantio, dia do fim do ciclo, a cultura deixa palhada?)
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
        ciclos.append((plantio, sem_cultura, bool(c["cobre_solo"])))
        dia = sem_cultura + DIAS_COLHEITA  # o talhao so fica livre depois da colheita

        # fator mais limitante
        cresce = min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"], r["atendimento_hidrico"])
        _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos)
        resultados.append(r)
        anterior = nome

    etc = sum(r["etc_mm"] for r in resultados)
    return {
        "agua": 1 - sum(r["deficit_mm"] for r in resultados) / etc if etc > 0 else 1.0,
        "solo": sum(r["solo"] for r in resultados) / len(resultados),
        "receita_ha": sum(r["receita_ha"] for r in resultados),
        "encaixe": min(min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"]) for r in resultados),
        "descoberto": solo_descoberto(dia_livre, ciclos, palhada_inicial, clima),
        "culturas": resultados,
    }


def solo_descoberto(dia_livre, ciclos, palhada_inicial, clima):
    """Dias sem cultura e chuva que cai neles, nos 365 dias a partir do talhao livre.

    ciclos: (dia do plantio, dia do fim do ciclo, deixa palhada?) de cada cultura, na ordem.
    Dia sem cultura = nenhuma cultura em pe (espera pelo plantio, colheita, depois da ultima).
    Dia exposto = dia sem cultura em que a cultura anterior nao deixa palhada (cobre_solo = 0).
    Antes da 1a cultura vale a ultima do historico; sem historico, conta como exposto.
    """
    meses = {}  # mes -> acumulados, na ordem do calendario a partir do talhao livre
    for d in range(dia_livre, dia_livre + 365):
        palhada = palhada_inicial
        em_pe = False
        for plantio, fim, deixa_palhada in ciclos:
            if plantio <= d < fim:
                em_pe = True
            elif fim <= d:
                palhada = deixa_palhada
        if em_pe:
            continue
        mes = MES_DO_DIA[d % 365]
        chuva = clima[mes - 1]["chuva_mm"] / DIAS_MES[mes - 1]
        a = meses.setdefault(mes, {"mes": mes, "dias": 0, "dias_expostos": 0, "chuva_mm": 0.0, "chuva_exposta_mm": 0.0})
        a["dias"] += 1
        a["chuva_mm"] += chuva
        if not palhada:
            a["dias_expostos"] += 1
            a["chuva_exposta_mm"] += chuva
    lista = list(meses.values())
    return {
        **{k: sum(a[k] for a in lista) for k in ("dias", "dias_expostos", "chuva_mm", "chuva_exposta_mm")},
        "meses": lista,
    }


def fator_declividade(declividade_pct):
    """Fator S da RUSLE (McCool et al., 1987): quanto a declividade multiplica a perda de solo.

    1 em 9% de declividade; abaixo disso, menor que 1.
    """
    seno = math.sin(math.atan(declividade_pct / 100))
    return 10.8 * seno + 0.03 if declividade_pct < 9 else 16.8 * seno - 0.50


def simular_cultura_diaria(c, inicio, serie, agua):
    """Como simular_cultura, com a chuva, o ET0 e as temperaturas de cada dia de um ano real.

    inicio: posicao do dia do plantio na serie. Calor: conta os dias da fase sensivel com
    maxima acima do limiar da cultura. fator_agua: 1 - Ky x (1 - atendimento hidrico).
    """
    ciclo = c["ciclo_dias"]
    limiar = c["temp_calor_c"]
    chuvas, et0s, tmins, tmaxs = serie["chuva"], serie["et0"], serie["tmin"], serie["tmax"]
    soma_temp = chuva_ciclo = etc_ciclo = deficit = 0.0
    dias_sensiveis = dias_calor = 0
    for i in range(ciclo):
        d = inicio + i
        fracao = i / ciclo
        chuva = chuvas[d]
        etc = kc_do_dia(c, fracao) * et0s[d]
        eta = min(etc, agua + chuva)  # a cultura so usa a agua que existe
        agua = min(CAD_MM, agua + chuva - eta)
        soma_temp += encaixe_temperatura((tmins[d] + tmaxs[d]) / 2, c)
        if limiar is not None and FASE_SENSIVEL[0] <= fracao < FASE_SENSIVEL[1]:
            dias_sensiveis += 1
            dias_calor += tmaxs[d] > limiar
        chuva_ciclo += chuva
        etc_ciclo += etc
        deficit += etc - eta
    atendimento = 1 - deficit / etc_ciclo if etc_ciclo > 0 else 1.0
    resultado = {
        "encaixe_temp": soma_temp / ciclo,
        "encaixe_chuva": encaixe_chuva(chuva_ciclo, c),
        "encaixe_calor": max(0.0, 1 - PERDA_CALOR * dias_calor / dias_sensiveis) if dias_sensiveis else 1.0,
        "dias_calor": float(dias_calor),
        "atendimento_hidrico": atendimento,
        "fator_agua": max(0.0, 1 - c["ky"] * (1 - atendimento)),
        "chuva_mm": chuva_ciclo,
        "etc_mm": etc_ciclo,
        "deficit_mm": deficit,
    }
    return resultado, agua


def avaliar_sequencia_diaria(nomes, slots, anterior, culturas, esperas, inicio, serie, precos, cache):
    """A sequencia em um ano da serie diaria, com o talhao livre na posicao `inicio`.

    esperas: dias de espera de cada cultura, os mesmos do modo mensal. O calendario
    (epocas de plantio, colheita) nao muda de um ano para o outro.
    """
    dia = sem_cultura = inicio
    agua = 0.0  # o solo comeca vazio
    resultados = []
    for nome, slot, espera in zip(nomes, slots, esperas):
        c = culturas[nome]
        plantio = dia + espera
        for d in range(sem_cultura, plantio):  # solo sem cultura so acumula chuva
            agua = min(CAD_MM, agua + serie["chuva"][d])
        chave = (nome, plantio, agua)  # a 1a cultura se repete em varias sequencias
        if chave not in cache:
            cache[chave] = simular_cultura_diaria(c, plantio, serie, agua)
        r, agua = cache[chave]
        r = {"cultura": nome, "slot": slot, **r}
        sem_cultura = plantio + c["ciclo_dias"]
        dia = sem_cultura + DIAS_COLHEITA
        # fator mais limitante; a agua entra pela resposta de produtividade (Ky)
        cresce = min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"], r["fator_agua"])
        _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos)
        resultados.append(r)
        anterior = nome
    etc = sum(r["etc_mm"] for r in resultados)
    return {
        "agua": 1 - sum(r["deficit_mm"] for r in resultados) / etc if etc > 0 else 1.0,
        "solo": sum(r["solo"] for r in resultados) / len(resultados),
        "receita_ha": sum(r["receita_ha"] for r in resultados),
        "culturas": resultados,
    }


def _quantil_ruim(valores):
    v = sorted(valores)
    return v[int(len(v) * QUANTIL_RUIM)]


def _modo_diario(diario, lat, climas, et0, tabela, sequencias, aval_hoje, slots, anterior, mes_plantio, precos, pesos):
    """Roda cada sequencia viavel em cada ano da serie diaria, no clima de hoje e no futuro.

    Devolve (resumo geral, {sequencia: bloco "diario"}). Por sequencia e clima: ano mediano
    e ano ruim (QUANTIL_RUIM) de agua, solo e receita, cada um com score e rank.
    """
    hoje = _serie_diaria(diario, lat)
    series = {"hoje": hoje, "futuro": _serie_futura(hoje, climas["hoje"], climas["futuro"], et0["hoje"], et0["futuro"])}
    esperas = {s: [r["espera_dias"] for r in aval_hoje[s]["culturas"]] for s in sequencias}
    # dias do talhao livre ate o fim do ultimo ciclo, na sequencia mais longa
    duracao = max(
        (sum(e + tabela[n]["ciclo_dias"] for e, n in zip(esperas[s], s)) + DIAS_COLHEITA * (len(s) - 1) for s in sequencias),
        default=0,
    )
    datas = hoje["datas"]
    inicios = {}  # ano em que o talhao fica livre -> posicao desse dia na serie
    for ano in range(datas[0].year, datas[-1].year + 1):
        i = (datetime.date(ano, mes_plantio, 1) - datas[0]).days
        if i >= 0 and i + duracao <= len(datas):
            inicios[ano] = i
    if sequencias and len(inicios) < MIN_ANOS_DIARIO:
        raise ValueError(
            f"serie diaria com menos de {MIN_ANOS_DIARIO} anos completos para o talhao livre no mes {mes_plantio}"
        )

    por_ano = {}  # clima -> sequencia -> ano -> resultado
    for cen, serie in series.items():
        cache = {}
        por_ano[cen] = {
            s: {
                ano: avaliar_sequencia_diaria(s, slots, anterior, tabela, esperas[s], i, serie, precos, cache)
                for ano, i in inicios.items()
            }
            for s in sequencias
        }

    niveis = {"mediano": statistics.median, "ruim": _quantil_ruim}
    partes = ("agua", "solo", "receita_ha")
    resumo = {
        cen: {
            s: {nivel: {p: f([a[p] for a in anos.values()]) for p in partes} for nivel, f in niveis.items()}
            for s, anos in porseq.items()
        }
        for cen, porseq in por_ano.items()
    }
    # renda de 0 a 1: a maior receita do ano mediano entre as sequencias, hoje e no futuro, vale 1
    teto = max((resumo[cen][s]["mediano"]["receita_ha"] for cen in resumo for s in sequencias), default=0.0) or 1.0
    for cen in resumo:
        for nivel in niveis:
            for s in sequencias:
                a = resumo[cen][s][nivel]
                a["renda"] = min(1.0, a["receita_ha"] / teto)
                a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
            for i, s in enumerate(sorted(sequencias, key=lambda s: -resumo[cen][s][nivel]["score"])):
                resumo[cen][s][nivel]["rank"] = i + 1

    campos_cultura = ("atendimento_hidrico", "fator_agua", "encaixe_calor", "fator", "receita_ha")
    blocos = {}
    for s in sequencias:
        blocos[s] = {}
        for cen in por_ano:
            anos = por_ano[cen][s]
            pior = min(anos, key=lambda ano: (anos[ano]["receita_ha"], anos[ano]["agua"]))
            blocos[s][cen] = {
                **resumo[cen][s],
                "pior_ano": {"ano": pior, "agua": anos[pior]["agua"], "receita_ha": anos[pior]["receita_ha"]},
                "culturas": [
                    {
                        "cultura": nome,
                        "slot": slot,
                        **{
                            nivel: {k: f([a["culturas"][i][k] for a in anos.values()]) for k in campos_cultura}
                            for nivel, f in niveis.items()
                        },
                    }
                    for i, (nome, slot) in enumerate(zip(s, slots))
                ],
                "anos": [{"ano": ano, **{p: a[p] for p in partes}} for ano, a in anos.items()],
            }
    geral = {"anos": list(inicios), "n_anos": len(inicios), "quantil_ruim": QUANTIL_RUIM}
    return geral, blocos


def _fator_limitante(r):
    """O menor entre encaixe de temperatura, de chuva, de calor e atendimento hidrico: (nome, valor)."""
    fatores = {
        "temperatura": r["encaixe_temp"],
        "chuva": r["encaixe_chuva"],
        "calor": r["encaixe_calor"],
        "agua": r["atendimento_hidrico"],
    }
    return min(fatores.items(), key=lambda kv: kv[1])


def avisos_da_sequencia(s, tabela, aval, precos, tem_historico, bloco_diario):
    """Lacunas de informacao e riscos de uma sequencia, tirados dos proprios numeros dela.

    Cada aviso: tipo ("risco" ou "lacuna"), codigo, cultura e cenario (ou None), os dados
    que o geraram e um texto pronto. A lista explica o resultado; nao muda score nem rank.
    """
    lista = []

    def aviso(tipo, codigo, texto, cultura=None, cenario=None, **dados):
        lista.append({"tipo": tipo, "codigo": codigo, "cultura": cultura, "cenario": cenario, "dados": dados, "texto": texto})

    for cen, porseq in aval.items():
        for r in porseq[s]["culturas"]:
            fator, valor = _fator_limitante(r)
            if valor < AVISO_FATOR:
                aviso(
                    "risco", "fator_limitante",
                    f"{r['cultura']} na {r['slot']}, clima {cen}: {NOME_FATOR[fator]} limita a produtividade a {valor * 100:.0f}%.",
                    r["cultura"], cen, fator=fator, valor=valor, slot=r["slot"],
                )  # fmt: skip
    hoje, futuro = aval["hoje"][s], aval["futuro"][s]
    if hoje["receita_ha"] > 0 and 1 - futuro["receita_ha"] / hoje["receita_ha"] > AVISO_QUEDA_FUTURO:
        queda = 1 - futuro["receita_ha"] / hoje["receita_ha"]
        aviso(
            "risco", "queda_no_futuro",
            f"A receita cai {queda * 100:.0f}% do clima de hoje para o de 2041-2060.",
            cenario="futuro", queda=queda, receita_hoje=hoje["receita_ha"], receita_futuro=futuro["receita_ha"],
        )  # fmt: skip
    for cen, bloco in (bloco_diario or {}).items():
        mediano, ruim = bloco["mediano"]["receita_ha"], bloco["ruim"]["receita_ha"]
        if mediano > 0 and 1 - ruim / mediano > AVISO_QUEDA_ANO_RUIM:
            aviso(
                "risco", "queda_no_ano_ruim",
                f"Clima {cen}: em um ano ruim (1 em 5) a receita fica {(1 - ruim / mediano) * 100:.0f}% abaixo da do ano mediano.",
                cenario=cen, queda=1 - ruim / mediano, receita_mediano=mediano, receita_ruim=ruim,
            )  # fmt: skip
    for r in hoje["culturas"]:
        if r["fator_sequencia"] == PENALIDADE_REPETICAO:
            aviso(
                "risco", "repete_a_cultura",
                f"{r['cultura']} repete a cultura anterior: o motor tira {(1 - PENALIDADE_REPETICAO) * 100:.0f}% da produtividade "
                "(pragas e doenças). O valor é provisório.",
                r["cultura"], fator_sequencia=r["fator_sequencia"], slot=r["slot"],
            )  # fmt: skip
    expostos = hoje["descoberto"]["dias_expostos"]
    if expostos >= AVISO_DIAS_EXPOSTOS:
        aviso(
            "risco", "solo_exposto",
            f"O solo fica {expostos} dias sem cultura e sem palhada, com {hoje['descoberto']['chuva_exposta_mm']:.0f} mm de chuva nesses dias.",
            dias_expostos=expostos, chuva_exposta_mm=hoje["descoberto"]["chuva_exposta_mm"],
        )  # fmt: skip

    if not tem_historico:
        aviso(
            "lacuna", "sem_historico",
            "Sem histórico de plantio: a primeira cultura não recebe a penalidade de repetição nem o bônus após fixadora de nitrogênio.",
        )  # fmt: skip
    for nome in dict.fromkeys(s):
        c = tabela[nome]
        if c["temp_calor_c"] is None:
            aviso(
                "lacuna", "sem_limiar_de_calor",
                f"{nome} não tem limiar de calor na tabela: o motor não desconta calor dela. Isso não comprova tolerância.",
                nome,
            )  # fmt: skip
        elif c["temp_calor_c"] in LIMIARES_POUCO_CONFIAVEIS:
            aviso(
                "lacuna", "limiar_de_calor_pouco_confiavel",
                f"{nome} usa o limiar de {c['temp_calor_c']} °C, em que a contagem de dias quentes é a menos confiável.",
                nome, temp_calor_c=c["temp_calor_c"],
            )  # fmt: skip
        if precos.get(nome, c["preco"]) == 0:
            aviso(
                "lacuna", "sem_valor_de_mercado",
                f"{nome} está com preço zero: forragem, semente e o benefício ao solo não entram na receita.",
                nome,
            )  # fmt: skip
        if bloco_diario is not None and c["ky_padrao"]:
            aviso(
                "lacuna", "ky_padrao",
                f"{nome} não está na tabela de Ky da FAO: a perda por falta de água usa Ky = {KY_PADRAO:g}.",
                nome, ky=c["ky"],
            )  # fmt: skip
        for campo, status in c["status"].items():
            aviso(
                "lacuna", "valor_a_conferir",
                f"{nome}: o valor de {campo} está marcado como '{status}' na tabela de culturas. Confira com uma fonte local.",
                nome, campo=campo, status=status, valor=c.get(campo),
            )  # fmt: skip
    return lista


def beneficios_da_sequencia(s, aval):
    """Beneficios de uma sequencia, so com o que o motor usa na conta (regra 18).

    Mesmo formato dos avisos, sem "tipo". Cada beneficio sai de um numero ou atributo que
    entra no score ou em descoberto; a lista explica o resultado e nao muda score nem rank.
    """
    lista = []

    def beneficio(codigo, texto, cultura=None, cenario=None, **dados):
        lista.append({"codigo": codigo, "cultura": cultura, "cenario": cenario, "dados": dados, "texto": texto})

    hoje, futuro = aval["hoje"][s], aval["futuro"][s]
    vistas = set()
    for r in hoje["culturas"]:
        nome = r["cultura"]
        if r["fator_sequencia"] == BONUS_APOS_FIXADORA:
            beneficio(
                "bonus_apos_fixadora",
                f"{nome} na {r['slot']} vem depois de uma fixadora de nitrogênio: o motor soma "
                f"{(BONUS_APOS_FIXADORA - 1) * 100:.0f}% à produtividade. O valor é provisório.",
                nome, fator_sequencia=r["fator_sequencia"], slot=r["slot"],
            )  # fmt: skip
        if nome in vistas:
            continue
        vistas.add(nome)
        if r["fixa_n"]:
            beneficio("fixa_nitrogenio", f"{nome} fixa nitrogênio do ar, segundo a tabela de culturas.", nome)
        if r["cobre_solo"]:
            beneficio(
                "deixa_palhada",
                f"{nome} deixa palhada: o motor conta o solo como coberto do fim do ciclo até o próximo plantio.",
                nome,
            )  # fmt: skip
    expostos = hoje["descoberto"]["dias_expostos"]
    if expostos < AVISO_DIAS_EXPOSTOS:
        beneficio(
            "pouco_solo_exposto",
            "O solo não fica nenhum dia sem cultura e sem palhada no ano." if expostos == 0
            else f"O solo fica só {expostos} dias no ano sem cultura e sem palhada.",
            dias_expostos=expostos, chuva_exposta_mm=hoje["descoberto"]["chuva_exposta_mm"],
        )  # fmt: skip
    if hoje["receita_ha"] > 0:
        queda = 1 - futuro["receita_ha"] / hoje["receita_ha"]
        if queda <= AVISO_QUEDA_FUTURO:
            if abs(queda) < 0.005:
                muda = "fica igual"
            else:
                muda = f"sobe {-queda * 100:.0f}%" if queda < 0 else f"cai só {queda * 100:.0f}%"
            beneficio(
                "estavel_no_futuro",
                f"A receita {muda} do clima de hoje para o de 2041-2060.",
                cenario="futuro", queda=queda, receita_hoje=hoje["receita_ha"], receita_futuro=futuro["receita_ha"],
            )  # fmt: skip
    piores = [_fator_limitante(r)[1] for cen in ("hoje", "futuro") for r in aval[cen][s]["culturas"]]
    if min(piores) >= AVISO_FATOR:
        beneficio(
            "clima_favoravel",
            f"Hoje e em 2041-2060, nenhum fator de clima ou água limita as culturas abaixo de {AVISO_FATOR * 100:.0f}%.",
            menor_fator=min(piores),
        )  # fmt: skip
    return lista


def recomendar(entrada, culturas, clima_hoje, clima_futuro, clima_seco=None, diario=None):
    """Ranqueia as sequencias de 1 ou 2 culturas no clima de hoje e no futuro.

    Cada posicao da sequencia e um slot (safra ou safrinha). Sequencia com cultura
    fora da epoca de plantio do slot nao entra no ranking: vai para "descartadas".

    entrada: dict com lat, rotacao_atual, prioridades, horizonte, mes_plantio, precos.
    culturas, clima_hoje, clima_futuro: DataFrames (ver docs/contrato_motor.md).
    clima_seco: opcional, mesma forma das outras duas. Se vier, a saida ganha um
    terceiro cenario ("seco"); sem ele, a saida so tem hoje e futuro.
    diario: opcional, serie diaria de hoje (data, chuva_mm, tmin_c, tmax_c e, se houver,
    et0_mm). Se vier, a saida ganha "diario": cada sequencia viavel em cada ano da serie,
    com ano mediano e ano ruim. Os campos que ja existiam nao mudam.
    Devolve um dict pronto para json.dumps.
    """
    tabela = _tabela_culturas(culturas)
    climas = {"hoje": _tabela_clima(clima_hoje), "futuro": _tabela_clima(clima_futuro)}
    if clima_seco is not None:
        climas["seco"] = _tabela_clima(clima_seco)
    for cen, clima in climas.items():
        faltam = sorted({coluna_de_calor(c) for c in tabela.values() if coluna_de_calor(c)} - set(clima[0]))
        if faltam:
            raise ValueError(f"clima {cen} sem as colunas de calor {faltam}: rode scripts/montar_clima.py")

    lat = float(entrada["lat"])
    horizonte = int(entrada.get("horizonte", 2))
    mes_plantio = int(entrada.get("mes_plantio", 10))
    historico = list(entrada.get("rotacao_atual") or [])
    precos = {k: float(v) for k, v in (entrada.get("precos") or {}).items()}
    declividade = entrada.get("declividade_pct")
    declividade = None if declividade is None else float(declividade)
    if declividade is not None and not 0 <= declividade <= 100:
        raise ValueError("declividade_pct deve estar entre 0 e 100")
    if horizonte not in (1, 2):
        raise ValueError("horizonte deve ser 1 ou 2")
    if not 1 <= mes_plantio <= 12:
        raise ValueError("mes_plantio deve estar entre 1 e 12")
    desconhecidas = sorted({n for n in [*historico, *precos] if n not in tabela})
    if desconhecidas:
        raise ValueError(f"culturas fora da tabela: {desconhecidas}. Validas: {sorted(tabela)}")
    pesos = _normalizar_pesos(entrada.get("prioridades") or {})

    anterior = historico[-1] if historico else None
    atual = rotacao_atual(historico, horizonte)

    todas = list(itertools.product(tabela, repeat=horizonte))
    et0 = {cen: et0_do_clima(clima, lat) for cen, clima in climas.items()}

    def avaliar(slots):
        return {
            cen: {s: avaliar_sequencia(s, slots, anterior, tabela, clima, et0[cen], mes_plantio, precos) for s in todas}
            for cen, clima in climas.items()
        }

    # a epoca de plantio nao depende do clima: as descartadas sao as mesmas em todos os climas
    slots = ordem_dos_slots(mes_plantio, horizonte)
    aval = avaliar(slots)
    if all("fora_de_epoca" in aval["hoje"][s] for s in todas):
        # nenhuma sequencia cabe na ordem do semestre (talhao livre de abril a junho, ou em dezembro
        # com duas culturas): tenta comecar pelo outro slot (regra 2)
        outra = ordem_dos_slots(1 if slots[0] == "safra" else 7, horizonte)
        aval_outra = avaliar(outra)
        if any("fora_de_epoca" not in aval_outra["hoje"][s] for s in todas):
            slots, aval = outra, aval_outra
    descartadas = [s for s in todas if "fora_de_epoca" in aval["hoje"][s]]
    sequencias = [s for s in todas if "fora_de_epoca" not in aval["hoje"][s]]

    # renda de 0 a 1: a maior receita entre as sequencias viaveis, hoje e no futuro, vale 1.
    # O ano seco fica fora do teto, para nao mudar os numeros de hoje e futuro; a renda dele para em 1.
    teto = max((aval[cen][s]["receita_ha"] for cen in ("hoje", "futuro") for s in sequencias), default=0.0) or 1.0
    rank = {}
    for cen, porseq in aval.items():
        for s in sequencias:
            a = porseq[s]
            a["renda"] = min(1.0, a["receita_ha"] / teto)
            a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
            if declividade is not None:  # chuva sobre solo exposto, ponderada pela declividade; fora do score
                a["descoberto"]["indice_erosao"] = a["descoberto"]["chuva_exposta_mm"] * fator_declividade(declividade)
        ordem = sorted(sequencias, key=lambda s: -porseq[s]["score"])
        rank[cen] = {s: i + 1 for i, s in enumerate(ordem)}

    geral_diario = blocos_diario = None
    if diario is not None:
        geral_diario, blocos_diario = _modo_diario(
            diario, lat, climas, et0, tabela, sequencias, aval["hoje"], slots, anterior, mes_plantio, precos, pesos
        )

    campos = ["score", "agua", "solo", "renda", "receita_ha", "encaixe", "descoberto", "culturas"]
    saida = {
        "entrada": {
            "lat": lat,
            "rotacao_atual": historico,
            "prioridades": pesos,
            "horizonte": horizonte,
            "mes_plantio": mes_plantio,
            "precos": precos,
            "declividade_pct": declividade,
        },
        "slots": slots,
        # a rotacao atual, para comparar com as outras: os numeros dela estao em "sequencias"
        # (item com o mesmo id) se for viavel; se nao for, "motivo" diz por que nao cabe
        "atual": None
        if atual is None
        else {
            "id": ">".join(atual),
            "culturas": list(atual),
            "viavel": atual in sequencias,
            "motivo": aval["hoje"][atual].get("fora_de_epoca"),
        },
        "clima": {
            cen: [{**m, "et0_mm": et0[cen][i] * DIAS_MES[i]} for i, m in enumerate(clima)]
            for cen, clima in climas.items()
        },
        "sequencias": [
            {
                "id": ">".join(s),
                "culturas": list(s),
                "atual": s == atual,
                **{f"rank_{cen}": rank[cen][s] for cen in climas},
                **{cen: {k: aval[cen][s][k] for k in campos} for cen in climas},
                **({"diario": blocos_diario[s]} if blocos_diario is not None else {}),
                "avisos": avisos_da_sequencia(
                    s, tabela, aval, precos, bool(historico), blocos_diario[s] if blocos_diario is not None else None
                ),
                "beneficios": beneficios_da_sequencia(s, aval),
            }
            for s in sorted(sequencias, key=lambda s: rank["hoje"][s])
        ],
        "descartadas": [
            {"id": ">".join(s), "culturas": list(s), "atual": s == atual, "motivo": aval["hoje"][s]["fora_de_epoca"]}
            for s in descartadas
        ],
    }
    if geral_diario is not None:
        saida["diario"] = geral_diario
    return _arredondar(saida)


def _serie_diaria(df, lat):
    """Confere a serie diaria e devolve listas por dia. Sem et0_mm, calcula Hargreaves de cada dia."""
    faltam = [c for c in COLUNAS_DIARIO if c not in df.columns]
    if faltam:
        raise ValueError(f"serie diaria sem as colunas: {faltam}")
    d = df.sort_values("data")
    datas = [x.date() for x in pd.to_datetime(d["data"])]
    if not datas or any((b - a).days != 1 for a, b in zip(datas, datas[1:])):
        raise ValueError("serie diaria precisa de uma linha por dia, sem dias faltando ou repetidos")
    serie = {"datas": datas, "mes": [x.month for x in datas]}
    for chave, coluna in (("chuva", "chuva_mm"), ("tmin", "tmin_c"), ("tmax", "tmax_c")):
        serie[chave] = [float(v) for v in d[coluna]]
    if "et0_mm" in d.columns:
        serie["et0"] = [float(v) for v in d["et0_mm"]]
    else:
        serie["et0"] = [
            0.0023 * ((tn + tx) / 2 + 17.8) * max(tx - tn, 0) ** 0.5 * 0.408 * radiacao_extraterrestre(lat, x.timetuple().tm_yday)
            for x, tn, tx in zip(datas, serie["tmin"], serie["tmax"])
        ]  # fmt: skip
    if not all(math.isfinite(v) for chave in ("chuva", "tmin", "tmax", "et0") for v in serie[chave]):
        raise ValueError("serie diaria com valores vazios")
    return serie


def _serie_futura(serie, hoje, futuro, et0_hoje, et0_futuro):
    """A serie de hoje com a mudanca mensal entre as duas tabelas de clima.

    Temperaturas: soma a diferenca do mes. Chuva e ET0: multiplica pela razao do mes,
    para os dias sem chuva continuarem sem chuva.
    """
    d_tmin = [f["tmin_c"] - h["tmin_c"] for h, f in zip(hoje, futuro)]
    d_tmax = [f["tmax_c"] - h["tmax_c"] for h, f in zip(hoje, futuro)]
    r_chuva = [f["chuva_mm"] / h["chuva_mm"] if h["chuva_mm"] > 0 else 1.0 for h, f in zip(hoje, futuro)]
    r_et0 = [f / h if h > 0 else 1.0 for h, f in zip(et0_hoje, et0_futuro)]
    meses = serie["mes"]
    return {
        **serie,
        "chuva": [v * r_chuva[m - 1] for v, m in zip(serie["chuva"], meses)],
        "tmin": [v + d_tmin[m - 1] for v, m in zip(serie["tmin"], meses)],
        "tmax": [v + d_tmax[m - 1] for v, m in zip(serie["tmax"], meses)],
        "et0": [v * r_et0[m - 1] for v, m in zip(serie["et0"], meses)],
    }


def _tabela_clima(df):
    faltam = [c for c in COLUNAS_CLIMA if c not in df.columns]
    if faltam:
        raise ValueError(f"tabela de clima sem as colunas: {faltam}")
    linhas = df.sort_values("mes").to_dict("records")
    if [int(m["mes"]) for m in linhas] != list(range(1, 13)):
        raise ValueError("tabela de clima precisa de 12 linhas, uma por mes (1 a 12)")
    opcionais = [c for c in df.columns if c == "et0_mm" or c.startswith("dias_acima_")]
    colunas = COLUNAS_CLIMA[1:] + opcionais
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
        limiar = linha.get("temp_calor_c")  # coluna opcional; vazio = a regra de calor nao se aplica
        c["temp_calor_c"] = None if limiar is None or pd.isna(limiar) else int(limiar)
        ky = linha.get("ky")  # coluna opcional; sem ela, vale a tabela KY. So o modo diario usa
        c["ky"] = KY.get(nome, KY_PADRAO) if ky is None or pd.isna(ky) else float(ky)
        c["ky_padrao"] = (ky is None or pd.isna(ky)) and nome not in KY
        # colunas opcionais <campo>_status (ex.: preco_status = memoria): valor ainda sem fonte conferida
        c["status"] = {
            col[: -len("_status")]: str(linha[col]).strip()
            for col in df.columns
            if col.endswith("_status") and not pd.isna(linha[col]) and str(linha[col]).strip()
        }
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
