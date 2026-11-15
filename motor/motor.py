"""Motor de recomendacao de rotacao: regras e aritmetica, sem ML.

Uso:
    from motor import carregar_dados, recomendar
    saida = recomendar(entrada, *carregar_dados())

Demo: python -m motor
Contrato de entrada e saida: docs/contrato_motor.md

Modo diario (opcional): recomendar(..., diario=carregar_diario()) roda a mesma conta
com a serie diaria de cada ano, em vez da media mensal, e resume ano mediano e ano ruim.

Futuro por modelo (opcional): recomendar(..., clima_modelos=carregar_clima_modelos()) roda o
futuro uma vez por modelo climatico e devolve a faixa de rank e de receita de cada sequencia.
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

# Agua que o solo guarda de um dia para o outro (mm). ZARC da soja: profundidade efetiva de raiz
# de 60 cm x agua disponivel de latossolo (classes AD3 e AD4 da IN SPA/MAPA 1/2022, 0,61 a
# 1,06 mm/cm) = 37 a 64 mm. 60 = AD4, latossolo argiloso. Vale quando a entrada nao traz solo_textura.
CAD_MM = 60
# Com solo_textura na entrada: a mesma raiz de 60 cm x a agua disponivel da classe do ZARC que
# corresponde a textura. Arenoso ~ AD2 (0,46-0,61 mm/cm: 28-37 mm), medio ~ AD3 (0,61-0,80: 37-48 mm),
# argiloso ~ AD4 (0,80-1,06: 48-64 mm). AD3 e AD4 conferidas pelo resumo da IN SPA/MAPA 1/2022;
# a faixa de AD2 e a correspondencia textura -> classe sao de memoria, a conferir.
CAD_POR_TEXTURA = {"arenoso": 30, "medio": 45, "argiloso": 60}
# Renda: receita por ano de talhao ocupado, dividida pela receita potencial (preco x produtividade,
# sem perda) do sistema de referencia: soja na safra e milho na safrinha. Nao depende das outras
# sequencias avaliadas. Sem essas culturas na tabela, o teto e a maior receita por ano avaliada.
SISTEMA_REFERENCIA = (("soja", "produtividade"), ("milho", "produtividade_safrinha"))
# Cultura de referencia de cada slot: o teto soma so os slots que as sequencias ocupam. Com uma
# cultura so, o teto e o da cultura de referencia daquele slot (soja na safra, milho na safrinha).
REFERENCIA_POR_SLOT = dict(zip(("safra", "safrinha"), SISTEMA_REFERENCIA))

# Valores provisorios, sem fonte: ajustar com um agronomo.
PENALIDADE_REPETICAO = 0.85  # fator na produtividade ao repetir a cultura anterior
BONUS_APOS_FIXADORA = 1.10  # fator na produtividade de uma nao fixadora apos um adubo verde (regra 10)
# O bonus so vale se a cultura seguinte e plantada ate esse numero de dias depois do fim do ciclo
# do adubo verde: a palhada de leguminosa se decompoe em semanas no Cerrado. Sugestao da revisao
# agronomica de 15/11 (~60 dias), sem fonte conferida.
JANELA_BONUS_N_DIAS = 60
# fator na produtividade de uma cultura que divide praga ou doenca com a anterior (HOSPEDEIRO_COMUM).
# Menor que a repeticao e nao soma com ela; multiplica o bonus apos adubo verde (1,10 x 0,92 = 1,012).
PENALIDADE_HOSPEDEIRO = 0.92
# Mosca-branca de soja para feijao (mosaico-dourado): fator proprio, maior. A Embrapa cita perdas de 40%
# a 100% do feijao em cultivar suscetivel; 0,75 e provisorio, de memoria da revisao agronomica de 15/11.
PENALIDADE_MOSCA_BRANCA = 0.75
PESO_SOLO = {"fixa_n": 0.4, "cobre_solo": 0.4, "diversidade": 0.2}
FASES_KC = (0.20, 0.45, 0.80)  # fracoes do ciclo: fim do Kc inicial, inicio e fim do Kc medio
DIAS_COLHEITA = 10  # dias para colher e liberar o talhao depois do fim do ciclo
ESPERA_MAX_DIAS = 182  # meio ano: se o mes de plantio do slot esta mais longe que isso, a epoca ja passou
# Meses depois do mes de plantio do slot em que a cultura ainda entra (plantio tardio, sem perda de
# produtividade; sai o aviso plantio_tardio). Provisorio, de memoria: as janelas do ZARC/Embrapa
# para o Cerrado mineiro passam de um mes (soja ate dezembro, sorgo safrinha ate 20/3). Nao conferido.
JANELA_PLANTIO_MESES = 1
FASE_SENSIVEL = FASES_KC[1:]  # florescimento e enchimento de graos: a fase de Kc medio
PERDA_CALOR = 1.0  # fracao da produtividade perdida se todos os dias da fase sensivel passam do limiar
# Escala da parte agua do score: o atendimento hidrico da sequencia (1 - deficit / demanda) vai da
# faixa fixa [AGUA_REF_MIN, 1] para [0, 1]. Com 0, a parte agua e o proprio atendimento. Foi 0,6 por
# algumas horas em 15/11; as revisoes mostraram que isso multiplicava o peso da agua por 2,5 (a agua
# ja entra na receita pelo fator de crescimento) e punha soja>feijao em 1o e soja>milho em 6o.
AGUA_REF_MIN = 0.0

# Hospedeiro comum (regra 10): culturas diferentes que dividem praga ou doenca relevante no Cerrado.
# Cada item: (culturas anteriores, culturas seguintes, praga, fonte). Vale para toda cultura seguinte
# diferente da anterior; a mesma cultura cai na repeticao. Conferido em 15/11/2026. Ficaram de fora:
# Pratylenchus brachyurus e Macrophomina phaseolina (atacam quase toda a tabela e nao diferenciam
# sequencias) e crotalaria como hospedeira de mofo-branco (sem fonte conferida).
_MOFO_BRANCO = ("soja", "feijao", "girassol", "algodao")
HOSPEDEIRO_COMUM = (
    (
        _MOFO_BRANCO, _MOFO_BRANCO, "mofo-branco (Sclerotinia sclerotiorum)",
        # hospedeiras citadas no comunicado: feijao, soja, girassol (...) e algodao
        "Embrapa Algodao, Comunicado Tecnico 336 (2007), "
        "https://www.infoteca.cnptia.embrapa.br/bitstream/doc/276699/1/COMTEC336.pdf",
    ),
    (
        ("soja",), ("feijao",), "mosca-branca (Bemisia tabaci), vetora do mosaico-dourado do feijoeiro",
        # soja e hospedeira da mosca-branca; "evitar a semeadura escalonada do feijao apos feijao ou apos a soja"
        "Embrapa Arroz e Feijao, Circular Tecnica 91, "
        "https://www.infoteca.cnptia.embrapa.br/infoteca/bitstream/doc/1130832/1/CNPAF-circ-tec-91.pdf",
    ),
)  # fmt: skip

# Modo diario. Ky = queda relativa da produtividade por queda relativa da evapotranspiracao
# (FAO-56, eq. 90). Valores da FAO-56, tabela 24, que repete o FAO Irrigation and Drainage
# Paper 33. Trigo: "spring wheat" (trigo de sequeiro do Cerrado).
KY = {"soja": 0.85, "milho": 1.25, "sorgo": 0.90, "feijao": 1.15, "girassol": 0.95, "algodao": 0.85, "trigo": 1.15}
KY_PADRAO = 1.0  # cultura sem Ky na tabela da FAO: perda proporcional, como no modo mensal
QUANTIL_RUIM = 0.2  # "ano ruim": cerca de 1 em cada 5 anos fica nesse valor ou abaixo
MIN_ANOS_DIARIO = 5  # menos anos completos que isso: nao resumir
# Geada: minima no abrigo de 3 graus C ou menos, o criterio usual no Brasil (Grodzki et al., 1996;
# Embrapa Trigo): o ar no abrigo fica de 3 a 6 graus C mais quente que a superficie das plantas.
LIMIAR_GEADA_C = 3.0
# Chuva extrema: dia acima do percentil 95 dos dias com chuva da serie de hoje (indice R95p do
# ETCCDI). O limiar sai da propria serie e vale tambem para o futuro, para a contagem mostrar a mudanca.
PERCENTIL_CHUVA_EXTREMA = 0.95
DIA_COM_CHUVA_MM = 1.0
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

# Ajuste de cenario ("e se"): faixas aceitas na entrada "ajuste". Escolha do time, sem fonte.
AJUSTE_CHUVA_PCT = (-50.0, 30.0)  # % sobre a chuva de cada mes
AJUSTE_TEMP_C = (0.0, 4.0)  # graus C somados a minima e a maxima de cada mes

# Altitude do talhao (entrada altitude_m, regra 21): faixa aceita, em metros. Escolha do time, sem
# fonte; so barra erro de digitacao ou de unidade.
ALTITUDE_M = (-100.0, 6000.0)

# Futuro por modelo (regra 20). Limite provisorio, sem fonte: so decide quando avisar.
AVISO_FAIXA_RANK = 5  # rank do futuro que varia mais que isso entre os modelos vira aviso
COLUNAS_MODELOS = ["modelo", "mes", "delta_chuva_mm", "delta_tmin_c", "delta_tmax_c"]  # razao_chuva, off_* opcionais

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


def carregar_clima_modelos(pasta=DADOS):
    """Le clima_modelos.csv (deltas do NEX por modelo e mes). None se a pasta nao tem o arquivo.

    Se a pasta tem clima_correcoes.csv, junta off_tmin e off_tmax (correcao da estacao A520) por
    mes: o ET0 de cada modelo usa as temperaturas sem a correcao, como scripts/montar_clima.py.
    """
    pasta = Path(pasta)
    arquivo = pasta / "clima_modelos.csv"
    if not arquivo.exists():
        return None
    modelos = pd.read_csv(arquivo)
    correcoes = pasta / "clima_correcoes.csv"
    if correcoes.exists() and not {"off_tmin", "off_tmax"} & set(modelos.columns):
        modelos = modelos.merge(pd.read_csv(correcoes)[["mes", "off_tmin", "off_tmax"]], on="mes", how="left")
    return modelos


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


def ler_ajuste(ajuste):
    """Confere a entrada "ajuste" ({"chuva_pct", "temp_c"}). Devolve None se nao veio."""
    if ajuste is None:
        return None
    if not isinstance(ajuste, dict):
        raise ValueError('ajuste deve ser um objeto com "chuva_pct" e "temp_c"')
    sobra = sorted(set(ajuste) - {"chuva_pct", "temp_c"})
    if sobra:
        raise ValueError(f"ajuste com campos desconhecidos: {sobra}")
    lido = {}
    for campo, (menor, maior) in (("chuva_pct", AJUSTE_CHUVA_PCT), ("temp_c", AJUSTE_TEMP_C)):
        valor = float(ajuste.get(campo) or 0)
        if not math.isfinite(valor) or not menor <= valor <= maior:
            raise ValueError(f"ajuste.{campo} deve estar entre {menor:g} e {maior:g}")
        lido[campo] = valor
    return lido


def fator_et0_temp(tmin, tmax, delta_c):
    """Quanto a ET0 de Hargreaves muda ao somar delta_c a minima e a maxima.

    A amplitude (tmax - tmin) e a radiacao nao mudam; so o termo (tmed + 17,8).
    """
    base = (tmin + tmax) / 2 + 17.8
    return (base + delta_c) / base if base > 0 else 1.0


def dias_acima_deslocado(m, limiar, delta_c, dias_no_mes):
    """Dias acima de `limiar` depois de somar delta_c a maxima = dias acima de (limiar - delta_c) hoje.

    A tabela so tem alguns limiares (dias_acima_NN): interpola entre os dois vizinhos e, fora da
    faixa, estende a reta dos dois mais proximos. Fica entre 0 e os dias do mes.
    """
    pontos = sorted((int(k[len("dias_acima_") :]), v) for k, v in m.items() if k.startswith("dias_acima_"))
    if len(pontos) < 2:
        return m[f"dias_acima_{limiar}"]
    x = limiar - delta_c
    i = 1
    while i < len(pontos) - 1 and pontos[i][0] < x:
        i += 1
    (x0, y0), (x1, y1) = pontos[i - 1], pontos[i]
    y = y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return min(max(y, 0.0), float(dias_no_mes))


def ajustar_clima(clima, ajuste):
    """Tabela de clima com o ajuste de cenario: chuva x (1 + pct/100), temperaturas + delta.

    ET0 da tabela (se vier) muda pelo fator de Hargreaves; sem a coluna, o Hargreaves do motor ja
    usa as temperaturas novas. Dias quentes: dias_acima_deslocado.
    """
    k, dt = 1 + ajuste["chuva_pct"] / 100, ajuste["temp_c"]
    novo = []
    for i, m in enumerate(clima):
        n = {**m, "chuva_mm": m["chuva_mm"] * k, "tmin_c": m["tmin_c"] + dt, "tmax_c": m["tmax_c"] + dt}
        if "et0_mm" in m:
            n["et0_mm"] = m["et0_mm"] * fator_et0_temp(m["tmin_c"], m["tmax_c"], dt)
        if dt:
            for col in m:
                if col.startswith("dias_acima_"):
                    n[col] = dias_acima_deslocado(m, int(col[len("dias_acima_") :]), dt, DIAS_MES[i])
        novo.append(n)
    return novo


def ajustar_serie(serie, ajuste):
    """Serie diaria com o ajuste de cenario, dia a dia, com a mesma conta de ajustar_clima."""
    k, dt = 1 + ajuste["chuva_pct"] / 100, ajuste["temp_c"]
    return {
        **serie,
        "chuva": [v * k for v in serie["chuva"]],
        "tmin": [v + dt for v in serie["tmin"]],
        "tmax": [v + dt for v in serie["tmax"]],
        "et0": [v * fator_et0_temp(tn, tx, dt) for v, tn, tx in zip(serie["et0"], serie["tmin"], serie["tmax"])],
    }


def climas_por_modelo(modelos, hoje, futuro, lat):
    """Uma tabela de clima futuro por modelo, com o metodo de scripts/montar_clima.py (regra 20).

    modelos: {modelo: 12 linhas de _tabela_modelos}; hoje e futuro: tabelas de _tabela_clima
    (futuro = a media dos mesmos modelos). Por mes:
    - tmin_c, tmax_c: hoje + delta do modelo;
    - chuva_mm: hoje x razao_chuva do modelo, se a coluna vier (o metodo do script); senao a
      aproximacao futuro medio x (hoje + delta do modelo) / (hoje + delta medio), que deixa a
      media dos modelos igual ao futuro medio;
    - et0_mm (so se hoje traz a coluna): ET0 de hoje x Hargreaves(temperaturas sem a correcao da
      estacao + delta do modelo) / Hargreaves(sem a correcao). Sem off_tmin/off_tmax, usa as
      temperaturas de hoje como estao;
    - dias_acima_NN: dias_acima_deslocado de hoje pelo delta de Tmax do modelo.
    """
    n = len(modelos)
    media_chuva = [sum(linhas[i]["delta_chuva_mm"] for linhas in modelos.values()) / n for i in range(12)]
    tem_et0 = all("et0_mm" in m for m in hoje)
    sem_correcao = [
        {"mes": h["mes"], "tmin_c": h["tmin_c"] - (off.get("off_tmin") or 0.0), "tmax_c": h["tmax_c"] - (off.get("off_tmax") or 0.0)}
        for h, off in zip(hoje, next(iter(modelos.values())))
    ]  # fmt: skip
    hg_hoje = et0_hargreaves(sem_correcao, lat)
    saida = {}
    for nome, linhas in modelos.items():
        clima = []
        hg = et0_hargreaves(
            [
                {"mes": b["mes"], "tmin_c": b["tmin_c"] + d["delta_tmin_c"], "tmax_c": b["tmax_c"] + d["delta_tmax_c"]}
                for b, d in zip(sem_correcao, linhas)
            ],
            lat,
        )
        for i, (h, f, d) in enumerate(zip(hoje, futuro, linhas)):
            if d.get("razao_chuva") is not None:
                chuva = h["chuva_mm"] * d["razao_chuva"]
            elif h["chuva_mm"] + media_chuva[i] > 0:
                chuva = f["chuva_mm"] * (h["chuva_mm"] + d["delta_chuva_mm"]) / (h["chuva_mm"] + media_chuva[i])
            else:
                chuva = h["chuva_mm"] + d["delta_chuva_mm"]
            m = {
                "mes": h["mes"],
                "chuva_mm": max(chuva, 0.0),
                "tmin_c": h["tmin_c"] + d["delta_tmin_c"],
                "tmax_c": h["tmax_c"] + d["delta_tmax_c"],
            }
            if tem_et0:
                m["et0_mm"] = h["et0_mm"] * (hg[i] / hg_hoje[i] if hg_hoje[i] > 0 else 1.0)
            for col in h:
                if col.startswith("dias_acima_"):
                    m[col] = dias_acima_deslocado(h, int(col[len("dias_acima_") :]), d["delta_tmax_c"], DIAS_MES[i])
            clima.append(m)
        saida[nome] = clima
    return saida


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

    E o proprio dia livre, se cair dentro do mes ou dos JANELA_PLANTIO_MESES seguintes (plantio
    tardio), ou o dia 1 da proxima vez que o mes chegar.
    None se a cultura nao tem mes naquele slot ou se a espera passa de ESPERA_MAX_DIAS.
    """
    if mes is None:
        return None
    janela = sum(DIAS_MES[(mes - 1 + k) % 12] for k in range(JANELA_PLANTIO_MESES + 1))  # dias da janela
    inicio = sum(DIAS_MES[: mes - 1]) - 365  # comeca um ano antes: a janela de dezembro entra em janeiro
    while inicio + janela - 1 < dia_livre:  # essa janela ja acabou: so a do ano seguinte
        inicio += 365
    plantio = max(inicio, dia_livre)
    return plantio if plantio - dia_livre <= ESPERA_MAX_DIAS else None


