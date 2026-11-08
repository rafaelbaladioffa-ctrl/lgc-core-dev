import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CcCategory, type CcEntry, type CcEntrySource } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import {
  D,
  ZERO,
  addFigures,
  budgetStatus,
  daysAllocatedInMonth,
  descendantsMap,
  distributeOverhead,
  emptyFigures,
  isoDate,
  money,
  monthlyRoleCost,
  parseDate,
  parseMonth,
  parsePeriod,
  personDays,
  presentFigures,
  sum,
  todaySaoPaulo,
  workingDays,
  type Dec,
  type Figures,
  type OverheadDriver,
  type Period,
} from './cc-engine.js';
import { CcContext, type CcNode } from './cc-context.js';
import { refreshBudgetStatus, yearConsumption } from './cc-budget-status.js';
import { advanceRef, releaseCommitments } from './cc-events.js';
import { LogisticsClient } from './logistics.client.js';
import { COST_CATEGORIES, type BudgetDto, type CreateEntryDto, type JobTitleMapDto, type OverheadRuleDto, type SettleAdvanceDto } from './cost-centers.dto.js';

const FUNNEL = ['aprovada', 'pedido', 'recebida_parcial', 'recebida', 'cancelada'] as const;

/** Linha que ainda vale: não é estorno e não foi estornada. */
const LIVE = { reversesId: null, reversedBy: { is: null } } satisfies Prisma.CcEntryWhereInput;

export interface PeriodTotals {
  own: Map<string, Figures>;
  byCategory: Map<string, Map<string, { realized: Dec; committed: Dec }>>;
  overhead: ReturnType<typeof distributeOverhead>;
}

