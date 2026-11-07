# Evidências P01 — implementação Luna

Revisão Sol, rodada 1: **não aceito; ajustes necessários**, conforme [relatório com reproduções e plano de correção](revisao-sol/REVISAO.md). O relato original abaixo permanece como registro da primeira entrega, sem equivaler a aceite técnico ou homologação.

Data da implementação inicial: 01/11/2026 (America/Sao_Paulo). Este README preserva o histórico;
o checkpoint atual está em `A23-A24-20261102.md`.

## Recorte entregue

Foi acrescentado o motor BPM linear `axis-bpm/1` em `/api/v1/bpm`, com configuração de filas/processo/versão, publicação/habilitação, draft/envio, atividade humana de triagem e execução, conclusão, encerramento, cancelamento, comentários, anexos BYTEA, timeline, incidentes de ausência de responsável, recibos idempotentes e locks otimistas. O legado continua identificado por `executionMode=legacy`.

Arquivos novos principais: `backend/src/request-processes/`, `backend/src/request-runtime/`, `backend/prisma/migrations/20261101000000_request_bpm_p01/`, `frontend/src/features/requisicoes-bpm/`. A migration é aditiva; foi ensaiada na cópia descartável e aplicada ao piloto local após backup, sem seed operacional.

## Verificações executadas

| Verificação | Resultado | Evidência |
|---|---|---|
| `npx prisma validate` | passou | schema Prisma válido |
| `npx tsc -p tsconfig.build.json --noEmit` | passou | typecheck do build backend |
| `npm run build` no frontend | passou | bundle Vite gerado |
| `git diff --check` | passou | somente avisos preexistentes de LF/CRLF |
| build Docker backend | passou | imagem `lgc-dev-core-backend:p01-a22-review` |
| PostgreSQL BPM | passou | `p01_20261102_bpm_test`, 13/13 testes de jornada/persistência |
| smoke HTTP autenticado | passou | endpoints legacy/BPM e cadastros retornaram 200; somente leitura |

## A01–A24

O quadro atualizado, com a distinção entre DOM, HTTP, PostgreSQL, visual e homologação, está em
[A23-A24-20261102.md](A23-A24-20261102.md). O checkpoint atual mantém P01 aberto e P02 não liberado.

## Limitações e riscos para revisão

- A migration e os testes PostgreSQL foram executados somente na cópia `p01_20261102_bpm_test`; nenhum banco operacional foi alterado.
- O smoke A24 read-only passou em usuários, papéis, permissões, setores, centros de custo, colaboradores, clientes, projetos, legado e BPM; refresh/troca de senha continuam pendentes em fixture isolada.
- A inspeção visual real de 390px foi bloqueada pela política de URL do navegador; o A23 permanece parcial apesar de 23/23 testes DOM.
- A UI administrativa e a jornada P01 ainda precisam de validação visual/personas, matriz completa de autorização e demais critérios marcados como parciais/não executados no quadro; A10/A12/A13 já possuem cobertura PostgreSQL real.
- A separação legacy/BPM foi corrigida para leitores e jobs identificados; permanece necessária a revisão cruzada de novos leitores antes do aceite integral.
