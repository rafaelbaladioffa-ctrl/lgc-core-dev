# P01 — jornada demonstrada com API simulada

02/11/2026. Marco de implementação; aceite integral A01–A24 e P02 continuam bloqueados.

## Percurso executado

`frontend/tests/draft.test.tsx` usa Vitest, jsdom e React Testing Library. O teste de percurso abre o catálogo, cria o rascunho, edita apenas o título, salva, desmonta a tela, retoma a versão fixa v1 após mudar o catálogo para v2, envia arquivo, envia o pedido, assume/conclui triagem e execução e encerra manualmente. São eventos reais sobre os componentes usados pela aplicação, com API simulada.

Outros cenários DOM: false/zero/decimal/data/select; primeira resposta pendente com nova edição; versão inicial 7; StrictMode; troca/desmontagem; retry de save com payload/key idênticos; 409 preservando dados e interrompendo autosave; campos read excluídos do PATCH; upload múltiplo independente; erro/retry de upload preservando bytes/key; envio após save; resposta perdida na transição.

## Implementação

- Editor montado após GET, com chave por registro. Schema da versão fixada filtrado no backend; campos read desabilitados e omitidos do PATCH.
- `useDraftAutosave.ts`: snapshot completo de título/descrição/fields, fila serial coalescida, revisão retornada, flush aguardável antes das transições, estado de conflito e replay da mesma tentativa de rede.
- Rota de detalhe preserva controles por status/allowedActions: assumir, concluir, liberar, cancelar, encerrar. Anexos, comentários e timeline têm controles visíveis.
- Upload processa todos os arquivos e não recarrega o formulário sobre edições locais. Inclusões geram arquivos independentes v1; substituição explícita usa previousId e preserva os bytes anteriores. Retry usa a mesma tentativa e receipt.
- Backend: transações/receipts para criar, salvar, anexar e encerrar; locks na leitura de receipt dos comandos por registro. PATCH faz merge protegido/CAS e devolve projeção. Cliente envia Idempotency-Key no PATCH; controller confere consistência com o payload.
- Runner DOM e dependências de desenvolvimento instalados com lockfile atualizado. O teste SSR anterior permanece auxiliar; não é contado como interação DOM.

## Comandos/resultados

Em frontend: `npm run test:journey` — **13 testes DOM passaram**; `npm run build` — passou.

Em backend: `npx tsc -p tsconfig.build.json --noEmit --pretty false` e `npx prisma validate` — passaram. `npm test -- --run src/request-runtime/p01-regression.spec.ts src/request-runtime/draft-commands.spec.ts src/request-runtime/attachments.spec.ts` — **18 testes passaram**. Os novos testes verificam replay/CAS/merge protegido e inclusão/substituição/replay de anexos BYTEA com persistência simulada.

`npm run test:e2e -- test/bpm-persistence.e2e-spec.ts` — **2 testes não executados**, por ausência de BPM_TEST_DATABASE_URL. Harness preparado para unicidade entre dois clientes/reconexão e rollback de receipt, usando somente registros próprios e banco local com sufixo _bpm_test. Não provisiona nem aplica migrations. A conexão a 127.0.0.1:5432 foi recusada.

## Arquivos deste marco

Frontend: `BpmDraftEditorPage.tsx`, `BpmPages.tsx`, `DynamicForm.tsx`, `useDraftAutosave.ts`, `api.ts`, `tests/draft.test.tsx`, `vitest.config.ts`, `package.json` e `package-lock.json`.

Backend: `request-runtime.service.ts`, `request-runtime.controller.ts`, `dto.ts`, `p01-regression.spec.ts`, `draft-commands.spec.ts`, `attachments.spec.ts`, `test/support/bpm-test-database.ts`, `test/bpm-persistence.e2e-spec.ts`.

## Ainda aberto no P01

Homologação HTTP/PostgreSQL/Playwright com personas e concorrência real; ensaio e proteções completas de migration/versões; A01–A24; protocolo uniforme obrigatório/header para todos os escritores (incluindo comentário/cancel/configuração); paginação/ETag/contratos; matriz completa de política por ator/etapa/terminal; inbox/fila, reatribuição/incidentes e administração completa (metas/opções/preview/clone). O harness PostgreSQL preparado cobre dois cenários de persistência e ainda não toda essa matriz. Nenhum compose, seed operacional ou banco existente foi usado.