@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: CcContext,
    private readonly outbox: OutboxService,
    private readonly logistics: LogisticsClient,
  ) {}

  // -------------------------------------------------------------------------
  // Totais do período (todos os CCs: o rateio depende dos pesos de todos)
  // -------------------------------------------------------------------------

  async periodTotals(period: Period): Promise<PeriodTotals> {
    const rows = await this.prisma.ccEntry.groupBy({
      by: ['costCenterAxisId', 'kind', 'stage', 'category'],
      where: { competence: { gte: period.start, lt: period.end } },
      _sum: { amount: true },
    });
    const own = new Map<string, Figures>();
    const byCategory = new Map<string, Map<string, { realized: Dec; committed: Dec }>>();
    for (const r of rows) {
      const f = own.get(r.costCenterAxisId) ?? emptyFigures();
      const v = new D(r._sum.amount ?? 0);
      if (r.kind === 'receita' && r.stage === 'realizado') f.revenue = f.revenue.plus(v);
      if (r.kind === 'custo' && r.stage === 'realizado') f.cost = f.cost.plus(v);
      if (r.kind === 'custo' && r.stage === 'comprometido') f.committed = f.committed.plus(v);
      own.set(r.costCenterAxisId, f);
      if (r.kind === 'custo') {
        const cats = byCategory.get(r.costCenterAxisId) ?? new Map();
        const c = cats.get(r.category) ?? { realized: ZERO, committed: ZERO };
        if (r.stage === 'realizado') c.realized = c.realized.plus(v);
        else c.committed = c.committed.plus(v);
        cats.set(r.category, c);
        byCategory.set(r.costCenterAxisId, cats);
      }
    }
    for (const f of own.values()) f.committed = D.max(ZERO, f.committed);

    // Rateio: origem = custo realizado próprio; pesos medidos no mesmo período.
    const rules = await this.prisma.ccOverheadRule.findMany({ where: { active: true }, include: { targets: true } });
    let overhead: PeriodTotals['overhead'] = { received: new Map(), ceded: new Map(), warnings: [] };
    if (rules.length > 0) {
      const days = workingDays(period);
      const allocations = await this.ctx.allocations(null, period);
      const headcount = new Map<string, Dec>();
      for (const a of allocations) {
        const n = personDays([a], days).get(a.collaboratorId) ?? 0;
        if (n > 0) headcount.set(a.costCenterId, (headcount.get(a.costCenterId) ?? ZERO).plus(n));
      }
      const map = (pick: (f: Figures) => Dec) => new Map([...own.entries()].map(([k, f]) => [k, pick(f)]));
      overhead = distributeOverhead(
        rules.map((r) => ({ source: r.sourceCostCenterAxisId, driver: r.driver as OverheadDriver, targets: r.targets.map((t) => ({ costCenterId: t.costCenterAxisId, percent: t.percent })) })),
        map((f) => f.cost),
        { headcount, receita: map((f) => f.revenue), custo_direto: map((f) => f.cost) },
      );
      for (const [id, list] of overhead.received) {
        const f = own.get(id) ?? emptyFigures();
        f.overheadIn = sum(list.map((x) => x.amount));
        own.set(id, f);
      }
      for (const [id, list] of overhead.ceded) {
        const f = own.get(id) ?? emptyFigures();
        f.overheadOut = sum(list.map((x) => x.amount));
        own.set(id, f);
      }
    }
    return { own, byCategory, overhead };
  }

  private async yearBudgets(year: number, ids: string[]) {
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const [budgets, consumption] = await Promise.all([
      this.prisma.ccBudget.groupBy({ by: ['costCenterAxisId'], where: { year, costCenterAxisId: { in: ids } }, _sum: { amount: true } }),
      this.prisma.ccEntry.groupBy({ by: ['costCenterAxisId', 'stage'], where: { kind: 'custo', costCenterAxisId: { in: ids }, competence: { gte: start, lt: end } }, _sum: { amount: true } }),
    ]);
    const out = new Map<string, { year: number; amount: string; consumed: string; percent: string | null; status: ReturnType<typeof budgetStatus>['status'] }>();
    for (const id of ids) {
      const amount = new D(budgets.find((b) => b.costCenterAxisId === id)?._sum.amount ?? 0);
      const realized = new D(consumption.find((c) => c.costCenterAxisId === id && c.stage === 'realizado')?._sum.amount ?? 0);
      const committed = D.max(ZERO, new D(consumption.find((c) => c.costCenterAxisId === id && c.stage === 'comprometido')?._sum.amount ?? 0));
      const consumed = realized.plus(committed);
      out.set(id, { year, amount: money(amount), consumed: money(consumed), ...budgetStatus(amount, consumed) });
    }
    return out;
  }

  private summary(node: CcNode, totals: PeriodTotals, desc: Map<string, string[]>, budget: ReturnType<CostCentersService['emptyBudget']>) {
    const own = totals.own.get(node.id) ?? emptyFigures();
    let consolidated = own;
    for (const d of desc.get(node.id) ?? []) consolidated = addFigures(consolidated, totals.own.get(d) ?? emptyFigures());
    return { ...node, own: presentFigures(own), consolidated: presentFigures(consolidated), budget };
  }

  private emptyBudget(year: number) {
    return { year, amount: '0.00', consumed: '0.00', percent: null as string | null, status: 'sem_orcamento' as ReturnType<typeof budgetStatus>['status'] };
  }

  // -------------------------------------------------------------------------
  // Visão geral e detalhe
  // -------------------------------------------------------------------------

  async list(user: AuthenticatedUser, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    const nodes = await this.ctx.nodes();
    const visible = this.ctx.visible(user, nodes);
    const year = Number(period.to.slice(0, 4));
    const [totals, budgets] = await Promise.all([this.periodTotals(period), this.yearBudgets(year, [...visible])]);
    const desc = descendantsMap(nodes);
    const items = nodes.filter((n) => visible.has(n.id)).map((n) => this.summary(n, totals, desc, budgets.get(n.id) ?? this.emptyBudget(year)));
    const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? null;

    const alerts: Array<{ costCenterId: string; name: string | null; type: 'orcamento' | 'despesa_campo' | 'rateio'; message: string }> = [];
    for (const item of items) {
      if (item.budget.status === 'estourado') alerts.push({ costCenterId: item.id, name: item.name, type: 'orcamento', message: `Orçamento de ${year} estourado (${pct(item.budget.percent)} consumido).` });
      else if (item.budget.status === 'alerta') alerts.push({ costCenterId: item.id, name: item.name, type: 'orcamento', message: `Orçamento de ${year} em alerta (${pct(item.budget.percent)} consumido).` });
    }
    for (const w of totals.overhead.warnings) if (visible.has(w.costCenterId)) alerts.push({ costCenterId: w.costCenterId, name: name(w.costCenterId), type: 'rateio', message: w.message });
    for (const a of await this.fieldExpenseAlerts(period, [...visible])) alerts.push({ ...a, name: name(a.costCenterId), type: 'despesa_campo' });
    return { period: { from: period.from, to: period.to }, year, items, alerts };
  }

  /** Despesa de campo por pessoa-dia acima do limite do CC. */
  private async fieldExpenseAlerts(period: Period, ids: string[]) {
    const settings = await this.prisma.ccSetting.findMany({ where: { costCenterAxisId: { in: ids }, fieldDailyLimit: { not: null } } });
    const out: Array<{ costCenterId: string; message: string }> = [];
    for (const s of settings) {
      const f = await this.fieldExpenses(s.costCenterAxisId, period);
      if (f.perPersonDay && s.fieldDailyLimit && new D(f.perPersonDay).gt(s.fieldDailyLimit)) {
        out.push({ costCenterId: s.costCenterAxisId, message: `Despesa de campo de R$ ${f.perPersonDay} por pessoa-dia, acima do limite de R$ ${money(new D(s.fieldDailyLimit))}.` });
      }
    }
    return out;
  }

  async fieldExpenses(costCenterAxisId: string, period: Period) {
    const [spent, logs, setting] = await Promise.all([
      this.prisma.ccEntry.aggregate({ where: { costCenterAxisId, kind: 'custo', stage: 'realizado', category: 'despesas_campo', competence: { gte: period.start, lt: period.end } }, _sum: { amount: true } }),
      this.prisma.ccTeamLog.aggregate({ where: { costCenterAxisId, activity: { in: ['projeto', 'deslocamento'] }, date: { gte: period.start, lt: period.end } }, _sum: { people: true } }),
      this.prisma.ccSetting.findUnique({ where: { costCenterAxisId } }),
    ]);
    const total = new D(spent._sum.amount ?? 0);
    const personDaysLogged = logs._sum.people ?? 0;
    const perPersonDay = personDaysLogged > 0 ? money(total.div(personDaysLogged)) : null;
    const limit = setting?.fieldDailyLimit ? money(new D(setting.fieldDailyLimit)) : null;
    return { total: money(total), personDays: personDaysLogged, perPersonDay, limit, overLimit: !!(perPersonDay && limit && new D(perPersonDay).gt(limit)) };
  }

  async detail(user: AuthenticatedUser, id: string, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    const { node, nodes } = await this.ctx.requireVisible(user, id);
    const year = Number(period.to.slice(0, 4));
    const [totals, budgets] = await Promise.all([this.periodTotals(period), this.yearBudgets(year, [id])]);
    const desc = descendantsMap(nodes);
    const name = (cc: string) => nodes.find((n) => n.id === cc)?.name ?? null;

    // Orçamento do período, por categoria e por mês.
    const budgetRows = await this.prisma.ccBudget.findMany({ where: { costCenterAxisId: id, year: { gte: Number(period.from.slice(0, 4)), lte: year } } });
    const inPeriod = budgetRows.filter((b) => period.months.includes(`${b.year}-${String(b.month).padStart(2, '0')}`));
    const cats = totals.byCategory.get(id) ?? new Map();
    const costsByCategory = COST_CATEGORIES.map((category) => ({
      category,
      realized: money(cats.get(category)?.realized ?? ZERO),
      committed: money(D.max(ZERO, cats.get(category)?.committed ?? ZERO)),
      budget: money(sum(inPeriod.filter((b) => b.category === category).map((b) => new D(b.amount)))),
    }));

    const monthlyRows = await this.prisma.$queryRaw<Array<{ month: string; kind: string; stage: string; total: Prisma.Decimal }>>`
      SELECT to_char(competence, 'YYYY-MM') AS month, kind::text AS kind, stage::text AS stage, SUM(amount) AS total
      FROM cc_entries WHERE cost_center_axis_id = ${id} AND competence >= ${period.start} AND competence < ${period.end}
      GROUP BY 1, 2, 3`;
    const monthly = period.months.map((m) => {
      const pick = (kind: string, stage: string) => new D(monthlyRows.find((r) => r.month === m && r.kind === kind && r.stage === stage)?.total ?? 0);
      return {
        month: m,
        budget: money(sum(inPeriod.filter((b) => `${b.year}-${String(b.month).padStart(2, '0')}` === m).map((b) => new D(b.amount)))),
        realized: money(pick('custo', 'realizado')),
        committed: money(D.max(ZERO, pick('custo', 'comprometido'))),
        revenue: money(pick('receita', 'realizado')),
      };
    });

    const purchases = await this.prisma.ccPurchase.findMany({
      where: { costCenterAxisId: id, OR: [{ approvedAt: { gte: period.start, lt: period.end } }, { approvedAt: null, orderedAt: { gte: period.start, lt: period.end } }] },
    });
    const funnel = FUNNEL.map((status) => {
      const list = purchases.filter((p) => p.status === status);
      return { status, count: list.length, total: money(sum(list.map((p) => new D(p.total)))) };
    });

    const projects = await this.prisma.axisMasterCache.findMany({ where: { kind: 'PROJECT', data: { path: ['cost_center_id'], equals: id } } });
    const won = projects.length
      ? await this.prisma.budgetRevision.findMany({ where: { status: 'ganha', budget: { axisProjectId: { in: projects.map((p) => p.axisId) } } }, include: { budget: true } })
      : [];
    const contractedRevenue = projects
      .map((p) => ({ projectId: p.axisId, code: p.code, name: p.name, revenue: money(sum(won.filter((r) => r.budget.axisProjectId === p.axisId).map((r) => new D(r.revenue ?? 0)))) }))
      .filter((r) => r.revenue !== '0.00');

    const setting = await this.prisma.ccSetting.findUnique({ where: { costCenterAxisId: id } });
    return {
      ...this.summary(node, totals, desc, budgets.get(id) ?? this.emptyBudget(year)),
      period: { from: period.from, to: period.to },
      costsByCategory,
      monthly,
      overhead: {
        received: (totals.overhead.received.get(id) ?? []).map((x) => ({ costCenterId: x.costCenterId, name: name(x.costCenterId), amount: money(x.amount) })),
        ceded: (totals.overhead.ceded.get(id) ?? []).map((x) => ({ costCenterId: x.costCenterId, name: name(x.costCenterId), amount: money(x.amount) })),
      },
      funnel,
      contractedRevenue,
      settings: { fieldDailyLimit: setting?.fieldDailyLimit ? money(new D(setting.fieldDailyLimit)) : null },
      children: nodes.filter((n) => n.parentId === id).map((n) => n.id),
    };
  }

  // -------------------------------------------------------------------------
  // Lançamentos
  // -------------------------------------------------------------------------

  async entries(user: AuthenticatedUser, id: string, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    await this.ctx.requireVisible(user, id);
    const rows = await this.prisma.ccEntry.findMany({
      where: { costCenterAxisId: id, competence: { gte: period.start, lt: period.end } },
      include: { reversedBy: { select: { id: true } } },
      orderBy: [{ competence: 'desc' }, { createdAt: 'desc' }],
      take: 2000,
    });
    const projects = await this.ctx.names('PROJECT', rows.map((r) => r.projectAxisId ?? ''));
    return rows.map((r) => this.presentEntry(r, projects.get(r.projectAxisId ?? '')?.code ?? null, !!r.reversedBy));
  }

  private presentEntry(r: CcEntry, projectCode: string | null, reversed: boolean) {
    return {
      id: r.id,
      costCenterId: r.costCenterAxisId,
      competence: isoDate(r.competence),
      kind: r.kind,
      category: r.category,
      stage: r.stage,
      source: r.source,
      amount: money(new D(r.amount)),
      description: r.description,
      projectId: r.projectAxisId,
      projectCode,
      sourceRef: r.sourceRef,
      reversesId: r.reversesId,
      reversed,
      reason: r.reason,
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async createEntry(user: AuthenticatedUser, id: string, dto: CreateEntryDto) {
    const { node } = await this.ctx.requireVisible(user, id);
    if (!node.active) throw new BadRequestException('Centro de custo inativo no Core: não aceita lançamento.');
    if ((dto.kind === 'receita') !== (dto.category === 'faturamento')) throw new BadRequestException('Receita usa a categoria Faturamento; custo usa as demais.');
    const value = new D(dto.amount);
    if (value.lte(0)) throw new BadRequestException('O valor precisa ser maior que zero. Para corrigir, estorne o lançamento.');
    const competence = parseDate(dto.competence, 'Competência');
    if (dto.projectId) await this.assertProject(dto.projectId);
    return this.prisma.$transaction(async (tx) => {
      const entry = await tx.ccEntry.create({
        data: {
          costCenterAxisId: id,
          projectAxisId: dto.projectId ?? null,
          competence,
          kind: dto.kind,
          category: dto.category,
          stage: 'realizado',
          source: 'manual',
          amount: value,
          description: dto.description.trim(),
          createdBy: user.userId,
        },
      });
      if (dto.kind === 'custo') await refreshBudgetStatus(tx, this.outbox, id, competence.getUTCFullYear());
      return this.presentEntry(entry, null, false);
    });
  }

  async reverseEntry(user: AuthenticatedUser, entryId: string, reason: string) {
    const entry = await this.prisma.ccEntry.findUnique({ where: { id: entryId }, include: { reversedBy: { select: { id: true } } } });
    if (!entry) throw new NotFoundException('Lançamento não encontrado.');
    await this.ctx.requireVisible(user, entry.costCenterAxisId);
    if (entry.source !== 'manual') throw new BadRequestException('Só lançamentos manuais são estornados pela tela. Os automáticos se corrigem na origem (Core, folha ou importação).');
    if (entry.reversesId) throw new BadRequestException('Este lançamento já é um estorno.');
    if (entry.reversedBy) throw new BadRequestException('Este lançamento já foi estornado.');
    return this.prisma.$transaction(async (tx) => {
      const rev = await tx.ccEntry.create({
        data: { ...pickEntry(entry), amount: new D(entry.amount).negated(), reversesId: entry.id, reason: reason.trim(), createdBy: user.userId },
      });
      if (entry.kind === 'custo') await refreshBudgetStatus(tx, this.outbox, entry.costCenterAxisId, entry.competence.getUTCFullYear());
      return this.presentEntry(rev, null, false);
    });
  }

  private async assertProject(projectId: string) {
    const p = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: projectId } } });
    if (!p) throw new BadRequestException('Projeto não encontrado no Financeiro. Atualize os projetos do Core.');
  }

  // -------------------------------------------------------------------------
  // Orçamento e configuração
  // -------------------------------------------------------------------------

  async getBudget(user: AuthenticatedUser, id: string, year: number) {
    assertYear(year);
    await this.ctx.requireVisible(user, id);
    const rows = await this.prisma.ccBudget.findMany({ where: { costCenterAxisId: id, year } });
    return {
      year,
      rows: COST_CATEGORIES.map((category) => ({
        category,
        months: Array.from({ length: 12 }, (_, i) => money(new D(rows.find((r) => r.category === category && r.month === i + 1)?.amount ?? 0))),
      })),
    };
  }

  async putBudget(user: AuthenticatedUser, id: string, year: number, dto: BudgetDto) {
    assertYear(year);
    await this.ctx.requireVisible(user, id);
    const categories = dto.rows.map((r) => r.category);
    if (new Set(categories).size !== categories.length) throw new BadRequestException('Categoria repetida no orçamento.');
    await this.prisma.$transaction(async (tx) => {
      await tx.ccBudget.deleteMany({ where: { costCenterAxisId: id, year } });
      const data = dto.rows.flatMap((r) =>
        r.months.map((v, i) => ({ costCenterAxisId: id, year, month: i + 1, category: r.category as CcCategory, amount: new D(v), updatedBy: user.userId })).filter((x) => x.amount.gt(0)),
      );
      if (data.length) await tx.ccBudget.createMany({ data });
      await refreshBudgetStatus(tx, this.outbox, id, year, true);
    });
    return this.getBudget(user, id, year);
  }

  async putSettings(user: AuthenticatedUser, id: string, fieldDailyLimit: string | null) {
    await this.ctx.requireVisible(user, id);
    const value = fieldDailyLimit === null ? null : new D(fieldDailyLimit);
    await this.prisma.ccSetting.upsert({
      where: { costCenterAxisId: id },
      create: { costCenterAxisId: id, fieldDailyLimit: value, updatedBy: user.userId },
      update: { fieldDailyLimit: value, updatedBy: user.userId },
    });
    return { fieldDailyLimit: value ? money(value) : null };
  }

  /** Situação do orçamento no ano (usada nos testes e pela tela de detalhe). */
  consumption(id: string, year: number) {
    return yearConsumption(this.prisma, id, year);
  }

  // -------------------------------------------------------------------------
  // Rateio
  // -------------------------------------------------------------------------

  async overheadRules() {
    const [rules, nodes] = await Promise.all([this.prisma.ccOverheadRule.findMany({ include: { targets: true }, orderBy: { updatedAt: 'desc' } }), this.ctx.nodes()]);
    const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? null;
    return rules.map((r) => ({
      sourceCostCenterId: r.sourceCostCenterAxisId,
      sourceName: name(r.sourceCostCenterAxisId),
      driver: r.driver,
      active: r.active,
      notes: r.notes,
      targets: r.targets.map((t) => ({ costCenterId: t.costCenterAxisId, name: name(t.costCenterAxisId), percent: t.percent === null ? null : new D(t.percent).toFixed(6) })),
    }));
  }

  async putOverheadRule(user: AuthenticatedUser, sourceId: string, dto: OverheadRuleDto) {
    const nodes = await this.ctx.nodes();
    const ids = new Set(nodes.map((n) => n.id));
    if (!ids.has(sourceId)) throw new NotFoundException('Centro de custo de origem não encontrado.');
    const targets = dto.targets.map((t) => t.costCenterId);
    if (targets.length === 0) throw new BadRequestException('Escolha ao menos um centro de custo de destino.');
    if (new Set(targets).size !== targets.length) throw new BadRequestException('Destino repetido no rateio.');
    if (targets.includes(sourceId)) throw new BadRequestException('A origem não pode ser destino do próprio rateio.');
    if (targets.some((t) => !ids.has(t))) throw new BadRequestException('Algum destino não existe no Financeiro.');
    if (dto.driver === 'percentual') {
      if (dto.targets.some((t) => t.percent === undefined)) throw new BadRequestException('No rateio percentual, informe o percentual de cada destino.');
      const total = sum(dto.targets.map((t) => new D(t.percent!)));
      if (total.gt(1)) throw new BadRequestException('Os percentuais somam mais de 100%.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.ccOverheadRule.upsert({
        where: { sourceCostCenterAxisId: sourceId },
        create: { sourceCostCenterAxisId: sourceId, driver: dto.driver, active: dto.active, notes: dto.notes?.trim() || null, updatedBy: user.userId },
        update: { driver: dto.driver, active: dto.active, notes: dto.notes?.trim() || null, updatedBy: user.userId },
      });
      await tx.ccOverheadTarget.deleteMany({ where: { ruleSourceId: sourceId } });
      await tx.ccOverheadTarget.createMany({
        data: dto.targets.map((t) => ({ ruleSourceId: sourceId, costCenterAxisId: t.costCenterId, percent: dto.driver === 'percentual' ? new D(t.percent!) : null })),
      });
    });
    return (await this.overheadRules()).find((r) => r.sourceCostCenterId === sourceId);
  }

  async deleteOverheadRule(sourceId: string) {
    const deleted = await this.prisma.ccOverheadRule.deleteMany({ where: { sourceCostCenterAxisId: sourceId } });
    if (deleted.count === 0) throw new NotFoundException('Regra de rateio não encontrada.');
  }

  // -------------------------------------------------------------------------
  // Cargos × funções e folha
  // -------------------------------------------------------------------------

  async jobTitleMaps() {
    const [maps, params, collaborators] = await Promise.all([
      this.prisma.jobTitleRoleMap.findMany({ orderBy: { jobTitleName: 'asc' } }),
      this.ctx.paramsAt(parseDate(todaySaoPaulo())),
      this.prisma.axisMasterCache.findMany({ where: { kind: 'COLLABORATOR', active: true } }),
    ]);
    const mapped = new Set(maps.map((m) => m.axisJobTitleId));
    const unmapped = new Map<string, { jobTitleId: string; jobTitleName: string | null; collaborators: number }>();
    for (const c of collaborators) {
      const data = (c.data ?? {}) as Record<string, unknown>;
      const jt = typeof data['job_title_id'] === 'string' ? (data['job_title_id'] as string) : null;
      if (!jt || mapped.has(jt)) continue;
      const row = unmapped.get(jt) ?? { jobTitleId: jt, jobTitleName: typeof data['job_title_name'] === 'string' ? (data['job_title_name'] as string) : null, collaborators: 0 };
      row.collaborators++;
      unmapped.set(jt, row);
    }
    return {
      maps: maps.map((m) => ({ jobTitleId: m.axisJobTitleId, jobTitleName: m.jobTitleName, roleKey: m.roleKey })),
      unmapped: [...unmapped.values()],
      roles: (params?.roles ?? []).map((r) => ({ roleKey: r.roleKey, label: r.label })),
    };
  }

  async putJobTitleMap(user: AuthenticatedUser, jobTitleId: string, dto: JobTitleMapDto) {
    if (!/^[0-9a-f-]{36}$/i.test(jobTitleId)) throw new BadRequestException('Cargo inválido.');
    const row = await this.prisma.jobTitleRoleMap.upsert({
      where: { axisJobTitleId: jobTitleId },
      create: { axisJobTitleId: jobTitleId, jobTitleName: dto.jobTitleName.trim(), roleKey: dto.roleKey, updatedBy: user.userId },
      update: { jobTitleName: dto.jobTitleName.trim(), roleKey: dto.roleKey, updatedBy: user.userId },
    });
    return { jobTitleId: row.axisJobTitleId, jobTitleName: row.jobTitleName, roleKey: row.roleKey };
  }

  /** Folha da competência por CC: custo mensal da função × dias alocados ÷ dias do mês (spec §4). */
  async generatePayroll(user: AuthenticatedUser, monthText: string) {
    const month = parseMonth(monthText);
    const params = await this.ctx.paramsAt(new Date(month.end.getTime() - 1));
    if (!params) throw new BadRequestException('Não há conjunto de parâmetros publicado para calcular a folha.');
    const [allocations, roleMap] = await Promise.all([this.ctx.allocations(null, month), this.ctx.roleMap()]);
    const collaborators = await this.ctx.names('COLLABORATOR', allocations.map((a) => a.collaboratorId));
    const daysInMonth = Math.round((month.end.getTime() - month.start.getTime()) / 86_400_000);
    const byCc = new Map<string, Dec>();
    const unmapped = new Map<string, { collaboratorId: string; name: string | null; jobTitleName: string | null }>();
    for (const a of allocations) {
      const c = collaborators.get(a.collaboratorId);
      const jt = typeof c?.data['job_title_id'] === 'string' ? (c.data['job_title_id'] as string) : null;
      const role = params.roles.find((r) => r.roleKey === (jt ? roleMap.get(jt) : undefined));
      const monthly = role ? monthlyRoleCost(params, role) : null;
      if (!monthly) {
        unmapped.set(a.collaboratorId, { collaboratorId: a.collaboratorId, name: c?.name ?? null, jobTitleName: typeof c?.data['job_title_name'] === 'string' ? (c.data['job_title_name'] as string) : null });
        continue;
      }
      const days = daysAllocatedInMonth(a, month);
      if (days > 0) byCc.set(a.costCenterId, (byCc.get(a.costCenterId) ?? ZERO).plus(monthly.mul(days).div(daysInMonth)));
    }
    const stats = await this.prisma.$transaction(
      (tx) =>
        this.replaceMonth(
          tx,
          `folha:${monthText}:`,
          [...byCc.entries()].map(([cc, value]) => ({ ref: `folha:${monthText}:${cc}`, costCenterAxisId: cc, projectAxisId: null, amount: value.toDecimalPlaces(2), description: `Folha ${monthText} (parâmetros ${params.code})` })),
          { competence: month.start, category: 'folha', source: 'folha', actor: user.userId },
        ),
      { timeout: 60_000 },
    );
    return { month: monthText, ...stats, unmapped: [...unmapped.values()] };
  }

  /** Consumo de material da Logística na competência (spec §2). Linhas sem CC são contadas e ignoradas. */
  async importLogistics(user: AuthenticatedUser, monthText: string) {
    const month = parseMonth(monthText);
    const rows = await this.logistics.consumption(monthText);
    const lines = new Map<string, { ref: string; costCenterAxisId: string; projectAxisId: string | null; amount: Dec; description: string }>();
    let withoutCostCenter = 0;
    for (const r of rows) {
      if (!r.cost_center_id) {
        withoutCostCenter++;
        continue;
      }
      const ref = `logistica:${monthText}:${r.cost_center_id}:${r.project_id ?? '-'}`;
      const prev = lines.get(ref);
      const amount = new D(r.value || 0).toDecimalPlaces(2).plus(prev?.amount ?? 0);
      lines.set(ref, { ref, costCenterAxisId: r.cost_center_id, projectAxisId: r.project_id, amount, description: `Consumo de material da Logística ${monthText}` });
    }
    const stats = await this.prisma.$transaction((tx) => this.replaceMonth(tx, `logistica:${monthText}:`, [...lines.values()], { competence: month.start, category: 'material', source: 'logistica', actor: user.userId }), {
      timeout: 60_000,
    });
    return { month: monthText, ...stats, withoutCostCenter };
  }

  /**
   * Substitui os lançamentos automáticos de uma competência: igual fica; diferente é estornado e lançado de novo;
   * referência que sumiu é estornada. Atualiza a faixa do orçamento dos CCs mexidos.
   */
  async replaceMonth(
    tx: Prisma.TransactionClient,
    prefix: string,
    lines: Array<{ ref: string; costCenterAxisId: string; projectAxisId: string | null; amount: Dec; description: string }>,
    opts: { competence: Date; category: CcCategory; source: CcEntrySource; actor: string },
  ) {
    const current = await tx.ccEntry.findMany({ where: { sourceRef: { startsWith: prefix }, ...LIVE } });
    const byRef = new Map(current.map((e) => [e.sourceRef!, e]));
    const touched = new Set<string>();
    let created = 0;
    let replaced = 0;
    let unchanged = 0;
    const reverse = async (e: CcEntry, reason: string) => {
      await tx.ccEntry.create({ data: { ...pickEntry(e), amount: new D(e.amount).negated(), reversesId: e.id, reason, createdBy: opts.actor } });
      touched.add(e.costCenterAxisId);
    };
    for (const line of lines) {
      const existing = byRef.get(line.ref);
      byRef.delete(line.ref);
      if (existing && new D(existing.amount).eq(line.amount)) {
        unchanged++;
        continue;
      }
      if (existing) {
        await reverse(existing, 'Recalculado');
        replaced++;
      } else created++;
      if (line.amount.isZero()) continue;
      await tx.ccEntry.create({
        data: {
          costCenterAxisId: line.costCenterAxisId,
          projectAxisId: line.projectAxisId,
          competence: opts.competence,
          kind: 'custo',
          category: opts.category,
          stage: 'realizado',
          source: opts.source,
          amount: line.amount,
          description: line.description,
          sourceRef: line.ref,
          createdBy: opts.actor,
        },
      });
      touched.add(line.costCenterAxisId);
    }
    for (const e of byRef.values()) {
      await reverse(e, 'Não consta mais na origem');
      replaced++;
    }
    for (const cc of touched) await refreshBudgetStatus(tx, this.outbox, cc, opts.competence.getUTCFullYear());
    return { created, replaced, unchanged };
  }

  // -------------------------------------------------------------------------
  // Adiantamentos e compras
  // -------------------------------------------------------------------------

  async advances(user: AuthenticatedUser, status?: 'aberto' | 'prestado', costCenterIds?: string[]) {
    const nodes = await this.ctx.nodes();
    const visible = this.ctx.visible(user, nodes);
    const ids = (costCenterIds ?? [...visible]).filter((id) => visible.has(id));
    const rows = await this.prisma.ccAdvance.findMany({ where: { costCenterAxisId: { in: ids }, ...(status && { status }) }, orderBy: { approvedAt: 'asc' } });
    return this.presentAdvances(rows);
  }

  async presentAdvances(rows: Awaited<ReturnType<PrismaService['ccAdvance']['findMany']>>) {
    const names = await this.ctx.names('COLLABORATOR', rows.map((r) => r.collaboratorAxisId));
    return rows.map((r) => ({
      id: r.id,
      requestCode: r.requestCode,
      collaboratorId: r.collaboratorAxisId,
      collaboratorName: names.get(r.collaboratorAxisId)?.name ?? null,
      costCenterId: r.costCenterAxisId,
      amount: money(new D(r.amount)),
      approvedAt: r.approvedAt.toISOString(),
      status: r.status,
      spentAmount: r.spentAmount === null ? null : money(new D(r.spentAmount)),
      settledAt: r.settledAt?.toISOString() ?? null,
    }));
  }

  /** Prestação de contas: baixa o comprometido e lança o gasto comprovado como realizado (hoje). */
  async settleAdvance(user: AuthenticatedUser, id: string, dto: SettleAdvanceDto) {
    const adv = await this.prisma.ccAdvance.findUnique({ where: { id } });
    if (!adv) throw new NotFoundException('Adiantamento não encontrado.');
    await this.ctx.requireVisible(user, adv.costCenterAxisId);
    if (adv.status !== 'aberto') throw new BadRequestException('Este adiantamento já teve a prestação de contas registrada.');
    const spent = new D(dto.spentAmount);
    const today = parseDate(todaySaoPaulo());
    const updated = await this.prisma.$transaction(async (tx) => {
      await releaseCommitments(tx, advanceRef(adv.requestAxisId), 'Prestação de contas');
      if (spent.gt(0)) {
        await tx.ccEntry.create({
          data: {
            costCenterAxisId: adv.costCenterAxisId,
            projectAxisId: adv.projectAxisId,
            competence: today,
            kind: 'custo',
            category: 'despesas_campo',
            stage: 'realizado',
            source: 'adiantamento',
            amount: spent,
            description: `Adiantamento ${adv.requestCode} — prestação de contas`,
            sourceRef: `${advanceRef(adv.requestAxisId)}:prestacao`,
            createdBy: user.userId,
          },
        });
      }
      const row = await tx.ccAdvance.update({ where: { id }, data: { status: 'prestado', spentAmount: spent, notes: dto.notes?.trim() || null, settledAt: new Date(), settledBy: user.userId } });
      await refreshBudgetStatus(tx, this.outbox, adv.costCenterAxisId, today.getUTCFullYear());
      return row;
    });
    return (await this.presentAdvances([updated]))[0];
  }

  async purchases(user: AuthenticatedUser, costCenterId?: string, status?: string) {
    const nodes = await this.ctx.nodes();
    const visible = this.ctx.visible(user, nodes);
    if (costCenterId && !visible.has(costCenterId)) throw new ForbiddenException('Você não tem acesso a este centro de custo.');
    const rows = await this.prisma.ccPurchase.findMany({
      where: { costCenterAxisId: costCenterId ? costCenterId : { in: [...visible] }, ...(status && { status: status as never }) },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      requestId: r.requestAxisId,
      code: r.code,
      costCenterId: r.costCenterAxisId,
      projectId: r.projectAxisId,
      total: money(new D(r.total)),
      status: r.status,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      orderedAt: r.orderedAt?.toISOString() ?? null,
      receivedAt: r.receivedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
    }));
  }
}

function pickEntry(e: CcEntry) {
  return { costCenterAxisId: e.costCenterAxisId, projectAxisId: e.projectAxisId, competence: e.competence, kind: e.kind, category: e.category, stage: e.stage, source: e.source, description: e.description };
}

function assertYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException('Ano inválido.');
}

const pct = (fraction: string | null) => (fraction === null ? '—' : `${new D(fraction).mul(100).toFixed(1).replace('.', ',')}%`);

