# Entrega de Gabriel — plano de lacunas

Implementação de 14/11/2026, baseada na Main remota `c54fe17`, para entrega na
branch `front-dev3`. Referência: [plano do time](../../docs/plano_gap.md).
Sem mudanças em `motor/`, `data/`, scripts de coleta ou testes originais do motor.

| Item | Entrega | Estado |
|---|---|---|
| G1 | Card climático filtra sequências com receita positiva em cada cultura futura; fallback e desempate documentados e testados | Concluído |
| G2 | Painel “Seu talhão”, NDVI mensal, cobertura/palhada, declividade, A520; metadados e arquivos no pacote Docker | Concluído |
| G3 | Glossário, resolução das fontes e avisos sobre preços, calor e constantes provisórias | Concluído |
| G4 | Validação e apresentação opcional do cenário seco; leitor e faixa dos modelos; CSVs incluídos no pacote | Consumidor pronto; aguarda P1 e D2 |
| G5 | Longitude enviada pelo front e validada na API | Clima por ponto aguarda função de D1 |
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

**P1 — Pedro:** `carregar_dados` precisa incluir a tabela seca na ordem esperada
por `recomendar`; a resposta precisa trazer `clima.seco`, `rank_seco` e `seco` em
todas as sequências viáveis. O front já valida os campos e mostra os valores na
ordem hoje / futuro / ano seco, sem mudar os três critérios de seleção. A API
continua repassando as tabelas e a saída diretamente. Os testes do terceiro cenário
usam dados sintéticos de contrato, não uma análise real de 2020/21.

**D2 — Dev 1:** fornecer `data/clima_modelos.csv` com os deltas mensais por modelo.
O leitor já calcula chuva anual e média dos 12 deltas de máxima, e a interface
deriva os extremos e a discordância do sinal da chuva. Não foram gerados dados
nem fixadas na tela as faixas citadas no plano. Reiniciar a API após a entrega.

**D1 — Dev 1:** fornecer a função de clima por latitude/longitude e a proveniência
dos dados (incluindo o eventual plano B). Ainda não há essa função nem
`docs/plano_outros_locais.md` na base consultada. A API aceita `lon`, mas continua
usando as tabelas fixas e informa `point_climate_available: false`. G5 não deve ser
apresentado como concluído para outras fazendas.

Detalhes técnicos em [API.md](API.md). Evidências e limites dos testes em
[VALIDACAO.md](VALIDACAO.md).

## Abrir localmente

Em `D:\NasaSpaceApps\frontend`, execute `npm run preview` para a versão compilada,
ou `npm run dev` durante o desenvolvimento. Ambos iniciam a API e a interface em
`http://127.0.0.1:4173/`; Ctrl+C encerra os dois processos.

## Limites da validação local

- **Docker:** o Docker Desktop foi iniciado, mas o WSL2 falhou com
  `HCS_E_HYPERV_NOT_INSTALLED`. A imagem ainda precisa de build e execução em um
  ambiente com virtualização disponível; os arquivos de contexto já estão no
  Dockerfile. Não foram alterados recursos do Windows nem a BIOS.
- **Leitor de tela:** NVDA 2026.3.1 portátil foi preparado a partir da distribuição
  oficial, com assinatura válida. O controle do navegador foi encerrado pela
  ferramenta por não conseguir confirmar a URL da janela. A leitura e a ativação
  pelo NVDA não foram verificadas. A evidência de G6 permanece limitada ao
  teclado e à árvore de acessibilidade descritos acima.

Esses dois pontos não devem ser marcados como validados apenas porque os testes
automatizados passaram. Não houve publicação de um serviço de produção.
