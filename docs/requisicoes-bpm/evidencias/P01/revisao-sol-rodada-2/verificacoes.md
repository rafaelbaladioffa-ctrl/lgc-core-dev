# Verificações executadas por Sol — rodada 2

Data: 01/11/2026 (America/Sao_Paulo).

## Suite fornecida pela implementação

Diretório: backend. A primeira tentativa de Vitest falhou por EPERM no rename do cache em TEMP do sandbox, antes de executar testes. Segunda tentativa, redirecionando apenas TEMP/TMP do processo para uma pasta gravável de revisão:

```powershell
$bpmReviewTemp = Join-Path (Resolve-Path '../docs/requisicoes-bpm/evidencias/P01/revisao-sol-rodada-2').Path '.tmp-vitest'
New-Item -ItemType Directory -Path $bpmReviewTemp -Force | Out-Null
$env:TMP = $bpmReviewTemp
$env:TEMP = $bpmReviewTemp
.\node_modules\.bin\vitest.cmd run src/request-runtime/p01-regression.spec.ts --reporter=verbose
```

Resultado: Vitest 4.1.12, 1 arquivo passou, **4 testes passaram**, exit code 0. Não houve execução de migration, banco, servidor ou navegador. Typecheck/build não foram repetidos nesta revisão.

## Verificações independentes do código atual

```powershell
node docs/requisicoes-bpm/evidencias/P01/revisao-sol-rodada-2/checks.cjs
```

Exit code 0 significa que o harness executou e registrou observações, não que a aplicação passou nos cenários. [results.json](results.json) mostra os dez casos; T01–T09 contêm defeitos atuais e T10 confirma correções de data/whitespace/string decimal, tipo de nó e feriado. Sem banco/HTTP, não provam concorrência nem constraints de PostgreSQL.
