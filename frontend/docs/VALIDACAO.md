# Verificação da integração · 14/11/2026

## Atualização — tarefas de Gabriel no plano de lacunas

Base `origin/main` em `c54fe17`, entrega na branch `front-dev3`. As seções abaixo
desta atualização registram a integração anterior; os números desta seção são os
da nova implementação.

- Build final `node scripts/build.mjs --release` concluído, com Rune/rune-kit e
  os patches na mesma revisão fixada. `cargo fmt --check` passou.
- `npm test`: **26 passaram**. Além dos casos anteriores: seleção comercial e
  fallback climático, outubro/fevereiro reais, campos de calor, longitude,
  terceiro cenário opcional/completo, rejeição de calendário ou métricas inválidas,
  identidade do contorno, não exposição dos dados em outro polígono e faixa de modelos.
- `npm run test:rust`: **1 passou**.
- `python -m unittest discover -s backend/tests -v`: **11 passaram**. Inclui
  metadados lidos dos arquivos reais, limites de longitude, repasse de tabelas
  opcionais, ausência de dados e agregação/validação dos deltas por modelo.
- `python -m unittest discover tests -v`: **29 testes do motor passaram**, sem
  alterações nos testes ou no motor. O `pytest` não está instalado nesse ambiente;
  não se está repetindo a contagem de 33/4 pulados citada no plano.
- `npm run test:integration`: **24 combinações passaram** contra API e proxy reais,
  incluindo os vencedores climáticos de outubro/fevereiro. Sete combinações sem
  sequência viável; cinco timelines selecionadas maiores que 12 meses.
- Entrada `deploy.serve` verificada com TestClient: HTML, loader WASM, GeoJSON,
  metadados e análise responderam corretamente. Conferência complementar por
  HTTP em `127.0.0.1:4180`, com bundle compilado usando `VITE_API_BASE_URL=/`:
  HTML, assets JS/CSS, loader e binário WASM, GeoJSON, `/health` e `/metadata`
  responderam corretamente. As **24 combinações** também passaram nessa entrada,
  sem o proxy Vite. O bundle local voltou ao modo padrão `/api` após a conferência.
  Dockerfile e exclusões atualizados;
  imagem Docker **não compilada**: ao iniciar o Docker Desktop, o WSL2 retornou
  `HCS_E_HYPERV_NOT_INSTALLED`, sem conseguir iniciar o daemon. Não foram
  alterados recursos do Windows nem a BIOS. Logs locais e ferramentas de QA
  ficam excluídos do contexto Docker.

No navegador, distribuição compilada em **1280 × 720** e **390 × 844**:

- Soja → Sorgo confirmado no card climático; detalhes da segunda cultura exibiram
  encaixe e dias de calor vindos do motor.
- Painel reconheceu tanto o GeoJSON de demonstração importado no rascunho existente
  quanto a área aberta pelo botão de exemplo. NDVI, frequências, relevo e A520 visíveis.
- Gráfico mensal com rolagem horizontal até dezembro em tela pequena; textos sem
  transbordamento. Glossário expandido, com os seis termos e avisos.
- G6: reproduzida ausência de ação com Enter quando o botão tinha o foco interno do
  Rune; Espaço e a ação acessível já funcionavam. Após o ajuste, navegação com Tab
  até o exemplo, foco visível e Enter abriram o mapa. Escape, foco inicial no botão
  de fechar, Tab entre controles nativos e confirmação da área foram exercitados.
- O teste de início vazio usou `localhost`, separado do rascunho existente em
  `127.0.0.1`; nenhum histórico do usuário foi removido.
- Nenhum erro no console da aba de teste final.

Capturas ignoradas pelo Git em `test-results/`: `gap-cards.jpg`, `gap-talhao.jpg`,
`gap-mobile.jpg`, `gap-example-focus.jpg` e `gap-example-enter.jpg`.

Limites desta rodada: P1/D2 ainda ausentes, então ano seco e faixa entre modelos
foram testados como extensões de contrato, sem prova de análise real em três cenários.
Clima por ponto aguarda D1. Acessibilidade verificada por foco/teclado/árvore, sem
escuta com NVDA/Narrador ou auditoria completa; celular físico também não testado.
Na tentativa complementar, NVDA 2026.3.1 portátil foi preparado a partir da
distribuição oficial, com assinatura válida da NV Access. O controle do navegador
foi encerrado pela ferramenta porque não conseguiu confirmar a URL da janela;
não houve teste de leitura ou ativação pelo NVDA. Nenhum ajuste de acessibilidade
do sistema foi feito para contornar esse bloqueio.
Avisos de código não utilizado do Rune, bundle JS acima de 500 kB e depreciação do
TestClient permanecem; não impediram build nem execução.

