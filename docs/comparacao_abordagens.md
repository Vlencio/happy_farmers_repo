# Comparação de abordagens: média mensal contra série diária

> 15/11/2026. Parte 13 de `docs/pendencias_desafio.md`. Sem dado novo e sem mudança no motor: os números saem de `recomendar` com as tabelas de `data/` e a série diária do POWER do talhão de demonstração (`carregar_diario()`, 2005 a 2024). O bloco no fim do arquivo reproduz as tabelas.

Entrada usada em tudo, salvo quando dito: talhão de demonstração, histórico soja, milho (a rotação atual é `soja>milho`), pesos iguais, horizonte 2.

## As duas abordagens

| | Modo mensal (o que a API e a tela usam) | Modo diário (`diario=carregar_diario()`) |
|---|---|---|
| Clima de hoje | Média de cada mês, 2005 a 2024: 12 linhas | Cada dia, um ano agrícola de cada vez: 19 anos, de 2005 a 2023 |
| Clima futuro | `clima_futuro.csv`: hoje + diferença NEX-GDDP (ssp245 − historical) | A série diária de hoje com a mesma diferença mensal |
| Água | Balanço dia a dia com a chuva média do mês espalhada por igual; perda = atendimento hídrico | Balanço com a chuva de cada dia; perda pela função Ky da FAO |
| Calor | Média de dias acima do limiar, espalhada pelo mês | Dias reais acima do limiar em cada ano |
| Resultado | Um número por sequência e clima | Ano mediano e ano ruim (o 4º pior de 19) por sequência e clima |
| Tempo por chamada | 0,08 s | 0,27 s |

As duas usam as mesmas regras (`docs/contrato_motor.md`): o que muda é o clima de entrada e o Ky.

## Talhão livre em outubro

26 sequências viáveis. Entram as cinco primeiras de cada ranking.

| Sequência | Mensal, hoje: rank | score | `agua` | receita (R$/ha) | Mensal, futuro: rank | Diário, mediano: rank | score | `agua` | receita | Diário, ruim: rank | `agua` | receita | Pior ano | Diário, futuro: rank mediano / ruim |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `soja>milho` (atual) | 1 | 82,0 | 0,918 | 14.171 | 1 | 2 | 76,8 | 0,828 | 12.438 | 1 | 0,781 | 11.905 | 9.537 (2020) | 2 / 1 |
| `soja>sorgo` | 2 | 80,3 | 1,000 | 11.563 | 2 | 1 | 77,5 | 0,908 | 10.839 | 2 | 0,832 | 9.740 | 8.851 (2020) | 1 / 2 |
| `soja>crotalaria` | 3 | 79,2 | 1,000 | 8.217 | 3 | 3 | 75,1 | 0,901 | 7.795 | 4 | 0,813 | 7.123 | 6.441 (2008) | 3 / 3 |
| `soja>trigo` | 4 | 76,8 | 0,917 | 12.113 | 5 | 5 | 72,9 | 0,827 | 10.988 | 5 | 0,753 | 10.187 | 8.097 (2023) | 6 / 6 |
| `soja>feijao` | 5 | 76,5 | 1,000 | 10.877 | 8 | 4 | 74,7 | 0,920 | 10.211 | 3 | 0,867 | 9.593 | 7.014 (2020) | 7 / 8 |

- **Os três cards têm as mesmas sequências no mensal e no ano mediano**, em outra ordem: no mediano `soja>sorgo` passa `soja>milho`. No ano ruim, `soja>milho` volta ao primeiro lugar e `soja>feijao` entra no terceiro, no lugar de `soja>crotalaria`.
- **O que muda a ordem é o milho safrinha.** No mensal ele atende 81,9% da demanda de água; no diário, 75,7% no ano mediano e 62,3% no ano ruim. Com Ky de 1,25, o `fator_agua` fica em 0,696 e 0,529. O sorgo, com Ky de 0,90, perde menos.
- **No futuro**, o mensal mantém `soja>milho` em primeiro; o diário dá `soja>sorgo` no ano mediano e `soja>milho` no ano ruim, como hoje.
- Sem histórico, as cinco primeiras e todos os ranks de hoje (mensal e diário) são os mesmos; só os ranks do futuro de `soja>trigo` e `soja>feijao` caem (no mensal, 6º e 10º).

