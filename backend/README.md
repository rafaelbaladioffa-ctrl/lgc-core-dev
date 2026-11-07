# Axis Core — API

API do Axis Core: NestJS 12 (ESM), Prisma 5.22 e PostgreSQL 16. Todas as rotas ficam sob `/api/v1`.
Arquitetura e módulos: [../docs/arquitetura.md](../docs/arquitetura.md). Variáveis de ambiente, Docker e
migrações: [../docs/operacao.md](../docs/operacao.md).

## Rodando

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npx prisma migrate deploy && npm run prisma:seed && npm run start:dev
```

> Leia [../docs/operacao.md §4](../docs/operacao.md#4-migrações--cuidados-obrigatórios) antes de mexer em
> migrações. Nunca rode `prisma migrate dev` contra um banco com dados.

## Scripts

| Script | O que faz |
|---|---|
| `start:dev` / `start:debug` | API com watch |
| `build` / `start:prod` | Compila para `dist/` e roda `node dist/main` |
| `lint` | oxlint com regras type-aware |
| `test` | Vitest unitário (`src/**/*.spec.ts`) |
| `test:e2e` | Vitest de integração (`test/`). Só roda com `TEST_DATABASE_URL` apontando para um Postgres local `*_test`; sem ela, os testes são pulados |
| `prisma:seed` | Papéis, permissões, admin e dados base (idempotente; roda a cada partida do container) |
| `seed:*` | Seeds auxiliares de organização e requisições |

## Estrutura

```
src/
  main.ts, app.module.ts      bootstrap, prefixo api/v1, pipes, CORS, helmet
  auth/ rbac/ users/          login/refresh/troca de senha, guards de permissão, usuários e papéis
  sectors/ cost-centers/ job-titles/ work-schedules/
  collaborators/ certifications/ clients/ projects/
  request-categories/ requests/ delegations/ approval-authority-rules/ holidays/
  integration/                outbox + dispatcher, satélites, API de consulta (API key)
  audit/ common/crypto/ prisma/
prisma/
  schema.prisma, migrations/, seed*.ts
scripts/
  backup-postgres.sh, restore-postgres.sh (usados pelo serviço de backup do compose)
test/                         integração com banco real (a24: login/refresh/troca de senha)
```

## Typecheck

Use `npx tsc -p tsconfig.build.json --noEmit`, que cobre `src/`. O `tsconfig.json` completo inclui
testes e seeds; restam 3 erros de tipo conhecidos em `seed-requests-fase1.ts` e `seed-requests-fase2-sectors.ts`
(os seeds rodam normalmente com `tsx`).
