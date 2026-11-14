"""Puxa o NEX-GDDP-CMIP6 diario de um retangulo inteiro (Minas Gerais) e salva em NetCDF.

Uso: python scripts/puxar_nexgddp_regiao.py --teste   (1 arquivo: mede tempo e tamanho)
     python scripts/puxar_nexgddp_regiao.py           (os 360 arquivos; retoma de onde parou)
Requer: pip install requests xarray netCDF4

Em vez de um pixel por requisicao (puxar_nexgddp.py), pede o retangulo todo. Sao as
mesmas 360 requisicoes (3 modelos x 2 cenarios x 3 variaveis x 20 anos), cada uma
com todos os quadrados de 0,25 grau da regiao. Os arquivos brutos ficam em
data/nexgddp/regiao_mg/bruto/, fora do Git. Depois rode montar_nex_regiao.py.
"""
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

from puxar_nexgddp import BASE, MODELOS, PERIODOS, VARIAVEIS

# Minas Gerais com folga (IBGE: lat -22,92 a -14,23; lon -51,05 a -39,86).
# As bordas caem nas divisas dos quadrados de 0,25 grau: 40 x 48 = 1.920 quadrados.
REGIAO = {"north": -13.5, "south": -23.5, "west": -51.5, "east": -39.5}
BRUTO = Path(__file__).resolve().parent.parent / "data" / "nexgddp" / "regiao_mg" / "bruto"
HDF5 = b"\x89HDF"  # inicio de todo arquivo netcdf4


def baixar(modelo, cenario, var, ano):
    """Baixa uma variavel/ano do retangulo. Devolve (arquivo, segundos); 0 s = ja existia."""
    arq = BRUTO / f"{var}_{modelo}_{cenario}_{ano}.nc"
    if arq.exists():
        return arq, 0.0
    nome = f"{var}_day_{modelo}_{cenario}_r1i1p1f1_gn_{ano}_v2.0.nc"
    url = f"{BASE}/{modelo}/{cenario}/r1i1p1f1/{var}/{nome}"
    params = {
        "var": var,
        **REGIAO,
        "horizStride": 1,
        "time_start": f"{ano}-01-01T00:00:00Z",
        "time_end": f"{ano}-12-31T23:59:59Z",
        "accept": "netcdf4-classic",
    }
    parcial = arq.with_suffix(".part")  # so vira .nc depois de baixar inteiro
    inicio = time.time()
    for tentativa in range(5):
        try:
            with requests.get(url, params=params, timeout=600, stream=True) as r:
                r.raise_for_status()
                with open(parcial, "wb") as f:
                    for bloco in r.iter_content(1 << 20):
                        f.write(bloco)
            with open(parcial, "rb") as f:
                comeco = f.read(200)
            if not comeco.startswith(HDF5):  # o servidor respondeu um erro em texto
                raise requests.RequestException(f"resposta nao e NetCDF: {comeco[:120]!r}")
            parcial.replace(arq)
            return arq, time.time() - inicio
        except requests.RequestException as e:
            if tentativa == 4:
                raise RuntimeError(f"falhou: {nome} ({e})")
            time.sleep(5 * (tentativa + 1))


def teste():
    """Baixa um arquivo so e estima o tempo e o tamanho do download completo."""
    import xarray as xr

    arq, seg = baixar(MODELOS[0], "historical", "pr", 1995)
    mb = arq.stat().st_size / 1e6
    print(f"{arq.name}: {mb:.1f} MB" + (f" em {seg:.0f} s" if seg else " (ja existia; apague para medir o tempo)"))
    with xr.open_dataset(arq) as ds:
        pr = ds["pr"]
        print(f"dimensoes: {dict(pr.sizes)}")
        print(f"lat {float(ds.lat.min())} a {float(ds.lat.max())} | lon {float(ds.lon.min())} a {float(ds.lon.max())}")
        com_dado = int(pr.isel(time=0).notnull().sum())
        print(f"quadrados com dado no dia 1: {com_dado} de {pr.sizes['lat'] * pr.sizes['lon']} (o resto e mar)")
    total = len(MODELOS) * len(PERIODOS) * len(VARIAVEIS) * 20
    print(f"\nestimativa para os {total} arquivos: {mb * total / 1000:.1f} GB", end="")
    print(f", cerca de {seg * total / 4 / 60:.0f} min com 4 em paralelo" if seg else "")


def puxar():
    tarefas = [
        (m, c, v, a)
        for m in MODELOS
        for c, (ini, fim) in PERIODOS.items()
        for v in VARIAVEIS
        for a in range(ini, fim + 1)
    ]
    print(f"{len(tarefas)} arquivos em {BRUTO} ...")
    inicio = time.time()
    feitos = 0
    with ThreadPoolExecutor(max_workers=4) as ex:
        for arq, seg in ex.map(lambda t: baixar(*t), tarefas):
            feitos += 1
            if feitos % 20 == 0 or feitos == len(tarefas):
                print(f"  {feitos}/{len(tarefas)}  ({(time.time() - inicio) / 60:.1f} min)")
    gb = sum(f.stat().st_size for f in BRUTO.glob("*.nc")) / 1e9
    print(f"\npronto: {gb:.2f} GB em {BRUTO}. Agora rode scripts/montar_nex_regiao.py")


if __name__ == "__main__":
    BRUTO.mkdir(parents=True, exist_ok=True)
    teste() if "--teste" in sys.argv else puxar()
