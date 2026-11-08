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
| Webhook de eventos | Core → Logística | Envelope e assinatura batem; a Logística entende `material_request.*` com destino, `site.*` e `cost_center.*`; o Core emite `site.*` e, desde 2026-11-08, `material_request.approved/cancel_requested` do **envio de material para obra** (§3.1); a compra de material ainda não emite `material_request.*` |
| Eventos de saída da Logística | Logística → Core | Formato fixado (§4.1); receptor `POST /integration/inbound` no Core (§4); sem handlers de negócio ainda (PT-09): tudo é guardado como `ignored` |
| API de consulta por API key | Logística → Core | Disponível no Core; **a Logística não usa** |
| Consulta de materiais e custo por API key | Core e Financeiro → Logística | Disponível na Logística (`GET /integration/materials`, §4.2); o Core a chama no servidor ao aprovar um projeto (valor estimado do envio, `LOGISTICA_API_URL`/`LOGISTICA_API_KEY`); o Financeiro a usa no seletor de materiais da cotação |

## 1. Identidade e sessão

- **Segredo compartilhado:** `JWT_SECRET` da Logística = `JWT_ACCESS_SECRET` do Core (HS256).
- A Logística **ignora as permissões do token** e resolve as próprias pelos `roles`, via tabela
  `axis_role_to_logistics_role` (`lgc-dev-logistica/backend/src/rbac/catalog.ts`; o `admin` do Axis vira ADMIN_TECNICO,
  ADMIN_CATALOGO e AUDITOR: lê todas as ordens de atendimento, completa e reserva as que chegam sem almoxarifado e
  cadastra almoxarifados), mais perfis
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
| `project.created/updated/status_changed/deleted` | sim (estado completo; ver [cadastros.md §10](dominio/cadastros.md#10-projetos)) | sim (qualquer `project.*` atualiza o cache; `deleted` chega com `status: encerrado`; desde 2026-11-08 o payload traz `site_id`, `site_code` e `site_name`) |
| `cost_center.created/updated` | sim | **sim** (cache `COST_CENTER`; antes ignorado): a ordem confere o centro de custo, sem bloquear |
| `site.created/updated` (site do cliente, com endereço e coordenadas; ver [cadastros.md §9.1](dominio/cadastros.md#91-sites)) | sim (desde 2026-11-08) | **sim** (cache `SITE`): destino das ordens de envio para obra |
| `project.document_added` (SOW) | sim | não assina; o evento só vai para quem assinar |
| `project.quote_requested` (cotação pelo Financeiro) | sim | não assina; o evento só vai para quem assinar |
| `user.*` (inclui `user.disabled`) | **não** | sim |
| `request.submitted/status_changed/completed` | sim | **não (ignora)** |
| `sla.warning/breached` | sim | não |
| `material_request.approved`, `material_request.cancel_requested` | **sim, só do envio de material para obra** (desde 2026-11-08; categoria `envio_material`, §3.1); a compra não emite | sim (`material-request.adapter.ts`), inclusive o `destination` do envio para obra |
| `ticket.status_changed` | **não** (módulo não existe) | sim (adaptador legado) |
| `purchase_order.approved/changed` | **não** | sim |

**Consequência:** o envio de material para obra aprovado no Core gera a ordem de atendimento na
Logística (§3.1); a compra de material continua sem gerar ordem, e a desativação de usuário não chega.

### 3.1 Envio de material para obra (`material_request.approved` com destino)

Contrato do plano de projeto aprovado (§4.3), aceito pela Logística. O Core emite o evento quando o responsável do centro de custo aprova a requisição
`envio_material` (criada ao aprovar o projeto, [requisicoes-estado-atual.md §16](dominio/requisicoes-estado-atual.md#16-envio-de-material-para-obra-kind--envio_material)); o payload abaixo é o que o Core grava, conferido contra o `material-request.adapter.ts` real:

```json
{
  "request_id": "<uuid>", "version": 1, "code": "REQ-…",
  "project_id": "<uuid>", "cost_center_id": "<uuid>",
  "requester_id": null, "recipient_id": "<colaborador responsável do projeto>",
  "warehouse_code": null, "needed_by": "2026-11-24",
  "destination": { "site_id": "<uuid>", "site_code": "GRU53", "address": "…", "city": "…", "state": "SP",
                   "latitude": -23.4, "longitude": -46.5 },
  "items": [ { "material_code": "RED-CAB-0123", "quantity": "1200.000" } ]
}
```

Regras do lado da Logística (detalhe na [especificação §12.2.1](../lgc-dev-logistica/docs/especificacao.md)):

- Cada item traz `material_code` **ou** `material_id` e `quantity` em string decimal (até 6 casas) ou número, maior que zero; item
  inválido ou material inexistente/inativo recusa a ordem inteira (400/422), e o Core reentrega.
- `destination` é opcional. Vira o destino da ordem (`site_id`, texto `GRU53 — endereço, cidade/UF`, latitude e longitude, que vêm
  juntas ou nenhuma) e preenche o destino do romaneio, editável antes da expedição.
- Idempotente por (`request_id`, `version`); versão maior substitui a ordem se ainda não houve separação; `cancel_requested` cancela.
- Projeto inativo bloqueia a ordem. **Centro de custo e site ausentes do cache só geram aviso** na ordem (os cadastros podem chegar
  depois do evento); inativos também só avisam.
- Sem estoque, a ordem fica `AGUARDANDO_ESTOQUE`; a Logística não compra (Suprimentos abre a compra do faltante).
- Material vai direto ao site e é baixado na confirmação da entrega (`SAIDA_ENTREGA` com projeto e centro de custo).

Do lado do Core: `request_id` é o id da requisição; `version` é sempre `1` (não há `material_request.changed` hoje); `requester_id` é `null` (o solicitante é o usuário de sistema); `recipient_id` é o colaborador responsável do projeto; `warehouse_code` é `null` (a Logística usa o almoxarifado padrão `DEFAULT_WAREHOUSE_CODE`; sem ele a ordem fica `AGUARDANDO_INFORMACAO` até alguém com `fulfillment:manage` definir o almoxarifado no detalhe da ordem, o que já dispara a reserva); `needed_by` é o início previsto da cotação aceita menos 5 dias úteis (ou `null`); `destination.address` junta rua, número, complemento, bairro e CEP do site, `latitude`/`longitude` vão ou `null`/`null`; `items[].quantity` é texto com 3 casas (`"1200.000"`). `material_request.cancel_requested` leva `request_id`, `code`, `project_id`, `cost_center_id` e `reason`, só quando a requisição já tinha sido aprovada; reprovar a requisição não emite nada.

**`site.created/updated`** (a confirmar com o PT-01 do Core): a Logística lê `site_id` (obrigatório), `code` (ou `site_code`), `name`,
`active` (opcional) e guarda o payload inteiro no cache. **`cost_center.*`** usa `cost_center_id`, `code`, `name` e `active`, como o Core já emite.

## 4. Eventos Logística → Core

O outbox da Logística envia para `AXIS_EVENTS_URL` o envelope
`{event_id, event_type, occurred_at, correlation_id, source: 'logistica', payload}` com
`Idempotency-Key`, `X-Event-Id` e `X-Logistica-Signature: sha256=<hmac do corpo>`
(`outbox-dispatcher.service.ts`). Com `AXIS_EVENTS_URL` vazio, as mensagens ficam `PENDING`.
Eventos produzidos: `receipt.divergent`, `inventory.variance_detected`, `replenishment.suggested`, `alert.raised`, entre outros, e os
da ordem de atendimento abaixo, que o Core acompanha desde o PT-09 (`LogisticsFulfillmentHandler`; os demais tipos continuam `ignored`).

**Receptor no Core** (`POST /api/v1/integration/inbound`, detalhes em
[arquitetura.md §6](arquitetura.md#6-integração-com-satélites)): valida o HMAC do corpo bruto com o
segredo do satélite, deduplica por `(satélite, event_id)` na tabela `integration_inbox` e despacha para
o handler do `event_type`. Sem handler: `202` e a mensagem fica `ignored`; erro do handler: `500` e
`failed` (a Logística reenvia pelo backoff dela).

Para ligar, na Logística:

| Variável | Valor |
|---|---|
| `AXIS_EVENTS_URL` | `https://<host do Core>/api/v1/integration/inbound` |
| `AXIS_OUTBOUND_SECRET` | segredo HMAC devolvido por `POST /integration/satellites` ao registrar a Logística (**obrigatório**: sem ele o outbox não assina e o Core responde `401`) |

A Logística precisa estar registrada e ativa no Core. As mensagens `PENDING` acumuladas são entregues
no ciclo seguinte do outbox, em ordem de criação.

### 4.1 Eventos da ordem de envio (formato exato)

`fulfillment.created`, `reservation.confirmed|partial|failed`, `shipment.dispatched` e `delivery.confirmed|partial|refused` são gravados
no outbox **na mesma transação** da escrita de negócio. Eventos da mesma transação têm o mesmo `created_at`: não dependa da ordem de
chegada, use `status` e `request_version`. Fonte do detalhe: [especificação §12.3.2](../lgc-dev-logistica/docs/especificacao.md).

Campos comuns do `payload`:

| Campo | Conteúdo |
|---|---|
| `fulfillment_order_id` (e `order_id`, igual) | id da ordem na Logística |
| `order_code` | `ATD-00000007` |
| `axis_request_id` | `request_id` do `material_request.approved` do Core |
| `request_version` | versão da requisição atendida |
| `project_id`, `cost_center_id` | como vieram no pedido |
| `status` | situação da ordem **depois** da operação (`RESERVADA`, `RESERVADA_PARCIAL`, `AGUARDANDO_ESTOQUE`, `EXPEDIDA`, `ENTREGUE`, `DIVERGENCIA`, …) |
| `status_reason` | motivo legível ou `null` |
| `destination` | `{ site_id, text, latitude, longitude }` ou `null` |
| `items` | `[{ material_id, material_code, description, unit, quantity }]`, `quantity` em string decimal (não vai em `reservation.*`) |

| Evento | Situação (`status`) | `items` | Campos extras |
|---|---|---|---|
| `fulfillment.created` | resultado da reserva: `RESERVADA`, `RESERVADA_PARCIAL`, `AGUARDANDO_ESTOQUE`, `AGUARDANDO_INFORMACAO`, `BLOQUEADA` ou `EM_ANALISE` | o pedido, com `reserved` e `shortage` por item | — |
| `shipment.dispatched` | `EXPEDIDA` | itens dos volumes expedidos | `shipment_id`, `shipment_code`, `manifest`, `carrier`, `route`, `vehicle`, `dispatched_at`, `packages` |
| `delivery.confirmed` | `ENTREGUE` | entregue **nesta** confirmação | `shipment_id`, `shipment_code`, `manifest`, `delivered_at`, `receiver_name`, `receiver_id`, `pending_packages: 0` |
| `delivery.partial` | `EXPEDIDA` | entregue nesta confirmação | os mesmos, com `pending_packages` maior que zero |
| `delivery.refused` | `DIVERGENCIA` | o recusado | os mesmos, mais `reason` |

**Tratamento no Core (PT-09, implementado)**, detalhe em [requisicoes-estado-atual.md §16.1](dominio/requisicoes-estado-atual.md#161-acompanhamento-da-logística-pt-09): `fulfillment.created` → requisição `em_atendimento`, guarda `order_code`, a situação (inclusive `AGUARDANDO_ESTOQUE`, PA-11) e a falta por item (`reserved`/`shortage`); `shipment.dispatched` → `aguardando_entrega` com o comentário "Expedido para o site" (romaneio e transportadora); `delivery.confirmed` → encerra a requisição; `delivery.partial` → mantém, somando os `items` entregues por material; `delivery.refused` → comentário com `reason`. O Core acha a requisição por `axis_request_id`, ignora `request_version` menor que o guardado, não depende da ordem de chegada (decide por `status` e `occurred_at`) e repetir o `event_id` não duplica nada. Requisição inexistente, que não é envio de material, ou evento vindo de outro satélite → `failed` (500; a Logística reenvia). A situação guardada aparece na requisição e na etapa "Requisição de envio" da jornada do projeto ([cadastros.md §10.5](dominio/cadastros.md#105-jornada-do-projeto-pt-11)); **nenhum valor em R$ vai ao Core** (o custo da entrega fica no Financeiro). O custo em R$ da entrega vem em
`stock.movement.posted` (`project_id`, `cost_center_id`) e, no Financeiro, por `consumption-by-cost-center`.

### 4.2 Consulta de materiais e custo (Core e Financeiro → Logística, por chave)

`GET /api/v1/integration/materials` com `X-Api-Key` (`INTEGRATION_API_KEY` da Logística) em um de dois modos, **mutuamente exclusivos**
(os dois juntos ou nenhum: `400`):

- `codes=A,B`: 1 a 200 códigos; devolve na ordem pedida; código inexistente ou de material inativo vai para `notFound`.
- `search=texto`: mínimo de 2 caracteres depois do `trim`; "contém", sem diferenciar maiúsculas, em `code` ou `shortDescription`; ordem:
  código igual ao termo, depois os que começam com o termo, depois o resto, por `code`; `limit` padrão 20, máximo 50 (acima disso vale 50);
  `notFound` sempre vazio. Usado pelo seletor de materiais da cotação do Financeiro.

Só materiais `ATIVO` aparecem. `warehouse_code` opcional vale nos dois modos. Resposta `200`, igual nos dois:

```json
{ "items": [ { "id": "<uuid>", "code": "RED-CAB-0123", "shortDescription": "Cabo óptico 12F", "unit": "M",
               "averageCost": "3.3000", "lastCost": "3.4500", "available": "1500", "active": true } ],
  "notFound": ["COD-DESCONHECIDO"] }
```

Sem chave ou chave errada `401`; sem `INTEGRATION_API_KEY` no servidor `503`. Custos são strings com 4 casas (ou `null`); `available` é o
disponível publicável. O custo médio é móvel e recalculado a cada recebimento
([especificação §12.5](../lgc-dev-logistica/docs/especificacao.md)); o Core usa o valor só para estimar a requisição e o Financeiro não o lê.

## 5. Próximos passos (ordem sugerida)

1. Endurecer o SSO (§1) — risco de segurança.
2. ~~Definir e implementar o contrato de requisição de material~~ (feito para o envio de material para obra, §3.1: o Core emite
   `material_request.approved/cancel_requested`). Falta `user.disabled` e, se a compra de material passar a ir à Logística, `material_request.*` dela.
3. ~~Criar o receptor de eventos da Logística no Core~~ (feito: `POST /integration/inbound`, HMAC,
   idempotência, §4). Falta ligar `AXIS_EVENTS_URL`/`AXIS_OUTBOUND_SECRET` e escrever os handlers de
   negócio dos eventos da §4.1 (PT-09).
4. Validar preço e material no servidor: feito para o valor estimado do envio de material (o Core chama a rota da §4.2 com a chave de serviço ao aprovar o projeto); a **compra** ainda grava `materialId`/`unitPrice` enviados pelo cliente.
5. Proteger custo no `purchase-catalog` (`material:read_cost`) e paginar.
6. ~~Remover `SEED_REVISED_CATALOG` do runtime~~ (feito: o filtro saiu da listagem e do
   `purchase-catalog`, e o compose a define como `false`). Falta aposentar o seed `REV-` em si:
   `prisma/revised-catalog.ts` e `syncRevisedCatalog`, hoje redundantes com `prisma/materiais-lgc.csv`.
7. Extrair os tipos de contrato (envelope, eventos, DTOs de catálogo/disponibilidade, claims do JWT)
   para um pacote compartilhado e validar nos dois lados no CI.
