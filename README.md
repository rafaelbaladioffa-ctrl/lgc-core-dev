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

## Sprint 2 — estoque e integração
- Ledger imutável `stock_movements` (trigger bloqueia UPDATE/DELETE/TRUNCATE) + `stock_balances` com CHECK(quantidade >= 0). `POST /stock/movements` exige `Idempotency-Key`; correção via `POST /stock/movements/:id/reverse`. Ajustes/perdas/descartes exigem `stock:adjust` + `axisApprovalRef`.
- `lots` (quarentena/bloqueio, validade, FEFO/vida útil mínima) e `serial_numbers` (único por material, nunca em dois locais).
- `POST /webhooks/axis`: HMAC-SHA256 do corpo bruto (`X-Axis-Signature: sha256=…`, segredo `AXIS_WEBHOOK_SECRET`), janela anti-replay (`WEBHOOK_MAX_AGE_HOURS`), idempotência por `event_id`, cache `axis_master_cache` com controle de ordem. Eventos de saída ficam em `integration_messages` (outbox, PENDING).

## Sprint 3 — disponibilidade, atendimento e reservas
- `GET /materials/:id/availability`, `POST /materials/availability:batch`, `GET /material-categories`, `GET /warehouses/:id/stock` (físico, reservado, bloqueado, disponível, projetado).
- `POST /fulfillment-orders` (idempotente por requisição+versão), `GET`, `/:id/reserve`, `/:id/cancel-request`, `POST /reservations/expire`. Reserva FEFO/FIFO atômica (`reserved_qty` ≤ `quantity` por CHECK), versão nova substitui a anterior se não houve separação.
- Adaptador `ticket.status_changed` (categorias de requisição de material, status `aberto`/`cancelado`) e `material_request.*` nativo → `src/integration/material-request.adapter.ts`. **O contrato do payload do ticket é uma suposição a confirmar com o Axis core** (documentado no arquivo).
- Erros de negócio carregam `code` (`AXIS_REFERENCE_INVALID`, `REQUEST_VERSION_CONFLICT`, `UNIT_CONVERSION_ERROR`…).

## Sprint 4 — separação, embalagem, expedição e entrega
- Fluxo: `release-picking` (parcial exige `acceptPartial`) → `picking-tasks/:id/start|scan|complete|check` → `fulfillment-orders/:id/pack` → `shipments/:id/dispatch` → `confirm-delivery` (ENTREGUE/PARCIAL/RECUSADA).
- Leitura valida endereço, material/SKU/código de barras, lote e série; falta exige motivo; conferência independente (quem separou não confere) para itens seriados, criticidade A, que exigem autorização ou com `requireCheck`.
- **A baixa do ledger (SAIDA_ENTREGA) acontece somente na confirmação de entrega** (9.5); até lá a reserva protege o saldo. Custódia (EPI/ferramenta/ativo/seriado) exige `receiverAxisId`; destinatário desligado bloqueia expedição/entrega (regra 14). Reservas de ordens em separação não expiram.

## Sprint 5 — recebimento, inspeção, armazenagem e transferências
- `POST /receipts` (sem pedido Axis exige `exceptionApprovalRef`), `items:scan`, `complete` (entrada no ledger; divergências → `DIVERGENTE` + evento `receipt.divergent`), `items/:itemId/inspect` (permissão `inspection:execute`; certificado e validade mínima validados antes da liberação), `putaway-tasks` (sugestão por categoria/risco/capacidade/consolidação; mistura incompatível recusada).
- Item que exige certificado/CA/calibração/risco/químico, ou com validade abaixo do mínimo, entra em QUARENTENA; lote vencido entra BLOQUEADO.
- `POST /transfers` → `approve` (reserva na origem; quem solicitou não aprova) → `start-picking` → `dispatch` (baixa da origem e entrada em trânsito, endereço virtual `TRANSITO` em condição BLOQUEADO) → `receive` (diferença = divergência, nunca ajuste automático) → `close`. `urgent` expede direto após aprovar, com auditoria.
