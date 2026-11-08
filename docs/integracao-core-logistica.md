# Integração Core ↔ Logística

Contratos entre o Axis Core e o satélite Logística, conferidos nos dois lados em 2026-11-07.
Fontes: `backend/src/auth`, `backend/src/integration`, `frontend/src/api/logisticsCatalog.ts`,
`frontend/nginx.conf`, `lgc-dev-logistica/backend/src/{auth,integration,materials,rbac}`,
`lgc-dev-logistica/frontend/src/lib/{auth,api}.ts`. Especificação original:
[../lgc-dev-logistica/docs/especificacao.md §0](../lgc-dev-logistica/docs/especificacao.md).

## Resumo

| Canal | Direção | Estado |
|---|---|---|
| SSO por JWT compartilhado | Core → Logística | Funciona; tem falhas de segurança (§1) |
| Launcher (`axisToken` de 90 s) | Core → Logística | Funciona |
| Catálogo de compra e disponibilidade | Navegador do Core → Logística | Funciona via nginx; sem proxy no `vite dev` |
| Webhook de eventos | Core → Logística | Envelope e assinatura batem; **os tipos de evento não** |
| Eventos de saída da Logística | Logística → Core | **Não existe receptor no Core** |
| API de consulta por API key | Logística → Core | Disponível no Core; **a Logística não usa** |

## 1. Identidade e sessão

- **Segredo compartilhado:** `JWT_SECRET` da Logística = `JWT_ACCESS_SECRET` do Core (HS256).
- A Logística **ignora as permissões do token** e resolve as próprias pelos `roles`, via tabela
  `axis_role_to_logistics_role` (`lgc-dev-logistica/backend/src/rbac/catalog.ts:68-74`), mais perfis
  e almoxarifados atribuídos por usuário.
- **Login no PWA:** chama `POST {VITE_AXIS_URL}/auth/login` e `/auth/refresh` do Core por CORS. O
  Core precisa listar o domínio do PWA em `CORS_ALLOWED_ORIGINS`.
- **Launcher:** `POST /integration/satellites/:id/launch` no Core (permissão `integration:read`)
  devolve URL com `?axisToken=` (JWT de 90 s). A Logística troca em `POST /auth/exchange` por uma
  sessão própria de 8 h, assinada com o mesmo segredo e `iss=axis-logistica`.

**Problemas:**

1. `POST /auth/exchange` aceita **qualquer** access token válido do Core, não só o do launcher (sem
   `aud`/`jti` de uso único), e devolve sessão de 8 h. O `JwtStrategy` do Core não verifica `iss`
   nem fixa o algoritmo, então aceita de volta esse token de 8 h. Efeito: contornar o TTL de 15 min e
   a revogação do Core.
2. O bloqueio de usuário desativado na Logística depende do evento `user.disabled`, que o Core não emite.
3. `#token=<JWT>` na URL do PWA é gravado como sessão sem troca (`frontend/src/lib/api.ts:18-23`).
4. Mapeamento de papéis: `gestor` (gestor de área no Core) vira `GESTOR_ALMOXARIFADO`, com
   `warehouse:access_all`, `stock:adjust` e `reconciliation:manage`; `tecnico` vira `ALMOXARIFE`.
   `analista_suprimentos` e `compliance` não têm mapeamento (403 no catálogo de compra).

**Direção recomendada:** token de launcher com `aud`/`typ` próprios e `jti` de uso único; o Core
recusar `iss=axis-logistica` e fixar `algorithms: ['HS256']` — ou migrar para RS256/JWKS com
chaves por emissor. Revisar o mapeamento de papéis com o negócio.

## 2. Catálogo e disponibilidade (tela "Nova requisição")

| Chamada (feita pelo navegador do Core) | Logística | Permissão na Logística |
|---|---|---|
| `GET /materials/purchase-catalog` | `materials.controller.ts:26-29` | `material:read` |
| `POST /materials/availability:batch` (até 200 ids) | `availability` | `stock:read` |

