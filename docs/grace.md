# GRACE: água armazenada em Minas Gerais

> 14/11/2026. Script: `scripts/puxar_grace.py`. Baixado e extraído em 14/11/2026: 261 meses, de abril de 2002 a setembro de 2026. O motor não lê esta tabela.

## O que é

- **Fonte:** GRACE e GRACE-FO (NASA/DLR), mascons da CSR (Universidade do Texas), versão RL06.3. De abril de 2002 até hoje, um valor por mês.
- **Mede:** a anomalia de toda a água armazenada numa região (solo, subsolo, aquíferos, rios e reservatórios), em cm de lâmina d'água, em relação à média de 2004 a 2009.
- **Resolução:** a grade é de 0,25°, mas cada mascon tem cerca de 1° (uns 110 km) e o sinal só é confiável em áreas de centenas de km. **É contexto regional, não dado do talhão.**
- **Acesso:** arquivo público, sem login, cerca de 114 MB:
  `https://download.csr.utexas.edu/outgoing/grace/RL0603_mascons/CSR_GRACE_GRACE-FO_RL0603_Mascons_all-corrections.nc`
- **Citar:** CSR GRACE/GRACE-FO RL06.3 Mascon Solutions, doi:[10.15781/cgq9-nh24](https://doi.org/10.15781/cgq9-nh24) (o DOI vem no próprio arquivo); e Save, H., S. Bettadpur, B.D. Tapley (2016), *High resolution CSR GRACE RL05 mascons*, J. Geophys. Res. Solid Earth, 121.

## Como rodar

O script baixa o arquivo para `data/grace/bruto/` (fora do Git) se ele ainda não estiver lá, e depois extrai:

```bash
uv run --no-project --with requests --with pandas --with xarray --with h5netcdf --with h5py python scripts/puxar_grace.py
```

Para usar um arquivo já baixado: `--arquivo CAMINHO.nc`.

## Saída: `data/grace/grace_mg.csv`

| Coluna | Significado |
|---|---|
| `data` | Meio do período de cada solução (não é o dia 1 do mês) |
| `lwe_cm_mg` | Média em Minas Gerais, ponderada pela área de cada quadrado |
| `lwe_cm_celula_demo` | O quadrado de 0,25° do talhão de demonstração. Só para conferência: carrega o mesmo sinal regional |

## Método

1. Converte a longitude de 0–360 para −180–180 e recorta o retângulo de MG.
2. Marca os quadrados de 0,25° cujo centro está dentro de `backend/geo/minas_gerais.geojson`. No teste foram 803 quadrados, cerca de 600 mil km², próximo da área de MG (586 mil km²).
3. Média ponderada pelo cosseno da latitude. Mês sem solução fica fora da tabela.

## Limites

- **Meses faltando:** a lacuna entre as missões (julho de 2017 a maio de 2018) e meses isolados.
- **Mistura tudo:** reservatórios como Furnas e Três Marias entram no total, então o sinal reflete também a operação das usinas, como a série de superfície de água do MapBiomas.
- **Não entra no score.** Serve para o pitch e para o painel, ao lado da tendência do POWER (`docs/tendencia_agua.md`): o GRACE mostra se a queda de chuva aparece na água armazenada da região.

## Detalhes do arquivo real

- Variável `lwe_thickness`, em cm. O arquivo grava a unidade como `Units` (U maiúsculo), então o script converte o tempo à mão: dias desde 2002-01-01.
- A biblioteca C do `netCDF4` não abre caminhos com acento no Windows ("Área de Trabalho"). O script lê com `h5netcdf` e `h5py`, abrindo o arquivo pelo Python.
- O arquivo inteiro ocupa cerca de 1 GB na memória; o script recorta MG antes de carregar.

## Resultado em Minas Gerais

- **Ciclo do ano:** cerca de 26 cm entre o máximo (fevereiro) e o mínimo (outubro).
- **Queda:** tirando o ciclo do ano, a média por ano agrícola passa de +13,7 cm (2004/05 a 2012/13) para −11,8 cm (2013/14 a 2024/25). São cerca de 25 cm de lâmina d'água a menos guardados na região. Ainda não voltou: 2024/25 ficou em −11,8 cm.
- **Tendência:** Theil-Sen de −13,4 cm por década em 23 anos agrícolas com pelo menos 8 meses (Mann-Kendall, p = 0,004). No mesmo período do POWER (2005/06 a 2023/24): −19,2 cm por década, p = 0,005.
- **Bate com o POWER:** correlação anual de 0,72 com a chuva, 0,72 com o balanço hídrico e 0,84 com o `GWETROOT` (18 anos).
- **Célula do talhão × MG:** correlação mensal de 0,72. A célula não é mais precisa que a média do estado; o sinal real tem centenas de km.

Frase para o pitch: "os satélites GRACE, que medem a gravidade, mostram que Minas Gerais guarda hoje cerca de 25 cm de água a menos que antes da seca de 2013/14, e ainda não se recuperou".
