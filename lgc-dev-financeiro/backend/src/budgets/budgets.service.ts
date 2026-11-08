import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BudgetRevision, type ParameterSet, type ParameterSetRole, type ProjectBudget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { computeBudget, type BudgetInputs, type BudgetResult, type EngineParams } from './budget-engine.js';
import type { BudgetInputsDto, CreateBudgetDto, UpdateBudgetDto, UpdateRevisionDto } from './budget-inputs.dto.js';

export const COST_PERMISSION = 'budget:read_cost';
const canSeeCost = (u: AuthenticatedUser) => u.permissions.includes(COST_PERMISSION);

type SetWithRoles = ParameterSet & { roles: ParameterSetRole[] };
type RevisionFull = BudgetRevision & { budget: ProjectBudget; parameterSet: SetWithRoles };

export const REVISION_STATUS_LABEL: Record<string, string> = {
  rascunho: 'Rascunho',
  em_aprovacao: 'Em aprovação',
  enviada: 'Enviada',
  ganha: 'Ganha',
  perdida: 'Perdida',
  substituida: 'Substituída',
  descartada: 'Descartada',
};

export function engineParams(set: SetWithRoles): EngineParams {
  return {
    ...set,
    roles: [...set.roles].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ ...r, roleKey: r.roleKey, label: r.label, fieldRole: r.fieldRole })),
  } as unknown as EngineParams;
}

/** Entradas iniciais: equipe com as funções do conjunto, sem pessoas. */
export function emptyInputs(set: SetWithRoles): BudgetInputs {
  return {
    workDays: 0,
    team: [...set.roles].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => (r.fieldRole ? { roleKey: r.roleKey, people: 0 } : { roleKey: r.roleKey, hours: '0' })),
    materials: [],
    travel: { cars: 0 },
    platform: { days: 0, dailyBilled: set.platformDailyBilled?.toString() ?? null },
  };
}

/** Sem `budget:read_cost`, o resultado mostra só o que é cobrado do cliente. */
export function presentResult(result: BudgetResult | null, cost: boolean) {
  if (!result || cost) return result;
  return {
    workDays: result.workDays,
    fieldHours: result.fieldHours,
    vehicleDays: result.vehicleDays,
    kmTotal: result.kmTotal,
    labor: result.labor.map(({ costPerHour: _c, cost: _k, ...l }) => l),
    materials: result.materials.map(({ realUnitCost: _r, cost: _c, estimatedCost: _e, ...m }) => m),
    revenue: result.revenue,
    warnings: result.warnings.filter((w) => !/custo/i.test(w)),
  };
}

function presentInputs(inputs: BudgetInputs, cost: boolean): BudgetInputs {
  if (cost) return inputs;
  return { ...inputs, materials: inputs.materials.map(({ realUnitCost: _r, ...m }) => m) };
}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
/** Data de negócio `AAAA-MM-DD` (coluna DATE chega à meia-noite UTC). */
const dateOnly = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : null);
const parseDateOnly = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : v === null ? null : undefined);
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type CacheRow = { axisId: string; code: string | null; name: string | null; active: boolean; data: unknown };
type ClientRow = { code: string | null; name: string | null } | null | undefined;

/** Projeto do Core como o Financeiro o mostra (cache alimentado pelo webhook e por POST /projects/sync). */
export function projectInfo(p: CacheRow, client: ClientRow) {
  const data = (p.data ?? {}) as Record<string, unknown>;
  const ccCode = str(data.cost_center_code);
  const ccName = str(data.cost_center_name);
  const start = str(data.planned_start_date);
  const end = str(data.planned_end_date);
  return {
    axisProjectId: p.axisId,
    code: p.code ?? p.axisId,
    name: p.name || str(data.name) || null,
    status: str(data.status),
    active: p.active,
    client: client ? { code: client.code, name: client.name } : null,
    costCenter: ccCode || ccName ? { code: ccCode, name: ccName } : null,
    plannedStartDate: start && DATE_ONLY.test(start) ? start : null,
    plannedEndDate: end && DATE_ONLY.test(end) ? end : null,
  };
}
export type ProjectInfo = ReturnType<typeof projectInfo>;

type DateSource = 'orcamento' | 'core' | null;

/**
 * Cabeçalho do orçamento (P-07): título e datas próprios são opcionais.
 * Sem título, vale o nome do projeto no Core (ou "código — cliente" se o projeto ainda não tem nome).
 * Sem data própria, vale a data prevista do projeto no Core; a data do orçamento, quando preenchida, sobrescreve.
 */
