# Verificação da integração · 14/11/2026

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
