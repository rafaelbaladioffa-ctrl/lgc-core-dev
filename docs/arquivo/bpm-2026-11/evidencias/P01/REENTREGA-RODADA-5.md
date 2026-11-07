# P01 — jornada, política e SLA: checkpoint

Revisado por Sol: **checkpoint técnico parcial; não houve avanço nas telas BpmPages.tsx; continuar P01**, conforme [relatório e próximo marco de rascunho](revisao-sol-rodada-5/REVISAO.md). Correções pontuais confirmadas, com ajustes E02/E04/E05 e jornada/suites ainda abertos. Relato original preservado abaixo.

Data: 2026-11-02

P01 permanece em implementação; P02 não foi iniciado.

## D03–D05 fechados no backend

- `saveDraft` agora rejeita campos `hidden/read/readonly` ou sem write e devolve DTO projetado, não o modelo Prisma bruto.
- Cancelamento não exige mais `request:create` no controller: o serviço aceita autor com create ou gestor com update dentro do escopo da fila.
- Projeção de campos e visibilidade de anexos usam a mesma política: acesso global e regras dos nós ativos; documento oculto retorna 404 também por URL direta.
- O fallback de `listCollaborators` para cliente Prisma incompleto foi removido; produção usa somente `User.findMany` com `userId` e `Collaborator.id`.

## Jornada adicional implementada

- API/UI passaram a expor timeline, comentários, anexos, release e reassign.
- Clocks agora calculam consumo de segundos em horário útil ao parar, atualizam `elapsedSeconds` e marcam `breachedAt` quando o orçamento é atingido.
- A definição publicada continua sendo a fonte das metas SLA.

## Verificações

- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- `npm run build` frontend: passou.
- Suíte P01: 12/12 testes passou.
- Checks da rodada 4: D01, D02, D03 e D05 confirmam os vetores corrigidos. D04 chega ao fluxo de acesso ao registro no fixture sintético, mas não conclui porque o fixture não fornece `requestAccess`/Prisma completo; não foi usado como prova de aceitação.

Ainda pendentes: protocolo único para todos os escritores e header Idempotency-Key, autosave/edição visual completa, tipos de campo/upload, inbox/fila, comandos visuais completos, preview/clone/opções/metas, paginação/ETag/contratos, migration ensaiada, integração PostgreSQL/Playwright e checklist A01–A24.

Nenhum compose, seed ou dado existente foi usado.
