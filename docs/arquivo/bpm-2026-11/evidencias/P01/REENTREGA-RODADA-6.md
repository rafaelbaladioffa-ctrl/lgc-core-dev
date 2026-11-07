# P01 — checkpoint do percurso de rascunho

Revisado por Sol: **formulário inicial e contratos auxiliares confirmados; percurso ainda incompleto**, conforme [revisão do checkpoint 6](revisao-sol-rodada-6/REVISAO.md). 14 testes backend e sete asserções auxiliares passaram; não são testes de jornada/DOM. O hook ainda permite saves simultâneos e precisa ser corrigido e integrado à edição/upload. Relato original preservado abaixo.

Data: 2026-11-02

P01 continua em implementação; este não é aceite final e P02 segue bloqueado.

## Correções E02/E04/E05

- `saveDraft` faz merge sobre `formData` persistido, preserva campos omitidos e aplica a política de escrita somente às chaves enviadas.
- Cancelamento usa pares coerentes de escopo e permissão: autor + `request:create` ou gestor da fila + `request:update`.
- `breachedAt` usa o instante do deadline (`targetAt`) quando o clock é parado após o orçamento, não o instante tardio da parada.

## Percurso de rascunho implementado

- Novo `DynamicForm.tsx` com tipos P01: texto, textarea, inteiro numérico, decimal textual, data, select por ID, boolean preservando `false` e attachment por seleção de arquivos.
- `useDraftAutosave` com debounce, estados pending/saving/saved/conflict/error e versão esperada.
- Novo pedido usa `DynamicForm`, preserva valores tipados e mantém command IDs estáveis no detalhe.
- Contrato de jornada independente em `frontend/tests/journey.contract.ts`, exercitando false, zero, decimal, date, select por ID, merge protegido e rejeição de escrita protegida.

## Verificações

- `npm run build` frontend: passou.
- `npm run test:journey`: 7 assertions passaram.
- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- Suíte backend P01: 14/14 testes passaram, incluindo merge protegido e deadline de breach.

O marco ainda é parcial: autosave ainda precisa ser ligado ao editor de retomada/detalhe com PATCH real; upload BYTEA/versionamento, resposta perdida/409 visual, inbox/fila, comentários/timeline/SLA/incidentes e comandos de close/release/reassign visuais ainda não foram declarados concluídos. Integração PostgreSQL, API/Playwright e A01–A24 continuam pendentes. Nenhum compose, seed ou dado existente foi usado.
