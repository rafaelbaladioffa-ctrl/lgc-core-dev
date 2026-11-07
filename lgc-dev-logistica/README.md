# Axis Logística (satélite de Almoxarifado/WMS)

Satélite do Axis Core, mantido como subpasta deste repositório. Esta subpasta é a versão oficial; o repositório
irmão `orca-dev/lgc-dev-logistica` está desatualizado (parado em 01/11/2026).

- **Stack:** NestJS 12 + Prisma 5 + PostgreSQL 16 com banco **próprio** (nunca o do Axis). O frontend é React 19 + Vite 8 (PWA).
- **Especificação:** [docs/especificacao.md](docs/especificacao.md). **Implantação:** [DEPLOY.md](DEPLOY.md).
- **Integração com o Core** (o que funciona e o que não fecha): [../docs/integracao-core-logistica.md](../docs/integracao-core-logistica.md).

> **Estado em 2026-11-07:**
> - Testes: 417 unitários do backend e 98 do frontend passando; os e2e exigem Postgres e não foram executados nesta avaliação.
> - Typecheck: o `tsc -p tsconfig.json` aponta 4 erros em mocks de teste.
> - Integração com o Core: o fluxo requisição do Core → ordem de atendimento ainda não funciona, porque os tipos de evento divergem.
> - Pendências do MVP: estão em [../docs/arquivo/logistica-status-final-2026-11-01.md](../docs/arquivo/logistica-status-final-2026-11-01.md) §3–4.

## Rodando

