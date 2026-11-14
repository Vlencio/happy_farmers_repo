"""Puxa a Producao Agricola Municipal (PAM/IBGE) de Minas Gerais pela API do SIDRA.

Uso: python scripts/puxar_pam.py [ano]     (sem ano = o ultimo publicado)
Requer: pip install requests pandas

Tabelas do SIDRA (sidra.ibge.gov.br), nivel Unidade da Federacao, MG = 31:
- 5457: area, producao, rendimento e valor de todas as lavouras temporarias e permanentes;
- 839:  milho por safra (1a e 2a);
- 1002: feijao por safra (1a, 2a e 3a).

Salva em data/ibge/:
- pam_mg_<ano>.csv         uma linha por produto
- pam_mg_safras_<ano>.csv  milho e feijao, uma linha por safra

Na PAM o ano e o ano civil da colheita. ".." "..." "-" e "X" (sem dado, nao se
aplica, zero, sigilo) viram vazio.
"""
import sys
from pathlib import Path

import pandas as pd
import requests

URL = "https://apisidra.ibge.gov.br/values/t/{tabela}/n3/31/v/{variaveis}/p/{periodo}/{classificacao}/all"
SAIDA = Path(__file__).resolve().parent.parent / "data" / "ibge"

# codigo da variavel no SIDRA -> coluna
VARIAVEIS = {
    "8331": "area_plantada_ha",  # na 5457: area plantada ou destinada a colheita
    "109": "area_plantada_ha",  # nas tabelas por safra
    "216": "area_colhida_ha",
    "214": "producao_t",
    "112": "rendimento_kg_ha",
    "215": "valor_mil_reais",
}
COLUNAS = ["area_plantada_ha", "area_colhida_ha", "producao_t", "rendimento_kg_ha", "valor_mil_reais"]


def puxar(tabela, variaveis, classificacao, periodo):
    url = URL.format(tabela=tabela, variaveis=variaveis, classificacao=classificacao, periodo=periodo)
    r = requests.get(url, timeout=120)
    r.raise_for_status()
    return montar(r.json())


def montar(resposta):
    """Resposta do SIDRA (lista de linhas, uma por variavel e produto) -> uma linha por produto."""
    df = pd.DataFrame(resposta[1:])  # a primeira linha e o cabecalho
    df = df[df["D2C"].isin(VARIAVEIS)]
    df["coluna"] = df["D2C"].map(VARIAVEIS)
    df["valor"] = pd.to_numeric(df["V"], errors="coerce")  # "..", "-", "X" -> vazio
    larga = df.set_index(["D3N", "D4C", "D4N", "coluna"])["valor"].unstack("coluna")
    larga = larga.reindex(columns=[c for c in COLUNAS if c in larga.columns]).reset_index()
    larga.columns.name = None
    return larga.rename(columns={"D3N": "ano", "D4C": "produto_cod", "D4N": "produto"})


def main():
    periodo = sys.argv[1] if len(sys.argv) > 1 else "last%201"
    SAIDA.mkdir(parents=True, exist_ok=True)

    pam = puxar(5457, "8331,216,214,112,215", "c782", periodo)
    pam = pam.sort_values("area_plantada_ha", ascending=False)
    ano = pam["ano"].iloc[0]
    pam.to_csv(SAIDA / f"pam_mg_{ano}.csv", index=False)
    print(pam.head(25).to_string(index=False))

    safras = pd.concat([puxar(839, "109,216,214,112", "c81", ano), puxar(1002, "109,216,214,112", "c81", ano)])
    safras = safras[safras["produto"] != "Total"]
    safras.to_csv(SAIDA / f"pam_mg_safras_{ano}.csv", index=False)
    print(safras.to_string(index=False))
    print(f"\nPAM {ano}: {len(pam)} produtos e {len(safras)} safras salvos em {SAIDA}")


if __name__ == "__main__":
    main()
