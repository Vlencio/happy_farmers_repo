# Entrega de Gabriel — plano de lacunas

Implementação de 14/11/2026 na branch `front-dev3`, com as entregas de Pedro em
`motor-dev2` (`82cabe8`) e de dados em `dados-calor` (`87cd7ec`) integradas por merge.
Referência: [plano do time](../../docs/plano_gap.md). As fórmulas e os dados dos
responsáveis foram preservados; Gabriel implementou o transporte e a apresentação.

| Item | Entrega | Estado |
|---|---|---|
| G1 | Card climático filtra sequências com receita positiva em cada cultura futura; fallback e desempate documentados e testados | Concluído |
| G2 | Painel “Seu talhão”, NDVI mensal, cobertura/palhada, declividade, A520; metadados e arquivos no pacote Docker | Concluído |
| G3 | Glossário, resolução das fontes e avisos sobre preços, calor e constantes provisórias | Concluído |
| G4 | Ano seco real da demonstração ligado à API e à tela; leitor da faixa dos modelos preparado | Ano seco concluído; faixa aguarda D2 |
| G5 | POWER por ponto + delta regional; origem, avisos e cache; deploy e espera ampliada | Concluído e testado em três pontos de Minas |
| G6 | Teste do botão por teclado e árvore de acessibilidade; Enter no foco Rune corrigido | Fluxo verificado; leitura com NVDA/Narrador ainda não auditada |

## O que foi corrigido e conferido

- Outubro: card climático **Soja → Sorgo**. Fevereiro: **Sorgo → Soja**.
- As culturas de cobertura continuam disponíveis para os demais objetivos.
  Nenhum limite de calor foi atribuído pelo front.
- O painel exige o contorno completo do talhão de demonstração; nome, área e
  tag de exemplo não bastam. Importar esse mesmo contorno também funciona.
- Agosto tem indício de solo descoberto/palhada em **50%** dos anos, setembro
  **60%**, outubro **40%**. O texto não repete a sugestão imprecisa de “mais da
  metade” para ambos agosto e setembro. NDVI é um indicador indireto.
- Teclado: Rune reserva Enter para o botão padrão da janela e usa Espaço para
  o botão focado. Acrescentado tratamento de Enter **somente no botão de exemplo**,
  sem repetir a ação ao segurar a tecla. Conferidos Tab/Shift+Tab, foco visível,
  abertura, Escape e confirmação do contorno. Ativação pelo botão exposto na
  árvore de acessibilidade também abriu o mapa; a falha de clique relatada no
  plano não se reproduziu nessa verificação.

## O que falta chegar dos responsáveis

**P1 e P3 — Pedro: recebidos.** A API liga `carregar_clima_seco()` como quinto
argumento de `recomendar` para a demonstração; outros pontos não recebem essa
série local. A grade regional entregue é selecionada pela API e usada por D1.

**D2 — Dev 1:** fornecer `data/clima_modelos.csv` com os deltas mensais por modelo.
O leitor já calcula chuva anual e média dos 12 deltas de máxima, e a interface
deriva os extremos e a discordância do sinal da chuva. Não foram gerados dados
nem fixadas na tela as faixas citadas no plano. Reiniciar a API após a entrega.

**D1 — recebido e integrado.** A função de `dados-calor` aceita deltas por parâmetro.
A API seleciona a célula regional, envia as tabelas ao motor e retorna `origem`;
`point_climate_available: true`. A tela mostra os avisos de POWER indisponível,
tabelas de demonstração e ponto fora de Minas. Fora da grade, informa falta de
cobertura. A identificação de Minas usa a malha simplificada do IBGE e apenas o
ponto do talhão; não é validação cadastral do contorno.

**Limites dos dados:** calendário ainda do Triângulo Mineiro; ano seco, NDVI e
relevo ainda da demonstração. D2 (faixa dos modelos), D3 (geada) e a revisão de
preços/limiares continuam com seus responsáveis. O aviso sobre a chuva extrema
no norte da grade está na tela; os valores fornecidos não foram alterados.

**Pedido de integração do Pedro:** Docker copia scripts e delta regional; o
`.dockerignore` libera apenas esse CSV dentro da grade; `requests` foi incluído.
Espera ampliada de 45 s para 6 min, com cancelamento. O cache diário de D1 é usado;
a pasta é criada na imagem. Consultas reais: 2,04–2,55 s; repetição via cache: 0,08 s.
Esses tempos são uma medição local, não uma garantia de disponibilidade do POWER.

Detalhes técnicos em [API.md](API.md). Evidências e limites dos testes em
[VALIDACAO.md](VALIDACAO.md).

## Abrir localmente

Em `D:\NasaSpaceApps\frontend`, execute `npm run preview` para a versão compilada,
ou `npm run dev` durante o desenvolvimento. Ambos iniciam a API e a interface em
`http://127.0.0.1:4173/`; Ctrl+C encerra os dois processos.

## Limites da validação local

- **Docker local:** o WSL2 falhou com `HCS_E_HYPERV_NOT_INSTALLED`. O build e a
  execução Linux foram automatizados no GitHub Actions, após os testes de
  Python/JS/Rust e HTTP; o resultado de cada execução fica ligado ao commit.
  Veja [CI](../../docs/CI.md). Não foram alterados recursos do Windows nem a BIOS.
- **Leitor de tela:** NVDA 2026.3.1 portátil foi preparado a partir da distribuição
  oficial, com assinatura válida. O controle do navegador foi encerrado pela
  ferramenta por não conseguir confirmar a URL da janela. A leitura e a ativação
  pelo NVDA não foram verificadas. A evidência de G6 permanece limitada ao
  teclado e à árvore de acessibilidade descritos acima.

Esses dois pontos não devem ser marcados como validados apenas porque os testes
automatizados passaram. Não houve publicação de um serviço de produção.