## Talhão livre em fevereiro

36 sequências viáveis. Entram as cinco primeiras de cada ranking.

| Sequência | Mensal, hoje: rank | score | `agua` | receita (R$/ha) | Mensal, futuro: rank | Diário, mediano: rank | score | `agua` | receita | Diário, ruim: rank | `agua` | receita | Pior ano | Diário, futuro: rank mediano / ruim |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `crotalaria>algodao` | 1 | 79,2 | 1,000 | 13.930 | 12 | 1 | 76,4 | 0,912 | 15.223 | 8 | 0,837 | 9.197 | 5.074 (2020) | 13 / 18 |
| `crotalaria>soja` | 2 | 75,6 | 1,000 | 8.217 | 1 | 2 | 71,3 | 0,932 | 8.330 | 2 | 0,872 | 7.483 | 6.795 (2020) | 1 / 1 |
| `sorgo>soja` | 3 | 74,8 | 1,000 | 11.262 | 2 | 4 | 69,5 | 0,914 | 10.822 | 1 | 0,877 | 10.262 | 9.253 (2020) | 2 / 2 |
| `crotalaria>milho` | 4 | 73,5 | 1,000 | 7.371 | 3 | 3 | 69,6 | 0,936 | 7.707 | 5 | 0,855 | 6.791 | 3.686 (2023) | 4 / 5 |
| `milho>algodao` | 5 | 72,5 | 0,933 | 17.346 | 20 | 7 | 69,0 | 0,851 | 17.523 | 18 | 0,786 | 11.919 | 7.314 (2020) | 20 / 29 |
| `feijao>soja` | 7 | 71,8 | 1,000 | 10.861 | 10 | 5 | 69,4 | 0,947 | 10.641 | 3 | 0,902 | 9.724 | 8.662 (2021) | 11 / 11 |
| `milheto>soja` | 13 | 68,7 | 1,000 | 8.217 | 6 | 9 | 67,9 | 0,985 | 8.330 | 4 | 0,908 | 7.483 | 7.067 (2020) | 3 / 3 |

- **Hoje, o mensal e o ano mediano concordam no vencedor** (`crotalaria>algodao`). No ano ruim ela cai para 8º e ganha `sorgo>soja`.
- **As sequências com algodão são as de maior receita e as que mais variam.** `crotalaria>algodao` vai de R$ 5.074/ha (2020) a R$ 17.989/ha (2007) entre os anos; `milho>algodao` cai do 5º lugar no mensal para o 18º no ano ruim. A média mensal mostra só o lado bom.
- **No futuro, as duas abordagens concordam**: `crotalaria>soja` em primeiro no mensal, no ano mediano e no ano ruim. A troca de vencedor entre hoje e futuro, que é o gancho do pitch, aparece nas duas.
- Sem histórico, `milho>algodao` sobe para 2º no mensal e no mediano e fica em 14º no ano ruim; `crotalaria>algodao` fica em 9º no ano ruim.

## Resumo por critério

| Critério | Outubro | Fevereiro |
|---|---|---|
| Faixa de `agua`, mensal | 0,884 a 1,000 | 0,902 a 1,000 |
| Faixa de `agua`, diário mediano | 0,823 a 0,991 | 0,845 a 0,992 |
| Faixa de `agua`, diário ano ruim | 0,747 a 0,929 | 0,767 a 0,951 |
| Correlação de postos (Spearman), mensal × diário mediano, hoje | 0,979 | 0,973 |
| Spearman, mensal × diário ano ruim, hoje | 0,949 | 0,887 |
| Spearman, mensal × diário mediano, futuro | 0,988 | 0,980 |
| Sequências com o mesmo rank no mensal e no mediano | 11 de 26 | 6 de 36 |
| Vencedor hoje: mensal / mediano / ruim | `soja>milho` / `soja>sorgo` / `soja>milho` | `crotalaria>algodao` / `crotalaria>algodao` / `sorgo>soja` |
| Vencedor no futuro: mensal / mediano / ruim | `soja>milho` / `soja>sorgo` / `soja>milho` | `crotalaria>soja` nos três |

