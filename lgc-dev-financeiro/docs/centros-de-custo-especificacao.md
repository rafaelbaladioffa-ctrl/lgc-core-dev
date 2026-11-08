# Axis Financeiro — módulo Centros de custo (controladoria)

Escrito em 2026-11-08. Mostra, por centro de custo (CC), quanto cada um gasta, compromete e gera de
receita; orçamento anual × realizado; funil das compras; rateio do overhead; e o painel das equipes
técnicas (CC do tipo `equipe_tecnica`, ex.: `DC-001-JAI`). Contratos com o Core e a Logística:
[../../docs/integracao-centros-de-custo.md](../../docs/integracao-centros-de-custo.md).

## 1. Conceitos

- **CC**: vem do cache de mestres (`axis_master_cache`, `kind = COST_CENTER`), com `kind`, `short_code`,
  `parent_cost_center_id` e `responsible_collaborator_id` no `data`. Nunca é editado aqui.
- **Lançamento** (`cc_entries`): fato financeiro de um CC numa competência (data). `kind` = `receita` ou
  `custo`; `stage` = `comprometido` (compra aprovada ainda não recebida, adiantamento em aberto, ou o orçado
  da revisão ganha do projeto) ou `realizado`; `category`; `source` (`compra`, `reembolso`, `adiantamento`,
  `logistica`, `folha`, `manual`, `projeto`).
  Lançamento não se apaga nem se altera: correção é **estorno** (linha com valor negativo e
  `reverses_id`). A baixa de um comprometido usa a **mesma competência** do comprometido, para o mês
  original zerar em vez de ficar negativo.
- **Categorias**: receita `faturamento`; custo `folha`, `material`, `compras`, `servicos`,
  `despesas_campo`, `frota`, `outros`.
- **Período**: meses `AAAA-MM` inclusivos (`from`, `to`); padrão = janeiro do ano corrente até o mês
  corrente (São Paulo).

## 2. Origens dos lançamentos

| Origem | Como entra | Lançamentos |
|---|---|---|
| `purchase.approved` | webhook do Core | um `comprometido`/`compras` por grupo de fornecedor (grupo `Estoque` é ignorado: o consumo vem da Logística) |
| `purchase.order_registered` | webhook | só atualiza o funil; cria o comprometido se a aprovação não tiver chegado |
| `purchase.delivery_received` | webhook | por grupo recebido: baixa do comprometido + `realizado`/`compras` na data do recebimento |
| `purchase.cancelled` | webhook | baixa dos comprometidos ainda abertos |
| `finance_request.approved` `reembolso` | webhook | `realizado`/`despesas_campo` |
| `finance_request.approved` `adiantamento` | webhook | adiantamento em aberto + `comprometido`/`despesas_campo`; a prestação de contas (tela) baixa o comprometido e lança o gasto comprovado como `realizado` |
| Folha da competência | botão "Gerar folha" | `realizado`/`folha` por CC: custo mensal da função × dias alocados ÷ dias do mês (§4) |
| Consumo da Logística | rotina diária (03:30, São Paulo) e botão "Importar da Logística" | `realizado`/`material` por CC e projeto (valor das saídas da competência). A rotina importa o **mês anterior e o corrente**; é idempotente por competência e por (CC, projeto) e o botão faz a mesma importação (§2.1) |
| Horas reais do Field | rotina diária (04:00, São Paulo) e botão "Importar horas do Field" (Controladoria) | **par** `realizado`/`folha`, origem `mao_de_obra`: custo no CC do projeto (com o projeto) e crédito negativo no CC de origem do técnico (§2.2) |
| Revisão ganha do projeto | `project.approved` do Core ou "Cliente aceitou" (Projetos) | `comprometido`, origem `projeto`, com o projeto: receita (`faturamento`, valor contratado) e custos orçados por categoria (`folha`, `material`, `frota`, `servicos`, `despesas_campo`, `outros`); `source_ref = ganho:<revisão>:<linha>`. Uma vez por revisão (§5.1) |
| Manual | tela do CC | qualquer categoria; `faturamento` é a receita (nota emitida) |

Reimportar ou regerar uma competência compara com o vigente da mesma referência (`source_ref`): igual
fica; diferente é estornado e lançado de novo.