def simular_cultura(c, dia_inicio, clima, et0, agua, cad=None):
    """Roda o ciclo de uma cultura dia a dia, com chuva e ET0 do mes.

    Devolve (resultado, agua que sobra no solo). O solo guarda ate `cad` mm (padrao CAD_MM).
    Calor: soma os dias acima do limiar da cultura que caem na fase sensivel do ciclo.
    """
    cad = CAD_MM if cad is None else cad
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
        agua = min(cad, agua + chuva - eta)
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


def adubo_verde(c):
    """Fixadora de N que nao exporta grao: fixa_n e produtividade zero nos dois slots da tabela.

    Soja e feijao levam quase todo o N fixado embora nos graos; so o que nao e colhido deixa
    credito de N no solo. Usa a produtividade da tabela, nao o preco (que pode ser editado).
    """
    return bool(c["fixa_n"]) and c["produtividade"] == 0 and c["produtividade_safrinha"] == 0


def tem_bonus_de_n(c, anterior, culturas, dias_apos_anterior):
    """Regra 10: nao fixadora plantada ate JANELA_BONUS_N_DIAS depois do fim do ciclo de um adubo verde."""
    return (
        anterior in culturas
        and adubo_verde(culturas[anterior])
        and not c["fixa_n"]
        and dias_apos_anterior is not None
        and dias_apos_anterior <= JANELA_BONUS_N_DIAS
    )