O Spearman foi calculado como a correlação de Pearson entre os ranks (sem empates); o ambiente não tem `scipy`.

Leitura: no geral as duas ordenam as sequências quase do mesmo jeito (Spearman acima de 0,97 contra o ano mediano). As trocas ficam entre sequências com score próximo, e o ano ruim é o que mais separa (0,887 em fevereiro, puxado pelo algodão).

## O que cada abordagem capta e o que perde

| Aspecto | Mensal | Diário |
|---|---|---|
| **Veranicos e chuva concentrada** | Não vê. Toda a chuva do mês é espalhada por igual, e de novembro a março todo mês tem 157 mm ou mais. | Vê. Na série, o maior período seguido sem chuva (dia com menos de 1 mm) de novembro a março tem mediana de 7 dias e chega a 11 (2013/14 e 2023/24); 3 de 19 estações têm 10 dias ou mais. Mesmo num ano normal a chuva cai concentrada em poucos dias, e no balanço o que passa dos 100 mm guardados no solo se perde. É o que deve explicar a queda do atendimento do milho safrinha de 0,819 para 0,757 já no ano mediano (não separei esse efeito da variação entre anos). |
| **Variação entre anos** | Não tem: um número por sequência. | Tem: receita de `soja>milho` entre R$ 9.537 (2020) e R$ 15.127 (2011); `agua` entre 0,649 e 0,976. A chuva de novembro a março vai de 648 mm (2020/21) a 1.228 mm (2006/07); a tabela mensal soma 947 mm. |
| **Pior ano** | Só pela tabela do ano seco, escolhida pela chuva (2020/21). | Por sequência. Em outubro, o pior ano em receita é 2023 em 18 das 26 sequências e 2020 em 4; em fevereiro, 2020 e 2023 em 13 das 36 cada. O ano mais seco nem sempre é o pior. |
| **Calor** | Usa a média de 20 anos de dias quentes. Desconta um pouco todo ano, inclusive em culturas com calor raro (milho safrinha: 0,986). | No ano mediano, culturas com calor raro ficam sem desconto (milho safrinha: 1,000); feijão e algodão, que pegam calor quase todo ano, ficam perto do mensal (feijão safrinha 0,806 contra 0,776; algodão safra 0,814 contra 0,744). Por ano, a série diária tem quase os mesmos dias quentes que a tabela (acima de 32 °C: 110,6 contra 111,0; acima de 35 °C: 34,0 nas duas): a diferença vem da mediana, não do dado. |
| **Calor no futuro** | Usa a contagem de dias dos modelos. | Soma a mudança mensal da máxima a cada dia e conta menos dias quentes em parte das culturas: trigo safrinha 0,905 contra 0,704 no mensal. Já anotado no contrato ("Em aberto", item 7). |
| **Geada** | Não tem como ver: a menor mínima média mensal é 12,8 °C hoje e 14,0 °C no futuro. | Conta os dias com mínima de 3 °C ou menos. Na série inteira há 1 dia assim (2021). Só o milho safrinha de `milho>milho` pega esse dia (1 ano de 19) e gera o aviso `geada`. No talhão de demonstração, geada não pesa em nenhuma das duas. |
| **Chuva extrema** | Não vê. | Conta dias acima de 24,67 mm (percentil 95); não muda score. |
| **Futuro** | Diferença dos modelos aplicada à média. | A mesma diferença sobre os dias de hoje: os veranicos do futuro são os de hoje (contrato, "Em aberto", item 8). |
| **Outros pontos** | Funciona para qualquer ponto com 12 linhas de clima; é o que a API usa. | Só o talhão de demonstração tem a série carregada; a API não usa. |
| **Explicação na tela** | Um balanço mês a mês por cultura, que é a timeline do card. | Mediana e ano ruim por parte; o "ano ruim" não é um ano só. Mostrar "1 ano em 5" encosta em "win rates or probabilities", fora do escopo. |

