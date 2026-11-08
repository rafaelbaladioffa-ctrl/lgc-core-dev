import { api } from './api';

/**
 * Centros de custo (controladoria): tipos e chamadas do §8 da especificação
 * (docs/centros-de-custo-especificacao.md), rótulos em pt-BR e funções puras das telas.
 * Valores chegam como texto decimal; percentuais como fração ("0.8125") ou null.
 */

// ---------------------------------------------------------------- Tipos do contrato (§8)

export type Period = { from: string; to: string };
export type Money = string;
export type Figures = { revenue: Money; cost: Money; committed: Money; overheadIn: Money; overheadOut: Money; result: Money; margin: string | null };
export type BudgetStatus = 'ok' | 'alerta' | 'estourado' | 'sem_orcamento';
export type CcKind = 'divisao' | 'administrativo' | 'operacional' | 'equipe_tecnica';

export type CcSummary = {
  id: string;
  code: string | null;
  shortCode: string | null;
  name: string | null;
  kind: CcKind | null;
  parentId: string | null;
  responsibleCollaboratorId: string | null;
  active: boolean;
  own: Figures;
  consolidated: Figures;
  budget: { year: number; amount: Money; consumed: Money; percent: string | null; status: BudgetStatus };
};

export type AlertType = 'orcamento' | 'despesa_campo' | 'rateio';
export type CcAlert = { costCenterId: string; name: string | null; type: AlertType; message: string };

export type FunnelStatus = 'aprovada' | 'pedido' | 'recebida_parcial' | 'recebida' | 'cancelada';

export type CcDetail = CcSummary & {
  period: Period;
  costsByCategory: { category: string; realized: Money; committed: Money; budget: Money }[];
  monthly: { month: string; budget: Money; realized: Money; committed: Money; revenue: Money }[];
  overhead: { received: { costCenterId: string; name: string | null; amount: Money }[]; ceded: { costCenterId: string; name: string | null; amount: Money }[] };
  funnel: { status: FunnelStatus; count: number; total: Money }[];
  contractedRevenue: { projectId: string; code: string | null; name: string | null; revenue: Money }[];
  settings: { fieldDailyLimit: Money | null };
  children: string[];
};

export type EntryKind = 'receita' | 'custo';
export type EntryStage = 'comprometido' | 'realizado';
export type EntrySource = 'compra' | 'reembolso' | 'adiantamento' | 'logistica' | 'folha' | 'manual';

export type Entry = {
  id: string;
  costCenterId: string;
  competence: string;
  kind: EntryKind;
  category: string;
  stage: EntryStage;
  source: EntrySource;
  amount: Money;
  description: string;
  projectId: string | null;
  projectCode: string | null;
  sourceRef: string | null;
  reversesId: string | null;
  reversed: boolean;
  reason: string | null;
  createdBy: string;
  /** E-mail de quem lançou (ou "Sistema (Core)"); nulo quando o usuário não está no cache. */
  createdByName?: string | null;
  createdAt: string;
};

export type TeamSummary = {
  id: string;
  code: string | null;
  shortCode: string | null;
  name: string | null;
  headcount: number;
  availableHours: string;
  projectHours: string;
  utilization: string | null;
  directCost: Money;
  attributedRevenue: Money;
  margin: Money;
  marginPct: string | null;
  costPerProjectHour: Money | null;
  quotedCostPerHour: Money | null;
};

export type Advance = {
  id: string;
  requestCode: string;
  collaboratorId: string;
  collaboratorName: string | null;
  costCenterId: string;
  amount: Money;
  approvedAt: string;
  status: 'aberto' | 'prestado';
  spentAmount: Money | null;
  settledAt: string | null;
};