def pragas_em_comum(anterior, nome):
    """Pragas e doencas de HOSPEDEIRO_COMUM que passam de `anterior` para `nome` (lista vazia se nenhuma).

    A mesma cultura nao conta aqui: repetir cai em PENALIDADE_REPETICAO.
    """
    if anterior is None or anterior == nome:
        return []
    return [praga for anteriores, seguintes, praga, _ in HOSPEDEIRO_COMUM if anterior in anteriores and nome in seguintes]


def fator_hospedeiro(pragas):
    """Fator de hospedeiro comum: o menor entre as pragas em comum (nao multiplica); 1 sem nenhuma."""
    if not pragas:
        return 1.0
    return min(PENALIDADE_MOSCA_BRANCA if p.startswith("mosca-branca") else PENALIDADE_HOSPEDEIRO for p in pragas)


def _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos, dias_apos_anterior=None):
    """Regras de sequencia, receita e parte de solo de uma cultura. Preenche r.

    dias_apos_anterior: dias do fim do ciclo da cultura anterior ate o plantio desta (regra 10).
    """
    nome = c["cultura"]
    pragas = pragas_em_comum(anterior, nome)
    repete = nome == anterior
    bonus_n = not repete and tem_bonus_de_n(c, anterior, culturas, dias_apos_anterior)
    penalidade = fator_hospedeiro(pragas)
    if repete:
        fator_sequencia = PENALIDADE_REPETICAO
    else:
        fator_sequencia = (BONUS_APOS_FIXADORA if bonus_n else 1.0) * penalidade
    r["repete"] = repete  # marcas para os avisos e beneficios (sem comparar numeros quebrados)
    r["bonus_n"] = bonus_n
    r["penalidade_hospedeiro"] = penalidade
    r["dias_apos_anterior"] = dias_apos_anterior if anterior in culturas else None
    produtividade = c["produtividade"] if slot == "safra" else c["produtividade_safrinha"]
    r["fixa_n"] = c["fixa_n"]  # atributos da tabela que entram na parte de solo, para explicar o numero
    r["cobre_solo"] = c["cobre_solo"]
    r["fator_sequencia"] = fator_sequencia
    r["hospedeiro_comum"] = {"anterior": anterior, "pragas": pragas} if pragas else None
    r["fator"] = cresce * fator_sequencia
    r["receita_ha"] = precos.get(nome, c["preco"]) * produtividade * r["fator"]
    # parte solo: o quanto a cultura cresce pelo clima (temperatura, chuva, calor), sem a agua, que ja
    # entra na parte agua e na receita
    clima = min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"])
    r["solo"] = clima * (
        PESO_SOLO["fixa_n"] * c["fixa_n"]
        + PESO_SOLO["cobre_solo"] * c["cobre_solo"]
        + PESO_SOLO["diversidade"] * (nome != anterior)
    )


