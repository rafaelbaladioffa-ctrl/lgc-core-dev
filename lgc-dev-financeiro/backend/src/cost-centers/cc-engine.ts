import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hourlyCost, type PayrollParams, type RoleCostInput } from '../budget-params/hourly-cost.js';

/** Cálculos do módulo Centros de custo (centros-de-custo-especificacao §3–§6). Funções puras, só `Decimal`. */

export type Dec = Prisma.Decimal;
export const D = Prisma.Decimal;
export const ZERO = new D(0);
const HALF_UP = Prisma.Decimal.ROUND_HALF_UP;
export const money = (v: Dec) => v.toDecimalPlaces(2, HALF_UP).toFixed(2);
export const ratio = (num: Dec, den: Dec): string | null => (den.isZero() ? null : num.div(den).toDecimalPlaces(4, HALF_UP).toFixed(4));
export const moneyOrNull = (num: Dec, den: Dec): string | null => (den.isZero() ? null : money(num.div(den)));
export const sum = (values: Iterable<Dec>) => {
  let total = ZERO;
  for (const v of values) total = total.plus(v);
  return total;
};

const DAY_MS = 86_400_000;
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PERIOD_MONTHS = 36;

/** Data de hoje em São Paulo (AAAA-MM-DD). */
export function todaySaoPaulo(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** `AAAA-MM-DD` → Date à meia-noite UTC (como o Prisma grava `@db.Date`). */
export function parseDate(value: string, label = 'Data'): Date {
  if (!DATE_RE.test(value)) throw new BadRequestException(`${label} inválida (use AAAA-MM-DD).`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label} inválida.`);
  return d;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const monthOf = (d: Date) => d.toISOString().slice(0, 7);

export function parseMonth(value: string, label = 'Competência'): { year: number; month: number; start: Date; end: Date } {
  const m = MONTH_RE.exec(value ?? '');
  if (!m) throw new BadRequestException(`${label} inválida (use AAAA-MM).`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return { year, month, start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

export interface Period {
  from: string;
  to: string;
  /** Primeiro dia do primeiro mês. */
  start: Date;
  /** Primeiro dia do mês seguinte ao último (exclusivo). */
  end: Date;
  months: string[];
}

/** Período em meses inclusivos; padrão = janeiro do ano corrente até o mês corrente (São Paulo). */
export function parsePeriod(from: string | undefined, to: string | undefined, today = todaySaoPaulo()): Period {
  const currentMonth = today.slice(0, 7);
  const f = from || `${today.slice(0, 4)}-01`;
  const t = to || currentMonth;
  const a = parseMonth(f, 'Início do período');
  const b = parseMonth(t, 'Fim do período');
  if (a.start > b.start) throw new BadRequestException('O início do período não pode ser depois do fim.');
  const months: string[] = [];
  for (let y = a.year, mo = a.month; y < b.year || (y === b.year && mo <= b.month); mo === 12 ? ((y += 1), (mo = 1)) : (mo += 1)) {
    months.push(`${y}-${String(mo).padStart(2, '0')}`);
  }
  if (months.length > MAX_PERIOD_MONTHS) throw new BadRequestException(`O período pode ter no máximo ${MAX_PERIOD_MONTHS} meses.`);
  return { from: f, to: t, start: a.start, end: b.end, months };
}

/**
 * Dias úteis (segunda a sexta, menos os feriados do Core) do período, até hoje inclusive. `holidays` são datas
 * `AAAA-MM-DD` (cache `HOLIDAY`, ver integration/master-cache.ts); sem elas, conta só segunda a sexta.
 */
export function workingDays(period: Pick<Period, 'start' | 'end'>, today = todaySaoPaulo(), holidays?: ReadonlySet<string> | null): Date[] {
  const limit = Math.min(period.end.getTime(), parseDate(today).getTime() + DAY_MS);
  const days: Date[] = [];
  for (let t = period.start.getTime(); t < limit; t += DAY_MS) {
    const d = new Date(t);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays?.has(d.toISOString().slice(0, 10))) days.push(d);
  }
  return days;
}

export interface AllocationSpan {
  collaboratorId: string;
  costCenterId: string;
  validFrom: Date;
  validTo: Date | null;
}

export const isAllocatedOn = (a: AllocationSpan, day: Date) => a.validFrom <= day && (!a.validTo || day < a.validTo);

/** Pessoas-dia por colaborador num CC, contando só os dias informados. */
export function personDays(allocations: AllocationSpan[], days: Date[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of allocations) {
    let n = 0;
    for (const d of days) if (isAllocatedOn(a, d)) n++;
    if (n > 0) out.set(a.collaboratorId, (out.get(a.collaboratorId) ?? 0) + n);
  }
  return out;
}

/** Dias (corridos) de `[validFrom, validTo)` dentro do mês, para a folha proporcional. */
export function daysAllocatedInMonth(a: Pick<AllocationSpan, 'validFrom' | 'validTo'>, month: { start: Date; end: Date }): number {
  const from = Math.max(a.validFrom.getTime(), month.start.getTime());
  const to = Math.min((a.validTo ?? month.end).getTime(), month.end.getTime());
  return to > from ? Math.round((to - from) / DAY_MS) : 0;
}

/** Custo mensal de uma função CLT pelos parâmetros (custo anual ÷ 12). Nulo quando faltam dados. */
export function monthlyRoleCost(params: PayrollParams, role: RoleCostInput): Dec | null {
  const r = hourlyCost(params, role);
  if (!r.ok) return null;
  if (r.value.annual) return new D(r.value.annual.total).div(12);
  // Custo hora informado: custo hora × horas trabalhadas no ano ÷ 12.
  if (params.hoursPerDay === null || params.hoursPerDay === undefined || !params.workingDaysYear) return null;
  const workedDays = Number(params.workingDaysYear) - Number(params.vacationWorkDays ?? 0);
  if (workedDays <= 0) return null;
  return new D(r.value.costPerHour).mul(new D(params.hoursPerDay)).mul(workedDays).div(12);
}

// ---------------------------------------------------------------------------
// Orçamento
// ---------------------------------------------------------------------------

export type BudgetStatus = 'ok' | 'alerta' | 'estourado' | 'sem_orcamento';

export function budgetStatus(budget: Dec, consumed: Dec): { percent: string | null; status: BudgetStatus } {
  if (budget.lte(0)) return { percent: null, status: 'sem_orcamento' };
  const pct = consumed.div(budget);
  return { percent: pct.toDecimalPlaces(4, HALF_UP).toFixed(4), status: pct.gte(1) ? 'estourado' : pct.gte('0.8') ? 'alerta' : 'ok' };
}

// ---------------------------------------------------------------------------
// Rateio
// ---------------------------------------------------------------------------

export type OverheadDriver = 'headcount' | 'receita' | 'custo_direto' | 'percentual';

export interface OverheadRuleInput {
  source: string;
  driver: OverheadDriver;
  targets: Array<{ costCenterId: string; percent: Dec | null }>;
}

export interface OverheadResult {
  /** destino → [{ origem, valor }] */
  received: Map<string, Array<{ costCenterId: string; amount: Dec }>>;
  /** origem → [{ destino, valor }] */
  ceded: Map<string, Array<{ costCenterId: string; amount: Dec }>>;
  warnings: Array<{ costCenterId: string; message: string }>;
}

/**
 * Distribui o custo realizado de cada origem (`pools`) pelos destinos, conforme o direcionador.
 * Arredonda em centavos e joga a diferença no último destino com peso, para a soma fechar exatamente.
 */
export function distributeOverhead(rules: OverheadRuleInput[], pools: Map<string, Dec>, weights: Record<Exclude<OverheadDriver, 'percentual'>, Map<string, Dec>>): OverheadResult {
  const result: OverheadResult = { received: new Map(), ceded: new Map(), warnings: [] };
  for (const rule of rules) {
    const pool = (pools.get(rule.source) ?? ZERO).toDecimalPlaces(2, HALF_UP);
    if (pool.isZero() || rule.targets.length === 0) continue;
    const w = rule.targets.map((t) => ({ id: t.costCenterId, weight: rule.driver === 'percentual' ? (t.percent ?? ZERO) : (weights[rule.driver].get(t.costCenterId) ?? ZERO) }));
    const total = sum(w.map((x) => x.weight));
    if (total.lte(0)) {
      result.warnings.push({ costCenterId: rule.source, message: 'Rateio sem base: os destinos não têm valor no direcionador no período.' });
      continue;
    }
    // No percentual, o que faltar para 100% fica na origem.
    const share = rule.driver === 'percentual' ? D.min(total, new D(1)) : new D(1);
    const toDistribute = pool.mul(share).toDecimalPlaces(2, HALF_UP);
    const positive = w.filter((x) => x.weight.gt(0));
    let allocated = ZERO;
    positive.forEach((x, i) => {
      const amount = i === positive.length - 1 ? toDistribute.minus(allocated) : toDistribute.mul(x.weight).div(total).toDecimalPlaces(2, HALF_UP);
      allocated = allocated.plus(amount);
      if (amount.isZero()) return;
      if (!result.received.has(x.id)) result.received.set(x.id, []);
      result.received.get(x.id)!.push({ costCenterId: rule.source, amount });
      if (!result.ceded.has(rule.source)) result.ceded.set(rule.source, []);
      result.ceded.get(rule.source)!.push({ costCenterId: x.id, amount });
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Árvore e consolidação
// ---------------------------------------------------------------------------

export interface TreeNode {
  id: string;
  parentId: string | null;
}

/** id → ids dos descendentes (sem o próprio), protegido contra ciclos. */
export function descendantsMap(nodes: TreeNode[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const n of nodes) if (n.parentId) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n.id]);
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    const seen = new Set<string>();
    const stack = [...(children.get(n.id) ?? [])];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id) || id === n.id) continue;
      seen.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    out.set(n.id, [...seen]);
  }
  return out;
}

export interface Figures {
  revenue: Dec;
  cost: Dec;
  committed: Dec;
  overheadIn: Dec;
  overheadOut: Dec;
}

export const emptyFigures = (): Figures => ({ revenue: ZERO, cost: ZERO, committed: ZERO, overheadIn: ZERO, overheadOut: ZERO });

export function addFigures(a: Figures, b: Figures): Figures {
  return { revenue: a.revenue.plus(b.revenue), cost: a.cost.plus(b.cost), committed: a.committed.plus(b.committed), overheadIn: a.overheadIn.plus(b.overheadIn), overheadOut: a.overheadOut.plus(b.overheadOut) };
}

/** Resultado = receita − custo − rateio recebido + rateio cedido; margem = resultado ÷ receita. */
export function presentFigures(f: Figures) {
  const result = f.revenue.minus(f.cost).minus(f.overheadIn).plus(f.overheadOut);
  return {
    revenue: money(f.revenue),
    cost: money(f.cost),
    committed: money(f.committed),
    overheadIn: money(f.overheadIn),
    overheadOut: money(f.overheadOut),
    result: money(result),
    margin: f.revenue.gt(0) ? ratio(result, f.revenue) : null,
  };
}

// ---------------------------------------------------------------------------
// Equipe técnica
// ---------------------------------------------------------------------------

/**
 * Receita atribuída à equipe: por projeto, receita do projeto × horas da equipe ÷ horas de todas as equipes.
 * Projeto sem horas de ninguém não atribui nada.
 */
export function attributeRevenue(teamHours: Map<string, Dec>, allHours: Map<string, Dec>, projectRevenue: Map<string, Dec>) {
  const rows: Array<{ projectId: string; teamHours: Dec; share: Dec | null; revenue: Dec }> = [];
  for (const [projectId, hours] of teamHours) {
    const all = allHours.get(projectId) ?? hours;
    const share = all.gt(0) ? hours.div(all) : null;
    const revenue = share ? (projectRevenue.get(projectId) ?? ZERO).mul(share).toDecimalPlaces(2, HALF_UP) : ZERO;
    rows.push({ projectId, teamHours: hours, share, revenue });
  }
  return { rows, total: sum(rows.map((r) => r.revenue)) };
}

/** Horas ociosas = disponíveis − horas lançadas em atividades que não são `ocioso` (mínimo 0). */
export function idleHours(available: Dec, hoursByActivity: Map<string, Dec>): Dec {
  let worked = ZERO;
  for (const [activity, hours] of hoursByActivity) if (activity !== 'ocioso') worked = worked.plus(hours);
  return D.max(ZERO, available.minus(worked));
}
