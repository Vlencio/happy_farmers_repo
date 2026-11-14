# Happy Farmers · front-end Rune

Primeira versão funcional do fluxo de fazenda → contexto → três caminhos → linha do tempo.
A interface principal é Rust/Rune com `rune-kit`. Python/FastAPI continua sendo o backend previsto.
O motor agronômico não faz parte desta implementação.

## Abrir neste computador

O ambiente e o WebAssembly já foram preparados e compilados:

```powershell
cd D:\NasaSpaceApps\frontend
npm run dev
```

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173). `Ctrl+C` encerra o servidor.
O servidor de verificação da implementação é temporário; execute o comando acima para usar o app.

## Em um clone novo

Pré-requisitos: Git, Node.js 22.12+ e [Rust via rustup](https://rust-lang.org/tools/install/).
No Windows, o toolchain MSVC requer as ferramentas de C++ do Visual Studio.
O arquivo `rust-toolchain.toml` fixa Rust **1.99.1**, `rustfmt` e o target `wasm32-unknown-unknown`.

```powershell
cd frontend
npm ci
cargo install wasm-bindgen-cli --version 0.2.129 --locked
npm run build -- --release
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
- Histórico opcional com cultura, safra/ano e observação. Até 12 registros, com inclusão/remoção e validação de safra.
- Três cards: maior renda, saúde do solo e resiliência climática.
- Linha do tempo de cada alternativa, meses relativos, etapas selecionáveis, água/clima, solo/manejo e pontos de atenção.
- Rascunho local, recuperação ao recarregar, estados de erro e cancelamento de chamadas ao motor.
- Layouts para desktop e tela pequena. A edição no mapa só altera o planejamento quando confirmada.

## Demonstração e API

Sem `VITE_API_BASE_URL`, o app usa `web/demo.mjs`: respostas fixas para testar a experiência.
Os valores, culturas, janelas e benefícios **não são calculados para a área**. A receita do exemplo
é bruta e não representa lucro. Não há consultas aos dados NASA ou pontuação escondida no front-end.

Para integrar o motor, copie `.env.example` para `.env` e configure:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Reinicie Vite; para a distribuição, gere o build novamente. A interface passa a chamar `POST /analyze`
e valida a resposta descrita em [docs/API.md](docs/API.md). Falhas não viram resultados fictícios:
há mensagem de erro, timeout de 45 segundos e cancelamento. Mudanças no contorno/histórico invalidam a análise anterior.

O rascunho fica no `localStorage` deste navegador e não é uma conta ou backup remoto.
O botão de localização só pede acesso ao dispositivo quando acionado. O mapa usa
Esri World Imagery com atribuição visível e requer internet. Não há geocodificador externo.

## Desenvolvimento e verificação

```powershell
npm run build:wasm              # após alterar Rust; recarregue a página
npm run dev                    # mudanças em JS/CSS recarregam pelo Vite
npm test                       # geometria, contrato, erros e cancelamento
npm run test:rust              # validação de safras, sem compilar um app nativo
npm run build -- --release     # WASM otimizado + arquivos estáticos em dist/
npm run preview                # conferir a distribuição
```

Principais arquivos:

| Arquivo | Responsabilidade |
|---|---|
| `src/lib.rs` | Estado, eventos e ponte Rune ↔ navegador |
| `src/ui.rs` | Layout, componentes rune-kit, cards e timeline |
| `src/model.rs`, `src/season.rs` | Tipos de dados e validação de safra |
| `web/map.mjs`, `web/geometry.mjs` | Mapa, edição, importação e GeoJSON |
| `web/main.mjs` | Arquivos, rascunho e coordenação assíncrona |
| `web/api.mjs` | Contrato e cliente HTTP para FastAPI |
| `web/demo.mjs` | Fixture explicitamente demonstrativa |

Verificação registrada em [docs/VALIDACAO.md](docs/VALIDACAO.md). Integração com motor real,
celular físico e leitores de tela ainda precisam de validação própria.