def avaliar_sequencia(nomes, slots, anterior, culturas, clima, et0, mes_plantio, precos, cad=None, altitude_m=None):
    """Simula as culturas em fila, uma por slot, com o talhao livre no dia 1 de mes_plantio.

    Se uma cultura nao pode ser plantada no slot dela, devolve so {"fora_de_epoca": motivo}.
    Com altitude_m, uma cultura com altitude_min_m acima dela devolve so {"fora_de_altitude": motivo}
    (regra 21), so se a sequencia cabe no calendario: fora_de_epoca vem antes.
    """
    cad = CAD_MM if cad is None else cad
    dia = dia_livre = sum(DIAS_MES[: mes_plantio - 1])  # dia em que o talhao fica livre
    sem_cultura = dia  # desde quando o solo esta sem cultura
    agua = 0.0  # o solo comeca vazio
    palhada_inicial = anterior in culturas and bool(culturas[anterior]["cobre_solo"])
    # fim do ciclo da cultura anterior. Para a do historico nao ha data: supoe que acabou
    # DIAS_COLHEITA antes do talhao livre, como as da sequencia (regra 10)
    fim_anterior = dia_livre - DIAS_COLHEITA
    ciclos = []  # (dia do plantio, dia do fim do ciclo, a cultura deixa palhada?)
    resultados = []
    livres = []  # dia em que o talhao fica livre antes de cada cultura
    for nome, slot in zip(nomes, slots):
        c = culturas[nome]
        mes = c[f"mes_plantio_{slot}"]
        livres.append(dia)
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
            agua = min(cad, agua + clima[m - 1]["chuva_mm"] / DIAS_MES[m - 1])
        r, agua = simular_cultura(c, plantio, clima, et0, agua, cad)
        r["slot"] = slot
        r["espera_dias"] = plantio - dia
        sem_cultura = plantio + c["ciclo_dias"]
        ciclos.append((plantio, sem_cultura, bool(c["cobre_solo"])))
        dia = sem_cultura + DIAS_COLHEITA  # o talhao so fica livre depois da colheita

        # fator mais limitante
        cresce = min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"], r["atendimento_hidrico"])
        _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos, plantio - fim_anterior)
        resultados.append(r)
        anterior = nome
        fim_anterior = sem_cultura

    if altitude_m is not None:  # so depois do calendario: a altitude descarta sequencias que cabem nele
        for i, (nome, slot) in enumerate(zip(nomes, slots)):
            minima = culturas[nome].get("altitude_min_m")
            if minima is not None and minima > altitude_m:
                # os campos de fora_de_epoca (posicao, slot, mes livre, mes de plantio) mais as duas altitudes
                return {
                    "fora_de_altitude": {
                        "cultura": nome,
                        "posicao": i + 1,
                        "slot": slot,
                        "mes_livre": MES_DO_DIA[livres[i] % 365],
                        "mes_plantio": culturas[nome][f"mes_plantio_{slot}"],
                        "altitude_min_m": minima,
                        "altitude_m": altitude_m,
                    }
                }

    receita = sum(r["receita_ha"] for r in resultados)
    anos = anos_ocupados(dia - dia_livre)
    atendimento = atendimento_da_sequencia(resultados)
    return {
        "agua": parte_agua(atendimento),
        "atendimento_hidrico": atendimento,
        "solo": sum(r["solo"] for r in resultados) / len(resultados),
        "receita_ha": receita,
        "anos_ocupados": anos,
        "receita_ano_ha": receita / anos,
        "encaixe": min(min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"]) for r in resultados),
        "descoberto": solo_descoberto(dia_livre, ciclos, palhada_inicial, clima),
        "culturas": resultados,
    }


def motivo_do_descarte(a):
    """Motivo do descarte de uma sequencia avaliada (fora_de_epoca ou fora_de_altitude); None se e viavel."""
    return a.get("fora_de_epoca") or a.get("fora_de_altitude")


def atendimento_da_sequencia(resultados):
    """1 - deficit total / demanda total das culturas da sequencia (1 sem demanda)."""
    etc = sum(r["etc_mm"] for r in resultados)
    return 1 - sum(r["deficit_mm"] for r in resultados) / etc if etc > 0 else 1.0


def parte_agua(atendimento):
    """Parte agua do score: o atendimento hidrico na faixa fixa [AGUA_REF_MIN, 1], levado a [0, 1]."""
    return min(1.0, max(0.0, (atendimento - AGUA_REF_MIN) / (1 - AGUA_REF_MIN)))


def anos_ocupados(dias):
    """Anos de talhao que a sequencia usa, do talhao livre ate a ultima colheita. No minimo 1:
    o calendario e anual, e uma sequencia mais curta nao libera outra safra no mesmo ano."""
    return max(dias, 365) / 365


def teto_de_renda(culturas, receitas_ano, slots=SLOTS):
    """Receita potencial por ano da referencia nos slots da sequencia, em R$/ha/ano.

    Soma, para cada slot, a cultura de referencia daquele slot (REFERENCIA_POR_SLOT) sem perda.
    Com duas culturas: soja safra + milho safrinha. Com uma: so a do slot, para a renda de uma
    cultura so nao ficar espremida contra o teto de duas. Usa o preco da tabela, nao o editado
    em `precos`. Sem as culturas, ou com teto zero, vale a maior receita por ano avaliada.
    """
    referencia = [REFERENCIA_POR_SLOT[slot] for slot in slots]
    if all(nome in culturas for nome, _ in referencia):
        teto = sum(culturas[nome]["preco"] * culturas[nome][campo] for nome, campo in referencia)
        if teto > 0:
            return teto
    return max(receitas_ano, default=0.0) or 1.0


def dias_sem_cultura(dia_livre, ciclos, palhada_inicial):
    """Dias sem cultura nos 365 dias a partir do talhao livre: lista de (dia, exposto?).

    ciclos: (dia do plantio, dia do fim do ciclo, deixa palhada?) de cada cultura, na ordem.
    Dia sem cultura = nenhuma cultura em pe (espera pelo plantio, colheita, depois da ultima).
    Dia exposto = dia sem cultura em que a cultura anterior nao deixa palhada (cobre_solo = 0).
    Antes da 1a cultura vale a ultima do historico; sem historico, conta como exposto.
    """
    dias = []
    for d in range(dia_livre, dia_livre + 365):
        palhada = palhada_inicial
        em_pe = False
        for plantio, fim, deixa_palhada in ciclos:
            if plantio <= d < fim:
                em_pe = True
            elif fim <= d:
                palhada = deixa_palhada
        if not em_pe:
            dias.append((d, not palhada))
    return dias


def solo_descoberto(dia_livre, ciclos, palhada_inicial, clima):
    """Dias sem cultura (dias_sem_cultura) e a chuva media do mes que cai neles, por mes e no total."""
    meses = {}  # mes -> acumulados, na ordem do calendario a partir do talhao livre
    for d, exposto in dias_sem_cultura(dia_livre, ciclos, palhada_inicial):
        mes = MES_DO_DIA[d % 365]
        chuva = clima[mes - 1]["chuva_mm"] / DIAS_MES[mes - 1]
        a = meses.setdefault(mes, {"mes": mes, "dias": 0, "dias_expostos": 0, "chuva_mm": 0.0, "chuva_exposta_mm": 0.0})
        a["dias"] += 1
        a["chuva_mm"] += chuva
        if exposto:
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


def simular_cultura_diaria(c, inicio, serie, agua, cad=None):
    """Como simular_cultura, com a chuva, o ET0 e as temperaturas de cada dia de um ano real.

    inicio: posicao do dia do plantio na serie. Calor: conta os dias da fase sensivel com
    maxima acima do limiar da cultura. fator_agua: 1 - Ky x (1 - atendimento hidrico).
    """
    cad = CAD_MM if cad is None else cad
    ciclo = c["ciclo_dias"]
    limiar = c["temp_calor_c"]
    chuvas, et0s, tmins, tmaxs = serie["chuva"], serie["et0"], serie["tmin"], serie["tmax"]
    limiar_chuva = serie.get("limiar_chuva_extrema")
    soma_temp = chuva_ciclo = etc_ciclo = deficit = 0.0
    dias_sensiveis = dias_calor = dias_geada = dias_chuva_extrema = 0
    for i in range(ciclo):
        d = inicio + i
        fracao = i / ciclo
        chuva = chuvas[d]
        etc = kc_do_dia(c, fracao) * et0s[d]
        eta = min(etc, agua + chuva)  # a cultura so usa a agua que existe
        agua = min(cad, agua + chuva - eta)
        soma_temp += encaixe_temperatura((tmins[d] + tmaxs[d]) / 2, c)
        if limiar is not None and FASE_SENSIVEL[0] <= fracao < FASE_SENSIVEL[1]:
            dias_sensiveis += 1
            dias_calor += tmaxs[d] > limiar
        dias_geada += tmins[d] <= LIMIAR_GEADA_C
        dias_chuva_extrema += limiar_chuva is not None and chuva > limiar_chuva
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
        "dias_geada": float(dias_geada),
        "dias_chuva_extrema": float(dias_chuva_extrema),
    }
    return resultado, agua


