"""Cruza as culturas de Minas Gerais (PAM/IBGE) com o ECOCROP e o clima da NASA no talhao.

Uso: python scripts/montar_culturas_mg.py
Requer: pip install pandas; rodar antes puxar_pam.py, montar_culturas.py e montar_clima.py

Entram as culturas de data/culturas.csv e data/culturas_candidatas.csv (as duas
saem de montar_culturas.py) mais todo produto da PAM com pelo menos AREA_MINIMA_HA
plantados em MG. Saida: data/culturas_mg.csv, uma linha por cultura: PAM + ECOCROP
+ encaixe no clima de hoje (POWER) e de 2041-2060 (POWER + NEX-GDDP).

Produto que falta no ano da PAM, ou com valor sem dado / sigiloso, fica com os
campos da PAM vazios.

Colunas e metodo em docs/ibge_pam.md.
"""
import math
import sys
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "scripts"))
from motor.motor import encaixe_chuva, encaixe_temperatura  # noqa: E402  (mesmas regras do motor)
from montar_culturas import faixas_ecocrop, ler_ecocrop  # noqa: E402

DADOS = RAIZ / "data"
AREA_MINIMA_HA = 10_000
ORDEM_MESES = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9]  # ano agricola: em empate, vale o primeiro

# codigo do produto na tabela 5457 -> (cultura, especie no ECOCROP, tipo, motivo se fica fora da rotacao)
PRODUTOS = {
    "40124": ("soja", "Glycine max", "anual", ""),
    "40122": ("milho", "Zea mays", "anual", ""),
    "40125": ("sorgo", "Sorghum bicolor", "anual", ""),
    "40112": ("feijao", "Phaseolus vulgaris", "anual", ""),
    "40114": ("girassol", "Helianthus annuus", "anual", ""),
    "40099": ("algodao", "Gossypium hirsutum", "anual", ""),
    "40127": ("trigo", "Triticum aestivum", "anual", ""),
    "40102": ("arroz", "Oryza sativa", "anual", ""),
    "40101": ("amendoim", "Arachis hypogaea", "anual", ""),
    "40103": ("aveia", "Avena sativa", "anual", ""),
    "40105": ("batata", "Solanum tuberosum", "anual", "hortalica irrigada de custo alto: sem custo de producao, a receita bruta dominaria o ranking"),
    "83388": ("abobora", "Cucurbita moschata", "anual", "hortalica: sem custo de producao, a receita bruta dominaria o ranking"),
    "40106": ("cana", "Saccharum officinarum", "semiperene", "ocupa o talhao por varios anos (cerca de 5 cortes): nao cabe em safra + safrinha"),
    "40119": ("mandioca", "Manihot esculenta", "semiperene", "ciclo de 12 a 18 meses: nao cabe em safra + safrinha"),
    "40139": ("cafe", "Coffea arabica", "permanente", "lavoura permanente"),  # 99% arabica em MG
    "40136": ("banana", "Musa acuminata x balbisiana", "permanente", "lavoura permanente"),  # grupo AAB (Prata)
    "40151": ("laranja", "Citrus sinensis", "permanente", "lavoura permanente"),
    "40271": ("tangerina", "Citrus reticulata", "permanente", "lavoura permanente"),
    "40137": ("seringueira", "Hevea brasiliensis", "permanente", "lavoura permanente"),
}
IGNORAR = {"0", "40140", "40141"}  # Total; cafe arabica e canephora ja estao em "Cafe Total"


def encaixe_na_janela(faixas, clima, inicio, meses):
    """(temperatura, chuva) da janela de `meses` meses que comeca no mes `inicio`.

    Temperatura: media do encaixe da temperatura media de cada mes. Chuva: soma da janela.
    """
    janela = [clima[(inicio - 1 + i) % 12] for i in range(meses)]
    temp = sum(encaixe_temperatura((m["tmin_c"] + m["tmax_c"]) / 2, faixas) for m in janela) / meses
    return temp, encaixe_chuva(sum(m["chuva_mm"] for m in janela), faixas)


def cruzar_clima(faixas, tipo, ciclo_dias, hoje, futuro):
    """Encaixe hoje e no futuro. Anual: melhor janela de plantio hoje; o futuro usa o mesmo mes.

    Semiperene e permanente: o ano inteiro, com a chuva anual.
    """
    if tipo in ("anual", "cobertura"):
        meses = min(12, max(1, math.ceil(ciclo_dias / 30)))  # a janela cobre o ciclo inteiro
        inicio = max(ORDEM_MESES, key=lambda m: min(encaixe_na_janela(faixas, hoje, m, meses)))
    else:
        meses, inicio = 12, 1
    saida = {"janela_meses": meses, "melhor_mes_plantio": inicio if meses < 12 else None}
    for nome, clima in (("hoje", hoje), ("futuro", futuro)):
        temp, chuva = encaixe_na_janela(faixas, clima, inicio, meses)
        saida[f"encaixe_temp_{nome}"] = round(temp, 2)
        saida[f"encaixe_chuva_{nome}"] = round(chuva, 2)
        saida[f"encaixe_{nome}"] = round(min(temp, chuva), 2)  # fator mais limitante, como no motor
    return saida


