# Fixtures do contrato

`motor.json` e `metadata.json` foram exportados do motor e das tabelas locais na
revisão `f75c784`, com latitude -20.032, histórico soja/milho, mês 10 e horizonte 2.
São usados apenas nos testes; a interface chama a API real.

Para regenerar, da raiz, após atualizar o motor ou os dados:

```powershell
.\.venv\Scripts\python.exe -m backend.export_fixture
```

O comando não baixa nem modifica tabelas.