export type TeamPanel = TeamSummary & {
  period: Period;
  members: { collaboratorId: string; name: string | null; jobTitleName: string | null; roleKey: string | null; since: string }[];
  hoursByActivity: { activity: string; hours: string }[];
  idleHours: string;
  idleCost: Money;
  costPerAvailableHour: Money | null;
  breakEvenMonthly: Money;
  revenueByProject: { projectId: string; code: string | null; teamHours: string; share: string | null; revenue: Money }[];
  production: { unit: string; quantity: string; costPerUnit: Money | null }[];
  fieldExpenses: { total: Money; personDays: number; perPersonDay: Money | null; limit: Money | null; overLimit: boolean };
  fleet: { cost: Money; km: string; costPerKm: Money | null; paramKmRate: Money | null };
  advances: Advance[];
  custody: { items: { collaboratorId: string; name: string | null; items: number; value: Money }[]; total: Money; error: string | null };
  warnings: string[];
};

export type TeamActivity = 'projeto' | 'deslocamento' | 'treinamento' | 'manutencao' | 'ocioso';

export type TeamLog = {
  id: string;
  date: string;
  activity: string;
  projectId: string | null;
  projectCode: string | null;
  people: number;
  hoursPerPerson: string;
  km: string | null;
  producedQuantity: string | null;
  producedUnit: string | null;
  notes: string | null;
  createdBy: string;
  /** E-mail de quem lançou (ou "Sistema (Core)"); nulo quando o usuário não está no cache. */
  createdByName?: string | null;
};

export type TeamLogInput = {
  date: string;
  activity: TeamActivity;
  projectId?: string;
  people: number;
  hoursPerPerson: string;
  km?: string;
  producedQuantity?: string;
  producedUnit?: string;
  notes?: string;
};

export type OverheadDriver = 'headcount' | 'receita' | 'custo_direto' | 'percentual';
export type OverheadRule = {
  sourceCostCenterId: string;
  sourceName: string | null;
  driver: OverheadDriver;
  active: boolean;
  notes: string | null;
  targets: { costCenterId: string; name: string | null; percent: string | null }[];
};
export type OverheadRuleInput = { driver: OverheadDriver; active: boolean; notes?: string; targets: { costCenterId: string; percent?: string }[] };

/**
 * O §8 só diz `{ maps, unmapped, roles }`; as formas abaixo são as que a tela assume
 * (cargo do Core → função do conjunto de parâmetros vigente).
 */
export type JobTitleMap = { jobTitleId: string; jobTitleName: string; roleKey: string; roleLabel?: string | null };
export type UnmappedJobTitle = { jobTitleId: string; jobTitleName: string; collaborators?: number };
export type BudgetRole = { roleKey: string; label: string };
export type JobTitleMaps = { maps: JobTitleMap[]; unmapped: UnmappedJobTitle[]; roles: BudgetRole[] };

export type PayrollResult = { month: string; created: number; replaced: number; unchanged: number; unmapped: { collaboratorId: string; name: string | null; jobTitleName: string | null }[] };
export type LogisticsImportResult = { month: string; created: number; replaced: number; unchanged: number };

export type Purchase = {
  id: string;
  requestId: string;
  code: string;
  costCenterId: string;
  projectId: string | null;
  total: Money;
  status: string;
  approvedAt: string | null;
  orderedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
};

export type BudgetGrid = { year: number; rows: { category: string; months: string[] }[] };

export type ManualEntryInput = { competence: string; kind: EntryKind; category: string; amount: string; description: string; projectId?: string };

// ---------------------------------------------------------------- Chamadas

