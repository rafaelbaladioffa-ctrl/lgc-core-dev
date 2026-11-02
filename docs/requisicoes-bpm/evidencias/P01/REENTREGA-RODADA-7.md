# P01 — percurso de rascunho conectado: checkpoint

Data: 2026-11-02

P01 continua em implementação; não libera P02.

## Entregue neste marco

- `useDraftAutosave` agora mantém snapshot em voo, coalesce edições novas, serializa saves, usa `currentVersion` retornada, preserva dados em 409/falha e oferece retry sem descartar payload.
- `BpmDraftEditorPage` foi adicionada à rota de detalhe e usa GET do registro com schema da versão fixada, `DynamicForm`, PATCH real, autosave, save manual, estados visuais, submit/cancel/close, comentários e timeline.
- Upload real após criação do draft: arquivo convertido para base64 no cliente, persistido como BYTEA no backend, ID anexado ao campo, lista/download autenticado e substituição versionada com `previousId`.
- Detail agora retorna schema/formAccess da versão fixada para o autor sem exigir a API administrativa.
- `DynamicForm` renderiza tipos reais, mantém `false`, zero, decimal como string, datas, select por ID e attachment.
- Runner de jornada executável via `npm run test:journey`; agora renderiza o componente com `react-dom/server` e verifica os controles tipados, além dos contratos de coercion/merge.

## Verificações

- `npm run build` frontend: passou.
- `npm run test:journey`: 9 assertions de componente/contrato passaram.
- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- Suíte backend P01: 14/14 testes passou.

## Ainda aberto

O runner ainda não é DOM interativo: não cobre timers reais do hook, resposta pendente/409/rede perdida, retomada v1 após v2 ou interação de seleção/upload. Esses cenários exigem um ambiente DOM/test runner adicional e continuam explicitamente pendentes, assim como inbox/fila, gestão visual completa, incidentes, protocolo comum/header, API/Playwright/Postgres e A01–A24. O marco é um checkpoint funcional parcial, não jornada homologada.

Nenhum compose, seed ou dado existente foi usado.
