# Plano — rodar a análise em qualquer lugar de Minas Gerais

> Proposta de 14/11/2026, escrita pelo Pedro. Ainda não foi combinada entre os três. Leiam a parte de vocês e digam se cabe no tempo que resta.

> Estado posterior na `front-dev3`, 14/11: P3 e D1 recebidos e integrados à API.
> Consultas reais em três pontos passaram; origem e avisos aparecem na tela.
> Fora de Minas, dentro da grade, a análise continua com aviso; fora da grade,
> retorna erro de cobertura. O registro da implementação está em
> `frontend/docs/API.md` e `frontend/docs/VALIDACAO.md`. A proposta abaixo é histórica.

## O que queremos

O usuário desenha um talhão em qualquer lugar de Minas Gerais e recebe a análise com o clima daquele ponto, sem esperar minutos.

## Por que hoje só vale para o talhão de demonstração

- `clima_hoje.csv` e `clima_futuro.csv` foram montados para um ponto só (-20,032, -48,526). O motor lê os mesmos dois arquivos para qualquer polígono.
- A correção de temperatura usa a estação A520, que só serve para aquele talhão.
- Os meses de plantio de `culturas.csv` são do Triângulo Mineiro.

## A ideia

O clima futuro (NEX-GDDP) é a parte lenta: 360 requisições por ponto, 11,6 minutos no download de ontem. Em vez de um ponto por vez, baixamos **um retângulo em volta do estado inteiro**, uma vez só, antes do pitch. São as mesmas 360 requisições, cada uma com todos os quadrados de 0,25° (cerca de 25 km) da região.

- Retângulo: latitude -23,5 a -13,5, longitude -51,5 a -39,5. O estado (IBGE) vai de -22,92 a -14,23 e de -51,05 a -39,86, então cabe com folga.
- 40 × 48 = 1.920 quadrados. Cerca de 1 GB de download (estimativa; o teste de um arquivo confirma).
- Do download sai uma tabela pequena, `data/nexgddp/regiao_mg/delta_mensal.csv`: a mudança do clima (futuro menos histórico, média dos 3 modelos) por quadrado e mês. Só ela vai para o Git; os arquivos brutos ficam fora.

Com isso, na hora da análise só falta o clima de hoje (POWER), que é uma requisição por talhão.

## O que já existe

| Arquivo | O que faz | Estado |
|---|---|---|
| `scripts/puxar_nexgddp_regiao.py` | Baixa o retângulo. `--teste` baixa um arquivo só e estima tempo e tamanho | Escrito; **ainda não rodado contra o servidor** |
| `scripts/montar_nex_regiao.py` | Gera `delta_mensal.csv` e confere o quadrado do talhão de demonstração contra `clima_correcoes.csv` | Testado com arquivos sintéticos (`tests/test_nex_regiao.py`) |

Colunas de `delta_mensal.csv`: `lat`, `lon` (centro do quadrado), `mes`, `delta_chuva_mm`, `delta_tmin_c`, `delta_tmax_c` e `delta_dias_acima_NN` para cada limiar de calor de `culturas.csv`, mais o de 35 °C.

## O que não muda

- **As regras do motor.** Ele já recebe as tabelas como argumento; só precisa receber as tabelas certas.
- **O JSON de saída** (`docs/contrato_motor.md`).
- **O talhão de demonstração.** As tabelas dele continuam embutidas e a análise dele continua instantânea.

## Tarefas

### Pedro

1. Rodar `python scripts/puxar_nexgddp_regiao.py --teste` e olhar tempo e tamanho.
2. Rodar o download completo e depois `montar_nex_regiao.py`.
3. Conferir a saída: no quadrado do talhão de demonstração, os deltas têm que bater com `clima_correcoes.csv`.

### Dev 1 — dados

1. **Revisar os dois scripts novos.** Eles repetem o método de `montar_clima.py` (delta por modelo e mês, depois média dos modelos) para uma grade.
2. **Clima de hoje por ponto.** `montar_clima.py` tem o ponto e os caminhos fixos no topo. Precisa de uma função que receba latitude e longitude, puxe o POWER diário daquele ponto e devolva `clima_hoje` e `clima_futuro` (hoje + delta do quadrado), com as mesmas colunas de hoje.
3. **Sem a correção da A520 fora do talhão de demonstração.** O ET0 já não usa a correção e o encaixe de temperatura quase não muda. Os dias quentes de hoje podem sair menores; vale dizer isso na tela.

### Gabriel — API e tela

1. **A API passa a receber a longitude.** Hoje a entrada só tem `lat`. O motor não usa a longitude; ela serve para a API escolher o quadrado.
2. **`/analyze` monta as tabelas do ponto antes de chamar o motor.** Para o talhão de demonstração, continua usando as tabelas embutidas.
3. **Medir a requisição do POWER.** Se couber nos 45 segundos que a tela já espera, não precisa de fluxo em duas etapas. Guardar o resultado por célula do POWER evita repetir.
4. **Mensagens novas:** talhão fora de Minas Gerais, POWER fora do ar, e o aviso atual de que o clima é do talhão de demonstração.

## Ordem

1. Pedro roda o teste de um arquivo. Se o tempo ou o tamanho forem ruins, paramos aqui.
2. Download completo e tabela de deltas.
3. Dev 1: clima de hoje por ponto. Gabriel: longitude e `/analyze`.
4. Testar três ou quatro pontos espalhados pelo estado antes do pitch.

## Riscos

- **O download do retângulo ainda não foi testado.** O serviço da NASA aceita retângulos, mas tempo e tamanho só o teste diz.
- **O POWER passa a ser chamado na hora do uso.** O plano original evitava chamadas ao vivo na demo. Por isso o talhão de demonstração fica embutido.
- **O calendário de plantio é do Triângulo Mineiro.** O norte de Minas é mais seco e pode ter outro calendário; os meses de hoje são de memória.
- **O retângulo cobre mais que o estado** (DF, RJ, parte de SP, GO, BA e ES). O clima existe para esses lugares, mas a tabela de culturas não foi pensada para eles.

## Decisões que faltam

1. **Fora de Minas, dentro do retângulo:** bloquear ou analisar com um aviso?
2. **Horário limite.** Se não estiver funcionando até lá, o pitch fica só com o talhão de demonstração.
3. **Outros estados depois.** Precisam de um retângulo novo e de calendário de plantio por estado (Conab ou ZARC).