const enc = encodeURIComponent;
const periodQuery = (p: Period) => `from=${enc(p.from)}&to=${enc(p.to)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const listCostCenters = (p: Period) => api<{ period: Period; year: number; items: CcSummary[]; alerts: CcAlert[] }>(`/cost-centers?${periodQuery(p)}`);
export const getCostCenter = (id: string, p: Period) => api<CcDetail>(`/cost-centers/${enc(id)}?${periodQuery(p)}`);
export const listEntries = (id: string, p: Period) => api<Entry[]>(`/cost-centers/${enc(id)}/entries?${periodQuery(p)}`);
export const createEntry = (id: string, body: ManualEntryInput) => api<Entry>(`/cost-centers/${enc(id)}/entries`, json('POST', body));
export const reverseEntry = (entryId: string, reason: string) => api<Entry>(`/cost-center-entries/${enc(entryId)}/reverse`, json('POST', { reason }));
export const getBudget = (id: string, year: number) => api<BudgetGrid>(`/cost-centers/${enc(id)}/budget/${year}`);
export const saveBudget = (id: string, grid: BudgetGrid) => api<BudgetGrid>(`/cost-centers/${enc(id)}/budget/${grid.year}`, json('PUT', { rows: grid.rows }));
export const saveCostCenterSettings = (id: string, fieldDailyLimit: string | null) =>
  api<{ fieldDailyLimit: Money | null }>(`/cost-centers/${enc(id)}/settings`, json('PUT', { fieldDailyLimit }));

export const listTeams = (p: Period) => api<TeamSummary[]>(`/teams?${periodQuery(p)}`);
export const getTeamPanel = (id: string, p: Period) => api<TeamPanel>(`/cost-centers/${enc(id)}/team?${periodQuery(p)}`);
export const listTeamLogs = (id: string, p: Period) => api<TeamLog[]>(`/cost-centers/${enc(id)}/team-logs?${periodQuery(p)}`);
export const createTeamLog = (id: string, body: TeamLogInput) => api<TeamLog>(`/cost-centers/${enc(id)}/team-logs`, json('POST', body));
export const deleteTeamLog = (logId: string) => api<null>(`/team-logs/${enc(logId)}`, { method: 'DELETE' });

export const listOverheadRules = () => api<OverheadRule[]>('/overhead-rules');
export const saveOverheadRule = (sourceId: string, body: OverheadRuleInput) => api<OverheadRule>(`/overhead-rules/${enc(sourceId)}`, json('PUT', body));
export const deleteOverheadRule = (sourceId: string) => api<null>(`/overhead-rules/${enc(sourceId)}`, { method: 'DELETE' });

export const getJobTitleMaps = () => api<JobTitleMaps>('/job-title-maps');
export const saveJobTitleMap = (jobTitleId: string, jobTitleName: string, roleKey: string) =>
  api<JobTitleMap>(`/job-title-maps/${enc(jobTitleId)}`, json('PUT', { jobTitleName, roleKey }));

export const generatePayroll = (month: string) => api<PayrollResult>(`/cost-centers/payroll/${enc(month)}`, json('POST', {}));
export const importLogistics = (month: string) => api<LogisticsImportResult>(`/cost-centers/logistics-import/${enc(month)}`, json('POST', {}));

export const listAdvances = (status: 'aberto' | 'prestado') => api<Advance[]>(`/advances?status=${status}`);
export const settleAdvance = (id: string, spentAmount: string, notes?: string) => api<Advance>(`/advances/${enc(id)}/settle`, json('POST', notes ? { spentAmount, notes } : { spentAmount }));

export const listPurchases = (costCenterId: string) => api<Purchase[]>(`/purchases?costCenterId=${enc(costCenterId)}`);

// ---------------------------------------------------------------- Rótulos (um lugar só)

export type Tone = 'success' | 'warning' | 'neutral' | 'danger';

export const REVENUE_CATEGORIES = ['faturamento'] as const;
export const COST_CATEGORIES = ['folha', 'material', 'compras', 'servicos', 'despesas_campo', 'frota', 'outros'] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  faturamento: 'Faturamento',
  folha: 'Folha',
  material: 'Material',
  compras: 'Compras',
  servicos: 'Serviços',
  despesas_campo: 'Despesas de campo',
  frota: 'Frota',
  outros: 'Outros',
};

export const KIND_LABEL: Record<CcKind, string> = { divisao: 'Divisão', administrativo: 'Administrativo', operacional: 'Operacional', equipe_tecnica: 'Equipe técnica' };
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = { receita: 'Receita', custo: 'Custo' };
export const STAGE_LABEL: Record<EntryStage, string> = { comprometido: 'Comprometido', realizado: 'Realizado' };
export const SOURCE_LABEL: Record<EntrySource, string> = { compra: 'Compra', reembolso: 'Reembolso', adiantamento: 'Adiantamento', logistica: 'Logística', folha: 'Folha', manual: 'Manual' };

export const ACTIVITIES: TeamActivity[] = ['projeto', 'deslocamento', 'treinamento', 'manutencao', 'ocioso'];
export const ACTIVITY_LABEL: Record<TeamActivity, string> = { projeto: 'Projeto', deslocamento: 'Deslocamento', treinamento: 'Treinamento', manutencao: 'Manutenção', ocioso: 'Ocioso' };

export const DRIVERS: OverheadDriver[] = ['headcount', 'receita', 'custo_direto', 'percentual'];
export const DRIVER_LABEL: Record<OverheadDriver, string> = { headcount: 'Pessoas-dia alocadas', receita: 'Receita', custo_direto: 'Custo direto realizado', percentual: 'Percentual fixo por destino' };

export const FUNNEL_LABEL: Record<FunnelStatus, string> = { aprovada: 'Aprovada', pedido: 'Pedido emitido', recebida_parcial: 'Recebida em parte', recebida: 'Recebida', cancelada: 'Cancelada' };

export const BUDGET_STATUS: Record<BudgetStatus, { label: string; tone: Tone }> = {
  ok: { label: 'Dentro do orçamento', tone: 'success' },
  alerta: { label: 'Alerta', tone: 'warning' },
  estourado: { label: 'Estourado', tone: 'danger' },
  sem_orcamento: { label: 'Sem orçamento', tone: 'neutral' },
};

export const ALERT_TYPE_LABEL: Record<AlertType, string> = { orcamento: 'Orçamento', despesa_campo: 'Despesa de campo', rateio: 'Rateio' };
export const ADVANCE_STATUS_LABEL: Record<Advance['status'], string> = { aberto: 'Em aberto', prestado: 'Prestado' };

/** Rótulo do mapa; chave desconhecida (o servidor pode evoluir) aparece como veio; nulo vira "—". */
export function labelOf(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}

/** "DC-001-JAI — Equipe Jaime"; sem nada, "Centro sem nome". */
export function ccLabel(cc: { code: string | null; shortCode?: string | null; name: string | null }): string {
  const code = cc.shortCode ?? cc.code ?? null;
  return [code, cc.name].filter(Boolean).join(' — ') || 'Centro sem nome';
}

// ---------------------------------------------------------------- Período e competência

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const isMonth = (v: string) => MONTH_RE.test(v);
export const isDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime()) && new Date(`${v}T12:00:00Z`).toISOString().startsWith(v);

/** Mês corrente em São Paulo, "AAAA-MM". */
export function currentMonth(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}`;
}

