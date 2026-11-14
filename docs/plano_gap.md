# Plano — fechar as lacunas da análise do desafio

> Proposta de 14/11/2026, a partir de `docs/happy_farmers_gap_analysis.md`. Ainda não foi combinada entre os três. Cada um lê a sua parte e diz se cabe no tempo que resta.

Este plano parte da análise de lacunas, conferida contra o código em `c54fe17` e contra o motor rodando local com as tabelas de `data/`. Nada foi alterado no repositório e nenhum script de download foi rodado. Os testes do motor passam (33, 4 pulados).

Quem cuida de quê não muda: Dev 1 — dados (`data/`, `scripts/`); Pedro — motor (`motor/`); Gabriel — tela e API (`frontend/`, `backend/`). Mudança na área de outro passa pelo dono.

> Atualização da entrega de Gabriel em `front-dev3`, 14/11: G1–G3 implementados;
> P1 e P3 (`motor-dev2`, `82cabe8`) e D1 (`dados-calor`, `87cd7ec`) integrados.
> G4 mostra o ano seco real da demonstração; a faixa segue aguardando D2. G5 usa
> POWER por ponto e delta regional, com origem/avisos, cache e espera de 6 minutos.
> G6 mantém a validação por teclado/árvore, pendente de leitor de tela. Detalhes e
> limites em `frontend/docs/PLANO_GAP.md` e `frontend/docs/VALIDACAO.md`.

## O que a conferência mostrou

| Afirmação da análise | Resultado |
|---|---|
| O card de clima sempre escolhe uma sequência com cultura de cobertura | **Confirmado.** `soja>milheto` com o talhão livre em outubro e `milheto>soja` em fevereiro, as duas com encaixe futuro 0,971. As culturas de cobertura não têm `temp_calor_c`, então `encaixe_calor` é sempre 1 |
| O índice de água quase não separa as opções | **Confirmado.** No clima médio, 0,88–1,00 (outubro) e 0,91–1,00 (fevereiro) |
| No ano seco o índice cai para 0,57–0,80 e `soja>feijao` passa à frente | **Não reproduzido.** Deu 0,66–0,90 (outubro) e 0,63–0,90 (fevereiro). No ano seco ganha `milho>crotalaria` (outubro) e `crotalaria>milho` (fevereiro); `soja>feijao` cai de 4º para 12º. O ranking muda, então o argumento continua valendo |
| NDVI, declividade e correção da A520 não chegam à tela | **Confirmado.** O `Dockerfile` copia só três CSVs, e o `.dockerignore` exclui `data/talhao` e `data/inmet` |
| A tela sempre manda pesos iguais e nenhum preço | **Confirmado** (`frontend/web/api.mjs:43`). É o MVP combinado, não uma lacuna |
| Dá para contar dias de geada pelo POWER diário | **Dá, e a conta é zero.** A menor mínima de 2005–2024 é 4,2 °C, sem a correção da A520. A correção baixa as mínimas de junho a agosto em 1,7 a 2,2 °C |
| O solo descoberto em ago–set justifica crotalária e milheto | **Mais fraco do que parece.** Com o talhão livre em outubro, toda sequência do motor termina até junho; nenhuma cobre agosto e setembro. É um fato do talhão, não uma diferença entre sequências |

O teste do ano seco foi feito passando `clima_seco.csv` no lugar de `clima_futuro`. Nesse teste, a `renda` é normalizada entre hoje e ano seco, e não entre hoje e futuro.

Duas coisas que a análise não considerou:

- **Servir para qualquer fazenda já tem plano:** `docs/plano_outros_locais.md`. Há 60 dos 360 arquivos do retângulo em `data/nexgddp/regiao_mg/bruto`. A versão da análise (POWER ao vivo + a mudança do NEX do talhão de demonstração, com aviso) fica como plano B se o download não terminar.
- **Os três modelos discordam na chuva.** Chuva anual, ssp245 menos historical: MIROC6 −80 mm, ACCESS-CM2 +8 mm, MRI-ESM2-0 +33 mm. Máxima média: +1,3 °C (MIROC6), +1,5 °C (MRI-ESM2-0), +2,3 °C (ACCESS-CM2). Calculado de `data/nexgddp/nexgddp_-20.032_-48.526.csv`. A média esconde isso.

## Tarefas

### Pedro — motor

**P1. Ano seco como terceiro cenário. Feito em 14/11, no motor.**