```bash
docker compose up -d logistica-postgres   # Postgres em localhost:5433 (usuário/banco: logistica/axis_logistica)
cd backend
cp .env.example .env                 # JWT_SECRET deve ser igual ao JWT_ACCESS_SECRET do Axis
npm install
npx prisma migrate deploy && npx prisma db seed
npm run start:dev                    # http://localhost:3100/api/v1
npm run dev:setup                    # migrações + seed (catálogo inicial 8.1–8.8; com SEED_DEV_DATA=true cria o ALM-CENTRAL e libera SEED_DEV_GRANT_SUBS)
npm run test:e2e:setup && npm run test:e2e   # testes em banco SEPARADO (.env.test → axis_logistica_test)
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

## Sprint 6 — devoluções, custódia, etiquetas e documentos
- Entrega de EPI/ferramenta/equipamento/ativo/seriado gera **termo de custódia** (`custody_terms`); `GET /custody` (o colaborador vê só o próprio), `custody/offboarded-pending` (desligados com itens), `custody/:id/mark-lost` (aprovação Axis).
- `POST /returns` entra em QUARENTENA; `returns/:id/items/:itemId/classify` → DISPONIVEL / MANUTENCAO / QUARENTENA / AVARIADO_REPARO / SUCATA (sucata exige `approvalRef`). A custódia baixa na devolução física.
- `POST /fulfillment-orders/:id/resolve-cancellation`: resolve CANCELAMENTO_SOLICITADO e entrega recusada (libera reservas, cancela tarefa/volume). Recusa de entrega → DIVERGENCIA até resolvida.
- `POST /labels/print` (LOCATION, MATERIAL+lote, SERIAL, PACKAGE; json ou ZPL; reimpressão exige motivo e é auditada em `label_prints`).
- `GET /documents/*`: comprovante de recebimento, divergência, lista de separação, romaneios (expedição/transferência), comprovante de entrega, termo de custódia, comprovante/certificado de devolução-descarte e extrato de movimentações (JSON pronto para PDF; datas DD/MM/AAAA HH:mm, moeda R$, custo só com `material:read_cost`).

## Sprint 7 — inventário (9.8)
- `POST /stock-counts` (tipos GERAL/ROTATIVO_ABC/ENDERECO/ITEM/LOTE/PROJETO/AMOSTRAGEM) tira o retrato do saldo e **congela** os endereços (movimento comum nesses endereços é recusado); um inventário ativo por endereço.
- Contagem cega: `GET :id/sheet` nunca traz o saldo do sistema; 1ª contagem → `close-round` → o que excede a tolerância (`tolerancePct`) vai para recontagem **por outro operador** → apuração (`APURADA`, evento `inventory.variance_detected`).
- `GET :id/report` (antes/depois, valor R$, recorrência), `PUT :id/action-plan`, `POST :id/adjustments` (permissões `stockcount:manage` + `stock:adjust`, `approvalRef` do Axis e motivo padronizado por divergência) → movimentos AJUSTE_POSITIVO/NEGATIVO e conclusão. `GET /documents/stock-counts/:id` emite o relatório de inventário.

## Sprint 8 — reposição, alertas e indicadores
- `PUT /stock-policies` (mínimo, máximo, segurança, ponto de reposição por material e almoxarifado). `POST /replenishment/calculate` calcula por consumo (90 dias), lead time, segurança e demanda aprovada futura, deduz compras/transferências em aberto, arredonda ao múltiplo de compra e guarda a justificativa. `…/suggestions/:id/send` envia ao Axis (`replenishment.suggested`) — **nunca gera pedido financeiro**; `purchase_order.approved|changed` do Axis registra previsão, e o recebimento contra o pedido atende a sugestão.
- `POST /alerts/scan` (idempotente; resolve sozinho o que deixou de valer): reposição/ruptura, lotes a vencer (90/60/30/7 e vencido), reserva expirando, requisição parada além do SLA, material bloqueado ainda reservado, trânsito atrasado, custódia vencida, inventário apurado, falha de integração e consumo anômalo. Críticos geram `alert.raised` para o papel responsável. `GET /alerts`, `POST /alerts/:id/acknowledge`. Config: `ALERT_ORDER_ANALYSIS_HOURS`, `ALERT_ORDER_PICKING_HOURS`, `ALERT_TRANSIT_HOURS`.
- `GET /dashboard/kpis`: acuracidade, nível de serviço, ciclos, ruptura/cobertura, vencimentos, consumo por projeto/CC (R$ com `material:read_cost`), divergências por fornecedor, perdas/ajustes, custódia, trânsito, ocupação, saúde da integração e alertas — agregados, sem ranking individual.
- A baixa de entrega agora grava o custo histórico do Axis (`averageCost`) no movimento.

## Sprint 9 — PWA operacional (`frontend/`) e sincronização offline
- **Backend:** `GET /sync/bootstrap?warehouseId=` (tarefas de separação/armazenagem, folhas de contagem cega, endereços e códigos de barras — sem saldo nem custo) e `POST /sync/batch` (até 200 operações com `opId` UUID gerado no aparelho; cada uma é idempotente por `deviceId+opId`; resultado `APLICADA | DUPLICADA | CONFLITO | REJEITADA | ERRO`; a permissão é checada por tipo de operação; `ERRO` = falha temporária e não é gravada).
- **Frontend (React + Vite, mobile-first, alto contraste, alvos grandes):** `cd frontend && npm install && npm run dev` (porta 5174, proxy `/api` → 3100). O acesso é o do Axis: **login com o mesmo e-mail e senha do Axis** (o front chama `POST {VITE_AXIS_URL}/auth/login`, padrão `http://localhost:3000/api/v1`, guarda o JWT e renova com `/auth/refresh`; a sessão expirada volta ao login sem perder a fila offline). Para integrar por link, `#token=<JWT>` na URL ainda é aceito. Telas: Separação (endereço → material → quantidade), Armazenagem, Inventário (contagem cega) e Pendências. Leitura por câmera (`BarcodeDetector`) ou coletor/teclado; sem rede, as ações ficam na fila local (IndexedDB) e sincronizam sozinhas ao voltar a conexão; conflitos e rejeições aparecem com a mensagem e podem ser dispensados ou refeitos. Service worker guarda a casca do app.
- Limites conhecidos: item seriado exige leitura da série online; vídeo/câmera depende de HTTPS (ou `localhost`) e de navegador com `BarcodeDetector`.

## Sprint 10 — hardening
- **Cenários obrigatórios (seção 23):** `backend/test/sprint10-scenarios.e2e-spec.ts` (20 cenários ponta a ponta).
- **Outbox → Axis:** `OutboxDispatcherService` (HMAC `X-Logistica-Signature`, `Idempotency-Key`, backoff 1 min/5 min/30 min/2 h, dead-letter); `GET /integration/outbox/status`, `POST /integration/outbox/dispatch`, `POST /integration/outbox/:id/retry`.
- **Agendador** (`SCHEDULER_ENABLED=true`, uma instância): outbox 30 s, alertas e reservas 5 min, reconciliação 1 h.
- **Reconciliação (12.4):** `POST /reconciliation/run`, `GET /reconciliation/issues`, `POST /reconciliation/issues/:id/resolve` — detecta e abre item; nunca corrige em silêncio.
- **Auditoria:** toda mutação, leitura sensível e negação de acesso; `GET /audit/events`; `X-Correlation-Id` em todas as respostas.
- **Deploy e status:** [DEPLOY.md](DEPLOY.md) (compose com Postgres próprio, backend, frontend/nginx e backup). O antigo `STATUS_FINAL.md` (o que ficou fora do MVP, contratos a confirmar e decisões da seção 28) foi para [../docs/arquivo/](../docs/arquivo/logistica-status-final-2026-11-01.md).

## Sprints 11–14 — telas web de gestão
O frontend ganhou, além do PWA operacional, telas de gestão, cada uma liberada por permissão (`NAV_ITEMS` em `frontend/src/App.tsx`). A navegação é feita por abas, sem router:

| Tela | Arquivo | Permissão |
|---|---|---|
| Painel | `Dashboard.tsx` | `dashboard:read` |
| Catálogo e cadastro de material | `Catalog.tsx`, `MaterialForm.tsx` | `material:read` |
| Estoque e ajustes | `Stock.tsx`, `StockAdjust.tsx` | `stock:read` |
| Recebimento | `Receiving.tsx` | `receipt:execute` |
| Transferências | `Transfers.tsx`, `TransferReceive.tsx` | `transfer:request` |
| Devoluções e custódia | `Returns.tsx` | `return:execute` |
| Atendimento | `Fulfillment.tsx` | `fulfillment:read` |
| Reposição e alertas | `Replenishment.tsx` | `alert:read` |
| Administração (endereços, parâmetros, integração) | `Admin.tsx`, `AdminForms.tsx` | `warehouse:read` |

O Core consome `GET /materials/purchase-catalog` e `POST /materials/availability:batch` na tela "Nova requisição".

## Pontos de atenção conhecidos
- **Catálogo revisado:** `SEED_REVISED_CATALOG=true` (definido no `docker-compose.yml`) faz duas coisas:
  - o seed sobrescreve custo e status dos itens `REV-` a cada partida, sem versão nem auditoria;
  - a listagem do catálogo esconde todo material cujo código não começa com `REV-`.
- **Custo exposto:** `GET /materials/purchase-catalog` devolve custo a quem tem só `material:read`.
- **SSO e permissões:**
  - `POST /auth/exchange` aceita qualquer access token do Core, não só o do launcher;
  - o CORS do backend não tem allow-list;
  - o mapeamento de papéis precisa de revisão.
  
  Detalhes em [../docs/integracao-core-logistica.md §1](../docs/integracao-core-logistica.md#1-identidade-e-sessão).

## Desenvolvimento e testes
- **Banco de testes separado:** copie `backend/.env.test.example` para `.env.test` (outro banco, `axis_logistica_test`); `npm run test:e2e:setup` migra e `npm run test:e2e` roda. O banco de desenvolvimento não acumula lixo de teste.
- **Catálogo inicial:** `prisma/catalog-data.ts` é gerado por `python scripts/generate-catalog.py <PLANNING_LOGISTICA.md>` (101 SKUs das tabelas 8.1–8.8; 8.9 químicos não é carregado — exige validação técnica e de HSE). O seed só cria o que ainda não existe e `SEED_CATALOG=false` desliga. A exceção é `SEED_REVISED_CATALOG=true`, que sobrescreve os itens `REV-` (ver "Pontos de atenção").
- **Perfil por usuário:** além do mapeamento por role do Axis, `PUT /rbac/users/:axisUserId/roles` concede perfis de Logística a um usuário específico (ex.: um colaborador que atua como almoxarife); o acesso a almoxarifados continua em `PUT /rbac/users/:axisUserId/warehouses`.