def inteiro(v):
    """Numero da PAM como inteiro, ou None se vier vazio (sem dado, sigilo)."""
    return None if pd.isna(v) else int(v)


def dados_pam(pam, cod, area_mg):
    """Campos da PAM de um produto; vazios se o produto nao aparece no ano."""
    r = pam[pam["produto_cod"] == cod]
    if r.empty:
        return {}
    p = r.iloc[0]
    producao, valor, area = p["producao_t"], p["valor_mil_reais"], p["area_plantada_ha"]
    tem_preco = not (pd.isna(producao) or pd.isna(valor)) and producao > 0
    return {
        "produto_pam": p["produto"], "ano_pam": int(p["ano"]),
        "area_plantada_ha": inteiro(area),
        "part_area_pct": None if pd.isna(area) else round(100 * area / area_mg, 1),
        "producao_t": inteiro(producao),
        "rendimento_t_ha": None if pd.isna(p["rendimento_kg_ha"]) else round(p["rendimento_kg_ha"] / 1000, 2),
        "valor_mil_reais": inteiro(valor),
        "preco_pam": round(1000 * valor / producao) if tem_preco else None,  # R$/t pago ao produtor
    }


def main():
    eco = ler_ecocrop()
    motor = pd.read_csv(DADOS / "culturas.csv").set_index("cultura")
    candidatas = pd.read_csv(DADOS / "culturas_candidatas.csv").set_index("cultura")
    hoje = pd.read_csv(DADOS / "clima_hoje.csv").sort_values("mes").to_dict("records")
    futuro = pd.read_csv(DADOS / "clima_futuro.csv").sort_values("mes").to_dict("records")
    arquivo_pam = sorted((DADOS / "ibge").glob("pam_mg_[0-9]*.csv"))[-1]  # o ano mais recente
    pam = pd.read_csv(arquivo_pam, dtype={"produto_cod": str})
    area_mg = pam.loc[pam["produto_cod"] == "0", "area_plantada_ha"].iloc[0]

    grandes = pam[(pam["area_plantada_ha"] >= AREA_MINIMA_HA) & ~pam["produto_cod"].isin(IGNORAR)]
    sem_mapa = grandes[~grandes["produto_cod"].isin(PRODUTOS)]
    if len(sem_mapa):
        raise SystemExit(f"produtos com mais de {AREA_MINIMA_HA} ha fora de PRODUTOS:\n{sem_mapa.to_string()}")

    linhas = []
    for cod, (cultura, especie, tipo, motivo) in PRODUTOS.items():
        faixas = faixas_ecocrop(eco, especie)
        if cultura in motor.index:
            situacao, ciclo = "no_motor", motor.loc[cultura, "ciclo_dias"]
        elif cultura in candidatas.index:
            situacao, ciclo = "candidata", candidatas.loc[cultura, "ciclo_dias"]
        else:
            situacao, ciclo = "fora_da_rotacao", (faixas["ciclo_ecocrop_min"] + faixas["ciclo_ecocrop_max"]) / 2
        linhas.append({
            "cultura": cultura, "tipo": tipo, "situacao": situacao, "motivo": motivo,
            **dados_pam(pam, cod, area_mg),
            "preco_motor": motor["preco"].get(cultura),
            "produtividade_motor": motor["produtividade"].get(cultura),
            **faixas,
            **cruzar_clima(faixas, tipo, ciclo, hoje, futuro),
        })
    for cultura in motor.index.difference([v[0] for v in PRODUTOS.values()]):  # cobertura: a PAM nao levanta
        faixas = faixas_ecocrop(eco, motor.loc[cultura, "especie_ecocrop"])
        linhas.append({
            "cultura": cultura, "tipo": "cobertura", "situacao": "no_motor",
            "motivo": "cultura de cobertura: a PAM nao levanta",
            **faixas,
            **cruzar_clima(faixas, "cobertura", motor.loc[cultura, "ciclo_dias"], hoje, futuro),
        })

    colunas = ["cultura", "tipo", "situacao", "motivo", "produto_pam", "ano_pam", "area_plantada_ha",
               "part_area_pct", "producao_t", "rendimento_t_ha", "valor_mil_reais", "preco_pam"]
    df = pd.DataFrame(linhas)
    df = df.reindex(columns=colunas + [c for c in df.columns if c not in colunas])  # mesma ordem mesmo sem PAM
    df = df.sort_values("area_plantada_ha", ascending=False, na_position="last")
    for c in ["ano_pam", "area_plantada_ha", "producao_t", "valor_mil_reais", "preco_pam",
              "janela_meses", "melhor_mes_plantio"]:
        df[c] = df[c].astype("Int64")
    df.to_csv(DADOS / "culturas_mg.csv", index=False)
    print(df[["cultura", "tipo", "situacao", "area_plantada_ha", "rendimento_t_ha", "preco_pam", "preco_motor",
              "janela_meses", "melhor_mes_plantio", "encaixe_hoje", "encaixe_futuro"]].to_string(index=False))
    print(f"\n{len(df)} culturas em culturas_mg.csv ({arquivo_pam.name})")


if __name__ == "__main__":
    main()
