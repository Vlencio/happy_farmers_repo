# Happy Farmers · front-end Rune

Fluxo de fazenda → contexto e prioridades → melhores pontuações → linha do tempo.
A interface principal é Rust/Rune com `rune-kit`. O adaptador em `../backend/` usa
Python/FastAPI para chamar o motor existente, seguindo `../docs/contrato_motor.md`.
As regras agronômicas continuam em `../motor/`, sem alterações feitas por esta integração.

## Abrir neste computador

O ambiente e o WebAssembly já foram preparados e compilados:

```powershell
cd D:\NasaSpaceApps\frontend
npm run dev
```

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173). O comando inicia Vite e FastAPI;
`Ctrl+C` encerra os dois. A API também oferece [OpenAPI](http://127.0.0.1:8000/docs).
O servidor de verificação da implementação é temporário; execute o comando acima para usar o app.

## Em um clone novo

Pré-requisitos: Python 3.11+, Git, Node.js 22.12+ e [Rust via rustup](https://rust-lang.org/tools/install/).
No Windows, o toolchain MSVC requer as ferramentas de C++ do Visual Studio.
O arquivo `rust-toolchain.toml` fixa Rust **1.99.1**, `rustfmt` e o target `wasm32-unknown-unknown`.

```powershell
# Na raiz do repositório:
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
cd frontend
npm ci
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run build:release
npm run preview
```

Se `cargo` não estiver no PATH da sessão, abra outro terminal após instalar Rust
ou use `$env:USERPROFILE\.cargo\bin\cargo.exe`.
O build também aceita a variável `WASM_BINDGEN` com o caminho do executável **0.2.129**.
Neste computador, há uma cópia oficial dessa CLI em `.tools/`, usada automaticamente.
Nenhum binário, cache ou `node_modules` precisa ser versionado.

## Revisão e patches

- Repositório: [anomalyco/rune](https://github.com/anomalyco/rune).
- Revisão fixa: `56f01cb88e629db2c8b8877631cde00de7f37bd5`, em `rune-revision.json`.
- Referências: [examples/hello](https://github.com/anomalyco/rune/tree/56f01cb88e629db2c8b8877631cde00de7f37bd5/examples/hello),
  [examples/web-hello](https://github.com/anomalyco/rune/tree/56f01cb88e629db2c8b8877631cde00de7f37bd5/examples/web-hello)
  e [README / Depending on Rune](https://github.com/anomalyco/rune/blob/56f01cb88e629db2c8b8877631cde00de7f37bd5/crates/rune/README.md#depending-on-rune).
- `setup-rune.mjs` busca **o SHA exato**, sem seguir `main`, e aplica o patch versionado de forma idempotente.
- Os quatro patches exigidos pelo Rune estão no manifesto raiz: `winit`, `parley_engine`, `wgpu-hal`, `accesskit_windows`, todos vindos desse checkout.
- Patch adicional `patches/rune-wasm-instance-cache.patch`: a revisão original guarda `wgpu::Instance` em um `static Mutex`, incompatível com os handles não `Send`/`Sync` do navegador. A correção usa `thread_local!` apenas em WASM e preserva o caminho nativo. Não usa `unsafe` nem o recurso `fragile-send-sync-non-atomic-wasm`.
- `Cargo.lock` e `package-lock.json` fixam as demais dependências. Não altere `.cache/rune` manualmente.

O build web usa fontes embutidas, WebGPU e fallback WebGL/CPU do Rune. Não exige WebGPU para abrir.
O Rune emite avisos de código nativo não utilizado no target web; não foram feitas alterações gerais na biblioteca para suprimi-los.

## O que está implementado

- Mapa satélite com desenho, edição de vértices, busca por coordenadas e localização opcional do dispositivo.
- Importação de Geometry, Feature ou FeatureCollection de **uma** fazenda, com Polygon/MultiPolygon em WGS84.
- Validação de coordenadas, fechamento, cruzamentos, anéis internos, área e limites de tamanho (2 MB / 5.000 vértices).
- Prévia, área aproximada em hectares e download do GeoJSON; furos e partes de MultiPolygon são preservados no arquivo.
- Prévia de satélite no cartão “A sua fazenda”, com o contorno confirmado sobre a mesma imagem Esri do editor. Atualiza ao desenhar/importar outra área, restaurar o rascunho ou redimensionar a tela; a edição continua no mapa completo.
- Histórico opcional com catálogo do motor, safra/ano e observação. Até 12 registros, com inclusão, remoção e reordenação.
- Mês em que o talhão fica livre e horizonte de uma ou duas culturas.
- Prioridades de água, solo e renda entre 0 e 3, iniciando em 1/1/1; tudo em zero usa pesos iguais. Nos resultados, mudar uma prioridade refaz a análise e reinicia o chat.
- Controles “Simule outro clima”: chuva de −50% a +30% e temperatura de 0 a +4 °C, com persistência, aplicação e reset. Aguardam a API anunciar `capabilities.ajuste: true`; hoje ficam indisponíveis. Resultados ajustados são identificados como hipóteses (Parte 6 em `docs/API.md`).
- Até três cards na ordem do ranking de hoje devolvido pelo motor, com posição e score de hoje/futuro. Não escolhe vencedores por objetivo nem recalcula o ranking (Parte 5 em `docs/API.md`).
- Referência da rotação atual junto dos três cards, com receita, solo e encaixe comparáveis e acesso ao calendário. Consome o campo `atual` do motor, inclusive com histórico maior que o horizonte; sem histórico ou fora do calendário, mostra a explicação correspondente (Parte 1 em `docs/API.md`).
- Solo entre as culturas: dias expostos e chuva nos cards, calendário mensal com cultura/palhada/exposição e comparação de chuva hoje/futuro/ano seco nos primeiros 365 dias. O índice de erosão é exibido quando recebido; a API aceita a declividade enviada para o contorno exato da demonstração (Parte 2 em `docs/API.md`).
- Riscos e lacunas por estratégia, inclusive na rotação atual: resumo separado nos cards e todos os avisos com cultura, cenário e dados do motor no detalhe. Lista vazia e resposta antiga sem avisos têm mensagens diferentes (Parte 3 em `docs/API.md`).
- Benefícios recebidos do motor: resumo nos cards e lista com contexto e evidências no detalhe, junto dos riscos e lacunas.
- Chat opcional sobre a análise, exibido apenas com `capabilities.chat: true`. Envia os IDs dos cards e da referência viável, a resposta original da análise e o histórico da conversa a cada pergunta. Oferece cancelamento, nova conversa e tratamento de falhas sem perder os resultados.
- Linha do tempo com as culturas, espera, plantio/colheita e tabela mensal de água, comparando hoje/futuro.
- Calendários que atravessam dezembro e podem exceder 12 meses; tratamento de resultado vazio e motivos de descarte.
- Rascunho local, recuperação ao recarregar, estados de erro e cancelamento de chamadas ao motor.
- Layouts para desktop e tela pequena. A edição no mapa só altera o planejamento quando confirmada.
- Painel “Seu talhão”: NDVI mensal, frequência de solo descoberto/palhada, declividade e correções da INMET A520, exclusivamente para o contorno de demonstração.
- Glossário e avisos sobre preços, calor, constantes provisórias e resolução das fontes.
- Ano seco real (2020/21) ligado para a demonstração. D2 foi entregue em `dados-calor` (`5deed52`), ainda pendente de merge: o painel consome a faixa climática dos modelos para o contorno de demonstração. Faixas de receita e rank por estratégia continuam dependendo do motor/API da Parte 7.
- POWER por ponto com delta regional de Minas, cache diário e avisos de origem/fallback/cobertura; veja o [estado do plano](docs/PLANO_GAP.md).

## Motor e API

O app chama `/api/analyze`, por proxy para a API local. A resposta é a saída do motor
sem recalcular os números, acrescida de `origem` quando há longitude; a interface mostra as três primeiras sequências do ranking de hoje.
Não há demonstração fictícia automática. As fixtures do motor são usadas só nos testes.

Para usar outro serviço compatível, copie `.env.example` para `.env` e configure:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Use `npm run dev:web` com a API externa. Reinicie Vite; para distribuição, gere o build novamente.
A interface valida o contrato descrito em [docs/API.md](docs/API.md). Há mensagens de erro,
timeout de 6 minutos e cancelamento. Mudanças de contorno, histórico ou opções invalidam a análise anterior.

O contorno fornece latitude e longitude aproximadas. Fora do raio de 25 km da
demonstração, a API consulta o POWER desse ponto e usa o delta regional do NEX-GDDP.
Falha do POWER usa as tabelas de demonstração com aviso explícito. Fora de Minas,
dentro da grade, há aviso de análise exploratória; fora da grade, há erro de cobertura. A área
multiplica a receita por hectare. Safra/ano e observações ficam salvos localmente,
pois o contrato recebe somente a ordem das culturas. Receita não desconta custos e
os índices não são probabilidades nem medições de solo.

Para iniciar apenas a API, da raiz:

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

O rascunho fica no `localStorage` deste navegador e não é uma conta ou backup remoto.
O chat não entra no rascunho: fica só em memória e reinicia ao mudar o planejamento
ou analisar novamente. Ao enviar uma pergunta, a API repassa à **Anthropic** a
pergunta, a conversa e os dados da análise em foco, incluindo coordenadas,
histórico de culturas, clima mensal e números das estratégias. Essa informação
também aparece no painel antes do envio. As credenciais são configuradas somente
no servidor, conforme [o contrato do chat](../docs/chat.md).
O botão de localização só pede acesso ao dispositivo quando acionado. O mapa usa
Esri World Imagery com atribuição visível e requer internet, inclusive na prévia
do talhão salvo. A imagem não é salva no rascunho. Se o satélite falhar, o contorno
continua visível com um aviso. Não há geocodificador externo.

## Desenvolvimento e verificação

```powershell
npm run build:wasm              # após alterar Rust; recarregue a página
npm run dev                    # mudanças em JS/CSS recarregam pelo Vite
npm test                       # geometria, contrato, erros e cancelamento
npm run test:rust              # validação de safras, sem compilar um app nativo
npm run test:integration       # 24 combinações contra os serviços já ativos
npm run build:release          # WASM otimizado + arquivos estáticos em dist/
npm run preview                # conferir a distribuição
```

Principais arquivos:

| Arquivo | Responsabilidade |
|---|---|
| `src/lib.rs` | Estado, eventos e ponte Rune ↔ navegador |
| `src/ui.rs` | Layout, componentes rune-kit, cards e timeline |
| `src/model.rs`, `src/season.rs` | Tipos de dados e validação de safra |
| `web/map.mjs`, `web/geometry.mjs` | Mapa, edição, importação e GeoJSON |
| `web/farm-preview.mjs`, `web/preview-layout.mjs`, `web/imagery.mjs` | Imagem de satélite do resumo, projeção compartilhada de contorno/tiles e fonte do mapa |
| `web/main.mjs` | Arquivos, rascunho e coordenação assíncrona |
| `web/api.mjs` | Contrato e cliente HTTP para FastAPI |
| `web/scenario.mjs` | Validação, confirmação do ajuste retornado e texto do cenário hipotético |
| `web/warnings.mjs` | Validação e apresentação dos riscos e lacunas de cada sequência |
| `web/benefits.mjs` | Validação e apresentação dos benefícios entregues pelo motor |
| `web/chat.mjs` | Cliente HTTP e conversa em memória vinculada à análise atual |
| `web/field.mjs` | Correspondência do contorno e apresentação dos dados do talhão |
| `../backend/app.py` | Transporte HTTP para o motor, catálogo e validação de entrada |
| `../backend/field_context.py` | Leitura dos CSVs de contexto e deltas opcionais por modelo |
| `../backend/point_climate.py` | Seleção da célula regional, ligação com D1 e avisos de origem/cobertura |
| `tests/fixtures/` | Saída real exportada do motor para testes |

Testes Python, da raiz:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -m unittest discover tests -v
```

Verificação registrada em [docs/VALIDACAO.md](docs/VALIDACAO.md). Celular físico e
leitores de tela ainda precisam de validação própria.

A rodada de [QA de 14/11/2026](docs/QA_2026-11-14.md) registra correções de teclado,
acessibilidade, rascunhos e mapa, além de três cenários reproduzíveis de navegador.
O patch `patches/rune-web-accessibility.patch` acompanha a revisão fixada de Rune
e é aplicado pelo mesmo setup dos demais patches.

Testes e build/execução da imagem Docker são automatizados no GitHub Actions para
`main` e `front-dev3`; configuração, escopo e comandos em [docs/CI.md](../docs/CI.md).
