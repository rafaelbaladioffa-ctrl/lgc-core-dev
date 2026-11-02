# P01 — checkpoint C01/C02 e correções incrementais

Revisado por Sol: **C01/C02 corrigidos em código/testes isolados; continuar a jornada de P01, sem aceite final**, conforme [relatório do checkpoint 4](revisao-sol-rodada-4/REVISAO.md). Os 12 testes foram confirmados; políticas/respostas de comandos e funcionalidades pendentes permanecem no escopo. Relato original preservado abaixo.

Data: 2026-11-02

P01 permanece em implementação; P02 continua bloqueado.

## C01/C02

- O template gerado por `createProcess` agora contém a política P01 canônica e passa pelo próprio `validateDefinition`.
- O diretório administrativo expõe `userId` e `collaboratorId` distintos quando consultado contra o modelo real de `User.collaboratorId`; a UI usa `collaboratorId` para membros/gestores e `userId` para publicadores.
- Publicadores são verificados como usuários ativos com `request_process:publish`.
- Categoria, versão draft e grants são criados na mesma transação; falha de grant não deixa categoria BPM órfã.
- Foi adicionado teste positivo de definição gerada e teste positivo de criação transacional com IDs de usuário/colaborador diferentes.

## Correções adicionais

- Release/reassign usam o mesmo contexto canônico com `activityId` na consulta e gravação do receipt; replay não depende do estado mutável anterior.
- Reassign rejeita solicitante/beneficiário, conta desabilitada/colaborador inativo e atividade terminal.
- Clocks usam as metas `definition.sla` publicada, não apenas colunas legadas.
- Download e listagem de anexos aplicam a visibilidade `formAccess` da atividade corrente.
- `publishedAt` voltou a ser nullable com `@default(now())`, a migration torna a coluna nullable preservando o default e a criação BPM grava `null` explicitamente.

## Evidências

- Suíte P01: 12 testes passaram.
- `npx tsc -p tsconfig.build.json --noEmit --pretty false`: passou.
- `npm run build` frontend: passou.
- `npx prisma validate`: passou.
- Checks da rodada 3 executados somente em leitura: C01, C03–C08 confirmam os vetores corrigidos. O fixture sintético C02 ainda não fornece `User.findMany`, portanto não prova o contrato real; o teste próprio com `User.id != Collaborator.id` cobre esse caminho.

Ainda não executados: PostgreSQL dedicado, concorrência/restart, API/Playwright e demais telas/jornadas A01–A24. Nenhum compose, seed ou dado compartilhado foi usado.
