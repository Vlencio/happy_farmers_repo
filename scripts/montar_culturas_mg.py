"""Cruza as culturas de Minas Gerais (PAM/IBGE) com o ECOCROP e o clima da NASA no talhao.

Uso: python scripts/montar_culturas_mg.py
Requer: pip install pandas; rodar antes puxar_pam.py, montar_culturas.py e montar_clima.py

Entram as culturas de data/culturas.csv mais todo produto da PAM com pelo menos
AREA_MINIMA_HA plantados em MG. Saidas:
- data/culturas_mg.csv:         uma linha por cultura: PAM + ECOCROP + encaixe no clima
                                de hoje (POWER) e de 2041-2060 (POWER + NEX-GDDP);
- data/culturas_candidatas.csv: as anuais de MG que cabem na rotacao, nas mesmas
                                colunas de culturas.csv. O motor NAO le este arquivo.

Colunas e metodo em docs/ibge_pam.md.
"""
import sys
from pathlib import Path

import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
from motor.motor import encaixe_chuva, encaixe_temperatura  # noqa: E402  (mesmas regras do motor)

DADOS = RAIZ / "data"
ECOCROP = DADOS / "ecocrop" / "EcoCrop_DB.csv"
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

# Anuais de MG que cabem na rotacao e ainda nao estao no motor, nas colunas manuais de culturas.csv.
# O trigo saiu daqui: esta em culturas.csv desde 14/11.
# Preco e produtividade saem da PAM; o resto esta em docs/ibge_pam.md (kc_med e kc_fim
# conferidos na FAO-56 tabela 12; ciclo, mes de plantio, kc_ini e calor de memoria).
CANDIDATAS = {
    #            ciclo  kc_ini kc_med kc_fim fixa_n cobre safra safrinha calor
    "arroz":    (120,   0.30,  1.20,  0.75,  0,     1,    11,   None,    35),
    "amendoim": (125,   0.40,  1.15,  0.60,  1,     0,    10,   None,    35),
    "aveia":    (120,   0.30,  1.15,  0.25,  0,     1,    None, 4,       32),
}
COLS_CANDIDATAS = ["ciclo_dias", "kc_ini", "kc_med", "kc_fim", "fixa_n", "cobre_solo",
                   "mes_plantio_safra", "mes_plantio_safrinha", "temp_calor_c"]


def faixas_ecocrop(eco, especie):
    r = eco[eco["ScientificName"] == especie]
    if len(r) != 1:
        raise SystemExit(f"{especie}: {len(r)} linhas no ECOCROP (esperado 1)")
    r = r.iloc[0]
    return {
        "especie_ecocrop": especie,
        "temp_min": r["TMIN"], "temp_max": r["TMAX"],
        "temp_otima_min": r["TOPMN"], "temp_otima_max": r["TOPMX"],
        "chuva_min": r["RMIN"], "chuva_max": r["RMAX"],
        "chuva_otima_min": r["ROPMN"], "chuva_otima_max": r["ROPMX"],
        "ciclo_ecocrop_min": r["GMIN"], "ciclo_ecocrop_max": r["GMAX"],
    }


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
        meses = max(1, round(ciclo_dias / 30))
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


def main():
    eco = pd.read_csv(ECOCROP, encoding="latin-1")
    motor = pd.read_csv(DADOS / "culturas.csv").set_index("cultura")
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
        p = pam[pam["produto_cod"] == cod].iloc[0]
        faixas = faixas_ecocrop(eco, especie)
        if cultura in motor.index:
            situacao, ciclo = "no_motor", motor.loc[cultura, "ciclo_dias"]
        elif cultura in CANDIDATAS:
            situacao, ciclo = "candidata", CANDIDATAS[cultura][0]
        else:
            situacao, ciclo = "fora_da_rotacao", (faixas["ciclo_ecocrop_min"] + faixas["ciclo_ecocrop_max"]) / 2
        linhas.append({
            "cultura": cultura, "tipo": tipo, "situacao": situacao, "motivo": motivo,
            "produto_pam": p["produto"], "ano_pam": int(p["ano"]),
            "area_plantada_ha": int(p["area_plantada_ha"]),
            "part_area_pct": round(100 * p["area_plantada_ha"] / area_mg, 1),
            "producao_t": int(p["producao_t"]),
            "rendimento_t_ha": round(p["rendimento_kg_ha"] / 1000, 2),
            "valor_mil_reais": int(p["valor_mil_reais"]),
            "preco_pam": round(1000 * p["valor_mil_reais"] / p["producao_t"]),  # R$/t pago ao produtor
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

    df = pd.DataFrame(linhas).sort_values("area_plantada_ha", ascending=False, na_position="last")
    for c in ["ano_pam", "area_plantada_ha", "producao_t", "valor_mil_reais", "preco_pam", "preco_motor",
              "janela_meses", "melhor_mes_plantio"]:
        df[c] = df[c].astype("Int64")
    df.to_csv(DADOS / "culturas_mg.csv", index=False)
    print(df[["cultura", "tipo", "situacao", "area_plantada_ha", "rendimento_t_ha", "preco_pam", "preco_motor",
              "melhor_mes_plantio", "encaixe_temp_hoje", "encaixe_chuva_hoje", "encaixe_hoje",
              "encaixe_temp_futuro", "encaixe_chuva_futuro", "encaixe_futuro"]].to_string(index=False))

    cand = df[df["situacao"] == "candidata"].set_index("cultura")
    tabela = []
    for cultura, manual in CANDIDATAS.items():
        m = dict(zip(COLS_CANDIDATAS, manual))
        tabela.append({
            "cultura": cultura,
            **{c: cand.loc[cultura, c] for c in motor.columns if c in cand.columns and c.startswith(("especie", "temp_", "chuva_", "ciclo_ecocrop"))},
            **m,
            "preco": cand.loc[cultura, "preco_pam"],
            "produtividade": cand.loc[cultura, "rendimento_t_ha"],
            "produtividade_safrinha": cand.loc[cultura, "rendimento_t_ha"] if m["mes_plantio_safrinha"] else None,
        })
    tabela = pd.DataFrame(tabela)[["cultura", *motor.columns]]  # mesma ordem de culturas.csv
    for c in ["mes_plantio_safra", "mes_plantio_safrinha", "temp_calor_c"]:
        tabela[c] = tabela[c].astype("Int64")
    tabela.to_csv(DADOS / "culturas_candidatas.csv", index=False)
    print(f"\n{len(df)} culturas em culturas_mg.csv; {len(tabela)} candidatas em culturas_candidatas.csv ({arquivo_pam.name})")


if __name__ == "__main__":
    main()
