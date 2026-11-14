# Happy Farmers × desafio Field Shift: o que falta melhorar

Análise do repositório [Vlencio/happy_farmers_repo](https://github.com/Vlencio/happy_farmers_repo) (commit `c54fe17`) e do protótipo publicado em [web-production-c486b0f2.up.railway.app](https://web-production-c486b0f2.up.railway.app/), comparados com as "Considerações potenciais" do desafio. Data: 14/11/2026.

Como foi verificado: leitura do código e da documentação; chamadas à API ao vivo (`/metadata` e `/analyze`), cujos resultados batem com o motor do repositório; execução local do motor para ver quais sequências vencem cada card.

## Resumo

A base técnica está boa: motor explicável, clima de hoje e de 2041–2060, balanço hídrico e calendário. O maior problema é que **vários dados já processados não chegam à tela** (NDVI, solo descoberto, declividade, ano seco, correção pela estação INMET). Aproveitar isso cobre boa parte do que o desafio pede, com pouco esforço.

## Comparação com o desafio

| Pedido do desafio | Situação | O que existe / o que falta |
|---|---|---|
| Temperatura, chuva, evapotranspiração | **Atende** | NASA POWER, NEX-GDDP com 3 modelos, ET0 por Hargreaves, Kc da FAO-56, regra de dias de calor |
| Umidade do solo / anomalias | **Parcial** | É estimada por um "balde" de 100 mm, sem medição. Não usa SMAP nem mostra anomalias |
| Estresse da vegetação (NDVI) | **Parcial** | O NDVI do MODIS foi processado em `data/talhao/`, mas **o motor não usa e a tela não mostra**. O Dockerfile nem copia esses arquivos |
| Risco de geada | **Falta** | Nada. O POWER diário já tem a mínima de cada dia, então dá para contar os dias frios |
| Explicar termos científicos | **Falta** | A tela mostra "Kc", "déficit" e "encaixe" sem glossário |
| Satélite × medição em solo | **Parcial, escondido** | A correção pela estação INMET A520 já foi feita (`clima_correcoes.csv`). Isso responde exatamente a esse item, mas não aparece no app nem no pitch |
| Comparar abordagens estatísticas ou de IA | **Falta** | O motor é por regras, por decisão do time, o que é defensável pela explicabilidade. Falta mostrar por que regras e não aprendizado de máquina. A camada de IA que "explica os números", prevista no CLAUDE.md, não foi implementada |
| Transições de estação / campo sem cobertura | **Pronto, sem uso** | `ndvi_climatologia.csv` mostra o solo descoberto em ago–set em 50–60% dos anos. É o melhor argumento para cultura de cobertura, e não é usado |
| Incerteza | **Parcial** | A média dos 3 modelos esconde a diferença entre eles. O ano seco (`clima_seco.csv`) existe, mas não entra na saída |
| Onde precisa de validação local | **Parcial** | As constantes estão marcadas "sem fonte, ajustar com agrônomo" no código. Na tela não há esse aviso |
| Combinar dados de resoluções diferentes | **Falta** | O clima é de um ponto, o NDVI de 250 m e a altitude de 30 m. Não há uma grade comum. Faz sentido, porque o escopo é um talhão, mas convém dizer isso |
| Rotação: nutrientes | **Atende** | Bônus para a cultura que vem depois de uma fixadora de nitrogênio |
| Rotação: erosão / matéria orgânica | **Falta** | A declividade foi calculada (média de 4%, 90% do talhão abaixo de 7%), mas não é usada. Cobertura do solo é só sim/não |
| Rotação: ciclo de pragas | **Parcial** | Só há penalidade por repetir a mesma cultura. Não considera família botânica |
| Rotação: forragem / mercado | **Parcial** | A braquiária vale R$ 0 e não tem valor de forragem. Alguns preços estão marcados como "de memória". O motor aceita preço editado, mas a tela não oferece |
| Prioridades do agricultor | **Parcial** | O motor aceita pesos para água, solo e renda, mas a tela sempre manda pesos iguais |
| Restrições (água, equipamento, mercado) | **Falta** | Não há como informar |
| Raiz profunda / tolerância à seca | **Falta** | A tabela de culturas não tem esses atributos |
| Mapa interativo | **Parcial** | Desenho e importação do contorno funcionam bem. Mas o mapa não mostra camadas de dados (NDVI, declividade, estresse hídrico) nem evolução no tempo |
| Controles de cenário (mais ou menos chuva e calor) | **Falta** | Só há hoje e futuro fixos |
| Funciona para qualquer fazenda | **Falta (crítico)** | Ao desenhar outra área, o clima continua sendo o do talhão de demonstração. O app avisa, mas um jurado vai notar |
| Fácil para o agricultor | **Parcial** | O fluxo de 3 passos em português é bom. O jargão atrapalha |

## Dois problemas no resultado

1. **O card "Resiliência climática" sempre escolhe uma combinação com cultura de cobertura** (soja>milheto quando o talhão fica livre em outubro, milheto>soja em fevereiro). As culturas de cobertura não têm limite de calor na tabela, então nunca perdem pontos por calor e "vencem" por essa lacuna. A agronomia não tem nada a ver com isso. Corrigir antes do pitch: ou excluir quem não gera receita desse card, ou dar um limite de calor às culturas de cobertura.
2. **O índice de água quase não distingue as opções.** No clima médio ele fica entre 0,88 e 1,00 em todas as sequências. Com o ano seco cai para 0,57–0,80 e muda o ranking (soja>feijão passa à frente). Por isso o ano seco vale muito para a narrativa.

## Prioridades para o tempo que resta

### Ganhos rápidos (algumas horas cada, com dados que já existem)

1. **Ano seco como terceiro cenário** (hoje / futuro / ano seco). O motor já roda nessa tabela.
2. **NDVI e solo descoberto na linha do tempo:** "seu talhão fica sem cobertura em ago–set em mais da metade dos anos". Isso justifica a crotalária e o milheto.
3. **Declividade virando aviso de erosão** nas sequências que deixam o solo descoberto.
4. **Corrigir o viés do card de clima** descrito acima.
5. **Controles de prioridade** (água / solo / renda). O motor já aceita pesos.
6. **Glossário curto** em balões de ajuda: evapotranspiração, Kc, déficit, NDVI, encaixe.
7. **Avisos de "valide com seu agrônomo"** nos pontos certos: preços, constantes provisórias, limites de calor.
8. **Mostrar a correção pela estação INMET** como "satélite + estação em solo". Responde a um item explícito do desafio.

### Médio esforço (só se der tempo)

- Buscar o NASA POWER ao vivo para o centro do contorno desenhado, uma única chamada à API. Reaproveitar a variação do NEX da área de demonstração, com aviso. Isso resolve o problema crítico de servir para qualquer fazenda.
- Mostrar a faixa entre os 3 modelos climáticos em vez de só a média, para comunicar a incerteza.
- Contagem de dias com risco de geada a partir do POWER diário (provavelmente baixo nessa região, mas responde ao item).
- Atributos de raiz profunda, tolerância à seca e valor de forragem na tabela de culturas.

### Para explicar no pitch (sem implementar)

O time escolheu deixar SMAP, GPM, SoilGrids e aprendizado de máquina fora do escopo. Como o desafio cita SMAP, ECOSTRESS, GPM e GEDI pelo nome, vale um slide dizendo por quê e como entrariam numa próxima versão. Um exemplo: usar o SMAP para validar o balde de água do solo.

## Observação do teste no navegador

No navegador automatizado, o botão "Usar área de exemplo" não pareceu responder quando acionado pela árvore de acessibilidade. Pode ser limitação do teste e não do app. Vale conferir, porque o próprio `frontend/docs/VALIDACAO.md` diz que leitores de tela ainda não foram validados.
