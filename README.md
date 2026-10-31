# Axis Logística (satélite de Almoxarifado/WMS)

Especificação: `../lgc-dev-core/PLANNING_LOGISTICA.md`. Stack: NestJS + Prisma + PostgreSQL 16 (banco **próprio**, nunca o do Axis).

## Rodando

```bash
docker compose up -d postgres        # Postgres em localhost:5433 (usuário/banco: logistica/axis_logistica)
cd backend
cp .env.example .env                 # JWT_SECRET deve ser igual ao JWT_ACCESS_SECRET do Axis
npm install
npx prisma migrate deploy && npx prisma db seed
npm run start:dev                    # http://localhost:3100/api/v1
npm run test:e2e                     # precisa de DATABASE_URL e JWT_SECRET no ambiente
```

## SSO e RBAC (Sprint 1)
- Sem login próprio: `Authorization: Bearer <JWT do Axis>` (HS256, mesmo segredo). Permissões do token do Axis são ignoradas.
- `roles` do token → tabela `axis_role_to_logistics_role` → perfis de Logística → permissões (`logistics_permissions`). Editável via `PUT /rbac/axis-role-mapping/:axisRole` (permissão `rbac:write`).
- Escopo por almoxarifado: `warehouse:access_all` ou linhas em `user_warehouse_access`.
- Endpoints: `GET /health` (público), `GET /me`, `/materials`, `/units-of-measure`, `/warehouses` (+`/locations`), `/rbac/*`.