## Conferência com o contrato

Os números da seção "O que o modo diário mostra" de `docs/contrato_motor.md` foram refeitos nesta execução, sem histórico, como lá:

- Faixas de `agua`: batem. Em fevereiro, o mínimo do ano mediano é 0,845; o contrato arredonda para 0,85.
- Receitas de `soja>milho`, `soja>sorgo`, `milho>algodao`, `crotalaria>algodao` e `sorgo>soja` (mensal, mediano, ruim, pior ano, futuro): batem todas.
- `crotalaria>algodao` em 9º no ano ruim sem histórico e `milho>algodao` perdendo 31% no ano ruim e 37% no futuro: batem. Com o histórico soja, milho, ela fica em 8º.
- Milho safrinha com atendimento de 76%, `fator_agua` 0,70 e 0,53: bate.
- Pior ano: 2023 em 18 de 26 e 2020 em 4 (outubro); 2020 em 13 e 2023 em 12 de 36 (fevereiro): bate sem histórico. Com o histórico, fevereiro fica 13 e 13.
- Série diária contra a tabela: 1.242 mm de chuva nas duas; ET0 1.625 mm contra 1.634 mm. Bate.
- Tempo: 0,27 s com o diário e 0,08 s sem ele (o contrato diz 0,3 s).

## Pendente

- **Conferir o motor contra produtividade observada** (IBGE PAM de vários anos contra o fator do modo diário nos mesmos anos). Precisa de dado novo: hoje só há a PAM de 2025 (`docs/ibge_pam.md`). Dono: Brenno. Nada foi baixado.

## Texto para o pitch: regras explicáveis, não um modelo treinado

O Happy Farmers calcula cada número com regras públicas: necessidade de água da FAO (Kc e Ky do FAO-56), faixas de clima do ECOCROP, clima observado do NASA POWER e projetado do NEX-GDDP. Cada nota tem uma conta por trás que o agricultor e o agrônomo podem abrir: o balanço de água mês a mês, os dias de calor no florescimento, o desconto por repetir a cultura. O assistente de IA só explica esses números; ele nunca os produz.

Escolhemos regras por três motivos:

1. **Não há dado para treinar.** Seria preciso produtividade por talhão e por ano. Temos 20 anos de clima diário num ponto e a produtividade do IBGE só de 2025, no nível do estado.
2. **O futuro está fora do passado.** Um modelo treinado com 2005–2024 teria de extrapolar para 2041–2060. As regras aplicam a mesma física (evapotranspiração, balanço de água) ao clima projetado.
3. **Dá para conferir e discordar.** Se um valor da tabela estiver errado, troca-se o valor e o efeito é previsível. Valores ainda sem fonte aparecem como aviso na própria recomendação.

O que essa escolha perde:

- **Só vê o que está nas regras.** Pragas, doenças, tipo de solo e manejo não entram. Um modelo treinado com dados de campo poderia captar efeitos que ninguém escreveu.
- **Algumas constantes não têm fonte**: água guardada no solo (100 mm), desconto por repetir cultura (15%), bônus depois de leguminosa (10%), perda por calor. O resultado depende delas.
- **Ainda não foi conferido contra colheitas reais.** A comparação com a PAM de vários anos está pendente.
- **A resposta depende da forma de olhar o clima.** No talhão de demonstração, com a média mensal ganha soja e milho; olhando ano a ano, no ano mediano ganha soja e sorgo. As duas formas concordam na ordem geral (correlação de postos de 0,97 a 0,98) e na troca de vencedor entre hoje e o futuro em fevereiro.

## Como reproduzir

