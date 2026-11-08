# Integração Core ↔ Financeiro

Contratos entre o Axis Core e o satélite Financeiro (`lgc-dev-financeiro/`), escritos em 2026-11-07
junto com a entrega F0. Detalhe do domínio e dos payloads:
[../lgc-dev-financeiro/docs/especificacao.md §2 e §5](../lgc-dev-financeiro/docs/especificacao.md#2-arquitetura-e-integração).

## Resumo

| Canal | Direção | Estado |
|---|---|---|
| Login e refresh no Core pelo navegador (CORS) | Financeiro web → Core | Funciona; o Core precisa listar a origem do Financeiro em `CORS_ALLOWED_ORIGINS` |
| Access token do Core na API do Financeiro | Core → Financeiro | Funciona; o Financeiro recusa tokens com `iss` e não troca por sessão própria |
| Launcher ("Abrir") | Core → Financeiro | **Não suportado** até o Core emitir token de launcher com `typ`/`aud` e `jti` de uso único |
| Webhook de dados mestres | Core → Financeiro | Funciona para `collaborator.*`, `client.*`, `project.*`, `cost_center.*` |
| Webhook de compra, reembolso e adiantamento | Core → Financeiro | **Contratos novos; o Core ainda não emite** |
| Eventos de pagamento | Financeiro → Core | Outbox pronto; **o Core não tem receptor** |
| API de consulta por API key | Financeiro → Core | Disponível no Core; o Financeiro ainda não usa |
| Consulta de projetos e clientes com o token do usuário (`GET /projects`, `GET /clients` do Core) | Financeiro → Core | Usada pelo botão "Atualizar do Axis Core" do módulo Projetos (PJ2); respeita `project:read`/`client:read` de quem clicou. URL em `AXIS_API_URL` |

## 1. Identidade

- `JWT_SECRET` do Financeiro = `JWT_ACCESS_SECRET` do Core; algoritmo fixo `HS256`.
- O Financeiro ignora as permissões do token e resolve as próprias: `axis_role_to_finance_role`
  (inicial: `admin → ADMIN_TECNICO`) mais `user_finance_roles`. O Core não tem papel financeiro (F-03).
- Sem `user.disabled`, um usuário desativado no Core perde o acesso quando o access token (15 min)
  expira. Com o evento, o bloqueio é imediato.

## 2. Eventos Core → Financeiro

Mesmo envelope e assinatura usados com a Logística (`{event_id, event_type, occurred_at, payload}`,
`X-Axis-Signature: sha256=<hmac>`). Receptor: `POST /api/v1/webhooks/axis`.

| Evento | Core emite? | Financeiro consome? |
|---|---|---|
| `collaborator.created/updated/offboarded` | sim | sim (cache) |
| `client.created/updated` | sim | sim (cache) |
| `project.created/updated/status_changed/deleted` | sim (`updated` e `deleted` desde 2026-11-07) | sim (cache; `encerrado` = inativo) |
| `user.disabled` | **não** | sim (bloqueio) |
| `cost_center.created/updated` | sim (desde 2026-11-07; exclusão vai como `updated` com `active: false`) | sim (cache) |

Todo `project.*` leva o estado completo do projeto: `project_id`, `code`, `name`, `status`,
`client_id`, `cost_center_id`, `cost_center_code`, `cost_center_name`, `responsible_collaborator_id`,
`planned_start_date`, `planned_end_date` (`AAAA-MM-DD` ou `null`). `project.updated` traz também
`changed_fields`; `project.status_changed`, `previous_status`; `project.deleted` (exclusão de
proposta) vai com `status: 'encerrado'` e `deleted: true`, e o Financeiro marca o projeto inativo.
Projeto antigo sem nome (`name: null`) não apaga o nome já guardado no cache. `cost_center.*` leva
`cost_center_id`, `code`, `name`, `sector_id`, `parent_cost_center_id`, `responsible_collaborator_id`
e `active`. Contrato no Core: [dominio/cadastros.md §4 e §10](dominio/cadastros.md#10-projetos).
O Financeiro usa nome e prazo previsto no cabeçalho do orçamento e o centro de custo no rateio
(decisão P-07 da especificação de Projetos).
| `purchase.order_registered`, `purchase.delivery_received` | **não** | a partir da F4 |
| `finance_request.approved` | **não** | a partir da F5 |
| `request.*` | sim | guardado como `IGNORED` |

## 3. Eventos Financeiro → Core

Outbox do Financeiro → `AXIS_EVENTS_URL`, com `X-Financeiro-Signature` e `Idempotency-Key`.
Eventos previstos: `payable.approved`, `payable.paid`, `payable.cancelled` (F6). Com
`AXIS_EVENTS_URL` vazio, ficam `PENDING`. O receptor no Core (`POST /integration/inbound`) é o mesmo
pré-requisito da Logística ([integracao-core-logistica.md §5](integracao-core-logistica.md#5-próximos-passos-ordem-sugerida)).

## 4. O que o Core precisa fazer (ordem sugerida)

1. Incluir a origem do Financeiro em `CORS_ALLOWED_ORIGINS` e cadastrar o satélite (sem `frontendUrl`).
2. Emitir `user.disabled`. (`cost_center.created/updated` e `project.updated/deleted` com o estado
   completo do projeto já são emitidos desde 2026-11-07.)
3. Emitir `purchase.order_registered` e `purchase.delivery_received` no registro do pedido e no
   recebimento da compra, na mesma transação, com fornecedor, itens, valores, CC e projeto.
4. Decidir F-01 (dono do cadastro de fornecedores) e, se for o Financeiro, trocar o texto livre
   `supplier` da cotação por `supplierId`.
5. Criar o receptor de eventos de satélite e mostrar na requisição de compra o estado do pagamento.
6. Token de launcher dedicado, para habilitar o botão "Abrir".
