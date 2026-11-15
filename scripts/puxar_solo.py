"""Baixa os parametros de solo do GLDAS2/Noah (NASA LDAS): textura e fracoes de areia, silte e argila.

Uso: python scripts/puxar_solo.py
Requer: so a biblioteca padrao.

Fonte: https://ldas.gsfc.nasa.gov/gldas/soils (sem login). Sao dois NetCDF globais de
0,25 grau, cerca de 2 MB no total, gravados em data/solo/bruto/ (fora do Git).
O dado e estatico: so precisa baixar de novo se a NASA publicar outra versao.
Depois rode scripts/montar_solo_mg.py.
"""
from pathlib import Path
from urllib.request import Request, urlopen

RAIZ = Path(__file__).resolve().parent.parent
BRUTO = RAIZ / "data" / "solo" / "bruto"
BASE = "https://ldas.gsfc.nasa.gov/sites/default/files/ldas/gldas/SOILS/"
ARQUIVOS = ("GLDASp4_soilfraction_025d.nc4", "GLDASp5_soiltexture_025d.nc4")


def main():
    BRUTO.mkdir(parents=True, exist_ok=True)
    for nome in ARQUIVOS:
        destino = BRUTO / nome
        if destino.exists():
            print(f"ja existe: {destino.name}")
            continue
        with urlopen(Request(BASE + nome, headers={"User-Agent": "Mozilla/5.0"}), timeout=120) as resp:
            dados = resp.read()
        if not dados.startswith(b"\x89HDF"):
            raise SystemExit(f"{nome}: a resposta nao e um NetCDF4 (a pagina mudou?)")
        destino.write_bytes(dados)
        print(f"baixado: {destino.name} ({len(dados) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