Da raiz do repositório, com o venv ativado (bash ou Git Bash):

```bash
python - <<'EOF'
from collections import Counter
from motor import carregar_dados, carregar_diario, recomendar

dados, diario = carregar_dados(), carregar_diario()

for mes in (10, 2):
    e = {"lat": -20.032, "rotacao_atual": ["soja", "milho"], "horizonte": 2, "mes_plantio": mes,
         "prioridades": {"agua": 1, "solo": 1, "renda": 1}}
    seqs = recomendar(e, *dados, diario=diario)["sequencias"]
    med = lambda s, c="hoje": s["diario"][c]["mediano"]
    ruim = lambda s, c="hoje": s["diario"][c]["ruim"]
    print(f"\nTalhao livre no mes {mes}: {len(seqs)} sequencias viaveis")
    print("id | mensal: rank score agua receita rank_fut | mediano: rank score agua receita | ruim: rank agua receita | pior ano | futuro diario: rank mediano/ruim")
    for s in seqs:
        if min(s["rank_hoje"], med(s)["rank"], ruim(s)["rank"]) > 5:
            continue
        h, p = s["hoje"], s["diario"]["hoje"]["pior_ano"]
        print(f"{s['id']} | {s['rank_hoje']} {h['score']:.1f} {h['agua']:.3f} {h['receita_ha']:.0f} {s['rank_futuro']}"
              f" | {med(s)['rank']} {med(s)['score']:.1f} {med(s)['agua']:.3f} {med(s)['receita_ha']:.0f}"
              f" | {ruim(s)['rank']} {ruim(s)['agua']:.3f} {ruim(s)['receita_ha']:.0f}"
              f" | {p['receita_ha']:.0f} ({p['ano']}) | {med(s, 'futuro')['rank']}/{ruim(s, 'futuro')['rank']}")
    faixa = lambda xs: f"{min(xs):.3f} a {max(xs):.3f}"
    print("agua mensal", faixa([s["hoje"]["agua"] for s in seqs]),
          "| mediano", faixa([med(s)["agua"] for s in seqs]), "| ruim", faixa([ruim(s)["agua"] for s in seqs]))
    print("mesmo rank no mensal e no mediano:", sum(s["rank_hoje"] == med(s)["rank"] for s in seqs), "de", len(seqs))
    print("pior ano:", Counter(s["diario"]["hoje"]["pior_ano"]["ano"] for s in seqs).most_common())
    for s in seqs[:3]:
        r = [a["receita_ha"] for a in s["diario"]["hoje"]["anos"]]
        print(f"{s['id']}: receita por ano {min(r):.0f} a {max(r):.0f}")
    for s in seqs:
        for i, c in enumerate(s["hoje"]["culturas"]):
            d = s["diario"]["hoje"]["culturas"][i]
            if s["id"] in ("soja>milho", "soja>trigo", "soja>feijao", "milho>algodao") and i == 1 or d["eventos"]["geada"]["anos"]:
                print(f"  {s['id']} {c['cultura']} {c['slot']}: atendimento mensal {c['atendimento_hidrico']:.3f},"
                      f" diario {d['mediano']['atendimento_hidrico']:.3f}/{d['ruim']['atendimento_hidrico']:.3f};"
                      f" calor mensal {c['encaixe_calor']:.3f}/{s['futuro']['culturas'][i]['encaixe_calor']:.3f},"
                      f" diario {d['mediano']['encaixe_calor']:.3f}/{s['diario']['futuro']['culturas'][i]['mediano']['encaixe_calor']:.3f};"
                      f" geada {d['eventos']['geada']}")
EOF
```

Trocar `["soja", "milho"]` por `[]` dá os números sem histórico. O Spearman, os veranicos (maior sequência de dias com menos de 1 mm de novembro a março em `carregar_diario()`), a chuva de novembro a março por estação, os dias quentes por ano e os dias com mínima de 3 °C ou menos foram calculados à parte, com pandas, sobre a mesma saída e a mesma série; não mudam nada no motor.