- Base: `VITE_LOGISTICA_API_BASE_URL` (padrão `/logistica-api`), proxy em `frontend/nginx.conf`.
- Resposta do catálogo: `id, code, shortDescription, technicalDescription, category, subcategory, unit, unitPrice`.
  Resposta de disponibilidade: `{items: [{material_id, available, …}]}`. Os dois lados batem.
- **Problemas:** o catálogo devolve custo (`unitPrice` = último/médio custo) a quem tem só
  `material:read`, sem paginação. O Core grava `materialId` e `unitPrice` enviados pelo cliente sem
  conferir na Logística (`backend/src/requests/requests.service.ts:165-174`), e o valor alimenta a
  alçada de aprovação.
- `SEED_REVISED_CATALOG` voltou a ser só uma flag de seed: ela ainda sobrescreve custo e status dos
  itens `REV-` a cada partida, mas não filtra mais a listagem nem o `purchase-catalog`, que escondiam
  todo material cujo código não começasse com `REV-`. O compose agora a define como `false`.

## 3. Eventos Core → Logística

Envelope e assinatura compatíveis: `{event_id, event_type, occurred_at, payload}` com
`X-Axis-Signature: sha256=<hmac>`; a Logística valida janela anti-replay (`WEBHOOK_MAX_AGE_HOURS`)
e idempotência por `event_id`.

| Evento | Core emite? | Logística consome? |
|---|---|---|
| `collaborator.created/updated/offboarded` | sim | sim |
| `client.created/updated` | sim | sim |
| `project.created/updated/status_changed/deleted` | sim (estado completo; ver [cadastros.md §10](dominio/cadastros.md#10-projetos)) | sim (qualquer `project.*` atualiza o cache; `deleted` chega com `status: encerrado`) |
| `cost_center.created/updated` | sim | **não (ignora)** |
| `user.*` (inclui `user.disabled`) | **não** | sim |
| `request.submitted/status_changed/completed` | sim | **não (ignora)** |
| `sla.warning/breached` | sim | não |
| `material_request.*` | **não** | sim (`material-request.adapter.ts`) |
| `ticket.status_changed` | **não** (módulo não existe) | sim (adaptador legado) |
| `purchase_order.approved/changed` | **não** | sim |

**Consequência:** uma requisição de material aprovada no Core não gera ordem de atendimento na
Logística, e a desativação de usuário não chega.

## 4. Eventos Logística → Core

O outbox da Logística envia para `AXIS_EVENTS_URL` com `X-Logistica-Signature` e `Idempotency-Key`
(`outbox-dispatcher.service.ts`). **O Core não tem endpoint de entrada**; com `AXIS_EVENTS_URL`
vazio, as mensagens ficam `PENDING`. Eventos produzidos: `receipt.divergent`,
`inventory.variance_detected`, `replenishment.suggested`, `alert.raised`, entre outros.

## 5. Próximos passos (ordem sugerida)

1. Endurecer o SSO (§1) — risco de segurança.
2. Definir e implementar o contrato de requisição de material: o Core emitir `material_request.*`
   (ou a Logística consumir `request.*` filtrando por categoria) e `user.disabled`.
3. Criar o receptor de eventos da Logística no Core (`POST /integration/inbound`, HMAC, idempotência).
4. Validar preço e material no servidor (o Core consulta a Logística com credencial de serviço).
5. Proteger custo no `purchase-catalog` (`material:read_cost`) e paginar.
6. ~~Remover `SEED_REVISED_CATALOG` do runtime~~ (feito: o filtro saiu da listagem e do
   `purchase-catalog`, e o compose a define como `false`). Falta aposentar o seed `REV-` em si:
   `prisma/revised-catalog.ts` e `syncRevisedCatalog`, hoje redundantes com `prisma/materiais-lgc.csv`.
7. Extrair os tipos de contrato (envelope, eventos, DTOs de catálogo/disponibilidade, claims do JWT)
   para um pacote compartilhado e validar nos dois lados no CI.