def avaliar_sequencia_diaria(nomes, slots, anterior, culturas, esperas, inicio, serie, precos, cache, cad=None):
    """A sequencia em um ano da serie diaria, com o talhao livre na posicao `inicio`.

    esperas: dias de espera de cada cultura, os mesmos do modo mensal. O calendario
    (epocas de plantio, colheita) nao muda de um ano para o outro.
    """
    cad = CAD_MM if cad is None else cad
    dia = sem_cultura = inicio
    fim_anterior = inicio - DIAS_COLHEITA  # cultura do historico: como no modo mensal (regra 10)
    agua = 0.0  # o solo comeca vazio
    resultados = []
    for nome, slot, espera in zip(nomes, slots, esperas):
        c = culturas[nome]
        plantio = dia + espera
        for d in range(sem_cultura, plantio):  # solo sem cultura so acumula chuva
            agua = min(cad, agua + serie["chuva"][d])
        chave = (nome, plantio, agua)  # a 1a cultura se repete em varias sequencias
        if chave not in cache:
            cache[chave] = simular_cultura_diaria(c, plantio, serie, agua, cad)
        r, agua = cache[chave]
        r = {"cultura": nome, "slot": slot, **r}
        sem_cultura = plantio + c["ciclo_dias"]
        dia = sem_cultura + DIAS_COLHEITA
        # fator mais limitante; a agua entra pela resposta de produtividade (Ky)
        cresce = min(r["encaixe_temp"], r["encaixe_chuva"], r["encaixe_calor"], r["fator_agua"])
        _receita_e_solo(r, c, slot, anterior, culturas, cresce, precos, plantio - fim_anterior)
        resultados.append(r)
        anterior = nome
        fim_anterior = sem_cultura
    atendimento = atendimento_da_sequencia(resultados)
    return {
        "agua": parte_agua(atendimento),
        "atendimento_hidrico": atendimento,
        "solo": sum(r["solo"] for r in resultados) / len(resultados),
        "receita_ha": sum(r["receita_ha"] for r in resultados),
        "culturas": resultados,
    }


def _percentil(valores, q):
    """Percentil com interpolacao linear entre os vizinhos (o mesmo do numpy)."""
    v = sorted(valores)
    pos = (len(v) - 1) * q
    i = int(pos)
    return v[i] + (v[min(i + 1, len(v) - 1)] - v[i]) * (pos - i)


def _eventos(valores):
    """Dias de um evento por ano -> anos com algum dia, total de dias e o maior ano."""
    return {"anos": sum(v > 0 for v in valores), "dias_total": sum(valores), "max_no_ano": max(valores, default=0.0)}


def _chave_rank(a):
    """Ordem do ranking: maior score; em empate, a media simples de agua, solo e renda.

    O empate acontece quando a prioridade pesa so uma parte que satura (agua = 1 em varias
    sequencias). Com pesos iguais o desempate e o proprio score e a ordem nao muda.
    """
    return (-round(a["score"], 9), -round(a["agua"] + a["solo"] + a["renda"], 9))


def _quantil_ruim(valores, maior_e_pior=False):
    """Valor do ano ruim: na posicao QUANTIL_RUIM da lista ordenada do pior para o melhor."""
    v = sorted(valores, reverse=maior_e_pior)
    return v[int(len(v) * QUANTIL_RUIM)]


def _ciclos_da_sequencia(nomes, culturas, esperas):
    """(plantio, fim do ciclo, deixa palhada?) de cada cultura, em dias a partir do talhao livre."""
    dia, ciclos = 0, []
    for nome, espera in zip(nomes, esperas):
        c = culturas[nome]
        plantio = dia + espera
        ciclos.append((plantio, plantio + c["ciclo_dias"], bool(c["cobre_solo"])))
        dia = plantio + c["ciclo_dias"] + DIAS_COLHEITA
    return ciclos


def _descoberto_diario(dias, inicios, chuvas, fator_erosao):
    """Chuva sobre os dias sem cultura em cada ano da serie, com mediana e ano ruim.

    dias: (dia, exposto?) de dias_sem_cultura, contados a partir do talhao livre; sao os mesmos
    todo ano. O ano ruim e o de MAIS chuva sobre solo sem cultura: a posicao QUANTIL_RUIM da
    lista ordenada do mais chuvoso para o menos. indice_erosao so com fator_erosao.
    """
    anos = []
    for ano, i in inicios.items():
        a = {"ano": ano, "chuva_mm": 0.0, "chuva_exposta_mm": 0.0}
        for d, exposto in dias:
            a["chuva_mm"] += chuvas[i + d]
            if exposto:
                a["chuva_exposta_mm"] += chuvas[i + d]
        if fator_erosao is not None:
            a["indice_erosao"] = a["chuva_exposta_mm"] * fator_erosao
        anos.append(a)
    chaves = [k for k in anos[0] if k != "ano"]
    return {
        "dias": len(dias),
        "dias_expostos": sum(exposto for _, exposto in dias),
        "mediano": {k: statistics.median([a[k] for a in anos]) for k in chaves},
        "ruim": {k: _quantil_ruim([a[k] for a in anos], maior_e_pior=True) for k in chaves},
        "anos": anos,
    }


