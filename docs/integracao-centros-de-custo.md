# Centros de custo: contratos entre Core, Logística e Financeiro

Escrito em 2026-11-08. Objetivo: o Financeiro mostrar, por centro de custo (CC), quanto cada um gasta,
compromete e gera de receita, com orçamento × realizado, rateio do overhead e o painel das equipes
técnicas (ex.: `DC-001-JAI`). Este documento é a fonte dos contratos; o detalhe de cada sistema fica em
[dominio/cadastros.md §4 e §7](dominio/cadastros.md), [integracao-core-financeiro.md](integracao-core-financeiro.md),
na especificação da Logística e em `lgc-dev-financeiro/docs/centros-de-custo-especificacao.md`.

Convenções: valores em reais vão como **string decimal com 2 casas** (`"1234.56"`); datas de
competência em `AAAA-MM-DD` (fuso `America/Sao_Paulo`); instantes em ISO 8601.

## 1. Core: cadastro do centro de custo

Campos novos em `cost_centers`:

| Campo | Regra |
|---|---|
| `kind` | `divisao`, `administrativo`, `operacional` ou `equipe_tecnica`. Obrigatório; padrão `administrativo`. A migração marca as raízes como `divisao`. |
| `short_code` | Sigla legível, opcional e única (ex.: `DC-001-JAI`). Maiúsculas, dígitos e hífen: `^[A-Z0-9]+(-[A-Z0-9]+)*$`, até 30 caracteres. Não substitui o `code` gerado. |
| `budget_status`, `budget_percent`, `budget_year`, `budget_status_at` | Situação do orçamento informada pelo Financeiro (§4). Somente leitura na API do Core. |

`cost_center.created/updated` passam a levar também `kind` e `short_code`.

## 2. Core: alocação do colaborador no CC (com vigência)

Tabela `collaborator_cost_center_allocations`: `collaborator_id`, `cost_center_id`, `valid_from`
(`DATE`), `valid_to` (`DATE`, nulo = vigente; exclusivo: o último dia é `valid_to - 1`). Uma vigente por
colaborador. Trocar o CC do colaborador fecha a vigente e abre outra a partir de
`costCenterEffectiveFrom` (opcional no `PUT /collaborators/:id`; padrão = hoje em São Paulo; não pode
ser anterior ao início da vigente). Desligar fecha a vigente na data do desligamento.
A migração cria uma alocação para quem já tem CC, a partir de `admission_date` (ou `created_at`).

Leitura: `GET /collaborators/:id/cost-center-history` (`collaborator:read`).

Eventos:

| Evento | Payload |
|---|---|
| `collaborator.created`, `collaborator.updated` | o que já existia **mais** o estado: `collaborator_id`, `name`, `status`, `sector_id`, `cost_center_id`, `job_title_id`, `job_title_name`, `admission_date` |
| `collaborator.cost_center_changed` (novo; também na criação com CC e no desligamento) | `collaborator_id`, `name`, `job_title_id`, `job_title_name`, `previous_cost_center_id` (ou `null`), `cost_center_id` (ou `null` no desligamento), `valid_from` (`AAAA-MM-DD`) |

## 3. Core: compras, reembolsos e adiantamentos

Emitidos na mesma transação da escrita de negócio.

| Evento | Quando | Payload |
|---|---|---|
| `purchase.approved` | a compra recebe a aprovação final (do responsável do CC) | `request_id`, `code`, `cost_center_id`, `project_id`, `requester_id`, `approved_at`, `total`, `groups[]` |
| `purchase.order_registered` | primeiro registro do pedido ao fornecedor | os mesmos campos (com `ordered_at` no lugar de `approved_at`) e, em cada grupo, `order_number`, `order_date`, `expected_delivery_date` |
| `purchase.delivery_received` | cada confirmação de recebimento | `request_id`, `code`, `cost_center_id`, `project_id`, `received_at`, `all_received`, `groups[]` (só os recebidos agora) |
| `purchase.cancelled` | cancelamento de compra já aprovada | `request_id`, `code`, `cost_center_id`, `project_id`, `cancelled_at` |
| `finance_request.approved` | reembolso ou adiantamento aprovado | `request_id`, `code`, `kind` (`reembolso` ou `adiantamento`), `collaborator_id` (favorecido), `cost_center_id`, `project_id`, `amount`, `approved_at` |

`groups[]`: `group_id`, `supplier`, `total` e `items[]` (`material_id` ou `null`, `description`,
`quantity`, `unit_price`, `total`). Grupo atendido pelo estoque da Logística vai com `supplier: "Estoque"`
e conta como consumo de material, não como compra. Por isso o `total` da compra é a soma dos grupos de
fornecedor, sem o Estoque (cada grupo traz o seu `total`). O grupo Estoque é valorizado pelo valor
unitário informado na requisição. `unit_price` vai com 2 casas (arredondado; a cotação guarda 4) e o
`total` do item é o calculado com o preço cheio. `order_number` pode ser `null`. A categoria de
`finance_request.approved` é reconhecida pelo código (`FIN-REEMBOLSO`, `FIN-ADIANTAMENTO`) e o valor vem
do campo `valor` do formulário; sem valor válido o evento não é emitido.