### 2.1 Importação diária do consumo da Logística (PT-07)

O agendador do Financeiro (`@nestjs/schedule`, o mesmo do outbox, já nas dependências) roda todo dia às 03:30
de São Paulo, só com `SCHEDULER_ENABLED=true` e em **uma** instância. Importa a competência do mês anterior
(movimento que chega depois do fechamento) e a do corrente. Cada competência usa a mesma importação do botão:
`replaced`/`created`/`unchanged` por (CC, projeto), com trava de transação por competência (`pg_advisory_xact_lock`),
então o botão e a rotina nunca correm juntos nem duplicam. Valor igual não lança nada; valor que mudou durante
o mês gera estorno + novo lançamento (por isso o livro cresce em pares enquanto o mês muda). Falha de uma
competência (Logística fora do ar, sem `LOGISTICA_API_KEY`) é registrada no log e não derruba a outra nem o
agendador; o ator gravado é `sistema:logistica`.

### 2.2 Mão de obra realizada por projeto: horas do Field (PT-10, PA-14)

Antes, a folha caía inteira no CC do colaborador (§4) e a mão de obra realizada do projeto era zero. Agora o
Financeiro puxa as **horas reais por técnico, projeto e dia** do Field (`GET /api/integration/labor-hours`, ver
[integração §7](../../docs/integracao-centros-de-custo.md#7-field--financeiro-horas-reais-por-técnico-e-projeto)) e
lança, para cada (colaborador, projeto, dia), um **par de lançamentos** `realizado`/`folha`, origem `mao_de_obra`:

| Lançamento | CC | Projeto | Valor | `source_ref` |
|---|---|---|---|---|
| **Custo** | CC do projeto | o projeto | + horas × custo hora médio da função | `mao_obra:<dia>:<projeto>:<colaborador>:custo` |
| **Crédito "mão de obra transferida"** | CC de origem do colaborador no dia (alocação com vigência) | — | o mesmo valor, **negativo** | `mao_obra:<dia>:<projeto>:<colaborador>:credito` |

- **Custo hora = o custo hora médio da função** (parâmetros vigentes na data; a mesma conta do módulo Projetos e
  da folha), via cargo do Core → função (`job_title_maps`). **Nunca o salário individual.**
- **Escolha do crédito (decisão documentada):** custo **negativo** na categoria `folha` do CC de origem, e não uma
  categoria nova. Assim a folha líquida do CC de origem (folha − transferido) fecha sem mexer nas categorias do
  orçamento nem na migração dos enums de categoria. O crédito não leva o projeto (senão o resultado do projeto
  se anularia); o que o distingue é a origem `mao_de_obra` e o `source_ref` terminando em `:credito`.
- **Mesmo CC nos dois lados** (o projeto roda no CC da equipe): o par se anula no total do CC, mas o resultado do
  projeto passa a mostrar a mão de obra. As horas que o técnico não gastou em projetos ficam como ociosidade no CC
  da equipe (a folha dele continua inteira lá, menos o que foi transferido).
- **Competência** = primeiro dia do mês do dia trabalhado. O orçamento anual do CC passa a refletir o
  transferido: o CC de origem consome menos, o CC do projeto consome mais (quando são diferentes).
- **Idempotente por (colaborador, projeto, dia)** e append-only, como o resto do livro: valor, CC ou projeto
  iguais → nada é lançado; hora diferente (o Field ajustou a timeline e o dia reapareceu com outro total) →
  estorno do par anterior + par novo; dia que sumiu do Field no período importado → estorno do par. Só se mexe em
  dias dentro do período pedido. Trava de transação (`pg_advisory_xact_lock`): botão e rotina não correm juntos.
- **Pendências (nunca lança errado, nunca some):** o dia **não gera lançamento** e aparece na Controladoria
  (resultado da importação e `GET /field-labor/pending`) e no painel da equipe, com o motivo:
  `sem_funcao` (cargo sem função mapeada), `sem_custo_funcao` (função sem custo hora nos parâmetros),
  `projeto_desconhecido` (projeto fora do cache do Core), `projeto_sem_cc` (projeto sem centro de custo) e
  `sem_cc_origem` (colaborador sem alocação no dia). Corrigido o cadastro, a próxima importação lança o dia.
- **Horas guardadas** em `field_labor_days` (um registro por colaborador × projeto × dia: horas, se houve ajuste de
  timeline, situação lançado/pendente, CCs): é a base das horas em projeto × ociosas do painel. Os valores em
  dinheiro ficam só nos `cc_entries`.
- **Rotina diária** (04:00 São Paulo, `SCHEDULER_ENABLED=true`, em uma instância, depois da Logística): do primeiro
  dia do mês corrente até ontem (na virada do mês, só ontem). Falha do Field (fora do ar, sem `FIELD_API_KEY`) vai
  para o log e não derruba o agendador; ator gravado: `sistema:field`. O botão pede período de até 62 dias (o
  limite do Field).

## 3. Rateio do overhead

Regra por CC de origem (normalmente administrativo): direcionador `headcount` (pessoas-dia alocadas),
`receita`, `custo_direto` (custo realizado) ou `percentual` (fixo por destino, soma 100%), e os CCs de
destino. É calculado na consulta, não gravado: o custo realizado da origem no período é distribuído
pelos pesos dos destinos no mesmo período. Destino recebe "rateio recebido"; a origem registra "rateio
cedido" (negativo), para o consolidado da empresa fechar. Pesos todos zero: nada é distribuído e a
regra aparece com aviso.

**Resultado do CC** = receita − custo realizado − rateio recebido + rateio cedido. Margem = resultado ÷
receita. O **consolidado** soma o CC e todos os descendentes.

## 4. Folha por CC

Alocação: `collaborator.cost_center_changed` do Core abre e fecha vigências em `cc_allocations`.
Cargo do Core → função do orçamento (`job_title_role_maps`, mantido pela Controladoria). Custo mensal
da função = custo anual ÷ 12 do conjunto de parâmetros vigente na competência (mesmo cálculo de custo
hora do módulo Projetos; com custo hora informado, custo hora × horas trabalhadas no ano ÷ 12). Quem
não tem cargo mapeado sai na lista "sem função" e não entra no lançamento.

## 5. Orçamento e situação

Orçamento anual por CC, mês e categoria de custo (`cc_budgets`). Consumo do ano = realizado + comprometido
em aberto. Faixas: `ok` < 80%, `alerta` 80–99%, `estourado` ≥ 100% (sem orçamento: `sem_orcamento`).
Quando a faixa muda, o Financeiro avisa o Core pelo outbox (`cost_center.budget_status` →
`PUT /integration/cost-centers/:id/budget-status`), e compra para CC estourado ganha a aprovação do
responsável do CC pai.

### 5.1 Comprometido do projeto (PT-07) e o orçamento do CC

Ao ganhar uma revisão ([projetos-especificacao §8](projetos-especificacao.md#8-realizado)), o Financeiro lança no
CC do projeto, com o projeto, o comprometido da receita contratada e dos custos orçados (origem `projeto`). **Regra
escolhida: sem estorno.** O realizado do projeto chega em categorias do CC que não casam uma a uma com as linhas
do orçamento (compra de material cai em `compras`, reembolso em `despesas_campo`, consumo da Logística em
`material`); estornar o comprometido conforme o realizado chega obrigaria a inventar esse casamento e a reprocessar
lançamentos. Por isso:

- os lançamentos de origem `projeto` **não entram** no consumo do orçamento do CC (`yearConsumption`), no
  "comprometido" dos totais do CC nem no mês a mês: o orçamento do CC continua = realizado + compras e adiantamentos
  em aberto, e não muda quando um projeto é ganho. Aparecem na lista de lançamentos do CC (etapa "comprometido",
  origem "Revisão ganha");
- o **comprometido líquido** é calculado no resultado do projeto, por grupo de custo: máx(0, comprometido −
  realizado). Realizado acima do comprometido não vira negativo; o saldo (`comprometido − realizado − em aberto`) mostra
  o estouro.

## 6. Equipe técnica (CC `equipe_tecnica`)

**Diário da equipe** (`cc_team_logs`): data, atividade (`projeto`, `deslocamento`, `treinamento`,
`manutencao`, `ocioso`), projeto (obrigatório quando `projeto`), pessoas, horas por pessoa, km rodados,
produção (quantidade e unidade, ex.: `km de fibra`, `pontos`, `racks`) e observação.

Indicadores do período (dias úteis de segunda a sexta, até hoje):

| Indicador | Cálculo |
|---|---|
| Horas disponíveis | Σ dias úteis × pessoas alocadas no dia × horas por dia (parâmetros vigentes; 8 se faltar) |
| Utilização | horas em `projeto` ÷ horas disponíveis |
| Horas ociosas | disponíveis − horas lançadas fora de `ocioso` (mínimo 0) |
| Custo direto | custo realizado do CC da equipe (folha, despesas de campo, frota, material…). **Não desconta** a mão de obra transferida aos projetos (§2.2): é o custo da equipe, contra o qual se mede a receita atribuída |
| Horas em projetos (Field) | horas reais dos técnicos da equipe (CC de origem no dia) em projetos, vindas do Field (§2.2); só dias lançados |
| Horas ociosas (Field) | disponíveis − horas em projetos do Field (mínimo 0). Convive com as horas ociosas do diário manual, que seguem como estavam |
| Mão de obra transferida | soma dos créditos `mao_de_obra` no CC no período |
| Dias do Field pendentes | dias de técnicos da equipe que não viraram lançamento (função sem mapeamento etc.), com as horas |
| Custo por hora disponível / produtiva | custo direto ÷ horas disponíveis / ÷ horas em projeto |
| Custo hora cotado | média do custo hora das funções dos alocados (parâmetros vigentes), ponderada por pessoas-dia |
| Custo da ociosidade | horas ociosas × custo por hora disponível |
| Receita atribuída | Σ por projeto: receita do projeto no período × horas da equipe no projeto ÷ horas de todas as equipes no projeto |
| Margem de contribuição | receita atribuída − custo direto (e %) |
| Faturamento mínimo mensal | custo direto ÷ meses do período |
| Custo por unidade produzida | custo direto ÷ quantidade, por unidade |
| Despesa de campo por pessoa-dia | despesas de campo ÷ pessoas-dia em `projeto`/`deslocamento`; acima do limite do CC = alerta |
| Frota | custo `frota` ÷ km lançados, comparado ao R$/km dos parâmetros |
| Adiantamentos em aberto | dos colaboradores alocados na equipe |
| Bens em custódia | valor por custodiante, da Logística, dos alocados hoje |

## 7. Permissões e visibilidade

| Permissão | Uso |
|---|---|
| `cost_center:read` | ver todos os CCs |
| `cost_center:read_own` | ver só os CCs de que o usuário é responsável no Core, e os descendentes (filtrado no servidor) |
| `cost_center:write` | orçamento, lançamento manual e estorno, rateio, mapeamento de cargos, folha, importação, limite de despesa, prestação de adiantamento |
| `team_log:write` | lançar e excluir o diário da equipe (nos CCs que a pessoa vê) |

Perfis: **Controladoria** ganha as quatro; novo **Responsável de centro de custo** (`RESPONSAVEL_CC`)
com `cost_center:read_own` e `team_log:write`, mapeado do papel `gestor` do Core.

## 8. API (prefixo `/api/v1`)

Valores em reais como string com 2 casas; percentuais como fração string com 4 casas (`"0.8125"`) ou
`null` quando o denominador é zero.

| Método e rota | Permissão | Resposta / corpo |
|---|---|---|
| `GET /cost-centers?from&to` | read ou read_own | `{ period, year, items: CcSummary[], alerts: Alert[] }` |
| `GET /cost-centers/:id?from&to` | read ou read_own | `CcDetail` |
| `GET /cost-centers/:id/entries?from&to` | read ou read_own | `Entry[]` |
| `POST /cost-centers/:id/entries` | write | corpo `{ competence, kind, category, amount, description, projectId? }` → `Entry` |
| `POST /cost-center-entries/:id/reverse` | write | `{ reason }` → `Entry` (só origem `manual`) |
| `GET /cost-centers/:id/budget/:year` | read ou read_own | `{ year, rows: [{ category, months: string[12] }] }` |
| `PUT /cost-centers/:id/budget/:year` | write | mesmo formato |
| `PUT /cost-centers/:id/settings` | write | `{ fieldDailyLimit: string \| null }` |
| `GET /teams?from&to` | read ou read_own | `TeamSummary[]` |
| `GET /cost-centers/:id/team?from&to` | read ou read_own | `TeamPanel` |
| `GET /cost-centers/:id/team-logs?from&to` | read ou read_own | `TeamLog[]` |
| `POST /cost-centers/:id/team-logs` | team_log:write | `{ date, activity, projectId?, people, hoursPerPerson, km?, producedQuantity?, producedUnit?, notes? }` |
| `DELETE /team-logs/:id` | team_log:write | 204 |
| `GET /overhead-rules` | read | `OverheadRule[]` |
| `PUT /overhead-rules/:sourceCostCenterId` | write | `{ driver, active, notes?, targets: [{ costCenterId, percent? }] }` |
| `DELETE /overhead-rules/:sourceCostCenterId` | write | 204 |
| `GET /job-title-maps` | write | `{ maps: [{ jobTitleId, jobTitleName, roleKey, active }], unmapped, roles }`: nome do cargo do cache `JOB_TITLE` do Core (`active: false` = excluído no Core); `unmapped` junta os cargos do cache e os dos colaboradores |
| `PUT /job-title-maps/:jobTitleId` | write | `{ roleKey, jobTitleName? }`: o nome gravado é o do Core; `jobTitleName` só vale para cargo que o Financeiro ainda não recebeu; cargo excluído é recusado |
| `POST /cost-centers/payroll/:month` | write | `{ month, created, replaced, unchanged, unmapped: [{ collaboratorId, name, jobTitleName }] }` |
| `POST /field-labor/import` | write | corpo `{ from, to }` (AAAA-MM-DD, até 62 dias) → `{ from, to, hours, launchedHours, created, replaced, unchanged, invalidRows, pending: [{ collaboratorId, collaboratorName, projectId, projectCode, reason, reasonLabel, days, hours }] }` (a rotina diária chama a mesma importação, §2.2) |
| `GET /field-labor/pending?from&to` | write | pendências vigentes (último estado importado), mesmo formato de `pending` |
| `POST /cost-centers/logistics-import/:month` | write | `{ month, created, replaced, unchanged, withoutCostCenter, unknownCostCenters, unknownProjects }` (a rotina diária chama a mesma importação, §2.1). `unknown*` = ids que o cache do Core não conhece: lançados assim mesmo, com aviso na tela e no log (F5) |
| `GET /advances?status=aberto\|prestado` | read ou read_own | `Advance[]` |
| `POST /advances/:id/settle` | write | `{ spentAmount, notes? }` → `Advance` |
| `GET /purchases?costCenterId&status` | read ou read_own | `Purchase[]` |

Formas:

```ts
type Period = { from: string; to: string };                       // 'AAAA-MM'
type Money = string;                                              // '1234.56'
type Figures = { revenue: Money; cost: Money; committed: Money; overheadIn: Money; overheadOut: Money; result: Money; margin: string | null };
type BudgetStatus = 'ok' | 'alerta' | 'estourado' | 'sem_orcamento';
type CcSummary = {
  id: string; code: string | null; shortCode: string | null; name: string | null;
  kind: 'divisao' | 'administrativo' | 'operacional' | 'equipe_tecnica' | null;
  parentId: string | null; responsibleCollaboratorId: string | null; active: boolean;
  own: Figures; consolidated: Figures;
  budget: { year: number; amount: Money; consumed: Money; percent: string | null; status: BudgetStatus };
};
type Alert = { costCenterId: string; name: string | null; type: 'orcamento' | 'despesa_campo' | 'rateio'; message: string };
type CcDetail = CcSummary & {
  period: Period;
  costsByCategory: { category: string; realized: Money; committed: Money; budget: Money }[];
  monthly: { month: string; budget: Money; realized: Money; committed: Money; revenue: Money }[];
  overhead: { received: { costCenterId: string; name: string | null; amount: Money }[]; ceded: { costCenterId: string; name: string | null; amount: Money }[] };
  funnel: { status: 'aprovada' | 'pedido' | 'recebida_parcial' | 'recebida' | 'cancelada'; count: number; total: Money }[];
  contractedRevenue: { projectId: string; code: string | null; name: string | null; revenue: Money }[];
  settings: { fieldDailyLimit: Money | null };
  children: string[];
};
type Entry = {
  id: string; costCenterId: string; competence: string; kind: 'receita' | 'custo'; category: string;
  stage: 'comprometido' | 'realizado'; source: 'compra' | 'reembolso' | 'adiantamento' | 'logistica' | 'folha' | 'manual' | 'projeto';
  amount: Money; description: string; projectId: string | null; projectCode: string | null;
  sourceRef: string | null; reversesId: string | null; reversed: boolean; reason: string | null; createdBy: string; createdByName: string | null; createdAt: string;
};
type TeamSummary = {
  id: string; code: string | null; shortCode: string | null; name: string | null; headcount: number;
  availableHours: string; projectHours: string; utilization: string | null; directCost: Money;
  attributedRevenue: Money; margin: Money; marginPct: string | null; costPerProjectHour: Money | null; quotedCostPerHour: Money | null;
};
type TeamPanel = TeamSummary & {
  period: Period;
  members: { collaboratorId: string; name: string | null; jobTitleName: string | null; roleKey: string | null; since: string }[];
  hoursByActivity: { activity: string; hours: string }[];
  idleHours: string; idleCost: Money; costPerAvailableHour: Money | null; breakEvenMonthly: Money;
  revenueByProject: { projectId: string; code: string | null; teamHours: string; share: string | null; revenue: Money }[];
  production: { unit: string; quantity: string; costPerUnit: Money | null }[];
  fieldExpenses: { total: Money; personDays: number; perPersonDay: Money | null; limit: Money | null; overLimit: boolean };
  fleet: { cost: Money; km: string; costPerKm: Money | null; paramKmRate: Money | null };
  advances: Advance[];
  custody: { items: { collaboratorId: string; name: string | null; items: number; value: Money }[]; total: Money; error: string | null };
  warnings: string[];
};
type TeamLog = { id: string; date: string; activity: string; projectId: string | null; projectCode: string | null; people: number; hoursPerPerson: string; km: string | null; producedQuantity: string | null; producedUnit: string | null; notes: string | null; createdBy: string; createdByName: string | null };
type OverheadRule = { sourceCostCenterId: string; sourceName: string | null; driver: 'headcount' | 'receita' | 'custo_direto' | 'percentual'; active: boolean; notes: string | null; targets: { costCenterId: string; name: string | null; percent: string | null }[] };
type Advance = { id: string; requestCode: string; collaboratorId: string; collaboratorName: string | null; costCenterId: string; amount: Money; approvedAt: string; status: 'aberto' | 'prestado'; spentAmount: Money | null; settledAt: string | null };
type Purchase = { id: string; requestId: string; code: string; costCenterId: string; projectId: string | null; total: Money; status: string; approvedAt: string | null; orderedAt: string | null; receivedAt: string | null; cancelledAt: string | null };
```

## 9. Telas

1. **Centros de custo** (`#/centros-de-custo`): seletor de período; alertas; árvore com receita, custo,
   comprometido, resultado, consumo do orçamento (barra e selo da faixa), alternando próprio/consolidado.
2. **Centro de custo** (`#/centros-de-custo/:id`): resultado (DRE) do período, custos por categoria ×
   orçamento, mês a mês, rateio recebido/cedido, funil de compras, receita contratada, lançamentos
   (com lançamento manual e estorno), limite de despesa de campo; atalho para o painel da equipe.
3. **Orçamento** (`#/centros-de-custo/:id/orcamento/:ano`): grade categoria × mês.
4. **Equipes técnicas** (`#/equipes`): comparativo das equipes; **Painel da equipe**
   (`#/equipes/:id`): indicadores do §6 e o diário da equipe.
5. **Controladoria** (`#/controladoria`): regras de rateio, cargos × funções, gerar folha, importar
   consumo da Logística, importar horas do Field (período, com as pendências), adiantamentos em aberto.

## 10. Fora desta entrega

- Contas a pagar: quando existir, o título pago substitui o realizado da compra (hoje o realizado é o
  recebimento).
- Mão de obra por projeto pelo plano de horas (e não pelas horas reais do Field), custo por salário individual
  e crédito em categoria própria: fora de propósito (§2.2).
- Frota com cadastro de veículos; certificações NR como custo.