def _modo_diario(
    diario, lat, climas, et0, tabela, sequencias, aval_hoje, slots, anterior, mes_plantio, precos, pesos, ajuste=None,
    declividade=None, teto=1.0, cad=None,
):
    """Roda cada sequencia viavel em cada ano da serie diaria, no clima de hoje e no futuro.

    Devolve (resumo geral, {sequencia: bloco "diario"}). Por sequencia e clima: ano mediano
    e ano ruim (QUANTIL_RUIM) de agua, solo e receita, cada um com score e rank.
    Com ajuste, a serie de hoje e ajustada depois do limiar de chuva extrema, que fica o da serie
    observada; o futuro sai das tabelas ja ajustadas. Solo descoberto: os mesmos dias do modo
    mensal, com a chuva de cada ano; com declividade, tambem o indice de erosao.
    """
    hoje = _serie_diaria(diario, lat)
    com_chuva = [v for v in hoje["chuva"] if v >= DIA_COM_CHUVA_MM]
    hoje["limiar_chuva_extrema"] = _percentil(com_chuva, PERCENTIL_CHUVA_EXTREMA) if com_chuva else None
    if ajuste is not None:
        hoje = ajustar_serie(hoje, ajuste)
    series = {"hoje": hoje, "futuro": _serie_futura(hoje, climas["hoje"], climas["futuro"], et0["hoje"], et0["futuro"])}
    esperas = {s: [r["espera_dias"] for r in aval_hoje[s]["culturas"]] for s in sequencias}
    # dias do talhao livre ate o fim do ultimo ciclo, na sequencia mais longa; no minimo os
    # 365 dias do solo descoberto
    duracao = max(
        (sum(e + tabela[n]["ciclo_dias"] for e, n in zip(esperas[s], s)) + DIAS_COLHEITA * (len(s) - 1) for s in sequencias),
        default=0,
    )
    if sequencias:
        duracao = max(duracao, 365)
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
                ano: avaliar_sequencia_diaria(s, slots, anterior, tabela, esperas[s], i, serie, precos, cache, cad)
                for ano, i in inicios.items()
            }
            for s in sequencias
        }

    niveis = ("mediano", "ruim")
    partes = ("agua", "atendimento_hidrico", "solo", "receita_ha", "renda", "score")
    # score de cada ano, com a renda pela mesma regra do modo mensal (receita por ano ocupado / teto fixo)
    for porseq in por_ano.values():
        for s, anos in porseq.items():
            for a in anos.values():
                a["renda"] = min(1.0, a["receita_ha"] / aval_hoje[s]["anos_ocupados"] / teto)
                a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
    # ano mediano e ano ruim sao anos reais: a posicao mediana e a posicao QUANTIL_RUIM na lista dos anos
    # ordenada pelo score do ano, do pior para o melhor. Todas as partes vem do mesmo ano.
    escolhido = {}
    for cen, porseq in por_ano.items():
        for s, anos in porseq.items():
            ordem = sorted(anos, key=lambda ano: (anos[ano]["score"], ano))
            escolhido[cen, s] = {"mediano": ordem[(len(ordem) - 1) // 2], "ruim": ordem[int(len(ordem) * QUANTIL_RUIM)]}
    resumo = {
        cen: {
            s: {
                nivel: {"ano": escolhido[cen, s][nivel], **{p: anos[escolhido[cen, s][nivel]][p] for p in partes}}
                for nivel in niveis
            }
            for s, anos in porseq.items()
        }
        for cen, porseq in por_ano.items()
    }
    for cen in resumo:
        for nivel in niveis:
            for i, s in enumerate(sorted(sequencias, key=lambda s: _chave_rank(resumo[cen][s][nivel]))):
                resumo[cen][s][nivel]["rank"] = i + 1

    campos_cultura = ("atendimento_hidrico", "fator_agua", "encaixe_calor", "fator", "receita_ha")
    palhada_inicial = anterior in tabela and bool(tabela[anterior]["cobre_solo"])
    fator_erosao = None if declividade is None else fator_declividade(declividade)
    blocos = {}
    for s in sequencias:
        blocos[s] = {}
        dias = dias_sem_cultura(0, _ciclos_da_sequencia(s, tabela, esperas[s]), palhada_inicial)
        for cen in por_ano:
            anos = por_ano[cen][s]
            pior = min(anos, key=lambda ano: (anos[ano]["receita_ha"], anos[ano]["agua"]))
            blocos[s][cen] = {
                **resumo[cen][s],
                "pior_ano": {"ano": pior, **{p: anos[pior][p] for p in ("agua", "atendimento_hidrico", "receita_ha")}},
                "culturas": [
                    {
                        "cultura": nome,
                        "slot": slot,
                        **{
                            nivel: {k: anos[escolhido[cen, s][nivel]]["culturas"][i][k] for k in campos_cultura}
                            for nivel in niveis
                        },
                        "eventos": {
                            evento: _eventos([a["culturas"][i][f"dias_{evento}"] for a in anos.values()])
                            for evento in ("geada", "chuva_extrema")
                        },
                    }
                    for i, (nome, slot) in enumerate(zip(s, slots))
                ],
                "anos": [{"ano": ano, **{p: a[p] for p in partes}} for ano, a in anos.items()],
                "descoberto": _descoberto_diario(dias, inicios, series[cen]["chuva"], fator_erosao),
            }
    geral = {
        "anos": list(inicios),
        "n_anos": len(inicios),
        "quantil_ruim": QUANTIL_RUIM,
        "limiar_geada_c": LIMIAR_GEADA_C,
        "limiar_chuva_extrema_mm": hoje["limiar_chuva_extrema"],
    }
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


def _agua_diaria_baixa(bloco_diario):
    """Modo diario: (clima, cultura do bloco) com fator_agua do ano mediano abaixo de AVISO_FATOR.

    E o complemento diario de fator_limitante: no mensal a agua entra pelo atendimento hidrico
    da media de 20 anos; no diario, pelo fator com Ky, que pesa mais (regra 6 do modo diario).
    """
    return [
        (cen, c)
        for cen, bloco in (bloco_diario or {}).items()
        for c in bloco["culturas"]
        if c["mediano"]["fator_agua"] < AVISO_FATOR
    ]


def _teve_bonus(r):
    """A cultura recebeu o bonus apos fixadora (com ou sem o desconto de hospedeiro comum)?"""
    return bool(r.get("bonus_n"))


def _virgula(x, casas=3):
    """Numero com virgula decimal, para os textos."""
    return f"{x:.{casas}f}".replace(".", ",")


def avisos_da_sequencia(s, tabela, aval, precos, tem_historico, bloco_diario, bloco_modelos=None):
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
            f"A receita cai {queda * 100:.0f}% do clima de hoje para o futuro (por volta de 2060).",
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
    for cen, c in _agua_diaria_baixa(bloco_diario):
        m = c["mediano"]
        ky = tabela[c["cultura"]]["ky"]
        aviso(
            "risco", "fator_agua_diario",
            f"{c['cultura']} na {c['slot']}, clima {cen}, modo diário: no ano mediano a falta de água "
            f"(Ky {ky:g}) limita a produtividade a {m['fator_agua'] * 100:.0f}%.",
            c["cultura"], cen, fator_agua=m["fator_agua"], atendimento_hidrico=m["atendimento_hidrico"],
            ky=ky, slot=c["slot"],
        )  # fmt: skip
    for cen, bloco in (bloco_diario or {}).items():
        for c in bloco["culturas"]:
            g = c["eventos"]["geada"]
            if g["anos"] > 0:
                aviso(
                    "risco", "geada",
                    f"{c['cultura']} na {c['slot']}, clima {cen}: a mínima chegou a {LIMIAR_GEADA_C:g} °C ou menos "
                    f"durante o ciclo em {g['anos']} de {len(bloco['anos'])} anos.",
                    c["cultura"], cen, anos=g["anos"], n_anos=len(bloco["anos"]), dias_total=g["dias_total"],
                    max_no_ano=g["max_no_ano"], limiar_c=LIMIAR_GEADA_C, slot=c["slot"],
                )  # fmt: skip
    if bloco_modelos is not None and bloco_modelos["rank_max"] - bloco_modelos["rank_min"] > AVISO_FAIXA_RANK:
        por = {m["modelo"]: m["rank"] for m in bloco_modelos["por_modelo"]}
        aviso(
            "risco", "rank_varia_entre_modelos",
            f"Por volta de 2060, o rank desta sequência vai de {bloco_modelos['rank_min']} a {bloco_modelos['rank_max']} "
            "conforme o modelo climático: os modelos discordam sobre ela.",
            cenario="futuro", rank_min=bloco_modelos["rank_min"], rank_max=bloco_modelos["rank_max"], por_modelo=por,
            limite=AVISO_FAIXA_RANK,
        )  # fmt: skip
    for r in hoje["culturas"]:
        if r.get("repete"):
            aviso(
                "risco", "repete_a_cultura",
                f"{r['cultura']} repete a cultura anterior: o motor tira {(1 - PENALIDADE_REPETICAO) * 100:.0f}% da produtividade "
                "(pragas e doenças). O valor é provisório.",
                r["cultura"], fator_sequencia=r["fator_sequencia"], slot=r["slot"],
            )  # fmt: skip
        hosp = r["hospedeiro_comum"]
        if hosp:
            com_bonus = (
                f" Com o bônus após fixadora de nitrogênio, o fator aplicado fica {_virgula(r['fator_sequencia'])}."
                if _teve_bonus(r) else ""
            )  # fmt: skip
            aviso(
                "risco", "hospedeiro_comum",
                f"{r['cultura']} na {r['slot']} vem depois de {hosp['anterior']}, que divide com ela "
                f"{' e '.join(hosp['pragas'])}: o motor tira {(1 - r['penalidade_hospedeiro']) * 100:.0f}% da produtividade."
                f"{com_bonus} O valor é provisório.",
                r["cultura"], fator_sequencia=r["fator_sequencia"], penalidade=r["penalidade_hospedeiro"],
                anterior=hosp["anterior"], pragas=list(hosp["pragas"]), slot=r["slot"],
            )  # fmt: skip
        nominal = tabela[r["cultura"]][f"mes_plantio_{r['slot']}"]
        if r["mes_plantio"] != nominal:  # entrou depois do mes do slot, dentro da janela (regra 3)
            aviso(
                "lacuna", "plantio_tardio",
                f"{r['cultura']} na {r['slot']} entra no mês {r['mes_plantio']}, depois do mês de plantio da tabela "
                f"({nominal}): o motor não desconta produtividade pelo plantio tardio.",
                r["cultura"], slot=r["slot"], mes_nominal=nominal, mes_real=r["mes_plantio"],
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
            "Sem histórico de plantio: a primeira cultura não recebe a penalidade de repetição, a de hospedeiro comum "
            "de pragas nem o bônus após fixadora de nitrogênio.",
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


def beneficios_da_sequencia(s, aval, bloco_diario=None):
    """Beneficios de uma sequencia, so com o que o motor usa na conta (regra 18).

    Mesmo formato dos avisos, sem "tipo". Cada beneficio sai de um numero ou atributo que
    entra no score ou em descoberto; a lista explica o resultado e nao muda score nem rank.
    bloco_diario: so no modo diario; com aviso fator_agua_diario, clima_favoravel nao sai.
    """
    lista = []

    def beneficio(codigo, texto, cultura=None, cenario=None, **dados):
        lista.append({"codigo": codigo, "cultura": cultura, "cenario": cenario, "dados": dados, "texto": texto})

    hoje, futuro = aval["hoje"][s], aval["futuro"][s]
    vistas = set()
    for r in hoje["culturas"]:
        nome = r["cultura"]
        if _teve_bonus(r):
            desconto = (
                f" Com o desconto por hospedeiro comum de pragas, o fator aplicado fica {_virgula(r['fator_sequencia'])}."
                if r["hospedeiro_comum"] else ""
            )  # fmt: skip
            beneficio(
                "bonus_apos_fixadora",
                f"{nome} na {r['slot']} é plantado {r['dias_apos_anterior']} dias depois do fim do ciclo de um "
                f"adubo verde que fixa nitrogênio: o motor soma {(BONUS_APOS_FIXADORA - 1) * 100:.0f}% à produtividade."
                f"{desconto} O valor e o prazo são provisórios.",
                nome, fator_sequencia=r["fator_sequencia"], slot=r["slot"], dias_apos_anterior=r["dias_apos_anterior"],
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
                f"A receita {muda} do clima de hoje para o futuro (por volta de 2060).",
                cenario="futuro", queda=queda, receita_hoje=hoje["receita_ha"], receita_futuro=futuro["receita_ha"],
            )  # fmt: skip
    piores = [_fator_limitante(r)[1] for cen in ("hoje", "futuro") for r in aval[cen][s]["culturas"]]
    if min(piores) >= AVISO_FATOR and not _agua_diaria_baixa(bloco_diario):
        beneficio(
            "clima_favoravel",
            f"Hoje e por volta de 2060, nenhum fator de clima ou água limita as culturas abaixo de {AVISO_FATOR * 100:.0f}%.",
            menor_fator=min(piores),
        )  # fmt: skip
    return lista


def _por_modelo(climas_mod, lat, tabela, sequencias, slots, anterior, mes_plantio, precos, pesos, teto, cad, info):
    """Avalia as sequencias viaveis no futuro de cada modelo (regra 20).

    Devolve (resumo geral, {sequencia: bloco "modelos"}). Mesma renda (teto fixo), score e ordem
    de ranking do futuro medio; nada disso entra no score nem no rank principais.
    """
    et0 = {nome: et0_do_clima(clima, lat) for nome, clima in climas_mod.items()}
    aval, rank = {}, {}
    for nome, clima in climas_mod.items():
        porseq = {s: avaliar_sequencia(s, slots, anterior, tabela, clima, et0[nome], mes_plantio, precos, cad) for s in sequencias}
        for a in porseq.values():
            a["renda"] = min(1.0, a["receita_ano_ha"] / teto)
            a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
        ordem = sorted(sequencias, key=lambda s: _chave_rank(porseq[s]))
        aval[nome], rank[nome] = porseq, {s: i + 1 for i, s in enumerate(ordem)}
    blocos = {}
    for s in sequencias:
        por = [
            {"modelo": nome, "score": aval[nome][s]["score"], "rank": rank[nome][s], "receita_ano_ha": aval[nome][s]["receita_ano_ha"]}
            for nome in climas_mod
        ]  # fmt: skip
        blocos[s] = {
            "por_modelo": por,
            "rank_min": min(m["rank"] for m in por),
            "rank_max": max(m["rank"] for m in por),
            "receita_ano_ha_min": min(m["receita_ano_ha"] for m in por),
            "receita_ano_ha_max": max(m["receita_ano_ha"] for m in por),
        }
    geral = {
        "nomes": list(climas_mod),
        **info,
        "aviso_faixa_rank": AVISO_FAIXA_RANK,
        "primeiro": {
            nome: ">".join(min(sequencias, key=lambda s: rank[nome][s])) if sequencias else None for nome in climas_mod
        },
        "clima": {
            nome: [{**m, "et0_mm": et0[nome][i] * DIAS_MES[i]} for i, m in enumerate(clima)]
            for nome, clima in climas_mod.items()
        },
    }
    return geral, blocos


def recomendar(entrada, culturas, clima_hoje, clima_futuro, clima_seco=None, diario=None, clima_modelos=None):
    """Ranqueia as sequencias de 1 ou 2 culturas no clima de hoje e no futuro.

    Cada posicao da sequencia e um slot (safra ou safrinha). Sequencia com cultura
    fora da epoca de plantio do slot nao entra no ranking: vai para "descartadas". Com
    altitude_m, tambem vai a sequencia com cultura cuja altitude_min_m passa da do talhao.

    entrada: dict com lat, rotacao_atual, prioridades, horizonte, mes_plantio, precos,
    declividade_pct, ajuste ({"chuva_pct", "temp_c"}: "e se", aplicado a todos os climas),
    solo_textura ("arenoso", "medio" ou "argiloso": agua que o solo guarda, CAD_POR_TEXTURA) e
    altitude_m (altitude do talhao em metros: descarta cultura com altitude_min_m maior, regra 21).
    culturas, clima_hoje, clima_futuro: DataFrames (ver docs/contrato_motor.md).
    clima_seco: opcional, mesma forma das outras duas. Se vier, a saida ganha um
    terceiro cenario ("seco"); sem ele, a saida so tem hoje e futuro.
    diario: opcional, serie diaria de hoje (data, chuva_mm, tmin_c, tmax_c e, se houver,
    et0_mm). Se vier, a saida ganha "diario": cada sequencia viavel em cada ano da serie,
    com ano mediano e ano ruim. Os campos que ja existiam nao mudam.
    clima_modelos: opcional, deltas do NEX por modelo e mes (carregar_clima_modelos). Se vier, o
    futuro roda uma vez por modelo (regra 20): cada sequencia viavel ganha "modelos" (score, rank
    e receita por ano de cada modelo, e a faixa) e a saida ganha "modelos". Score e rank principais
    nao mudam. clima_futuro deve ser a media dos mesmos modelos.
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
    climas_mod = info_modelos = None
    if clima_modelos is not None:  # o futuro de cada modelo sai das tabelas antes do ajuste
        modelos = _tabela_modelos(clima_modelos)
        linhas = [d for t in modelos.values() for d in t]
        info_modelos = {
            "chuva": "razao" if all(d.get("razao_chuva") is not None for d in linhas) else "aproximada",
            "et0_sem_correcao": all(d.get("off_tmin") is not None and d.get("off_tmax") is not None for d in linhas),
        }
        climas_mod = climas_por_modelo(modelos, climas["hoje"], climas["futuro"], float(entrada["lat"]))
    ajuste = ler_ajuste(entrada.get("ajuste"))
    if ajuste is not None:  # "e se": o mesmo ajuste em todos os cenarios, antes da conta
        climas = {cen: ajustar_clima(clima, ajuste) for cen, clima in climas.items()}
        if climas_mod is not None:
            climas_mod = {nome: ajustar_clima(clima, ajuste) for nome, clima in climas_mod.items()}

    textura = entrada.get("solo_textura")
    if textura is not None and (not isinstance(textura, str) or textura not in CAD_POR_TEXTURA):
        raise ValueError(f"solo_textura deve ser um de {sorted(CAD_POR_TEXTURA)}")
    cad = CAD_MM if textura is None else CAD_POR_TEXTURA[textura]

    altitude = entrada.get("altitude_m")
    if altitude is not None:
        if isinstance(altitude, bool) or not isinstance(altitude, (int, float)):
            raise ValueError("altitude_m deve ser um numero, em metros")
        altitude = float(altitude)
        if not (math.isfinite(altitude) and ALTITUDE_M[0] <= altitude <= ALTITUDE_M[1]):
            raise ValueError(f"altitude_m deve estar entre {ALTITUDE_M[0]:g} e {ALTITUDE_M[1]:g} m")

    lat = float(entrada["lat"])
    horizonte = int(entrada.get("horizonte", 2))
    mes_plantio = int(entrada.get("mes_plantio", 10))
    historico = list(entrada.get("rotacao_atual") or [])
    precos = {k: float(v) for k, v in (entrada.get("precos") or {}).items()}
    if any(not math.isfinite(v) or v < 0 for v in precos.values()):
        raise ValueError("precos devem ser numeros finitos, zero ou positivos")
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
            cen: {
                s: avaliar_sequencia(s, slots, anterior, tabela, clima, et0[cen], mes_plantio, precos, cad, altitude)
                for s in todas
            }
            for cen, clima in climas.items()
        }

    # a epoca de plantio e a altitude nao dependem do clima: as descartadas sao as mesmas em todos os climas
    slots = ordem_dos_slots(mes_plantio, horizonte)
    aval = avaliar(slots)
    if all(motivo_do_descarte(aval["hoje"][s]) for s in todas):
        # nenhuma sequencia cabe na ordem do semestre (talhao livre de abril a junho, ou em dezembro
        # com duas culturas): tenta comecar pelo outro slot (regra 2)
        outra = ordem_dos_slots(1 if slots[0] == "safra" else 7, horizonte)
        aval_outra = avaliar(outra)
        if any(not motivo_do_descarte(aval_outra["hoje"][s]) for s in todas):
            slots, aval = outra, aval_outra
    descartadas = [s for s in todas if motivo_do_descarte(aval["hoje"][s])]
    sequencias = [s for s in todas if not motivo_do_descarte(aval["hoje"][s])]

    # renda de 0 a 1: receita por ano ocupado / receita potencial do sistema de referencia (regra 12)
    teto = teto_de_renda(tabela, [aval[cen][s]["receita_ano_ha"] for cen in aval for s in sequencias], slots)
    rank = {}
    for cen, porseq in aval.items():
        for s in sequencias:
            a = porseq[s]
            a["renda"] = min(1.0, a["receita_ano_ha"] / teto)
            a["score"] = 100 * (pesos["agua"] * a["agua"] + pesos["solo"] * a["solo"] + pesos["renda"] * a["renda"])
            if declividade is not None:  # chuva sobre solo exposto, ponderada pela declividade; fora do score
                a["descoberto"]["indice_erosao"] = a["descoberto"]["chuva_exposta_mm"] * fator_declividade(declividade)
        ordem = sorted(sequencias, key=lambda s: _chave_rank(porseq[s]))
        rank[cen] = {s: i + 1 for i, s in enumerate(ordem)}

    geral_diario = blocos_diario = None
    if diario is not None:
        geral_diario, blocos_diario = _modo_diario(
            diario, lat, climas, et0, tabela, sequencias, aval["hoje"], slots, anterior, mes_plantio, precos, pesos, ajuste,
            declividade, teto, cad,
        )

    geral_modelos = blocos_modelos = None
    if climas_mod is not None:
        geral_modelos, blocos_modelos = _por_modelo(
            climas_mod, lat, tabela, sequencias, slots, anterior, mes_plantio, precos, pesos, teto, cad, info_modelos
        )

    campos = [
        "score", "agua", "atendimento_hidrico", "solo", "renda", "receita_ha", "anos_ocupados", "receita_ano_ha", "encaixe",
        "descoberto",
        "culturas",
    ]  # fmt: skip
    saida = {
        "entrada": {
            "lat": lat,
            "rotacao_atual": historico,
            "prioridades": pesos,
            "horizonte": horizonte,
            "mes_plantio": mes_plantio,
            "precos": precos,
            "declividade_pct": declividade,
            **({"ajuste": ajuste} if ajuste is not None else {}),
            **({"solo_textura": textura, "cad_mm": cad} if textura is not None else {}),
            **({"altitude_m": altitude} if altitude is not None else {}),
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
            "motivo": motivo_do_descarte(aval["hoje"][atual]),
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
                **({"modelos": blocos_modelos[s]} if blocos_modelos is not None else {}),
                "avisos": avisos_da_sequencia(
                    s, tabela, aval, precos, bool(historico), blocos_diario[s] if blocos_diario is not None else None,
                    blocos_modelos[s] if blocos_modelos is not None else None,
                ),
                "beneficios": beneficios_da_sequencia(s, aval, blocos_diario[s] if blocos_diario is not None else None),
            }
            for s in sorted(sequencias, key=lambda s: rank["hoje"][s])
        ],
        "descartadas": [
            {"id": ">".join(s), "culturas": list(s), "atual": s == atual, "motivo": motivo_do_descarte(aval["hoje"][s])}
            for s in descartadas
        ],
    }
    if geral_diario is not None:
        saida["diario"] = geral_diario
    if geral_modelos is not None:
        saida["modelos"] = geral_modelos
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


def _tabela_modelos(df):
    """Confere clima_modelos e devolve {modelo: 12 linhas por mes}, modelos em ordem alfabetica."""
    faltam = [c for c in COLUNAS_MODELOS if c not in df.columns]
    if faltam:
        raise ValueError(f"clima_modelos sem as colunas: {faltam}")
    numericas = COLUNAS_MODELOS[2:] + [c for c in ("razao_chuva", "off_tmin", "off_tmax") if c in df.columns]
    modelos = {}
    for nome, g in df.groupby("modelo", sort=True):
        linhas = g.sort_values("mes").to_dict("records")
        if [int(m["mes"]) for m in linhas] != list(range(1, 13)):
            raise ValueError(f"clima_modelos: {nome} precisa de 12 linhas, uma por mes (1 a 12)")
        tabela = []
        for m in linhas:
            linha = {"mes": int(m["mes"])}
            for k in numericas:
                v = m[k]
                if pd.isna(v) and k in COLUNAS_MODELOS:
                    raise ValueError(f"clima_modelos: {nome}, mes {linha['mes']}: {k} vazio")
                linha[k] = None if pd.isna(v) else float(v)
            if linha.get("razao_chuva") is not None and linha["razao_chuva"] < 0:
                raise ValueError(f"clima_modelos: {nome}, mes {linha['mes']}: razao_chuva negativa")
            tabela.append(linha)
        modelos[str(nome)] = tabela
    if not modelos:
        raise ValueError("clima_modelos esta vazio")
    return modelos


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
        minima = linha.get("altitude_min_m")  # coluna opcional; vazio = sem altitude minima (regra 21)
        c["altitude_min_m"] = None if minima is None or pd.isna(minima) else float(minima)
        if c["altitude_min_m"] is not None and not math.isfinite(c["altitude_min_m"]):
            raise ValueError(f"{nome}: altitude_min_m deve ser um numero finito ou vazio")
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
