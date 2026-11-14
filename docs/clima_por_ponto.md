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

Hoje só existe o delta do talhão de demonstração, em `data/clima_correcoes.csv`.
Somá-lo ao clima de outro ponto é o plano B do `plano_gap.md`, e `origem` avisa.

Quando houver delta regional (P3), passar em `deltas` uma tabela com 12 linhas e
as colunas `mes`, `delta_chuva_mm`, `delta_tmin_c`, `delta_tmax_c` e uma
`delta_dias_acima_NN` para cada limiar de calor de `culturas.csv` (hoje 32, 35,
36 e 38), com `origem_delta="nex_regional"`. O `delta_mensal.csv` citado no
plano ainda não existe no repositório; este formato é uma proposta.

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
