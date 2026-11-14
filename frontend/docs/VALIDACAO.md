# Verificação local · 14/11/2026

## Ambiente e builds

- Windows, Node 22.12.0, npm 10.9.1, Rust 1.99.1/MSVC.
- Rune/rune-kit `56f01cb88e629db2c8b8877631cde00de7f37bd5`.
- Quatro patches de dependência do Rune e o patch local do cache WASM aplicados.
- Build WASM de desenvolvimento e `npm run build -- --release` concluídos.
- Distribuição Vite servida localmente; HTML respondeu 200 e WASM com `application/wasm`.
- `cargo fmt --check` e `git diff --check` sem problemas.

## Testes automatizados

- `npm test`: **11 testes passaram**.
  - GeoJSON do projeto, área, furos e MultiPolygon.
  - JSON inválido, coordenadas projetadas/não finitas, anéis abertos, cruzamentos, áreas nulas e múltiplas fazendas.
  - Limites de tamanho/vértices, furos fora do contorno e áreas excluídas sobrepostas.
  - Três objetivos distintos, rejeição de respostas incompletas, montagem do POST, HTTP/JSON inválidos e propagação de cancelamento.
- `npm run test:rust`: **1 teste passou**, cobrindo formatos válidos/inválidos de safra, inclusive virada de século.

Os testes de API usam transporte controlado, sem executar um backend ou motor agronômico real.

## Uso no navegador

Revisão visual e interação real no navegador integrado, com viewport de desktop (1440 × 900)
e tela pequena (390 × 844):

- Abertura da interface Rune, formulários e navegação.
- Carregamento de imagem satélite, desenho de quatro vértices e conclusão do polígono.
- Importação do GeoJSON do projeto: aproximadamente **219,16 ha**, 15 vértices.
- Edição de vértice: a área mudou na prévia; fechar sem confirmar preservou a área anterior.
- Download: geometria exportada comparada ao arquivo original, com **coordenadas idênticas** após a importação.
- Rejeição de um GeoJSON do tipo Point, com erro visível e recuperação por nova importação.
- Inclusão de soja/2025–26 com observação, recuperação após recarregar e remoção do registro.
- Continuação com e sem histórico.
- Três cards e abertura das três timelines; troca de etapa atualiza período, descrição, água, solo e risco.
- Layouts empilhados, rolagem dos formulários, mapa e detalhes em viewport pequeno.
- Confirmação de recomeço visível mesmo no final da página em tela pequena; cancelar mantém o rascunho.

Capturas locais da versão final: `test-results/desktop-cards.jpg` e `test-results/mobile.jpg`
(artefatos de verificação, ignorados pelo Git).

## Limites desta verificação

- Nenhuma recomendação real foi calculada: todos os resultados vêm da fixture marcada como demonstração.
- O contrato precisa ser acordado com o responsável pelo FastAPI e testado contra o serviço real.
- Viewport pequeno não substitui teste em celular físico, gestos reais de toque ou Safari/iOS.
- Os caminhos de fallback gráfico do Rune não foram todos exercitados separadamente.
- Acessibilidade completa ainda não foi auditada: o runtime web expõe a navegação principal,
  mas campos de texto e o menu do Select precisam de revisão com leitores de tela.
- O Rune gera avisos de código não utilizado no build web. O Geoman também emitiu avisos de listener
  durante algumas operações; os fluxos de desenho/edição foram verificados funcionalmente.
- Mapas dependem do serviço externo de imagens. Não há cache offline ou consulta a um motor nesta entrega.

Os problemas encontrados na primeira passagem (importação do WASM pelo Vite e chamada de conclusão
do desenho) foram corrigidos e os respectivos fluxos foram repetidos com sucesso.
Os scripts de coleta de dados e o motor não foram alterados ou executados.
