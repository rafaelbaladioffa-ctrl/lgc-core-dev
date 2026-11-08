# Axis Financeiro (satélite financeiro: projetos e contas a pagar)

Satélite do Axis Core, mantido como subpasta deste repositório, como a Logística.

- **Stack:** NestJS 12 + Prisma 5 + PostgreSQL 16 com banco **próprio** (`axis_financeiro`); frontend React 19 + Vite 8.
- **Primeiro módulo — Projetos** (orçamento, lucro previsto e realizado): [docs/projetos-especificacao.md](docs/projetos-especificacao.md).
- **Centros de custo** (resultado, orçamento, compras, rateio e equipes técnicas): [docs/centros-de-custo-especificacao.md](docs/centros-de-custo-especificacao.md).
- **Contas a pagar** (frente seguinte) e base do satélite: [docs/especificacao.md](docs/especificacao.md).
- **Contratos com o Core:** [../docs/integracao-core-financeiro.md](../docs/integracao-core-financeiro.md).

> **Estado em 2026-11-07:** entrega F0 (esqueleto). Health, `/me`, SSO com o access token do Core,
> RBAC local, auditoria append-only, receptor de webhook do Core com cache de mestres, outbox e
> frontend com login e tela inicial. Módulo Projetos: **PJ1 entregue** (parâmetros de orçamento
> versionados com custo hora da equipe, catálogo de materiais e destinos, perfis do módulo), **PJ2
> entregue** (orçamento do projeto com revisões, resultado, preço mínimo e preço da meta) e **PJ3
> entregue** (submeter, devolver, aprovar envio, ganha/perdida e avisos de divergência com o Core).
> **PJ4 entregue** (fila de pedidos de cotação do Core, SOW em PDF e Bid Template do RFQ lidos na
> revisão, horas-meta, horas T e indicadores do cliente) e **PJ7 entregue** (Bid preenchida no modelo do
> RFQ ao aprovar o envio e devolvida ao Core pelo outbox). Próximo: PJ5 (realizado); contas a pagar
> (F1–F6) vem depois de Projetos.
>
> **Primeiro uso do PJ1:** conceda `CONTROLADORIA` a quem mantém os custos, crie o rascunho em
> Parâmetros (já vem com as referências legais de encargos e impostos), preencha ISS, veículo, meta e
> as funções da equipe, e publique. Os valores da empresa ficam só no banco.

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

O frontend segue o shell e a identidade visual do Core (topbar, menu lateral, migalhas, tema claro/escuro,
login). Os estilos canônicos (`src/styles/axis-tokens.css` e `axis-shell.css`), a marca e os ícones são
gerados por `node scripts/sync-design.mjs` na raiz do repositório; não os edite aqui. O estilo próprio fica
em `app.css`, `pages.css` e `cost-centers.css`, só com tokens.

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
| `GET /parameter-sets`, `/parameter-sets/schema`, `/parameter-sets/:id` | `budget_params:read` (salários e custo hora só com `budget_params:read_payroll`, leitura registrada) |
| `GET /parameter-sets/:id/hourly-costs` | `budget_params:read_payroll` |
| `POST /parameter-sets` (novo rascunho), `PATCH /parameter-sets/:id`, `POST /parameter-sets/:id/publish` | `budget_params:write` |
| `GET /budget-materials`, `/budget-destinations` (e `/:id`; `?includeInactive=true`) | `budget_params:read` (custo real do material só com `budget:read_cost`) |
| `POST`, `PATCH /budget-materials`, `/budget-destinations` | `budget_params:write` |
| `GET /projects`, `/projects/:axisProjectId`, `POST /projects/sync` (lê o Core com o seu token) | `budget:read` |
| `POST /budgets` (orçamento + R1), `POST /budgets/:id/revisions` | `budget:write` |
| `GET /revisions/:id`, `POST /revisions/:id/simulate` | `budget:read` (custo, impostos e lucro só com `budget:read_cost`) |
| `PATCH /revisions/:id`, `POST /revisions/:id/use-current-parameters`, `/discard` | `budget:write` |

Perfis do módulo Projetos: `ORCAMENTISTA`, `GESTOR_COMERCIAL`, `GESTOR_PROJETO`, `CONTROLADORIA`
([especificação §9](docs/projetos-especificacao.md#9-permissões-e-perfis)). Rode `npx prisma db seed`
depois de aplicar a migração `pj1_parametros` para criá-los.

Centros de custo: rotas em [centros-de-custo-especificacao.md §8](docs/centros-de-custo-especificacao.md#8-api-prefixo-apiv1);
permissões `cost_center:read`, `cost_center:read_own`, `cost_center:write` e `team_log:write`, perfil novo
`RESPONSAVEL_CC` (mapeado do papel `gestor` do Core) e `CONTROLADORIA` ampliado. Depois da migração
`centros_de_custo`, rode `npx prisma db seed` de novo. A importação do consumo e a custódia usam
`LOGISTICA_API_URL` e `LOGISTICA_API_KEY` (a mesma chave de `INTEGRATION_API_KEY` na Logística).

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