- `recomendar` aceita `clima_seco` como quinto argumento, opcional. Com ele, a saída ganha `clima.seco`, `rank_seco` e um bloco `seco` em cada sequência, com a mesma estrutura de `hoje`. Sem ele, a saída é idêntica à de antes (conferido em 216 entradas contra o motor de `c54fe17`).
- `carregar_dados` continua devolvendo três tabelas. A do ano seco vem de `carregar_clima_seco()`, que devolve `None` se o arquivo não existe. Assim a API e o deploy atuais não mudam até o Gabriel ligar (G4).
- **`renda`:** o teto continua sendo a maior receita entre hoje e futuro; a `renda` do ano seco para em 1.
- É um ano real (2020/21), não uma média. Detalhes e números em `docs/contrato_motor.md`.
- `python -m motor` mostra os três cenários. Testes: 40 passam, 7 novos para o ano seco.

**P2. Combinar com o Gabriel a regra do card de clima** (ver G1). A causa está no motor: cultura sem limiar de calor nunca perde ponto.

**P3. Download do retângulo e `delta_mensal.csv`. Feito em 14/11.**

- 360 arquivos, 568 MB, todos íntegros. A grade veio com 41 × 49 quadrados (o servidor inclui a borda), e não 40 × 48; 1.888 têm dado, o resto é mar.
- `data/nexgddp/regiao_mg/delta_mensal.csv`: 1.888 quadrados × 12 meses. No quadrado do talhão de demonstração, bate com `data/clima_correcoes.csv` (diferença máxima de 0,005).
- **Ressalva conhecida, sem correção:** o NEX-GDDP traz 92 valores de chuva acima de 300 mm em um dia (até 1.230 mm), em maio, junho e agosto. Eles mexem o `delta_chuva_mm` em até ±23 mm em 62 quadrados ao norte da latitude −17,1 (norte e noroeste de Minas). Com um desvio desses na chuva de maio, a receita futura do motor muda em até uns 5% e o primeiro lugar pode trocar entre sequências quase empatadas. Temperatura e dias de calor não são afetados. O talhão de demonstração e o Triângulo estão fora.
- Falta só o que depende de D1 e G5.

### Dev 1 — dados

**D1. Clima de hoje por ponto.** Vem primeiro: os dois caminhos de "qualquer fazenda" dependem dele.

- Uma função que recebe latitude e longitude, puxa o POWER diário do ponto e devolve `clima_hoje` e `clima_futuro` com as mesmas colunas de hoje. Hoje `scripts/montar_clima.py` tem o ponto e os caminhos fixos no topo.
- O delta vem de `delta_mensal.csv` (quadrado do ponto). No plano B, vem de `data/clima_correcoes.csv` (talhão de demonstração), e a saída precisa dizer isso para a tela avisar.
- Sem a correção da A520 fora do talhão de demonstração.
- Pronto quando: para (-20,032, -48,526) sem correção, a função reproduz o `clima_hoje.csv` atual, a menos da correção da A520.

**D2. Faixa entre os modelos.**

- Em `montar_clima.py`, `deltas_nex()` tira a média dos modelos na linha 88. Gravar também o delta por modelo, por exemplo em `data/clima_modelos.csv`: `modelo`, `mes`, `delta_chuva_mm`, `delta_tmin_c`, `delta_tmax_c`.
- Conferir os números anuais da seção anterior.
- Só leitura dos arquivos que já estão em `data/nexgddp/`; não precisa de download.

**D3. Geada.** Recontar os dias frios do POWER diário com a correção da A520 na mínima, do mesmo jeito que `dias_quentes_power` faz com a máxima. Definir o limiar (de memória: mínima no abrigo abaixo de uns 3 °C; conferir). Se der zero ou quase, vira uma frase na tela e no pitch, não uma regra do motor.

**D4. Conferir os preços marcados "memória"** em `docs/culturas_fontes.md`.

**D5. Só se sobrar tempo:** colunas de raiz profunda, tolerância à seca e valor de forragem em `culturas.csv`. O motor não lê coluna nova sem o Pedro mudar.

### Gabriel — tela e API

**G1. Corrigir o card de clima.**

- Em `frontend/web/api.mjs:139`, o card de clima escolhe o maior `futuro.encaixe`. Limitar a escolha às sequências em que toda cultura gera receita (`receita_ha > 0`); se não houver nenhuma, usar todas.
- Resultado esperado com as tabelas atuais: `soja>sorgo` (outubro) e `sorgo>soja` (fevereiro).
- Por que não dar limite de calor às culturas de cobertura: seriam números sem fonte.
- Atualizar a tabela dos cards em `frontend/docs/API.md`, o texto do critério no próprio `api.mjs`, os testes em `frontend/tests/api.test.mjs` e o item 4 de "Next steps" em `CLAUDE.md`.