## Registro anterior da integração

## Ambiente e contrato

- Windows, Python 3.13, Node 22.12.0, npm 10.9.1, Rust 1.99.1/MSVC.
- Rune/rune-kit continuam em `56f01cb88e629db2c8b8877631cde00de7f37bd5`, com os quatro
  patches de dependência e o patch local do cache WASM.
- Contrato e motor da Main em `f75c784`; integração criada sobre `front-dev3`, que
  já continha a interface Rune e essa versão da Main.
- Build otimizado WASM + Vite concluído; `cargo fmt --check` e `git diff --check` passaram.
- Launcher testado: inicia FastAPI e Vite preview, responde HTML/health e encerra os
  dois serviços com Ctrl+C. Reinício na mesma porta confirmado.
- Nenhuma alteração em `motor/`, `data/`, scripts de coleta ou testes originais do motor.
  O motor foi executado para analisar os dados existentes; nenhum download de dados foi feito.

## Testes automatizados

- `npm test`: **18 testes passaram**. Inclui os seis testes GeoJSON existentes,
  contrato real exportado do motor, catálogo e acentos, ordem do histórico,
  culturas não suportadas, seleção por objetivo, receita × área, passagem por
  dezembro, balanço mensal, resposta vazia/inválida, erros HTTP/JSON e cancelamento.
- `npm run test:rust`: **1 teste passou**, formatos de safra/ano.
- `python -m unittest discover -s backend/tests -v`: **6 testes passaram**.
  Igualdade entre HTTP e chamada direta ao motor, catálogo da tabela, validação,
  uma cultura, prioridades parciais e CORS.
- `python -m unittest discover tests -v`: **25 testes existentes do motor passaram**.
- `npm run test:integration`: **24 combinações de mês/horizonte passaram**, usando
  HTTP via proxy Vite e o motor real. Sete respostas não tinham sequência viável;
  seis timelines selecionadas excediam 12 meses. Contagens, histórico enviado,
  quantidade de etapas e posição dos meses foram conferidos.

## Verificação no navegador

Interação e revisão visual com a distribuição compilada, em 1440 × 900 e 390 × 844:

- Rascunho da versão anterior restaurado com GeoJSON de aproximadamente 219,16 ha.
- Catálogo real, seleção de Crotalária, inclusão de histórico e análise com/sem contexto.
- Dois registros reordenados por setas; a nova ordem permaneceu ao recarregar.
- Opções de fevereiro/uma cultura e outubro/duas culturas alteraram os resultados.
- Outubro/duas, sem histórico: cards Soja → Milho, Soja → Crotalária e Soja → Girassol.
- Abertura dos três caminhos; troca para a segunda cultura atualizou calendário e números.
- Balanço de água mensal com hoje/futuro, incluindo rolagem horizontal em tela pequena.
- Abril/uma cultura: nenhum card inventado, aviso de ausência de sequência viável e
  nove motivos de descarte expansíveis.
- Períodos 2005–2024 / 2041–2060 e limitação geográfica visíveis na versão final.
- Registros criados para o teste removidos; contorno preservado, opções retornadas a outubro/duas.

Capturas locais, ignoradas pelo Git: `test-results/motor-cards.jpg`, `motor-water.jpg`,
`motor-empty.jpg` e `motor-mobile.jpg`. A captura dos cards foi atualizada após o build final.

Desenho, edição/importação e download com coordenadas preservadas já tinham sido
verificados na primeira versão. Esses módulos não foram modificados nesta integração;
os testes automatizados de geometria foram executados novamente.

## Limites

- Verificação de integração e apresentação, não validação científica das regras do motor.
- As tabelas continuam fixas ao talhão de demonstração; não há coleta climática por GeoJSON.
- Não houve teste em celular físico, Safari/iOS ou auditoria completa de acessibilidade.
  O Select e os campos de texto do runtime Rune ainda precisam de revisão com leitores de tela.
- Não foram exercitados separadamente todos os fallbacks gráficos do Rune.
- O build mantém avisos do Rune sobre código não utilizado no alvo web. O TestClient
  emite aviso de depreciação de httpx; os testes e a API concluíram normalmente.
