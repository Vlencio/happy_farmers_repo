# NDVI do talhão contra o índice de água do modo diário

> 15/11/2026. Script: `scripts/comparar_ndvi_agua.py`. Sem dado novo: lê `data/culturas.csv`, as tabelas de clima, a série diária do POWER e `data/talhao/`. Não grava nada. Parte 11 de `docs/pendencias_desafio.md`.

## Pergunta

Nos anos em que o modo diário do motor calcula pouca água para a safra, o NDVI do talhão (MODIS MOD13Q1) também fica mais baixo? Se sim, o NDVI vira evidência observada do balanço que o motor calcula.

## Método

- **Que cultura comparar.** Não há registro do uso real do talhão; o que se sabe vem do próprio NDVI. Ele mostra todo ano uma cultura que fica verde entre novembro e dezembro, faz pico em janeiro e cai entre fevereiro e março, com solo descoberto ou pouco verde de junho a outubro (`ndvi_climatologia.csv`). Isso é compatível com soja na safra, que é também o primeiro slot da rotação atual da demonstração (`soja>milho`). Se há safrinha não dá para afirmar: o NDVI de abril e maio varia muito entre os anos.
- **Índices de água** (modo diário, clima de hoje, talhão livre em outubro, histórico soja, milho):
  - `agua_soja`: horizonte 1, só a soja. É o atendimento hídrico da soja no ano (1 − déficit / ETc), plantio em 1º de outubro, 115 dias. É o índice principal.
  - `agua_soja_milho`: horizonte 2, a sequência `soja>milho` inteira.
- **NDVI do mesmo ano agrícola** (o `ano` do motor é o do talhão livre: 2014 = safra 2014/15):
  - `ndvi_dez_mar`: média do NDVI mensal de dezembro a março. É o par principal com `agua_soja`.
  - `ndvi_pico`: maior NDVI de 16 dias de dezembro a março.
  - `ndvi_dez_mai`: média de dezembro a maio, com `agua_soja_milho`.
- **Referência sem motor:** chuva de outubro a março do POWER (`data/power/agua_por_ano.csv`).
- **Estatística:** Pearson e Spearman, com p bilateral por permutação (200 mil embaralhamentos, semente fixa). A anomalia contra a climatologia não muda a correlação, porque tira a mesma constante de todos os anos.
- As janelas e os pares foram fixados antes de rodar. Não testei outras janelas depois de ver o resultado, para não procurar uma correlação até achar.

## Ano a ano

O NDVI começa em dezembro de 2014: são 10 safras, de 2014/15 a 2023/24.

| Safra | NDVI dez–mar | NDVI pico | NDVI dez–mai | `agua_soja` | `agua_soja_milho` | Chuva out–mar (mm) |
|---|---|---|---|---|---|---|
| 2014/15 | 0,729 | 0,812 | 0,689 | 0,852 | 0,881 | 861 |
| 2015/16 | 0,754 | 0,838 | 0,715 | 0,889 | 0,806 | 1.159 |
| 2016/17 | 0,751 | 0,816 | 0,740 | 0,982 | 0,923 | 882 |
| 2017/18 | 0,738 | 0,821 | 0,713 | 0,962 | 0,806 | 1.069 |
| 2018/19 | 0,752 | 0,784 | 0,764 | 0,870 | 0,849 | 942 |
| 2019/20 | 0,763 | 0,796 | 0,744 | 0,835 | 0,718 | 992 |
| 2020/21 | 0,668 | 0,874 | 0,626 | 0,767 | 0,649 | 729 |
| 2021/22 | 0,656 | 0,879 | 0,628 | 1,000 | 0,828 | 1.066 |
| 2022/23 | 0,739 | 0,844 | 0,653 | 0,830 | 0,810 | 1.064 |
| 2023/24 | 0,773 | 0,819 | 0,756 | 0,817 | 0,691 | 823 |

## Resultado

| x | y | Pearson | p | Spearman | p |
|---|---|---|---|---|---|
| `agua_soja` | NDVI dez–mar (principal) | −0,13 | 0,74 | −0,25 | 0,49 |
| `agua_soja` | NDVI pico | 0,06 | 0,87 | 0,03 | 0,95 |
| `agua_soja_milho` | NDVI dez–mai | 0,16 | 0,65 | 0,10 | 0,79 |
| Chuva out–mar | NDVI dez–mar | 0,14 | 0,70 | 0,01 | 1,00 |
| `agua_soja` | Chuva out–mar | 0,50 | 0,14 | 0,61 | 0,07 |

**Não andam juntos.** Nenhum par passa de 0,25 em módulo, e o par principal tem até o sinal trocado. Com esta série, o NDVI não serve de evidência observada para o índice de água do motor. A chuva da estação também não explica o NDVI, então o problema não é só do motor.

O único ano em que os dois concordam é 2020/21, o ano seco: o menor `agua_soja` (0,767) e o segundo menor NDVI de dezembro a março. Um ano não é evidência.

O que o NDVI mostra é a **data de plantio e de colheita**, mais do que a falta de água:

- **2020/21:** o talhão ficou sem cobertura até meados de novembro (NDVI 0,30) e só ficou verde em dezembro. O produtor esperou a chuva. A cultura chegou a 0,874 em janeiro, um dos maiores picos da série. O motor planta sempre em 1º de outubro e cobra um déficit que a lavoura real evitou plantando mais tarde.
- **2021/22:** verde já no começo de novembro, pico em janeiro e colheita em fevereiro (0,58 em 2/fev, 0,47 em março). Para o motor, foi o ano de mais água (1,000); a média de dezembro a março é a menor só porque a colheita caiu dentro da janela.

## Limitações

- **10 anos é pouco.** Com n = 10, só correlações acima de ~0,63 dariam p < 0,05. Um resultado nulo aqui não prova que o motor está errado; também não confirma nada.
- **Calendário fixo.** O motor planta a soja em 1º de outubro todo ano; no talhão, pelo NDVI, o plantio muda com a chegada da chuva (de fim de outubro a fim de novembro). Comparar o motor com o NDVI exigiria o plantio do motor acompanhar a chuva, o que é mudança no `motor/` (dono: Pedro) e não foi feito.
- **Uso real desconhecido.** A cultura de cada ano não está registrada; a soja é inferida do NDVI e da demonstração. Safrinha, pousio ou braquiária mudam o que o NDVI de abril a junho mede.
- **O NDVI satura** em canopia fechada (acima de ~0,8): estresse moderado em soja fechada pode não aparecer.
- **Escalas diferentes.** O índice usa a chuva de uma célula do POWER (cerca de 50 km de lado); o NDVI usa 41 pixels de 250 m dentro do talhão.
- O próximo passo da Parte 11 seria a umidade do solo medida (SMAP), que está em "Out of scope".
