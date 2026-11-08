import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { hourlyCost } from '../budget-params/hourly-cost.js';
import {
  D,
  ZERO,
  attributeRevenue,
  idleHours,
  isAllocatedOn,
  isoDate,
  money,
  moneyOrNull,
  parseDate,
  parsePeriod,
  personDays,
  ratio,
  sum,
  todaySaoPaulo,
  workingDays,
  type Dec,
  type Period,
} from './cc-engine.js';
import { CcContext, type CcNode } from './cc-context.js';
import { CostCentersService } from './cost-centers.service.js';
import { LogisticsClient } from './logistics.client.js';
import type { TeamLogDto } from './cost-centers.dto.js';

const DEFAULT_HOURS_PER_DAY = new D(8);

/** Painel das equipes técnicas (centros-de-custo-especificacao §6). */
@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: CcContext,
    private readonly costCenters: CostCentersService,
    private readonly logistics: LogisticsClient,
  ) {}

  async list(user: AuthenticatedUser, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    const nodes = await this.ctx.nodes();
    const visible = this.ctx.visible(user, nodes);
    const teams = nodes.filter((n) => n.kind === 'equipe_tecnica' && visible.has(n.id));
    const out = [];
    for (const t of teams) out.push(this.present((await this.compute(t, period)).summary));
    return out;
  }

  async panel(user: AuthenticatedUser, id: string, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    const { node } = await this.ctx.requireVisible(user, id);
    if (node.kind !== 'equipe_tecnica') throw new BadRequestException('Este centro de custo não é de equipe técnica. Ajuste o tipo no cadastro do Core.');
    const c = await this.compute(node, period);

    const members = c.members;
    const advances = await this.prisma.ccAdvance.findMany({
      where: { status: 'aberto', OR: [{ costCenterAxisId: id }, { collaboratorAxisId: { in: members.map((m) => m.collaboratorId) } }] },
      orderBy: { approvedAt: 'asc' },
    });
    let custody: { items: Array<{ collaboratorId: string; name: string | null; items: number; value: string }>; total: string; error: string | null } = { items: [], total: '0.00', error: null };
    try {
      const rows = await this.logistics.custody();
      const ids = new Set(members.map((m) => m.collaboratorId));
      const items = rows.filter((r) => ids.has(r.custodian_id)).map((r) => ({ collaboratorId: r.custodian_id, name: members.find((m) => m.collaboratorId === r.custodian_id)?.name ?? null, items: r.items, value: money(new D(r.value || 0)) }));
      custody = { items, total: money(sum(items.map((i) => new D(i.value)))), error: null };
    } catch (e) {
      custody.error = (e as Error).message;
    }
    const kmRate = c.params?.kmRate ?? null;
    return {
      ...this.present(c.summary),
      period: { from: period.from, to: period.to },
      members,
      hoursByActivity: [...c.hoursByActivity.entries()].map(([activity, hours]) => ({ activity, hours: hours.toFixed(2) })),
      idleHours: c.idle.toFixed(2),
      fieldLabor: {
        projectHours: c.fieldLabor.hours.toFixed(2),
        idleHours: c.fieldLabor.idleHours.toFixed(2),
        transferredCost: money(c.fieldLabor.transferredCost),
        pendingDays: c.fieldLabor.pendingDays,
        pendingHours: c.fieldLabor.pendingHours.toFixed(2),
        byProject: c.fieldLabor.byProject.map((p) => ({ projectId: p.projectId, code: c.projectNames.get(p.projectId)?.code ?? null, hours: p.hours.toFixed(2) })),
      },
      idleCost: money(c.costPerAvailableHour ? c.idle.mul(c.costPerAvailableHour) : ZERO),
      costPerAvailableHour: c.costPerAvailableHour ? money(c.costPerAvailableHour) : null,
      breakEvenMonthly: money(c.summary.directCost.div(period.months.length)),
      revenueByProject: c.revenueRows.map((r) => ({ projectId: r.projectId, code: c.projectNames.get(r.projectId)?.code ?? null, teamHours: r.teamHours.toFixed(2), share: r.share ? r.share.toDecimalPlaces(4).toFixed(4) : null, revenue: money(r.revenue) })),
      production: [...c.production.entries()].map(([unit, quantity]) => ({ unit, quantity: quantity.toFixed(3), costPerUnit: moneyOrNull(c.summary.directCost, quantity) })),
      fieldExpenses: await this.costCenters.fieldExpenses(id, period),
      fleet: { cost: money(c.fleetCost), km: c.km.toFixed(1), costPerKm: moneyOrNull(c.fleetCost, c.km), paramKmRate: kmRate === null ? null : money(new D(kmRate)) },
      advances: await this.costCenters.presentAdvances(advances),
      custody,
      warnings: c.warnings,
    };
  }

  /**
   * Mão de obra realizada pelas horas do Field (PT-10): horas dos técnicos da equipe em projetos × horas disponíveis
   * (ociosas = o que sobra), e o custo que a equipe transferiu aos projetos (créditos `mao_de_obra` no CC). O custo
   * direto do painel NÃO desconta o transferido: continua sendo o custo da equipe, contra o qual se mede a receita.
   */
  private async fieldLabor(costCenterAxisId: string, period: Period, availableHours: Dec) {
    const [days, credits] = await Promise.all([
      this.prisma.fieldLaborDay.findMany({ where: { originCostCenterAxisId: costCenterAxisId, date: { gte: period.start, lt: period.end } } }),
      this.prisma.ccEntry.groupBy({
        by: ['source'],
        where: { costCenterAxisId, source: 'mao_de_obra', projectAxisId: null, sourceRef: { endsWith: ':credito' }, competence: { gte: period.start, lt: period.end } },
        _sum: { amount: true },
      }),
    ]);
    const launched = days.filter((d) => d.status === 'lancado');
    const byProject = new Map<string, Dec>();
    for (const d of launched) byProject.set(d.projectAxisId, (byProject.get(d.projectAxisId) ?? ZERO).plus(d.hours));
    const hours = sum(launched.map((d) => new D(d.hours)));
    const pendingDays = days.filter((d) => d.status === 'pendente');
    return {
      hours,
      idleHours: D.max(ZERO, availableHours.minus(hours)),
      transferredCost: new D(credits[0]?._sum.amount ?? 0).negated(),
      pendingDays: pendingDays.length,
      pendingHours: sum(pendingDays.map((d) => new D(d.hours))),
      byProject: [...byProject.entries()].map(([projectId, h]) => ({ projectId, hours: h })),
    };
  }

  private present(s: Awaited<ReturnType<TeamsService['compute']>>['summary']) {
    return {
      id: s.node.id,
      code: s.node.code,
      shortCode: s.node.shortCode,
      name: s.node.name,
      headcount: s.headcount,
      availableHours: s.availableHours.toFixed(2),
      projectHours: s.projectHours.toFixed(2),
      utilization: ratio(s.projectHours, s.availableHours),
      directCost: money(s.directCost),
      attributedRevenue: money(s.attributedRevenue),
      margin: money(s.attributedRevenue.minus(s.directCost)),
      marginPct: s.attributedRevenue.gt(0) ? ratio(s.attributedRevenue.minus(s.directCost), s.attributedRevenue) : null,
      costPerProjectHour: moneyOrNull(s.directCost, s.projectHours),
      quotedCostPerHour: s.quotedCostPerHour ? money(s.quotedCostPerHour) : null,
    };
  }

  private async compute(node: CcNode, period: Period) {
    const warnings: string[] = [];
    const today = parseDate(todaySaoPaulo());
    const days = workingDays(period, undefined, await this.ctx.holidays(period));
    const [allocations, params, roleMap, logs, costs] = await Promise.all([
      this.ctx.allocations([node.id], period),
      this.ctx.paramsAt(new Date(Math.min(period.end.getTime() - 1, today.getTime()))),
      this.ctx.roleMap(),
      this.prisma.ccTeamLog.findMany({ where: { costCenterAxisId: node.id, date: { gte: period.start, lt: period.end } } }),
      this.prisma.ccEntry.groupBy({ by: ['category'], where: { costCenterAxisId: node.id, kind: 'custo', stage: 'realizado', source: { not: 'mao_de_obra' }, competence: { gte: period.start, lt: period.end } }, _sum: { amount: true } }),
    ]);

    let hoursPerDay = this.ctx.hoursPerDay(params);
    if (!hoursPerDay) {
      hoursPerDay = DEFAULT_HOURS_PER_DAY;
      warnings.push('Parâmetros sem horas por dia: usando 8 h para as horas disponíveis.');
    }
    const pd = personDays(allocations, days);
    const totalPersonDays = sum([...pd.values()].map((n) => new D(n)));
    const availableHours = totalPersonDays.mul(hoursPerDay);

    const hoursByActivity = new Map<string, Dec>();
    const teamProjectHours = new Map<string, Dec>();
    const production = new Map<string, Dec>();
    let km = ZERO;
    for (const l of logs) {
      const h = new D(l.hoursPerPerson).mul(l.people);
      hoursByActivity.set(l.activity, (hoursByActivity.get(l.activity) ?? ZERO).plus(h));
      if (l.activity === 'projeto' && l.projectAxisId) teamProjectHours.set(l.projectAxisId, (teamProjectHours.get(l.projectAxisId) ?? ZERO).plus(h));
      if (l.km) km = km.plus(l.km);
      if (l.producedQuantity && l.producedUnit) production.set(l.producedUnit, (production.get(l.producedUnit) ?? ZERO).plus(l.producedQuantity));
    }
    if (logs.length === 0) warnings.push('Nenhum diário lançado no período: utilização e receita atribuída ficam zeradas.');
    const projectHours = hoursByActivity.get('projeto') ?? ZERO;

    // Receita atribuída: receita dos projetos no período × participação da equipe nas horas do projeto.
    const projectIds = [...teamProjectHours.keys()];
    const [allLogs, revenueRows] = projectIds.length
      ? await Promise.all([
          this.prisma.ccTeamLog.findMany({ where: { activity: 'projeto', projectAxisId: { in: projectIds }, date: { gte: period.start, lt: period.end } }, select: { projectAxisId: true, people: true, hoursPerPerson: true } }),
          this.prisma.ccEntry.groupBy({ by: ['projectAxisId'], where: { kind: 'receita', stage: 'realizado', projectAxisId: { in: projectIds }, competence: { gte: period.start, lt: period.end } }, _sum: { amount: true } }),
        ])
      : [[], []];
    const allHours = new Map<string, Dec>();
    for (const l of allLogs) allHours.set(l.projectAxisId!, (allHours.get(l.projectAxisId!) ?? ZERO).plus(new D(l.hoursPerPerson).mul(l.people)));
    const projectRevenue = new Map(revenueRows.map((r) => [r.projectAxisId!, new D(r._sum.amount ?? 0)]));
    const attributed = attributeRevenue(teamProjectHours, allHours, projectRevenue);

    const byCategory = new Map(costs.map((c) => [c.category, new D(c._sum.amount ?? 0)]));
    const directCost = sum(byCategory.values());

    // Membros (alocados hoje ou no fim do período) e custo hora cotado ponderado por pessoas-dia.
    const refDay = period.end <= today ? new Date(period.end.getTime() - 86_400_000) : today;
    const current = allocations.filter((a) => isAllocatedOn(a, refDay));
    const collaborators = await this.ctx.names('COLLABORATOR', allocations.map((a) => a.collaboratorId));
    const roleOf = (collaboratorId: string) => {
      const jt = collaborators.get(collaboratorId)?.data['job_title_id'];
      return typeof jt === 'string' ? (roleMap.get(jt) ?? null) : null;
    };
    let weighted = ZERO;
    let weight = ZERO;
    const missingRole = new Set<string>();
    for (const [collaboratorId, n] of pd) {
      const roleKey = roleOf(collaboratorId);
      const role = params?.roles.find((r) => r.roleKey === roleKey);
      const hc = role && params ? hourlyCost(params, role) : null;
      if (!hc?.ok) {
        missingRole.add(collaboratorId);
        continue;
      }
      weighted = weighted.plus(new D(hc.value.costPerHour).mul(n));
      weight = weight.plus(n);
    }
    if (missingRole.size > 0) warnings.push(`${missingRole.size} colaborador(es) sem função mapeada ou sem custo nos parâmetros: fora do custo hora cotado.`);
    const members = current.map((a) => {
      const c = collaborators.get(a.collaboratorId);
      return {
        collaboratorId: a.collaboratorId,
        name: c?.name ?? null,
        jobTitleName: typeof c?.data['job_title_name'] === 'string' ? (c.data['job_title_name'] as string) : null,
        roleKey: roleOf(a.collaboratorId),
        since: isoDate(a.validFrom),
      };
    });

    const idle = idleHours(availableHours, hoursByActivity);
    const fieldLabor = await this.fieldLabor(node.id, period, availableHours);
    const projectNames = await this.ctx.names('PROJECT', [...projectIds, ...fieldLabor.byProject.map((p) => p.projectId)]);
    return {
      params,
      fieldLabor,
      members,
      hoursByActivity,
      idle,
      costPerAvailableHour: availableHours.gt(0) ? directCost.div(availableHours) : null,
      revenueRows: attributed.rows,
      projectNames,
      production,
      km,
      fleetCost: byCategory.get('frota') ?? ZERO,
      warnings,
      summary: {
        node,
        headcount: members.length,
        availableHours,
        projectHours,
        directCost,
        attributedRevenue: attributed.total,
        quotedCostPerHour: weight.gt(0) ? weighted.div(weight) : null,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Diário da equipe
  // -------------------------------------------------------------------------

  async logs(user: AuthenticatedUser, id: string, from?: string, to?: string) {
    const period = parsePeriod(from, to);
    await this.ctx.requireVisible(user, id);
    const rows = await this.prisma.ccTeamLog.findMany({ where: { costCenterAxisId: id, date: { gte: period.start, lt: period.end } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 2000 });
    const [projects, users] = await Promise.all([this.ctx.names('PROJECT', rows.map((r) => r.projectAxisId ?? '')), this.ctx.userLabels(rows.map((r) => r.createdBy))]);
    return rows.map((r) => ({ ...this.presentLog(r, projects.get(r.projectAxisId ?? '')?.code ?? null), createdByName: users.get(r.createdBy) ?? null }));
  }

  private presentLog(r: Awaited<ReturnType<PrismaService['ccTeamLog']['create']>>, projectCode: string | null) {
    return {
      id: r.id,
      date: isoDate(r.date),
      activity: r.activity,
      projectId: r.projectAxisId,
      projectCode,
      people: r.people,
      hoursPerPerson: new D(r.hoursPerPerson).toFixed(2),
      km: r.km === null ? null : new D(r.km).toFixed(1),
      producedQuantity: r.producedQuantity === null ? null : new D(r.producedQuantity).toFixed(3),
      producedUnit: r.producedUnit,
      notes: r.notes,
      createdBy: r.createdBy,
    };
  }

  async createLog(user: AuthenticatedUser, id: string, dto: TeamLogDto) {
    const { node } = await this.ctx.requireVisible(user, id);
    if (node.kind !== 'equipe_tecnica') throw new BadRequestException('O diário só existe para centros de custo de equipe técnica.');
    const date = parseDate(dto.date);
    if (date > parseDate(todaySaoPaulo())) throw new BadRequestException('A data do diário não pode ser futura.');
    if (dto.activity === 'projeto' && !dto.projectId) throw new BadRequestException('Informe o projeto da atividade.');
    const hours = new D(dto.hoursPerPerson);
    if (hours.lte(0) || hours.gt(24)) throw new BadRequestException('Horas por pessoa: entre 0 e 24.');
    if ((dto.producedQuantity && !dto.producedUnit?.trim()) || (!dto.producedQuantity && dto.producedUnit?.trim())) throw new BadRequestException('Produção: informe a quantidade e a unidade juntas.');
    let projectCode: string | null = null;
    if (dto.projectId) {
      const p = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: dto.projectId } } });
      if (!p) throw new BadRequestException('Projeto não encontrado no Financeiro. Atualize os projetos do Core.');
      projectCode = p.code;
    }
    const row = await this.prisma.ccTeamLog.create({
      data: {
        costCenterAxisId: id,
        date,
        activity: dto.activity,
        projectAxisId: dto.projectId ?? null,
        people: dto.people,
        hoursPerPerson: hours,
        km: dto.km ? new D(dto.km) : null,
        producedQuantity: dto.producedQuantity ? new D(dto.producedQuantity) : null,
        producedUnit: dto.producedUnit?.trim() || null,
        notes: dto.notes?.trim() || null,
        createdBy: user.userId,
      },
    });
    return this.presentLog(row, projectCode);
  }

  async deleteLog(user: AuthenticatedUser, logId: string) {
    const row = await this.prisma.ccTeamLog.findUnique({ where: { id: logId } });
    if (!row) throw new NotFoundException('Lançamento do diário não encontrado.');
    await this.ctx.requireVisible(user, row.costCenterAxisId);
    await this.prisma.ccTeamLog.delete({ where: { id: logId } });
  }
}
