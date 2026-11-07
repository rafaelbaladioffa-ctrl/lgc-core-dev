# Axis Financeiro (satélite de contas a pagar)

Satélite do Axis Core, mantido como subpasta deste repositório, como a Logística.

- **Stack:** NestJS 12 + Prisma 5 + PostgreSQL 16 com banco **próprio** (`axis_financeiro`); frontend React 19 + Vite 8.
- **Especificação e entregas:** [docs/especificacao.md](docs/especificacao.md).
- **Contratos com o Core:** [../docs/integracao-core-financeiro.md](../docs/integracao-core-financeiro.md).

> **Estado em 2026-11-07:** entrega F0 (esqueleto). Health, `/me`, SSO com o access token do Core,
> RBAC local, auditoria append-only, receptor de webhook do Core com cache de mestres, outbox e
> frontend com login e tela inicial. Ainda não há domínio de contas a pagar (F1–F3).

## Rodando em desenvolvimento

```bash
docker compose up -d financeiro-postgres   # Postgres em localhost:5434 (usuário/banco: financeiro/axis_financeiro)
cd backend
cp .env.example .env                 # JWT_SECRET igual ao JWT_ACCESS_SECRET do Core
npm install
npm run dev:setup                    # migrações + seed do RBAC
npm run start:dev                    # http://localhost:3200/api/v1
```

```bash
cd frontend
npm install
npm run dev                          # http://localhost:5175 (proxy /api → :3200)
```

Em desenvolvimento o login e o refresh vão ao Core pelo proxy `/core-api` do Vite (Core em
`localhost:3000`), sem precisar liberar a 5175 no CORS do Core. Em produção, defina `VITE_AXIS_URL`
no build e inclua o domínio do Financeiro em `CORS_ALLOWED_ORIGINS` do Core.

## Acesso

- Sem login próprio: `Authorization: Bearer <access token do Core>` (HS256, mesmo segredo).
  Tokens com `iss` (ex.: sessão da Logística) são recusados.
- Permissões do Core são ignoradas. Papel do Core → perfis do Financeiro em
  `axis_role_to_finance_role` (inicial: `admin → ADMIN_TECNICO`), mais perfis por usuário.
- Para dar acesso a alguém: um usuário com `rbac:write` chama
  `PUT /api/v1/rbac/users/<id do usuário no Core>/roles` com `{ "financeRoles": ["TESOURARIA"] }`.
  Ninguém altera os próprios perfis.

| Rota | Permissão |
|---|---|
| `GET /health` | pública |
| `GET /me` | autenticado |
| `GET /rbac/roles`, `/rbac/axis-role-mapping`, `/rbac/users/:id/roles` | `rbac:read` |
| `PUT /rbac/axis-role-mapping/:axisRole`, `/rbac/users/:id/roles` | `rbac:write` |
| `GET /audit` | `audit:read` |
| `POST /webhooks/axis` | assinatura HMAC (`X-Axis-Signature`) |
| `GET /integration/outbox/status`, `POST /dispatch`, `POST /:id/retry` | `integration:configure` |

## Integração com o Core

1. No Core, cadastre o satélite (`POST /integration/satellites`) com o webhook
   `http://financeiro-backend:3200/api/v1/webhooks/axis` e copie o segredo HMAC para
   `AXIS_WEBHOOK_SECRET`. Não informe `frontendUrl`: o botão "Abrir" do Core manda um token de
   launcher que o Financeiro ainda não aceita (especificação §2.1).
2. Assine os eventos `collaborator.*`, `client.*`, `project.*` (e `user.*`/`cost_center.*` quando o
   Core os emitir).
3. `AXIS_EVENTS_URL` fica vazio até o Core ter receptor de eventos; os eventos do Financeiro ficam `PENDING`.

## Verificação

```bash
cd backend && npx tsc -p tsconfig.build.json --noEmit && npm run lint && npm test
```

```bash
cd frontend && npx tsc -p tsconfig.json --noEmit && npx oxlint src && npm test
```

Testes que precisam de banco usam um banco separado com sufixo `_test` (ex.: `axis_financeiro_test`),
nunca o de desenvolvimento.