export function budgetHeader(b: Pick<ProjectBudget, 'title' | 'projectCode' | 'plannedStartDate' | 'plannedEndDate'>, project: ProjectInfo | null) {
  const ownStart = dateOnly(b.plannedStartDate);
  const ownEnd = dateOnly(b.plannedEndDate);
  const pick = (own: string | null, core: string | null | undefined): { value: string | null; source: DateSource } =>
    own ? { value: own, source: 'orcamento' } : core ? { value: core, source: 'core' } : { value: null, source: null };
  return {
    title: b.title,
    displayTitle: b.title || project?.name || [project?.code ?? b.projectCode, project?.client?.name].filter(Boolean).join(' — '),
    plannedStartDate: ownStart,
    plannedEndDate: ownEnd,
    schedule: { start: pick(ownStart, project?.plannedStartDate), end: pick(ownEnd, project?.plannedEndDate) },
  };
}

const toDecimal = (v: string | null | undefined) => (v === null || v === undefined ? null : new Prisma.Decimal(v));

@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Projetos (cache do Core) com o resumo do orçamento
  // -------------------------------------------------------------------------

  async listProjects(user: AuthenticatedUser) {
    const [projects, clients, budgets] = await Promise.all([
      this.prisma.axisMasterCache.findMany({ where: { kind: 'PROJECT' }, orderBy: { code: 'desc' } }),
      this.prisma.axisMasterCache.findMany({ where: { kind: 'CLIENT' }, select: { axisId: true, name: true, code: true } }),
      this.prisma.projectBudget.findMany({ include: { revisions: { where: { status: { not: 'descartada' } }, orderBy: { number: 'desc' }, take: 1 } } }),
    ]);
    const clientById = new Map(clients.map((c) => [c.axisId, c]));
    const budgetByProject = new Map(budgets.map((b) => [b.axisProjectId, b]));
    const cost = canSeeCost(user);
    const lastSync = await this.prisma.axisMasterCache.aggregate({ where: { kind: 'PROJECT' }, _max: { syncedAt: true } });
    return {
      lastSyncedAt: lastSync._max.syncedAt,
      projects: projects.map((p) => {
        const data = p.data as Record<string, unknown>;
        const project = projectInfo(p, clientById.get(str(data.client_id) ?? ''));
        const budget = budgetByProject.get(p.axisId);
        const rev = budget?.revisions[0];
        return {
          ...project,
          budget: budget
            ? {
                id: budget.id,
                ...budgetHeader(budget, project),
                revision: rev
                  ? { id: rev.id, number: rev.number, status: rev.status, revenue: rev.revenue, ...(cost ? { profit: rev.profit, profitOnCost: rev.profitOnCost } : {}) }
                  : null,
              }
            : null,
        };
      }),
    };
  }

  private async project(axisProjectId: string) {
    const p = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: axisProjectId } } });
    if (!p) throw new NotFoundException('Projeto não encontrado no cache do Core. Atualize a lista de projetos.');
    const clientId = str((p.data as Record<string, unknown>).client_id);
    const client = clientId ? await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'CLIENT', axisId: clientId } } }) : null;
    return projectInfo(p, client);
  }

  async getProject(axisProjectId: string, user: AuthenticatedUser) {
    const project = await this.project(axisProjectId);
    const budgets = await this.prisma.projectBudget.findMany({
      where: { axisProjectId },
      include: { revisions: { orderBy: { number: 'desc' }, include: { parameterSet: { select: { code: true } } } } },
    });
    const cost = canSeeCost(user);
    return {
      ...project,
      budgets: budgets.map((b) => ({
        id: b.id,
        ...budgetHeader(b, project),
        model: b.model,
        createdAt: b.createdAt,
        revisions: b.revisions.map((r) => ({
          id: r.id,
          number: r.number,
          status: r.status,
          parameterSetCode: r.parameterSet.code,
          revenue: r.revenue,
          ...(cost ? { profit: r.profit, profitOnCost: r.profitOnCost } : {}),
          updatedAt: r.updatedAt,
          createdBy: r.createdBy,
        })),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Orçamento e revisões
  // -------------------------------------------------------------------------

  private async currentParameterSet(tx: Prisma.TransactionClient = this.prisma): Promise<SetWithRoles> {
    const set = await tx.parameterSet.findFirst({ where: { status: 'vigente' }, include: { roles: true } });
    if (!set) throw new ConflictException('Não há parâmetros de orçamento vigentes. Publique um conjunto em Parâmetros antes de orçar.');
    return set;
  }

  private persistFields(result: BudgetResult) {
    return {
      result: result as unknown as Prisma.InputJsonValue,
      revenue: toDecimal(result.revenue.total),
      taxes: toDecimal(result.taxes.amount),
      directCost: toDecimal(result.directCosts.total),
      indirectCost: toDecimal(result.indirect.total),
      profit: toDecimal(result.result.profit),
      profitOnCost: toDecimal(result.result.profitOnCost),
      computedAt: new Date(),
    };
  }

  async createBudget(dto: CreateBudgetDto, user: AuthenticatedUser) {
    const project = await this.project(dto.axisProjectId);
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.projectBudget.findUnique({ where: { axisProjectId_model: { axisProjectId: project.axisProjectId, model: 'generico' } }, select: { id: true } });
      if (exists) throw new ConflictException('Este projeto já tem orçamento. Abra-o e crie uma nova revisão.');
      const set = await this.currentParameterSet(tx);
      const inputs = emptyInputs(set);
      const result = computeBudget(engineParams(set), inputs);
      // Sem título informado, o cabeçalho mostra o nome do projeto no Core (e acompanha a edição lá).
      const title = dto.title?.trim() || null;
      const budget = await tx.projectBudget.create({ data: { axisProjectId: project.axisProjectId, projectCode: project.code, model: 'generico', title, createdBy: user.userId } });
      const rev = await tx.budgetRevision.create({
        data: { budgetId: budget.id, number: 1, parameterSetId: set.id, inputs: inputs as unknown as Prisma.InputJsonValue, ...this.persistFields(result), createdBy: user.userId, updatedBy: user.userId },
      });
      await this.audit.record(user.userId, 'budget.created', 'project_budget', budget.id, { project: project.code, revision: 1, parameterSet: set.code }, tx);
      return { budgetId: budget.id, revisionId: rev.id };
    });
  }

  /**
   * Cabeçalho do orçamento: título e início/conclusão previstos. `null` volta a usar o valor do projeto no Core.
   * Vale para todas as revisões e pode mudar em qualquer situação da revisão (não entra no cálculo).
   */
  async updateBudget(id: string, dto: UpdateBudgetDto, user: AuthenticatedUser) {
    const budget = await this.prisma.projectBudget.findUnique({ where: { id } });
    if (!budget) throw new NotFoundException('Orçamento não encontrado.');
    const project = await this.project(budget.axisProjectId).catch(() => null);
    const changes: { title?: string | null; plannedStartDate?: Date | null; plannedEndDate?: Date | null } = {};
    if (dto.title !== undefined) changes.title = dto.title?.trim() || null;
    const start = parseDateOnly(dto.plannedStartDate);
    const end = parseDateOnly(dto.plannedEndDate);
    if (start && dateOnly(start) !== dto.plannedStartDate) throw new BadRequestException('Início previsto: data inexistente.');
    if (end && dateOnly(end) !== dto.plannedEndDate) throw new BadRequestException('Conclusão prevista: data inexistente.');
    if (start !== undefined) changes.plannedStartDate = start;
    if (end !== undefined) changes.plannedEndDate = end;
    const next = budgetHeader({ ...budget, ...changes }, project);
    const { start: s, end: e } = next.schedule;
    if (s.value && e.value && e.value < s.value) {
      const origin = (src: DateSource) => (src === 'core' ? 'do projeto no Axis Core' : 'do orçamento');
      throw new BadRequestException(`A conclusão prevista (${origin(e.source)}) não pode ser antes do início (${origin(s.source)}).`);
    }
    if (Object.keys(changes).length === 0) return next;
    await this.prisma.$transaction(async (tx) => {
      await tx.projectBudget.update({ where: { id }, data: changes });
      await this.audit.record(
        user.userId,
        'budget.updated',
        'project_budget',
        id,
        { project: budget.projectCode, title: next.title, plannedStartDate: next.plannedStartDate, plannedEndDate: next.plannedEndDate, changed: Object.keys(changes) },
        tx,
      );
    });
    return next;
  }

  private async loadRevision(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<RevisionFull> {
    const rev = await tx.budgetRevision.findUnique({ where: { id }, include: { budget: true, parameterSet: { include: { roles: true } } } });
    if (!rev) throw new NotFoundException('Revisão de orçamento não encontrada.');
    return rev;
  }

  async getRevision(id: string, user: AuthenticatedUser) {
    const rev = await this.loadRevision(id);
    const cost = canSeeCost(user);
    const [project, siblings, current] = await Promise.all([
      this.project(rev.budget.axisProjectId).catch(() => null),
      this.prisma.budgetRevision.findMany({ where: { budgetId: rev.budgetId }, orderBy: { number: 'desc' }, select: { id: true, number: true, status: true } }),
      this.prisma.parameterSet.findFirst({ where: { status: 'vigente' }, select: { id: true, code: true } }),
    ]);
    const set = rev.parameterSet;
    return {
      id: rev.id,
      number: rev.number,
      code: `${rev.budget.projectCode} R${rev.number}`,
      status: rev.status,
      notes: rev.notes,
      budget: { id: rev.budget.id, ...budgetHeader(rev.budget, project), model: rev.budget.model, axisProjectId: rev.budget.axisProjectId, projectCode: rev.budget.projectCode },
      project,
      parameterSet: { id: set.id, code: set.code, status: set.status, hoursPerDay: set.hoursPerDay, kmRate: set.kmRate, materialMarkup: set.materialMarkup, platformDailyBilled: set.platformDailyBilled },
      currentParameterSet: current,
      roles: [...set.roles].sort((a, b) => a.sortOrder - b.sortOrder).map((r) => ({ roleKey: r.roleKey, label: r.label, fieldRole: r.fieldRole, billingRate: r.billingRate })),
      inputs: presentInputs(rev.inputs as unknown as BudgetInputs, cost),
      result: presentResult(rev.result as unknown as BudgetResult | null, cost),
      costVisible: cost,
      revisions: siblings,
      updatedAt: rev.updatedAt,
      updatedBy: rev.updatedBy,
    };
  }

  /**
   * Completa o que o usuário não vê: sem `read_cost`, o custo real do material vem da linha anterior com o
   * mesmo item do catálogo ou, se o item é novo na revisão, do catálogo. Material avulso fica sem custo (estimado).
   */
  private async mergeHiddenCosts(inputs: BudgetInputsDto, previous: BudgetInputs | null, user: AuthenticatedUser, tx: Prisma.TransactionClient): Promise<BudgetInputs> {
    const clean = JSON.parse(JSON.stringify(inputs)) as BudgetInputs;
    if (canSeeCost(user)) return clean;
    const before = new Map((previous?.materials ?? []).filter((m) => m.materialId).map((m) => [m.materialId!, m.realUnitCost ?? null]));
    const missing = clean.materials.filter((m) => m.materialId && !before.has(m.materialId)).map((m) => m.materialId!);
    const catalog = missing.length ? await tx.budgetMaterial.findMany({ where: { id: { in: missing } }, select: { id: true, realCost: true } }) : [];
    const fromCatalog = new Map(catalog.map((c) => [c.id, c.realCost?.toString() ?? null]));
    clean.materials = clean.materials.map((m) => ({ ...m, realUnitCost: m.materialId ? (before.get(m.materialId) ?? fromCatalog.get(m.materialId) ?? null) : null }));
    return clean;
  }

  private validateTeam(inputs: BudgetInputs, set: SetWithRoles) {
    const keys = new Set(set.roles.map((r) => r.roleKey));
    const unknown = inputs.team.filter((t) => !keys.has(t.roleKey)).map((t) => t.roleKey);
    if (unknown.length) throw new BadRequestException(`Funções que não existem no conjunto ${set.code}: ${unknown.join(', ')}.`);
    if (new Set(inputs.team.map((t) => t.roleKey)).size !== inputs.team.length) throw new BadRequestException('Função repetida na equipe.');
  }

  async simulate(id: string, inputs: BudgetInputsDto, user: AuthenticatedUser) {
    const rev = await this.loadRevision(id);
    const merged = await this.mergeHiddenCosts(inputs, rev.inputs as unknown as BudgetInputs, user, this.prisma);
    this.validateTeam(merged, rev.parameterSet);
    return presentResult(computeBudget(engineParams(rev.parameterSet), merged), canSeeCost(user));
  }

  async updateRevision(id: string, dto: UpdateRevisionDto, user: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const rev = await this.loadRevision(id, tx);
      if (rev.status !== 'rascunho') throw new ConflictException(`A revisão R${rev.number} não está em rascunho e não pode ser alterada. Crie uma nova revisão.`);
      const data: Prisma.BudgetRevisionUpdateInput = { updatedBy: user.userId };
      if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;
      if (dto.inputs) {
        const merged = await this.mergeHiddenCosts(dto.inputs, rev.inputs as unknown as BudgetInputs, user, tx);
        this.validateTeam(merged, rev.parameterSet);
        Object.assign(data, { inputs: merged as unknown as Prisma.InputJsonValue, ...this.persistFields(computeBudget(engineParams(rev.parameterSet), merged)) });
      }
      await tx.budgetRevision.update({ where: { id }, data });
      await this.audit.record(user.userId, 'budget_revision.updated', 'budget_revision', id, { revision: rev.number, changed: Object.keys(data).filter((k) => k !== 'updatedBy') }, tx);
    });
    return this.getRevision(id, user);
  }

  /** Nova revisão a partir da última não descartada, com os parâmetros vigentes. */
  async newRevision(budgetId: string, user: AuthenticatedUser) {
    const id = await this.prisma.$transaction(async (tx) => {
      const budget = await tx.projectBudget.findUnique({ where: { id: budgetId }, include: { revisions: { orderBy: { number: 'desc' } } } });
      if (!budget) throw new NotFoundException('Orçamento não encontrado.');
      const draft = budget.revisions.find((r) => r.status === 'rascunho');
      if (draft) throw new ConflictException(`A revisão R${draft.number} ainda está em rascunho. Continue nela ou descarte-a.`);
      const base = budget.revisions.find((r) => r.status !== 'descartada') ?? budget.revisions[0];
      const set = await this.currentParameterSet(tx);
      const inputs = base ? (base.inputs as unknown as BudgetInputs) : emptyInputs(set);
      const keys = new Set(set.roles.map((r) => r.roleKey));
      inputs.team = inputs.team.filter((t) => keys.has(t.roleKey));
      const number = (budget.revisions[0]?.number ?? 0) + 1;
      const rev = await tx.budgetRevision.create({
        data: { budgetId, number, parameterSetId: set.id, inputs: inputs as unknown as Prisma.InputJsonValue, ...this.persistFields(computeBudget(engineParams(set), inputs)), createdBy: user.userId, updatedBy: user.userId },
      });
      await this.audit.record(user.userId, 'budget_revision.created', 'budget_revision', rev.id, { budget: budget.title ?? budget.projectCode, revision: number, basedOn: base?.number ?? null, parameterSet: set.code }, tx);
      return rev.id;
    });
    return { revisionId: id };
  }

  /** Troca o conjunto de parâmetros do rascunho pelo vigente e recalcula. */
  async useCurrentParameters(id: string, user: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const rev = await this.loadRevision(id, tx);
      if (rev.status !== 'rascunho') throw new ConflictException('Só o rascunho pode trocar de parâmetros.');
      const set = await this.currentParameterSet(tx);
      if (set.id === rev.parameterSetId) return;
      const inputs = rev.inputs as unknown as BudgetInputs;
      const keys = new Set(set.roles.map((r) => r.roleKey));
      inputs.team = inputs.team.filter((t) => keys.has(t.roleKey));
      await tx.budgetRevision.update({
        where: { id },
        data: { parameterSetId: set.id, inputs: inputs as unknown as Prisma.InputJsonValue, ...this.persistFields(computeBudget(engineParams(set), inputs)), updatedBy: user.userId },
      });
      await this.audit.record(user.userId, 'budget_revision.parameters_changed', 'budget_revision', id, { from: rev.parameterSet.code, to: set.code }, tx);
    });
    return this.getRevision(id, user);
  }

  async discard(id: string, user: AuthenticatedUser) {
    await this.prisma.$transaction(async (tx) => {
      const rev = await this.loadRevision(id, tx);
      if (rev.status !== 'rascunho') throw new ConflictException('Só uma revisão em rascunho pode ser descartada.');
      await tx.budgetRevision.update({ where: { id }, data: { status: 'descartada', updatedBy: user.userId } });
      await this.audit.record(user.userId, 'budget_revision.discarded', 'budget_revision', id, { revision: rev.number }, tx);
    });
    return this.getRevision(id, user);
  }
}