## 4. Financeiro → Core: situação do orçamento do CC

`PUT /api/v1/integration/cost-centers/:id/budget-status` com a API key do satélite (mesmo mecanismo da
devolução da cotação). Corpo: `year`, `budget`, `committed`, `realized`, `percent` (número, 0–999,
consumo = (comprometido + realizado) ÷ orçamento × 100), `status` (`ok` < 80%, `alerta` 80–99%,
`estourado` ≥ 100%), `computed_at`. O Financeiro envia pelo outbox, com retry, sempre que o consumo
de um CC muda de faixa ou o orçamento é alterado.

Efeito no Core: compra submetida para um CC `estourado` ganha uma etapa final de aprovação do
responsável do CC pai (`approvalSource: 'orcamento_cc'`), quando ele existe e não é a mesma pessoa que
já aprova pelo CC. A tela do CC e o detalhe da compra mostram a situação.

Detalhes do receptor (2026-11-08): só aceita o satélite que assina `cost_center.updated`; um
`computed_at` mais antigo que o gravado é ignorado (`200`, `applied: false`); o Core guarda só
`status`, `percent`, `year` e `computed_at`. A regra da etapa vale quando `year` é o ano corrente (São
Paulo), é avaliada no envio da compra para aprovação e também não se aplica quando o responsável do
CC pai é o solicitante ou o beneficiário.

## 5. Logística → Financeiro: consumo e custódia por CC

API por chave (`X-Api-Key`, variável `INTEGRATION_API_KEY` na Logística; `LOGISTICA_API_URL` e
`LOGISTICA_API_KEY` no Financeiro):

- `GET /api/v1/integration/consumption-by-cost-center?month=AAAA-MM` → `[{ cost_center_id, project_id, value, movements }]`:
  valor das saídas de entrega (`quantity × unit_cost`, descontados os estornos) da competência.
- `GET /api/v1/integration/custody-value` → `[{ custodian_id, items, value }]`: bens em custódia ativa
  por colaborador custodiante, valorizados pelo custo.

Detalhes fixados na implementação (Logística, `docs/especificacao.md §12.3.1`):

- Sem `INTEGRATION_API_KEY` configurada → 503; chave ausente ou errada → 401; `month` fora de `AAAA-MM` → 400.
- Competência pelo `effective_at` do movimento, mês em `America/Sao_Paulo`. O estorno de uma saída entra
  **negativo no mês em que foi lançado** (o mês já importado não muda); um mês pode fechar com `value` negativo.
- `cost_center_id` e `project_id` podem vir nulos (entrega sem CC ou sem projeto). `movements` conta saídas e
  estornos lançados.
- Custódia: `items` = termos ativos com saldo; `value` = saldo não devolvido × custo médio do material (na falta,
  último custo). `custodian_id` é o id do colaborador/usuário do Axis gravado no termo.

O painel da Logística também passa a mostrar o consumo em R$ por centro de custo.

**Importação no Financeiro (PT-07):** além do botão por competência, o Financeiro chama
`consumption-by-cost-center` todo dia (mês anterior e corrente, agendador do Financeiro, ver
[centros-de-custo-especificacao §2.1](../lgc-dev-financeiro/docs/centros-de-custo-especificacao.md#21-importação-diária-do-consumo-da-logística-pt-07)).
A rota é só leitura e a importação é idempotente por competência e por (CC, projeto), então chamar várias vezes
não custa nada além da consulta.

## 6. Core: reenvio dos cadastros (carga inicial do satélite)

O Core só emite `cost_center.*`, `collaborator.*` e `site.*` quando o cadastro muda. Um satélite que passa a assinar esses eventos depois que os cadastros já existem fica com o cache vazio. No Financeiro, isso aparece como "Nenhum centro de custo visível".

`POST /api/v1/integration/satellites/resync-master-data` (permissão `integration:manage`, auditado como `resync_master_data`), que na tela é o botão **Integrações → Reenviar cadastros**, grava no outbox, numa única transação:

- `cost_center.updated` para cada centro de custo, com o mesmo payload do §1 e `active: true`;
- `collaborator.updated` para cada colaborador, com o estado do §2;
- `collaborator.cost_center_changed` para cada alocação **vigente**, com `previous_cost_center_id: null` e o `valid_from` da alocação;
- `site.updated` para cada site de cliente (ativo ou não), com o estado completo ([cadastros.md §9.1](dominio/cadastros.md#91-sites)); desde 2026-11-08.

Os eventos vão a todos os satélites inscritos em cada tipo. Quem recebe trata como atualização, e reenviar de novo não duplica nada: o Financeiro substitui a alocação aberta que começa na mesma data. O histórico de alocações já encerradas não é reenviado.

Resposta: `{ "costCenters": n, "collaborators": n, "allocations": n, "sites": n }`.
