# Testes e build Docker

A automação está em `.github/workflows/ci.yml`, com duas etapas no GitHub Actions.
Ela roda em pushes para `main` e `front-dev3` e em pull requests para essas branches.
Também aceita execução manual; o botão **Run workflow** fica disponível quando o
arquivo da automação estiver na branch padrão (`main`).

## Testes

Ubuntu 24.04, Python 3.13, Node 22 e a versão Rust de
`frontend/rust-toolchain.toml`. As ações usadas têm revisões fixadas por SHA.

1. Instala `backend/requirements-ci.txt`, incluindo `xarray` e `netCDF4` para
   executar os testes de montagem regional com arquivos sintéticos.
2. Executa os testes de `tests/` e `backend/tests/`.
3. Regenera as fixtures com o motor/tabelas atuais e exige ausência de diferenças
   em `frontend/tests/fixtures/`. Uma entrega nova de dados pode exigir atualização
   dessas fixtures e dos resultados esperados antes de passar na automação.
4. Executa os testes JavaScript, o teste Rust e `cargo fmt --check`.
5. Inicia a API em loopback, verifica catálogo/origem/cenários/cobertura e testa as
   24 combinações de mês e horizonte através do adaptador JavaScript via HTTP.

Os testes usam arquivos versionados, dados sintéticos e simulações do provedor.
Não executam downloads de POWER, NEX-GDDP ou IBGE.

## Docker

Só começa se os testes passarem. O build usa o `Dockerfile` real, compila
Rune/rune-kit para WASM com a revisão e os patches fixados e monta a imagem
`linux/amd64`. O cache de camadas fica no GitHub Actions para os próximos builds.

A imagem é carregada no runner e iniciada com `PORT=8765` e `--network none`.
O teste executado dentro do contêiner verifica:

- API saudável e catálogo atual, incluindo trigo;
- análise da demonstração com hoje/futuro/ano seco e aviso de origem;
- mensagem HTTP 422 para ponto fora da cobertura;
- HTML, CSS, JavaScript e arquivo WASM válido;
- importação do provedor POWER e presença dos 12 deltas de uma célula regional.

O contêiner é encerrado ao final, inclusive em caso de falha. Logs ficam na execução
do Actions. A automação testa a imagem; não publica em registry nem faz deploy.
Usa apenas `contents: read`, sem credenciais de NASA ou de hospedagem. Execuções
antigas da mesma branch/PR são canceladas quando chega uma mais nova.

## Reproduzir localmente

Da raiz, com o ambiente Python e Node preparados:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-ci.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
.\.venv\Scripts\python.exe -m backend.export_fixture
npm test --prefix frontend
npm run test:rust --prefix frontend
```

Para conferir a API já iniciada:

```powershell
.\.venv\Scripts\python.exe -m deploy.check_runtime --api-only
$env:HAPPY_FARMERS_TEST_API = 'http://127.0.0.1:8000'
npm run test:integration --prefix frontend
```

Com Docker funcional, da raiz:

```powershell
docker build -t happy-farmers:ci .
docker run --detach --name happy-farmers-ci --network none --env PORT=8765 happy-farmers:ci
docker exec happy-farmers-ci python -m deploy.check_runtime --url http://127.0.0.1:8765
docker logs happy-farmers-ci
docker rm --force happy-farmers-ci
```

Referências da configuração: [sintaxe do GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax),
[build e teste de imagens](https://docs.docker.com/build/ci/github-actions/test-before-push/)
e [cache de build](https://docs.docker.com/build/ci/github-actions/cache/).
