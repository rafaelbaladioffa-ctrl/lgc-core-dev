# Axis Financeiro — especificação

Satélite financeiro do Axis. Primeira frente: **contas a pagar**. Documento de **alvo**: a seção
[§12](#12-entregas) diz o que já existe no código; o resto ainda não foi implementado.

Redigido em 2026-11-07 a partir de: [arquitetura do Core](../../docs/arquitetura.md),
[integração Core ↔ Logística](../../docs/integracao-core-logistica.md),
[Requisições — estado atual](../../docs/dominio/requisicoes-estado-atual.md) (fluxo de compra),
[spec de Requisições §7.12–7.13](../../docs/dominio/requisicoes-spec.md#712-financeiro--700) e
[decisões de negócio](../../docs/dominio/decisoes-negocio.md) (B01, B03, P26-02).

## 0. Resumo

| Item | Decisão |
|---|---|
| Onde mora | Subpasta `lgc-dev-financeiro/` deste repositório, como a Logística (decisão A8 do Core) |
| Stack | NestJS 12 (ESM) + Prisma 5 + PostgreSQL 16; frontend React 19 + Vite 8 |
| Banco | Próprio: `axis_financeiro`. Nunca lê o banco do Core (A2) |
| Portas de desenvolvimento | API `:3200`, Postgres `:5434`, web `:5175` |
| Identidade | Sem login próprio. Aceita o access token do Core (HS256, mesmo segredo) |
| Autorização | RBAC local: papéis do Core → perfis do Financeiro, mais perfis concedidos por usuário |
| Integração | Webhook do Core (HMAC) para dados mestres e eventos de compra; outbox próprio para avisar o Core |
| MVP | Fornecedores, contas bancárias da empresa, títulos a pagar com parcelas e rateio, aprovação, programação e baixa |

## 1. Princípios

1. **O Core é a fonte da verdade** de usuários, colaboradores, centros de custo, projetos, clientes e
   requisições. O Financeiro guarda só um cache desses dados (`axis_master_cache`) e nunca os edita.
2. **O Financeiro é a fonte da verdade** de fornecedores (dados fiscais e bancários), títulos,
   pagamentos e contas bancárias da empresa. Ver decisão pendente F-01.
3. **Dinheiro é decimal**: `NUMERIC(14,2)` no banco e `Prisma.Decimal` no código. Nada de `number`
   para valores. Arredondamento meio-para-cima, só na última operação.
4. **Datas de negócio são datas** (`DATE`, sem hora): vencimento, emissão, competência, pagamento.
   Instantes (`TIMESTAMPTZ`) só para auditoria. Fuso de referência `America/Sao_Paulo`.
5. **Nada se apaga.** Título vira `cancelado`, baixa vira estornada por um lançamento inverso
   vinculado. Auditoria append-only.
6. **Segregação de funções** (§3.2) é regra de servidor, não de tela.
7. **Eventos na mesma transação** da escrita de negócio (regra 6 do `AGENTS.md`).

## 2. Arquitetura e integração

```
 navegador ── login/refresh (CORS) ──▶ API Core :3000
     │                                      │ webhook X-Axis-Signature (outbox do Core)
     │ Bearer <access token do Core>        ▼
     └────────────────────────────────▶ API Financeiro :3200 ──▶ Postgres axis_financeiro
                                            │ outbox → POST {AXIS_EVENTS_URL} (X-Financeiro-Signature)
                                            ▼
                                       Core (receptor ainda não existe)
```

### 2.1 Identidade

- O frontend do Financeiro faz login e refresh **no Core** (`POST /auth/login`, `/auth/refresh`) por
  CORS, como o PWA da Logística. O Core precisa listar a origem do Financeiro em `CORS_ALLOWED_ORIGINS`.
- A API valida o access token com `JWT_SECRET` = `JWT_ACCESS_SECRET` do Core, algoritmo fixo `HS256`.
- **Recusa qualquer token com `iss`.** Os tokens do Core não têm emissor; os da Logística têm
  `iss=axis-logistica` (sessões de 8 h). Assim uma sessão longa da Logística não abre o Financeiro.
- **Não há troca por sessão própria** (`/auth/exchange`), ao contrário da Logística: o problema 1 de
  [integracao-core-logistica.md §1](../../docs/integracao-core-logistica.md#1-identidade-e-sessão)
  não se repete aqui. O botão "Abrir" do Core (launcher) fica para depois de o Core emitir token de
  launcher com `typ`/`aud` próprios e `jti` de uso único.
- `mustChangePassword = true` → 403 em toda rota autenticada.
- Usuário desativado no Core: sem o evento `user.disabled`, o acesso termina quando o access token
  (15 min) expira e o refresh é recusado pelo Core. Quando o evento existir, o Financeiro passa a
  recusar o usuário imediatamente pelo cache.

### 2.2 Autorização

Permissões do token do Core são **ignoradas**. Vale o RBAC local (§3): `axis_role_to_finance_role`
(papel do Core → perfis do Financeiro) mais `user_finance_roles` (perfil concedido a um usuário do
Core). Toda rota usa `@RequirePermissions`; rotas que alteram dados são auditadas.

### 2.3 Eventos Core → Financeiro

Receptor `POST /api/v1/webhooks/axis`: HMAC-SHA256 do corpo bruto (`X-Axis-Signature: sha256=<hex>`,
segredo `AXIS_WEBHOOK_SECRET`), janela anti-replay (`WEBHOOK_MAX_AGE_HOURS`), idempotência por
`event_id` em `integration_messages`, eventos fora de ordem não sobrescrevem o cache.

| Evento | Uso no Financeiro | Core emite hoje? |
|---|---|---|
| `collaborator.created/updated/offboarded` | cache (favorecido de reembolso/adiantamento) | sim |
| `client.created/updated` | cache (contas a receber, futuro) | sim |
| `project.created/status_changed` | cache (rateio por projeto) | sim |
| `cost_center.created/updated` | cache (rateio por CC) | **não** |
| `user.disabled` | bloqueio imediato | **não** |
| `purchase.order_registered` | cria título previsto (§5.1) | **não** — contrato novo |
| `purchase.delivery_received` | libera o título para conferência fiscal | **não** — contrato novo |
| `request.status_changed` (cancelamento de compra) | cancela título previsto sem pagamento | sim, mas sem dados de compra |
| `finance_request.approved` (reembolso/adiantamento) | cria título para o colaborador (§5.2) | **não** — contrato novo |

Até o Core emitir os eventos de compra, o título é lançado manualmente com a referência da
requisição (código `REQ-…`).

### 2.4 Eventos Financeiro → Core

Outbox `integration_messages` (direção `OUTBOUND`), entregue a `AXIS_EVENTS_URL` com
`X-Financeiro-Signature: sha256=<hmac>` e `Idempotency-Key = event_id`; retry 1 min / 5 min / 30 min
/ 2 h, depois `FAILED` (dead-letter, reenvio manual). Com `AXIS_EVENTS_URL` vazio, fica `PENDING`.

| Evento | Quando | Payload |
|---|---|---|
| `payable.approved` | título aprovado | `payable_id`, `axis_request_id?`, `total`, `due_dates[]` |
| `payable.paid` | última parcela baixada | `payable_id`, `axis_request_id?`, `paid_at`, `total_paid` |
| `payable.cancelled` | título cancelado | `payable_id`, `axis_request_id?`, `reason` |

O Core ainda não tem receptor (`POST /integration/inbound`); é pré-requisito compartilhado com a
Logística ([integracao-core-logistica.md §5 item 3](../../docs/integracao-core-logistica.md#5-próximos-passos-ordem-sugerida)).

### 2.5 Consulta síncrona ao Core

Para preencher o cache sem esperar evento (carga inicial, CC e projetos), o Financeiro usa a API de
consulta do Core com API key (`GET /api/v1/integration/{cost-centers,projects,collaborators}`).
Nenhum dado sensível de colaborador (CPF, conta bancária) sai do Core por essa API; ver F-04.

## 3. Perfis, permissões e segregação

### 3.1 Permissões

| Permissão | Descrição |
|---|---|
| `supplier:read` | Consultar fornecedores (sem dados bancários) |
| `supplier:write` | Cadastrar e alterar fornecedores |
| `supplier:read_bank` | Ver dados bancários completos (leitura registrada) |
| `supplier:write_bank` | Alterar dados bancários (exige confirmação de outra pessoa, §4.1) |
| `bank_account:read` / `bank_account:write` | Contas bancárias da empresa |
| `payable:read` | Consultar títulos |
| `payable:write` | Lançar e corrigir títulos em rascunho |
| `payable:approve` | Aprovar ou reprovar títulos |
| `payable:cancel` | Cancelar título (com motivo) |
| `payment:schedule` | Montar e alterar programação de pagamentos |
| `payment:execute` | Registrar baixa e estorno |
| `report:read` | Agenda, posição de títulos, previsão de saídas |
| `audit:read` | Trilha de auditoria |
| `rbac:read` / `rbac:write` | Perfis e mapeamentos |
| `integration:configure` | Outbox, reprocessamento, carga do cache |

### 3.2 Perfis

| Perfil | Permissões |
|---|---|
| `ANALISTA_CONTAS_PAGAR` | supplier:read/write, payable:read/write, bank_account:read, report:read |
| `APROVADOR_FINANCEIRO` | supplier:read, payable:read/approve/cancel, report:read |
| `TESOURARIA` | supplier:read/read_bank, bank_account:read/write, payable:read, payment:schedule/execute, report:read |
| `CADASTRO_BANCARIO` | supplier:read/read_bank/write_bank |
| `CONSULTA_FINANCEIRA` | supplier:read, payable:read, report:read |
| `AUDITOR` | leitura de tudo, audit:read, rbac:read |
| `ADMIN_TECNICO` | rbac:read/write, integration:configure, audit:read — **sem** acesso a títulos |

Mapeamento inicial dos papéis do Core: `admin → ADMIN_TECNICO`. O Core não tem papel financeiro; as
pessoas do Financeiro recebem perfis por usuário (`PUT /rbac/users/:axisUserId/roles`). Ver F-03.

**Regras de segregação (servidor):**

- Quem lançou o título não o aprova.
- Quem aprovou o título não registra a baixa dele.
- Alteração de dados bancários de fornecedor só vale depois de confirmada por outra pessoa com
  `supplier:write_bank`; até lá, o fornecedor não entra em programação.
- O solicitante da requisição de origem não aprova o título dela.

## 4. Modelo de domínio

### 4.1 Fornecedor (`suppliers`)

Pessoa jurídica ou física que recebe pagamento. Campos: tipo (PJ/PF), CNPJ/CPF (validado, único),
razão social, nome fantasia, inscrições, e-mail e telefone de cobrança, endereço, situação
(`ativo`, `bloqueado`, `inativo`), observações.

Dados bancários em `supplier_bank_accounts` (pode haver mais de uma; uma principal): banco, agência,
conta, tipo, titular e documento do titular, chave PIX. Documento e conta **criptografados**
(AES-256-GCM, `FIELD_ENCRYPTION_KEY` próprio do Financeiro); leitura completa só com
`supplier:read_bank`, registrada. Estados da conta: `pendente_confirmacao` → `confirmada` (por outra
pessoa) ou `recusada`. Titular diferente do fornecedor exige justificativa.

Colaborador como favorecido (reembolso/adiantamento) é um fornecedor tipo PF vinculado ao
`collaboratorId` do Core.

### 4.2 Conta bancária da empresa (`company_bank_accounts`)

Banco, agência, conta, apelido, saldo inicial e data do saldo, ativa. Destino das baixas. Saldo e
conciliação ficam fora do MVP (§10).

### 4.3 Título a pagar (`payables`)

| Campo | Regra |
|---|---|
| `code` | `CP-AAAA-NNNNN`, sequencial por ano |
| `origin` | `compra`, `reembolso`, `adiantamento`, `manual` |
| `axisRequestId` / `axisRequestCode` | obrigatório quando a origem não é `manual` |
| `supplierId` | obrigatório; fornecedor `ativo` |
| `description` | 3–500 caracteres |
| `issueDate`, `competenceDate` | data; competência padrão = emissão |
| `grossAmount` | > 0 |
| `retentions[]` | tipo (`ISS`, `IRRF`, `INSS`, `PIS_COFINS_CSLL`, `outra`), base, alíquota, valor — informados, não calculados no MVP |
| `netAmount` | bruto − retenções, calculado pelo servidor |
| `installments[]` | ≥ 1; soma = líquido; vencimentos crescentes |
| `allocations[]` | rateio, §4.5 |
| `fiscalDocument` | §4.4; obrigatório para aprovar quando origem `compra` ou `manual` com fornecedor PJ |
| `attachments[]` | nota, boleto, comprovantes |
| `status` | §4.8 |

### 4.4 Documento fiscal

Tipo (`nfe`, `nfse`, `fatura`, `recibo`, `outro`), número, série, chave de acesso (44 dígitos para
NF-e, validada pelo dígito), data de emissão, valor. A mesma chave ou a combinação
fornecedor + tipo + número + série não pode existir em dois títulos ativos (bloqueia pagamento em
duplicidade). Leitura de XML fica fora do MVP.

### 4.5 Rateio (`payable_allocations`)

Cada linha: centro de custo do Core (obrigatório), projeto do Core (opcional), percentual ou valor.
A soma tem de fechar 100 % / o valor líquido, com a diferença de centavo jogada na última linha.
CC e projeto precisam existir e estar ativos no cache. Título de compra herda o CC da requisição.

### 4.6 Aprovação

- Um título em `aguardando_aprovacao` é aprovado ou reprovado por alguém com `payable:approve`,
  respeitando §3.2.
- Alçada por valor: **pendente** (F-02). Até ela existir, uma aprovação basta e o valor fica
  registrado para auditoria.
- Compra já aprovada no Core (pelo responsável do CC) **não dispensa** a aprovação financeira: a do
  Core aprova o gasto; a do Financeiro confere documento, valor e vencimento contra o pedido.
  Divergência de valor acima da tolerância (F-05) exige justificativa.

### 4.7 Programação e baixa

- **Programação** (`payment_batches`): data prevista, conta da empresa, lista de parcelas aprovadas.
  Estados `aberta` → `fechada` → `liquidada`/`parcial`. Uma parcela fica em uma programação por vez.
- **Baixa** (`payments`): parcela, data do pagamento, conta da empresa, valor pago, juros, multa,
  desconto, forma (`pix`, `ted`, `boleto`, `debito`, `dinheiro`), comprovante, observação. Baixa
  parcial permitida; a parcela fica `parcialmente_paga` até zerar.
- **Estorno**: lançamento inverso vinculado, com motivo; reabre a parcela.
- Exportação de remessa CNAB e retorno bancário ficam fora do MVP.

### 4.8 Estados do título

```
rascunho ──enviar──▶ aguardando_aprovacao ──aprovar──▶ aprovado ──programar──▶ programado
   ▲                     │      │                         │                       │
   └──── devolver ───────┘   reprovar                     │                   baixa total
                                ▼                         ▼                       ▼
                            reprovado                parcialmente_pago ──────▶ pago
  previsto (origem compra, sem nota) ──receber nota──▶ rascunho
  cancelado: de previsto, rascunho, aguardando_aprovacao, aprovado ou programado sem baixa
```

`previsto` existe para a previsão de saída de caixa: o pedido de compra foi registrado no Core, mas
a nota ainda não chegou.

## 5. Origens do título

### 5.1 Compra (Requisições do Core)

1. Suprimentos registra o pedido ao fornecedor no Core (`POST /requests/:id/purchase-order`).
2. O Core emite `purchase.order_registered` com: `request_id`, `code`, `cost_center_id`,
   `project_id?`, `requester_id`, e por grupo de entrega `group_id`, `supplier` (nome; CNPJ quando o
   Core tiver cadastro de fornecedor), itens (`material_id`, `description`, `quantity`, `unit_price`,
   `total`), `order_number`, `order_date`, `expected_delivery_date`.
3. O Financeiro cria um título `previsto` por grupo de fornecedor, casando o fornecedor pelo CNPJ ou,
   sem CNPJ, deixando-o pendente de vínculo pelo analista.
4. `purchase.delivery_received` marca o grupo como recebido; o analista anexa a nota, confere e envia
   para aprovação.
5. Cancelamento da compra no Core cancela os títulos `previsto`/`rascunho`; com título aprovado ou
   pago, abre pendência para o analista (não cancela sozinho; relaciona-se com B04).

**Pré-requisito no Core:** emitir esses eventos e, idealmente, ter fornecedor com CNPJ na cotação
(hoje `supplier` é texto livre, 1–120 caracteres).

### 5.2 Reembolso e adiantamento

Categorias `Reembolso` e `Adiantamento` já existem no seed do Core. Aprovadas, o Core emite
`finance_request.approved` com `request_id`, `code`, `kind`, `collaborator_id`, `amount`,
`cost_center_id`, `project_id?`. O Financeiro cria o título para o colaborador-favorecido. Prestação
de contas do adiantamento fica fora do MVP.

### 5.3 Manual

Lançado pelo analista com `payable:write` (contas de consumo, impostos, aluguel, serviços sem
requisição). Mesmo fluxo de aprovação.

## 6. API (alvo do MVP)

Prefixo `api/v1`. Paginação `{ data, meta: { page, per_page, total } }`. Erros em pt-BR com `code`.

| Rota | Permissão |
|---|---|
| `GET /health` | pública |
| `GET /me` | autenticado |
| `GET/POST /suppliers`, `GET/PATCH /suppliers/:id` | supplier:read / supplier:write |
| `POST /suppliers/:id/bank-accounts`, `POST …/:accountId/confirm` | supplier:write_bank |
| `GET /suppliers/:id/bank-accounts?full=true` | supplier:read_bank |
| `GET/POST /company-bank-accounts`, `PATCH /:id` | bank_account:read / write |
| `GET/POST /payables`, `GET/PATCH /payables/:id` | payable:read / write |
| `POST /payables/:id/submit` | payable:write |
| `POST /payables/:id/approve`, `/reject`, `/return` | payable:approve |
| `POST /payables/:id/cancel` | payable:cancel |
| `GET/POST /payment-batches`, `POST /:id/items`, `/close` | payment:schedule |
| `POST /installments/:id/payments`, `POST /payments/:id/reverse` | payment:execute |
| `GET /reports/payables-agenda`, `/reports/cash-outflow-forecast` | report:read |
| `POST /webhooks/axis` | HMAC |
| `GET /integration/outbox/status`, `POST /dispatch`, `POST /:id/retry` | integration:configure |
| `GET/PUT /rbac/*` | rbac:read / rbac:write |

## 7. Telas (MVP)

Mesma identidade do Core (tokens de `axis-tokens.css`), desktop primeiro.

1. **Início**: a pagar hoje, vencidos, próximos 7 dias, aguardando aprovação.
2. **Títulos**: lista com filtros (status, fornecedor, vencimento, CC, origem), detalhe com parcelas,
   rateio, documento, anexos, histórico e ações do status.
3. **Novo título / editar rascunho**: fornecedor, documento, valores, retenções, parcelas, rateio.
4. **Aprovações**: fila do aprovador.
5. **Programação**: montar lote por data e conta, registrar baixas.
6. **Fornecedores**: cadastro, dados bancários com confirmação.
7. **Administração**: contas da empresa, perfis, outbox.

## 8. Regras de valores e datas

- Valores entram como texto decimal (`"1234.56"`), validados no DTO, até 2 casas (preço unitário até
  4). Exibição com `formatBRL`.
- Vencimento em fim de semana ou feriado: o sistema avisa e sugere o próximo dia útil (calendário de
  feriados do Core, por consulta), sem alterar sozinho.
- Juros e multa são informados na baixa; cálculo automático fica fora do MVP.

## 9. Auditoria e LGPD

- `audit_events` append-only: toda mutação (ator, rota, campos alterados — nomes, não valores),
  negações 403 e leituras sensíveis (dados bancários, relatórios).
- Ações de negócio gravam evento próprio com antes/depois (ex.: `payable.approved`,
  `supplier.bank_account_confirmed`).
- Dados bancários e documento de PF criptografados; logs nunca levam valores do corpo.
- Retenção: segue a política do Core (A4), com o prazo fiscal de guarda de documentos (F-06).

## 10. Fora do MVP

Contas a receber e faturamento; conciliação bancária e importação de OFX; remessa/retorno CNAB e
DDA; leitura de XML de NF-e; cálculo automático de retenções e de juros/multa; prestação de contas
de adiantamento; orçamento por CC; integração contábil; multiempresa.

## 11. Decisões pendentes

| # | Pergunta | Recomendação |
|---|---|---|
| F-01 | Quem é dono do cadastro de fornecedores: Financeiro ou Core (Suprimentos)? A cotação do Core usa texto livre. | Financeiro é dono do cadastro fiscal/bancário e expõe consulta; o Core passa a escolher fornecedor por `supplierId` na cotação. |
| F-02 | Alçada de aprovação de títulos por valor e quem compõe cada faixa. | Ligar à matriz financeira pendente (B01/B03/P26-02); até lá, uma aprovação. |
| F-03 | Quem são as pessoas de Contas a Pagar, Tesouraria e aprovação? Criar papel `financeiro` no Core? | Conceder perfis por usuário no Financeiro; criar papel no Core só se outro módulo precisar. |
| F-04 | Dados bancários do colaborador para reembolso: ficam no Core (RH) ou no Financeiro? | No Financeiro, cadastrados com confirmação dupla; o Core não expõe dado bancário. |
| F-05 | Tolerância entre valor do pedido e valor da nota. | 0 % sem justificativa; acima exige justificativa e fica destacada para o aprovador. |
| F-06 | Prazo de guarda de documentos e anexos. | Mínimo legal fiscal (5 anos) a confirmar com a contabilidade. |
| F-07 | Pagamento é feito fora do sistema (internet banking) e só registrado aqui? | Sim no MVP; integração bancária depois. |

## 12. Entregas

| # | Entrega | Estado |
|---|---|---|
| F0 | Esqueleto: health, `/me`, SSO com o Core, RBAC local, auditoria, receptor de webhook com cache de mestres, outbox, frontend com login e tela inicial, compose | **feito** (2026-11-07) |
| F1 | Fornecedores e dados bancários com confirmação; contas da empresa | pendente |
| F2 | Títulos manuais: documento, retenções, parcelas, rateio, envio, aprovação, cancelamento | pendente |
| F3 | Programação e baixa, estorno, agenda e previsão de saídas | pendente |
| F4 | Compra do Core → título (`purchase.*`), depende do Core emitir os eventos | pendente |
| F5 | Reembolso e adiantamento (`finance_request.approved`) | pendente |
| F6 | Eventos para o Core (`payable.*`), depende do receptor no Core | pendente |
