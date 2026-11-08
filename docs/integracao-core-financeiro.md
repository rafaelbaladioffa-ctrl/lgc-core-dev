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
| Webhook de compra, reembolso e adiantamento | Core → Financeiro | Core emite desde 2026-11-08 ([integracao-centros-de-custo.md §3](integracao-centros-de-custo.md#3-core-compras-reembolsos-e-adiantamentos)) |
| Alocação do colaborador no CC (`collaborator.cost_center_changed`) | Core → Financeiro | Core emite desde 2026-11-08 ([integracao-centros-de-custo.md §2](integracao-centros-de-custo.md#2-core-alocação-do-colaborador-no-cc-com-vigência)) |
| Situação do orçamento do CC (`PUT /integration/cost-centers/:id/budget-status`) | Financeiro → Core | Core recebe desde 2026-11-08 ([integracao-centros-de-custo.md §4](integracao-centros-de-custo.md#4-financeiro--core-situação-do-orçamento-do-cc)) |
| Eventos de pagamento | Financeiro → Core | Outbox pronto; **o Core não tem receptor** |
| Pedido de cotação do projeto (`project.quote_requested`) | Core → Financeiro | Core emite e o Financeiro consome desde 2026-11-08 (fila de pedidos de cotação, PJ4) (§4) |
| Devolução da cotação (`POST /integration/projects/:id/quotes`) | Financeiro → Core | Core recebe e o Financeiro envia desde 2026-11-08 (PJ7: ao aprovar o envio, pelo outbox com retry) (§4) |
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
| `collaborator.created/updated/offboarded` | sim (`created/updated` com o estado completo desde 2026-11-08) | sim (cache) |
| `collaborator.cost_center_changed` | sim (desde 2026-11-08) | sim (alocação com vigência) |
| `client.created/updated` | sim | sim (cache) |
| `project.created/updated/status_changed/deleted` | sim (`updated` e `deleted` desde 2026-11-07) | sim (cache; `encerrado` = inativo) |
| `user.disabled` | **não** | sim (bloqueio) |
| `cost_center.created/updated` | sim (desde 2026-11-07; exclusão vai como `updated` com `active: false`) | sim (cache) |
| `project.document_added` | sim | recebido e ignorado: o Financeiro baixa o documento pelo pedido de cotação |
| `project.quote_requested` | sim (desde 2026-11-08) | sim (fila de pedidos de cotação, PJ4; §4) |

Todo `project.*` leva o estado completo do projeto: `project_id`, `code`, `name`, `status`,
`client_id`, `cost_center_id`, `cost_center_code`, `cost_center_name`, `responsible_collaborator_id`,
`planned_start_date`, `planned_end_date` (`AAAA-MM-DD` ou `null`). `project.updated` traz também
`changed_fields`; `project.status_changed`, `previous_status`; `project.deleted` (exclusão de
proposta) vai com `status: 'encerrado'` e `deleted: true`, e o Financeiro marca o projeto inativo.
Projeto antigo sem nome (`name: null`) não apaga o nome já guardado no cache. `cost_center.*` leva
`cost_center_id`, `code`, `name`, `sector_id`, `parent_cost_center_id`, `responsible_collaborator_id`,
`kind`, `short_code` e `active`. Contrato no Core: [dominio/cadastros.md §4 e §10](dominio/cadastros.md#10-projetos).
O Financeiro usa nome e prazo previsto no cabeçalho do orçamento e o centro de custo no rateio
(decisão P-07 da especificação de Projetos).
| `purchase.approved`, `purchase.order_registered`, `purchase.delivery_received`, `purchase.cancelled` | sim (desde 2026-11-08) | sim (centros de custo) |
| `finance_request.approved` | sim (desde 2026-11-08; `FIN-REEMBOLSO` e `FIN-ADIANTAMENTO`) | sim (centros de custo) |
| `request.*` | sim | guardado como `IGNORED` |

## 3. Eventos Financeiro → Core

Outbox do Financeiro → `AXIS_EVENTS_URL`, com `X-Financeiro-Signature` e `Idempotency-Key`.
Eventos previstos: `payable.approved`, `payable.paid`, `payable.cancelled` (F6). Com
`AXIS_EVENTS_URL` vazio, ficam `PENDING`. O receptor no Core (`POST /integration/inbound`) é o mesmo
pré-requisito da Logística ([integracao-core-logistica.md §5](integracao-core-logistica.md#5-próximos-passos-ordem-sugerida)).

## 4. Cotação do projeto

Decidido com o dono em 2026-11-08 (P-11 a P-15 da
[especificação de Projetos do Financeiro](../lgc-dev-financeiro/docs/projetos-especificacao.md#17-decisões-pendentes)):

```
CORE                                        FINANCEIRO
Projeto em proposta + SOW (PDF) + Bid Template do RFQ (.xlsm)
  └─ "Solicitar cotação" ──project.quote_requested──▶ orçamento aws_sow na fila do orçamentista
                                             baixa SOW e Bid Template do Core; lê o PDF
                                             calcula equipe, dias, horas-meta e valores do bid
                                             revisão submetida → aprovada para envio
  Cotação Rn  ◀──POST /integration/projects/:id/quotes── Bid preenchida (.xlsx) + dias + equipe
```

1. **Pedido (Core).** Alguém com `project:update` clica em "Solicitar cotação" (P-11). Só projeto em
   `proposta` com SOW **e** Bid Template anexados. O Core grava o pedido e emite
   `project.quote_requested` na mesma transação: estado completo do projeto mais `quote_request_id`,
   `sow_document_id`, `sow_version`, `sow_filename`, `sow_content_hash`, `bid_template_document_id`,
   `bid_template_version`, `bid_template_filename`, `bid_template_content_hash`, `notes`,
   `requested_by_user_id`, `requested_by_email`, `requested_at`. Pedir de novo (ex.: SOW nova) emite outro evento; o Financeiro reaproveita o
   orçamento do projeto e cria nova revisão quando a SOW mudou.
2. **SOW (Financeiro).** A SOW é PDF (P-13). O Financeiro baixa o arquivo por
   `GET /integration/projects/:id/documents/:documentId/content` (precisa assinar
   `project.document_added`) e extrai o texto para o parser da §7.1 da especificação. O orçamentista
   confere linha a linha, como já previsto.
3. **Devolução (Financeiro → Core).** Quando a revisão é **aprovada para envio** (P-12), o Financeiro
   grava na própria outbox e envia ao Core, com retry, usando a API key do satélite:

```http
POST /api/v1/integration/projects/:axisProjectId/quotes
Authorization: Bearer <api_key>
Content-Type: application/json

{
  "external_revision_id": "<id da revisão no Financeiro>",
  "revision_number": 2,
  "sow_document_id": "<id da SOW do Core usada>",
  "work_days": 10,
  "planned_start_date": "2026-12-01",
  "planned_end_date": "2026-12-12",
  "team": [
    { "role_key": "tecnico", "role_name": "Técnico", "field_role": true, "people": 3, "days": 10, "hours": 264 },
    { "role_key": "encarregado", "role_name": "Encarregado", "field_role": true, "people": 1, "days": 10, "hours": 88 },
    { "role_key": "gerente_projeto", "role_name": "Gerente de projeto", "field_role": false, "hours": 20 }
  ],
  "materials": [
    { "material_code": "RED-CAB-0123", "description": "Cabo óptico 12F", "unit": "m", "quantity": "1200.000" }
  ],
  "approved_at": "2026-11-20T14:03:00Z",
  "approved_by_email": "gestor@lgc.com.br",
  "bid": { "filename": "Bid PROP-100.001-1126 R2.xlsx", "content_base64": "<xlsx>" }
}
```

   - Só o satélite que **assina** `project.quote_requested` pode enviar (`403`).
   - Equipe = **quantidade por função** (P-15), nunca pessoas nomeadas. Função de campo exige `people`
     e `days`; o gerente vai só com `hours`. Função repetida → `400`.
   - A Bid é o **Bid Template do RFQ preenchido** (P-14): o mesmo arquivo anexado no Core, com as
     células de entrada escritas pelo Financeiro. `.xlsx`/`.xlsm`, até 25MB, tipo conferido pelos bytes.
   - **Materiais** (`materials[]`, opcional no Core para não quebrar cotações antigas; o Financeiro sempre
     envia e **recusa aprovar o envio** de material sem código da Logística, decisão PA-08 do
     [plano do projeto aprovado](plano-projeto-aprovado-ponta-a-ponta.md)): `material_code` é o `Material.code`
     do catálogo da Logística, `quantity` é texto decimal positivo com até 3 casas. **Nada de preço, custo,
     markup nem frete** (campo extra → `400`). `material_code` repetido → `400`. A quantidade é a orçada,
     sem perdas: o motor do Financeiro aplica perdas como percentual do **custo**, não da quantidade; o
     Financeiro soma linhas do mesmo código antes de enviar. Cabos fornecidos pela AWS (instalação apenas)
     não entram. O Core guarda o código, a descrição, a unidade e a quantidade em `project_quote_materials`
     (`logistics_material_id` fica nulo até a consulta à Logística do PT-06).
   - **Idempotência:** mesma `external_revision_id` com a mesma Bid **e os mesmos materiais** devolve a
     cotação já gravada (`201` com o mesmo `id`); com outra Bid ou outros materiais → `409` (revisão aprovada
     não muda; mande nova revisão). Cotação antiga sem materiais reenviada sem materiais continua idempotente.
   - Nenhum campo de custo, salário, imposto ou lucro: o DTO recusa campos extras (`400`).
4. **No Core.** A seção "Cotação do Financeiro" do projeto mostra a situação (`aguardando` /
   `recebida`), a revisão vigente, dias, pessoas em campo, horas, equipe por função, a **lista de
   materiais** da revisão e o download da Bid; as revisões anteriores ficam como "Substituída". Detalhe: [dominio/cadastros.md §10.2](dominio/cadastros.md#102-cotação-pelo-financeiro).

**Cadastro do satélite:** a API key entregue ao cadastrar vai em `AXIS_API_KEY` do Financeiro (download
da SOW e do Bid Template e envio da cotação). O Financeiro precisa assinar `project.*`, `project.document_added` e
`project.quote_requested`.

## 5. O que o Core precisa fazer (ordem sugerida)

1. Incluir a origem do Financeiro em `CORS_ALLOWED_ORIGINS` e cadastrar o satélite (sem `frontendUrl`).
2. Emitir `user.disabled`. (`cost_center.created/updated` e `project.updated/deleted` com o estado
   completo do projeto já são emitidos desde 2026-11-07.)
3. ~~Emitir `purchase.*` e `finance_request.approved`~~ — feito em 2026-11-08
   ([integracao-centros-de-custo.md §3](integracao-centros-de-custo.md#3-core-compras-reembolsos-e-adiantamentos)).
   O Financeiro precisa assinar `purchase.*`, `finance_request.approved` e
   `collaborator.cost_center_changed`, e assinar `cost_center.updated` para poder enviar a situação do
   orçamento (`PUT /integration/cost-centers/:id/budget-status`).
4. Decidir F-01 (dono do cadastro de fornecedores) e, se for o Financeiro, trocar o texto livre
   `supplier` da cotação por `supplierId`.
5. Criar o receptor de eventos de satélite e mostrar na requisição de compra o estado do pagamento.
6. Token de launcher dedicado, para habilitar o botão "Abrir".