**G2. Painel "Seu talhão", só para o talhão de demonstração.** Os dados de `data/talhao/` valem só para aquele polígono.

- NDVI por mês e solo descoberto: `data/talhao/ndvi_climatologia.csv`. `freq_solo` é 0,5 em agosto, 0,6 em setembro e 0,4 em outubro. Frase sugerida: "seu talhão fica sem cobertura em agosto e setembro em mais da metade dos anos".
- Declividade: `data/talhao/declividade.csv`. Média 4,05%, 90% do talhão abaixo de 7,07%, máxima 17,82%. É relevo suave; mostrar como fato, sem alarme de erosão.
- "Satélite + estação em solo": `data/clima_correcoes.csv`, colunas `off_tmin` e `off_tmax`. A estação INMET A520 (Conceição das Alagoas, a 40 km) mostra noites 1,2 a 2,5 °C mais frias que o POWER. A correção entra em `tmin_c`, `tmax_c` e nos dias quentes; não entra no ET0 nem na chuva (viés de −5%, r = 0,90).
- Precisa de: rota nova ou campos em `/metadata`, mais os arquivos no `Dockerfile` e fora do `.dockerignore`.

**G3. Glossário e avisos.** Só texto.

- Termos: evapotranspiração, Kc, déficit, atendimento hídrico, NDVI, encaixe. Aparecem em `frontend/web/api.mjs:129-131` e na tabela mensal de `frontend/src/ui.rs` (por volta das linhas 990–1021). Se o rune-kit não tiver balão de ajuda, uma seção "Entenda os termos" resolve.
- Avisos de "valide com seu agrônomo": nos preços, nos limites de calor e nas constantes provisórias (lista no fim de `docs/contrato_motor.md`).
- Uma linha dizendo que os dados têm resoluções diferentes (clima de um ponto, NDVI de 250 m, altitude de 30 m) e que o escopo é um talhão.

**G4. Mostrar o ano seco e a faixa dos modelos.** A P1 já está no motor; a faixa depende de D2.

- Ligar na API: em `backend/app.py`, guardar `carregar_clima_seco()` junto das tabelas e passar como quinto argumento de `recomendar`. Com `None`, o motor devolve só hoje e futuro.
- Terceira coluna ou seletor hoje / futuro / ano seco no calendário e nos fatos do card. `validateMotorOutput` hoje só confere `hoje` e `futuro`; campo novo não quebra, mas precisa de validação própria.
- O JSON cresce de cerca de 120 KB para 175 KB com o terceiro cenário.
- Faixa dos modelos como texto: "os três modelos apontam de +1,3 a +2,3 °C na máxima; na chuva, discordam do sinal".
- Copiar `data/clima_seco.csv` no `Dockerfile`.

**G5. Longitude na API e tabelas por ponto em `/analyze`**, como em `docs/plano_outros_locais.md`. Depende de D1.

**G6. Conferir o botão "Usar área de exemplo"** com teclado e leitor de tela. No teste automatizado da análise ele não respondeu pela árvore de acessibilidade; pode ser limitação do teste.

### Para o pitch, sem código

- Por que regras e não aprendizado de máquina: cada número da tela pode ser explicado.
- Por que SMAP, GPM e SoilGrids ficaram fora, e como entrariam depois. Exemplo: SMAP para validar o balde de água do solo.
- Por que não há grade comum: o escopo é um talhão.
- A frase da geada (D3) e a da discordância dos modelos na chuva (D2).

## Ordem

1. Em paralelo, já: G1, G3, P1, D1.
2. Depois: G2, D2, D3, e G4 quando P1 e D2 chegarem.
3. Por último, com horário limite: P3, G5 e o teste de três ou quatro pontos pelo estado.

## Fora deste plano

- **Controles de prioridade, preço editável e texto por IA.** A análise sugere, mas o time fechou os três em 14/11: três cards objetivos, pesos iguais, sem LLM. Só voltam se os três reabrirem.
- **Aviso de erosão por sequência.** O relevo é suave e os meses descobertos são os mesmos em todas as sequências. Vai como fato no painel do talhão (G2).
- **Controles de mais ou menos chuva e calor, e camadas de dados no mapa.** São funcionalidades novas. O ano seco cobre parte da primeira.
- **Família botânica na regra de pragas.** Coluna nova e regra nova sem fonte.

## Decisões que faltam

1. O ano seco entra como terceiro cenário na tela? Hoje o `CLAUDE.md` fala em comparar hoje e futuro.
2. A regra nova do card de clima (G1) está boa para os três?
3. Horário limite para "qualquer fazenda"; depois dele, o pitch fica com o talhão de demonstração.