/** Hoje em São Paulo, "AAAA-MM-DD". */
export function today(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Padrão do §1: janeiro do ano corrente até o mês corrente. */
export function defaultPeriod(now: Date = new Date()): Period {
  const to = currentMonth(now);
  return { from: `${to.slice(0, 4)}-01`, to };
}

/** Valida competência "AAAA-MM" (gerar folha, importar da Logística). */
export function validateMonth(v: string): string | null {
  if (!v.trim()) return 'Informe a competência.';
  return isMonth(v.trim()) ? null : 'Use o formato AAAA-MM.';
}

export function validatePeriod(p: Period): string | null {
  if (!isMonth(p.from) || !isMonth(p.to)) return 'Informe o mês inicial e o final (AAAA-MM).';
  if (p.from > p.to) return 'O mês inicial não pode ser depois do final.';
  return null;
}

/** Período a partir da consulta da rota (`?from=AAAA-MM&to=AAAA-MM`); ausente ou inválido → padrão. */
export function periodFromPath(path: string, now: Date = new Date()): Period {
  const q = new URLSearchParams(path.includes('?') ? path.slice(path.indexOf('?') + 1) : '');
  const p = { from: q.get('from') ?? '', to: q.get('to') ?? '' };
  return validatePeriod(p) === null ? p : defaultPeriod(now);
}

export const withPeriod = (base: string, p: Period) => `${base}?${periodQuery(p)}`;

const MONTH_NAMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const MONTH_LABELS = MONTH_NAMES.map((m) => m[0].toUpperCase() + m.slice(1));

/** "2026-03" → "mar/2026". */
export function formatMonth(v: string | null | undefined): string {
  if (!v) return '—';
  const m = MONTH_RE.exec(v);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]}/${m[1]}` : v;
}

export const formatPeriodLabel = (p: Period) => (p.from === p.to ? formatMonth(p.from) : `${formatMonth(p.from)} a ${formatMonth(p.to)}`);

// ---------------------------------------------------------------- Árvore

export type TreeRow<T> = { item: T; depth: number; hasChildren: boolean };

/**
 * Monta a árvore a partir de `parentId` e devolve as linhas na ordem de exibição (pai antes dos filhos,
 * irmãos por código). Quem tem o pai fora da lista (visão `read_own`) vira raiz. Ramos em `collapsed`
 * não mostram os descendentes. Ciclos não travam: cada item aparece uma vez.
 */
export function buildTree<T extends { id: string; parentId: string | null; code: string | null; name: string | null }>(items: T[], collapsed: ReadonlySet<string> = new Set()): TreeRow<T>[] {
  const ids = new Set(items.map((i) => i.id));
  const byParent = new Map<string | null, T[]>();
  for (const i of items) {
    const parent = i.parentId && ids.has(i.parentId) && i.parentId !== i.id ? i.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), i]);
  }
  const key = (i: T) => `${i.code ?? '￿'} ${i.name ?? ''}`;
  for (const list of byParent.values()) list.sort((a, b) => key(a).localeCompare(key(b), 'pt-BR'));

  const out: TreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const item of byParent.get(parent) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const hasChildren = (byParent.get(item.id) ?? []).length > 0;
      out.push({ item, depth, hasChildren });
      if (hasChildren && !collapsed.has(item.id)) walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  // Itens presos num ciclo (nenhum chega à raiz) aparecem no fim, sem recuo.
  if (collapsed.size === 0) for (const i of items) if (!seen.has(i.id)) out.push({ item: i, depth: 0, hasChildren: false });
  return out;
}

// ---------------------------------------------------------------- Decimais exatos (só para totais de exibição)

/** "1234.5" / "-0.25" → inteiro em unidades de 10^-scale; texto inválido ou com casas demais → null. */
export function toScaled(v: string | null | undefined, scale = 2): bigint | null {
  if (v === null || v === undefined) return null;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v.trim());
  if (!m) return null;
  const dec = m[3] ?? '';
  if (dec.length > scale) return null;
  const n = BigInt(m[2] + dec.padEnd(scale, '0'));
  return m[1] ? -n : n;
}

export function fromScaled(n: bigint, scale = 2): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(scale + 1, '0');
  const out = scale > 0 ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return neg ? `-${out}` : out;
}

/** Soma exata de textos decimais; vazios e inválidos são ignorados. */
export function sumDecimals(values: Array<string | null | undefined>, scale = 2): string {
  let total = 0n;
  for (const v of values) total += toScaled(v, scale) ?? 0n;
  return fromScaled(total, scale);
}

/** Totais da grade do orçamento: por linha (categoria), por mês e geral. */
export function budgetTotals(rows: string[][]): { rowTotals: string[]; monthTotals: string[]; total: string } {
  const rowTotals = rows.map((r) => sumDecimals(r));
  const monthTotals = Array.from({ length: 12 }, (_, m) => sumDecimals(rows.map((r) => r[m])));
  return { rowTotals, monthTotals, total: sumDecimals(rowTotals) };
}

/** Grade completa (todas as categorias de custo × 12 meses), na ordem do §1, a partir do que o servidor guardou. */
export function normalizeBudgetRows(rows: BudgetGrid['rows']): { category: string; months: string[] }[] {
  const known = COST_CATEGORIES.map((c) => {
    const found = rows.find((r) => r.category === c);
    return { category: c as string, months: Array.from({ length: 12 }, (_, i) => found?.months[i] ?? '0.00') };
  });
  const extra = rows.filter((r) => !(COST_CATEGORIES as readonly string[]).includes(r.category));
  return [...known, ...extra.map((r) => ({ category: r.category, months: Array.from({ length: 12 }, (_, i) => r.months[i] ?? '0.00') }))];
}

/** Largura da barra de consumo (0–100) a partir da fração; acima de 100% fica cheia. */
export function consumptionWidth(percent: string | null): number {
  const n = Number(percent);
  if (percent === null || !Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.round(n * 1000) / 10);
}

/** Soma das frações dos destinos de uma regra `percentual` é exatamente 100%? */
export function percentTargetsComplete(fractions: Array<string | null | undefined>): boolean {
  return toScaled(sumDecimals(fractions, 6), 6) === 1_000_000n;
}

// ---------------------------------------------------------------- Diário da equipe

export type TeamLogForm = { date: string; activity: TeamActivity; projectId: string; people: string; hoursPerPerson: string; km: string; producedQuantity: string; producedUnit: string; notes: string };
export type TeamLogErrors = Partial<Record<keyof TeamLogForm, string>>;

/** Número digitado em pt-BR ("1.234,5") → "1234.5"; vazio → null; inválido → 'invalid'. */
function parseLocalNumber(input: string, scale: number): string | null | 'invalid' {
  const s = input.trim().replace(/\s/g, '');
  if (!s) return null;
  const n = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^\d+(\.\d+)?$/.test(n)) return 'invalid';
  if ((n.split('.')[1]?.length ?? 0) > scale) return 'invalid';
  return n;
}

/** Valida o formulário do diário e monta o corpo da API (§6). */
export function validateTeamLog(f: TeamLogForm): { ok: true; body: TeamLogInput } | { ok: false; errors: TeamLogErrors } {
  const errors: TeamLogErrors = {};
  if (!isDate(f.date)) errors.date = 'Informe a data.';
  else if (f.date > today()) errors.date = 'A data não pode ser no futuro.';
  if (f.activity === 'projeto' && !f.projectId) errors.projectId = 'Escolha o projeto.';
  const people = parseLocalNumber(f.people, 0);
  if (people === null || people === 'invalid' || Number(people) < 1) errors.people = 'Informe quantas pessoas (número inteiro, 1 ou mais).';
  const hours = parseLocalNumber(f.hoursPerPerson, 2);
  if (hours === null || hours === 'invalid' || Number(hours) <= 0 || Number(hours) > 24) errors.hoursPerPerson = 'Informe as horas por pessoa (até 24, no máximo 2 casas).';
  const km = parseLocalNumber(f.km, 2);
  if (km === 'invalid') errors.km = 'Km inválido.';
  const qty = parseLocalNumber(f.producedQuantity, 4);
  if (qty === 'invalid') errors.producedQuantity = 'Quantidade inválida.';
  if (qty && !f.producedUnit.trim()) errors.producedUnit = 'Informe a unidade (ex.: km de fibra, pontos, racks).';
  if (!qty && f.producedUnit.trim()) errors.producedQuantity = 'Informe a quantidade produzida.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const body: TeamLogInput = { date: f.date, activity: f.activity, people: Number(people), hoursPerPerson: hours as string };
  if (f.projectId) body.projectId = f.projectId;
  if (km) body.km = km;
  if (qty) {
    body.producedQuantity = qty;
    body.producedUnit = f.producedUnit.trim();
  }
  if (f.notes.trim()) body.notes = f.notes.trim();
  return { ok: true, body };
}
