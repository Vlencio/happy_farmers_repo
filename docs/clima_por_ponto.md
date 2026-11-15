# Clima por ponto — contrato de chamada

> D1 de `docs/plano_gap.md`. Código: `scripts/clima_ponto.py`. Testes:
> `tests/test_clima_ponto.py` (não chamam a API). Ainda não está ligado ao
> `backend/`; isso é o G5.

## Chamada

```python
from scripts.clima_ponto import clima_por_ponto

r = clima_por_ponto(lat, lon)
recomendar(entrada, culturas, r["clima_hoje"], r["clima_futuro"])
```

| Parâmetro | Tipo | O que é |
|---|---|---|
| `lat`, `lon` | número | Graus decimais. Fora de −90..90 / −180..180: `ValueError` |
| `puxar` | função `(lat, lon) -> DataFrame`, opcional | Troca a chamada da API do POWER. Usado nos testes |
| `deltas` | DataFrame, opcional | Mudança do clima por mês (ver abaixo). Padrão: a do talhão de demonstração |
| `origem_delta` | texto, opcional | Rótulo de `deltas`, copiado para `origem["delta"]` |

## Retorno

Um dicionário com três chaves:

- `clima_hoje`, `clima_futuro`: DataFrames de 12 linhas com as mesmas colunas de
  `data/clima_hoje.csv` (`mes`, `chuva_mm`, `tmin_c`, `tmax_c`, `et0_mm`,
  `dias_quentes`, `dias_acima_NN`). Entram direto em `recomendar`.
- `origem`: de onde os números vieram.

| Campo de `origem` | Valores |
|---|---|
| `hoje` | `tabela_demo`, `power_arquivo`, `power_api` ou `fallback_tabela_demo` |
| `delta` | `nex_talhao_demo` ou o rótulo passado em `origem_delta` |
| `chuva_futuro` | `razao` (hoje × razão do NEX) ou `delta_somado` (hoje + delta em mm, quando `deltas` não traz `razao_chuva`) |
| `correcao_a520` | `true` só quando as tabelas são as da demonstração |
| `distancia_demo_km` | Distância do ponto ao talhão de demonstração |
| `lat`, `lon` | O ponto pedido |
| `periodos` | `{"hoje": "2005-2024", "futuro": "2041-2060"}` |
| `aviso` | Frase para a tela, ou `null` quando não há ressalva |

## Qual caminho a função segue

| Situação | `hoje` | O que devolve | `aviso` |
|---|---|---|---|
| Ponto a até 25 km do talhão de demonstração | `tabela_demo` | As tabelas de `data/`, com a correção da A520. A demonstração não muda | `null` |
| Outro ponto, arquivo do POWER já em `data/power/` | `power_arquivo` | Clima de hoje do ponto + delta | Diz que a mudança do clima é a do talhão de demonstração |
| Outro ponto, sem arquivo | `power_api` | Chama a API do POWER (2005–2024, diário), guarda o arquivo e segue como acima | Idem |
| A API falha, ou vem com menos de 10 anos de dados | `fallback_tabela_demo` | As tabelas da demonstração | Diz o motivo e a distância |

Fora do talhão de demonstração não há correção da A520: a estação só vale perto
dele. O ET0 usa Hargreaves com a latitude do ponto.

## O delta (mudança do clima)

O delta padrão é o do talhão de demonstração, em `data/clima_correcoes.csv`.
O regional (`data/nexgddp/regiao_mg/delta_mensal.csv`, escolhido por
`backend/point_climate.py`) entra em `deltas`, com `origem_delta="nex_regional"`.

`deltas` é uma tabela de 12 linhas com `mes`, `delta_chuva_mm`, `delta_tmin_c`,
`delta_tmax_c` e, se houver, `razao_chuva`. Como cada parte do futuro é feita
(desde 15/11):

- **Temperaturas:** hoje + delta do mês.
- **Dias quentes (`dias_acima_NN`, de 26 a 40 °C):** os dias do POWER do ponto com
  a máxima somada ao `delta_tmax_c` do mês. As colunas `delta_dias_acima_NN` de
  `deltas` não são mais lidas.
- **Chuva:** hoje × `razao_chuva`. Sem essa coluna (caso do `delta_mensal.csv`
  regional de hoje), hoje + `delta_chuva_mm`; `origem["chuva_futuro"]` diz qual.

## Limites

- A primeira chamada para um ponto novo faz uma requisição ao POWER (20
  anos de dados diários; tempo de resposta não medido).
  Para a demonstração sem rede, rodar antes `python scripts/clima_ponto.py
  <lat> <lon>` para cada ponto que será mostrado.
- O arquivo guardado é por coordenada com 3 casas. Dois pontos vizinhos geram
  dois arquivos, embora a grade do POWER seja de cerca de 50 km.
- Não devolve o ano seco (`clima_seco`) do ponto.
- A chamada real à API não foi testada nesta entrega; os testes usam a série do
  talhão de demonstração.
