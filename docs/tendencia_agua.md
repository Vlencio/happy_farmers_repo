# Tendência da chuva e do balanço hídrico (POWER 2005–2024)

> 14/11/2026. Script: `scripts/tendencia_agua.py`. Sem dado novo: lê o arquivo mensal do POWER do talhão de demonstração. O motor não lê estas tabelas.

## Saídas

- `data/power/agua_por_ano.csv`: um ano agrícola (julho a junho) por linha, de 2005/06 a 2023/24, 19 anos. Colunas: chuva, ET0 (Hargreaves, mesmo método de `montar_clima.py`), balanço = chuva − ET0, chuva da estação chuvosa (out–mar) e da seca (abr–set), meses com balanço negativo, Tmax média e `GWETROOT` médio.
- `data/power/agua_tendencia.csv`: uma variável por linha. Inclinação de Theil-Sen por década, teste de Mann-Kendall e médias da primeira e da segunda metade da série.

## Resultado no POWER

| Variável | Média | Theil-Sen por década | p (Mann-Kendall) |
|---|---|---|---|
| Chuva | 1.236 mm | −262 mm (−21%) | 0,003 |
| ET0 | 1.632 mm | +100 mm (+6%) | < 0,001 |
| Balanço (chuva − ET0) | −395 mm | −352 mm | 0,002 |
| Tmax média | 30,1 °C | +1,4 °C | < 0,001 |
| `GWETROOT` | 0,50 | −0,07 (−14%) | < 0,001 |

Conferi a chuva e o balanço contra o `scipy` (mesmo p e mesma inclinação).

## Cuidado antes de usar no pitch

- **A estação INMET A520 não confirma a força da queda.** Nos 12 anos agrícolas completos da estação, a chuva cai 8,6% por década, com p = 0,45. O POWER nos mesmos 12 anos cai 13% por década, com p = 0,19. A correlação anual entre os dois é só 0,46.
- **É mais um degrau do que uma linha.** A média cai de 1.367 mm (primeira metade) para 1.120 mm (segunda) a partir da seca de 2013/14; dois anos muito secos no fim (2020/21 e 2023/24) puxam a inclinação.
- **O GRACE confirma a direção.** A água armazenada em MG, medida por gravidade e sem depender de pluviômetro, cai junto e tem correlação anual de 0,72 com a chuva do POWER (`docs/grace.md`). Isso reforça a queda do POWER contra a dúvida levantada pela estação.
- **19 anos é pouco** para separar tendência de variação entre décadas. Uma série do POWER desde 1981 ajudaria, mas exige novo download.

Frase segura: "no POWER, os anos agrícolas desde 2013/14 tiveram em média 18% menos chuva e balanço hídrico 350 mm mais negativo que os anteriores; a estação do INMET mostra queda menor e não significativa".
