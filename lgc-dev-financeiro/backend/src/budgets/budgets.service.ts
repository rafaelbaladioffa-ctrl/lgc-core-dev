import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BudgetModel, type BudgetRevision, type ParameterSet, type ParameterSetRole, type ProjectBudget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { computeBudget, type BudgetInputs, type BudgetResult, type EngineParams } from './budget-engine.js';
import type { BudgetInputsDto, CreateBudgetDto, UpdateBudgetDto, UpdateRevisionDto } from './budget-inputs.dto.js';
import { allowedActions, coreDivergence, EVENT_LABEL, submitBlockers, WORKFLOW, type WorkflowAction } from './revision-workflow.js';
import { presentSow } from './sow/sow-view.js';
import { summarizeTypes, type SowCableLine, type SowHeader } from './sow/sow-parser.js';
import { computeAwsQuote, type KpiKey } from './bid/aws-quote.js';
import type { BidTargets } from './bid/bid-template-reader.js';
import { parseDate, todaySaoPaulo } from '../cost-centers/cc-engine.js';
import { raiseBudgetAlert } from './budget-alerts.js';
import { cachedCostCenter } from './revision-won.js';
import { commitmentAlert, postWonCommitments } from './won-commitments.js';
import { holidaySet } from '../integration/master-cache.js';

export const COST_PERMISSION = 'budget:read_cost';
const canSeeCost = (u: AuthenticatedUser) => u.permissions.includes(COST_PERMISSION);

type SetWithRoles = ParameterSet & { roles: ParameterSetRole[] };
/** Bid Template da revisão sem o conteúdo do arquivo (que só é lido para preencher a Bid, na PJ7). */
const BID_TEMPLATE_META = { documentId: true, version: true, filename: true, contentHash: true, targets: true, importedAt: true, importedBy: true, quoteRequestId: true } as const;
type BidTemplateMeta = Prisma.RevisionBidTemplateGetPayload<{ select: typeof BID_TEMPLATE_META }>;
type RevisionFull = BudgetRevision & { budget: ProjectBudget; parameterSet: SetWithRoles; sow?: Parameters<typeof presentSow>[0]; bidTemplate?: BidTemplateMeta | null };

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
    /** Site do projeto no Core (`site_id` do evento project.*): o deslocamento da revisão sugere o destino ligado a ele. */
    site: str(data.site_id) ? { axisId: str(data.site_id)!, code: str(data.site_code), name: str(data.site_name) } : null,
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
    const [projects, clients, budgets, requests, openAlerts] = await Promise.all([
      this.prisma.axisMasterCache.findMany({ where: { kind: 'PROJECT' }, orderBy: { code: 'desc' } }),
      this.prisma.axisMasterCache.findMany({ where: { kind: 'CLIENT' }, select: { axisId: true, name: true, code: true } }),
      this.prisma.projectBudget.findMany({
        include: { revisions: { where: { status: { not: 'descartada' } }, orderBy: { number: 'desc' }, select: { id: true, number: true, status: true, revenue: true, profit: true, profitOnCost: true } } },
      }),
      this.prisma.quoteRequest.findMany({ orderBy: { requestedAt: 'desc' }, select: { id: true, axisProjectId: true, requestedAt: true, budgetId: true } }),
      this.prisma.budgetAlert.findMany({ where: { resolvedAt: null }, select: { message: true, budget: { select: { axisProjectId: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const alertsByProject = new Map<string, string[]>();
    for (const a of openAlerts) alertsByProject.set(a.budget.axisProjectId, [...(alertsByProject.get(a.budget.axisProjectId) ?? []), a.message]);
    const clientById = new Map(clients.map((c) => [c.axisId, c]));
    // Projeto com cotação AWS e orçamento genérico mostra a cotação AWS (é a que segue para o Core).
    const budgetByProject = new Map<string, (typeof budgets)[number]>();
    for (const b of budgets) if (!budgetByProject.has(b.axisProjectId) || b.model === 'aws_sow') budgetByProject.set(b.axisProjectId, b);
    const requestByProject = new Map<string, (typeof requests)[number]>();
    for (const r of requests) if (!requestByProject.has(r.axisProjectId)) requestByProject.set(r.axisProjectId, r);
    const cost = canSeeCost(user);
    const lastSync = await this.prisma.axisMasterCache.aggregate({ where: { kind: 'PROJECT' }, _max: { syncedAt: true } });
    return {
      lastSyncedAt: lastSync._max.syncedAt,
      projects: projects.map((p) => {
        const data = p.data as Record<string, unknown>;
        const project = projectInfo(p, clientById.get(str(data.client_id) ?? ''));
        const budget = budgetByProject.get(p.axisId);
        const rev = budget?.revisions[0];
        const request = requestByProject.get(p.axisId);
        return {
          ...project,
          warnings: [...coreDivergence(project.status, budget?.revisions.map((r) => r.status) ?? []), ...(alertsByProject.get(p.axisId) ?? [])],
          quoteRequest: request ? { id: request.id, requestedAt: request.requestedAt, started: !!request.budgetId } : null,
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
    const [found, requests, alerts] = await Promise.all([
      this.prisma.projectBudget.findMany({
        where: { axisProjectId },
        include: { revisions: { orderBy: { number: 'desc' }, include: { parameterSet: { select: { code: true } } } } },
      }),
      this.prisma.quoteRequest.findMany({ where: { axisProjectId }, orderBy: { requestedAt: 'desc' } }),
      this.prisma.budgetAlert.findMany({ where: { resolvedAt: null, budget: { axisProjectId } }, orderBy: { createdAt: 'asc' } }),
    ]);
    // A cotação AWS (pedida pelo Core) vem antes do orçamento genérico.
    const budgets = [...found].sort((a, b) => Number(b.model === 'aws_sow') - Number(a.model === 'aws_sow') || a.createdAt.getTime() - b.createdAt.getTime());
    const cost = canSeeCost(user);
    return {
      ...project,
      /** Pedidos de cotação do Core para este projeto (mais novo primeiro): a cotação AWS nasce por eles. */
      quoteRequests: requests.map((r) => ({
        id: r.id,
        requestedAt: r.requestedAt,
        requestedByEmail: r.requestedByEmail,
        notes: r.notes,
        sowVersion: r.sowVersion,
        bidTemplateVersion: r.bidTemplateVersion,
        started: !!r.budgetId,
      })),
      warnings: coreDivergence(project.status, budgets.flatMap((b) => b.revisions.map((r) => r.status))),
      /** Alertas abertos nos orçamentos (ex.: o Core aprovou uma revisão enquanto outra já estava ganha); dispensáveis com `budget:approve`. */
      alerts: alerts.map((a) => ({ id: a.id, budgetId: a.budgetId, revisionId: a.revisionId, kind: a.kind, message: a.message, createdAt: a.createdAt })),
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
          approvedAt: r.approvedAt,
          approvedByEmail: r.approvedByEmail,
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

  /** `aws_sow` nasce pela fila de pedidos de cotação do Core (PJ4); a tela de projetos cria o `generico`. */
  async createBudget(dto: CreateBudgetDto, user: AuthenticatedUser, model: BudgetModel = 'generico') {
    const project = await this.project(dto.axisProjectId);
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.projectBudget.findUnique({ where: { axisProjectId_model: { axisProjectId: project.axisProjectId, model } }, select: { id: true } });
      if (exists) throw new ConflictException('Este projeto já tem orçamento. Abra-o e crie uma nova revisão.');
      const set = await this.currentParameterSet(tx);
      const inputs = emptyInputs(set);
      const result = computeBudget(engineParams(set), inputs);
      // Sem título informado, o cabeçalho mostra o nome do projeto no Core (e acompanha a edição lá).
      const title = dto.title?.trim() || null;
      const budget = await tx.projectBudget.create({ data: { axisProjectId: project.axisProjectId, projectCode: project.code, model, title, createdBy: user.userId } });
      const rev = await tx.budgetRevision.create({
        data: { budgetId: budget.id, number: 1, parameterSetId: set.id, inputs: inputs as unknown as Prisma.InputJsonValue, ...this.persistFields(result), createdBy: user.userId, updatedBy: user.userId },
      });
      await this.audit.record(user.userId, 'budget.created', 'project_budget', budget.id, { project: project.code, model, revision: 1, parameterSet: set.code }, tx);
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

  /** Revisão com orçamento, parâmetros, SOW e Bid Template (sem o arquivo); para o serviço da Bid. */
  loadRevisionFull(id: string) {
    return this.loadRevision(id);
  }

  /** Feriados ativos do Core (cache `HOLIDAY`); `null` enquanto o Core não enviou o calendário. */
  holidays(tx: Prisma.TransactionClient = this.prisma) {
    return holidaySet(tx);
  }

  /** Projeto do cache do Core, ou nulo se ainda não sincronizado. */
  projectInfoOrNull(axisProjectId: string) {
    return this.project(axisProjectId).catch(() => null);
  }

  header(budget: Pick<ProjectBudget, 'title' | 'projectCode' | 'plannedStartDate' | 'plannedEndDate'>, project: ProjectInfo | null) {
    return budgetHeader(budget, project);
  }

  private async loadRevision(id: string, tx: Prisma.TransactionClient = this.prisma): Promise<RevisionFull> {
    const rev = await tx.budgetRevision.findUnique({
      where: { id },
      include: { budget: true, parameterSet: { include: { roles: true } }, sow: true, bidTemplate: { select: BID_TEMPLATE_META } },
    });
    if (!rev) throw new NotFoundException('Revisão de orçamento não encontrada.');
    return rev;
  }

  /**
   * Modelo `aws_sow` (§7.2–§7.4): horas-meta, horas T, indicadores e valores do bid, com o que ainda impede
   * submeter. Nulo nos outros modelos.
   */
  awsInfo(rev: RevisionFull, project: ProjectInfo | null, holidays: ReadonlySet<string> | null = null) {
    if (rev.budget.model !== 'aws_sow') return null;
    const missing: Array<'sow' | 'bid_template'> = [];
    if (!rev.sow) missing.push('sow');
    if (!rev.bidTemplate) missing.push('bid_template');
    const result = rev.result as unknown as BudgetResult | null;
    const bidTemplate = rev.bidTemplate
      ? { documentId: rev.bidTemplate.documentId, version: rev.bidTemplate.version, filename: rev.bidTemplate.filename, importedAt: rev.bidTemplate.importedAt, quoteRequestId: rev.bidTemplate.quoteRequestId }
      : null;
    const targets = (rev.bidTemplate?.targets ?? null) as unknown as BidTargets | null;
    let quote = null;
    if (rev.sow && targets && result) {
      const header = budgetHeader(rev.budget, project);
      const sowHeader = rev.sow.header as unknown as SowHeader;
      const inputs = rev.inputs as unknown as BudgetInputs;
      quote = computeAwsQuote({
        types: summarizeTypes(rev.sow.cables as unknown as SowCableLine[]),
        targets,
        result,
        hoursPerDay: rev.parameterSet.hoursPerDay ? Number(rev.parameterSet.hoursPerDay) : null,
        window: { start: sowHeader.startDate, end: sowHeader.endDate },
        hoursOverrides: (rev.sow.fieldHoursOverrides ?? {}) as Record<string, number>,
        justifications: (rev.sow.kpiJustifications ?? {}) as Partial<Record<KpiKey, string>>,
        bid: {
          proposalName: `${rev.budget.projectCode} R${rev.number}`,
          start: header.schedule.start.value,
          end: header.schedule.end.value,
          platformDays: inputs.platform?.days ?? 0,
          platformDaily: inputs.platform?.dailyBilled ?? null,
        },
        holidays,
      });
    }
    const blockers = [
      ...(missing.includes('sow') ? ['Importe a SOW do cliente.'] : []),
      ...(missing.includes('bid_template') ? ['Importe o Bid Template do cliente.'] : []),
      ...(quote?.blockers ?? []),
    ];
    return { missing, bidTemplate, targets, quote, blockers };
  }

  async getRevision(id: string, user: AuthenticatedUser) {
    const rev = await this.loadRevision(id);
    const cost = canSeeCost(user);
    const [project, siblings, current, events, holidays] = await Promise.all([
      this.project(rev.budget.axisProjectId).catch(() => null),
      this.prisma.budgetRevision.findMany({ where: { budgetId: rev.budgetId }, orderBy: { number: 'desc' }, select: { id: true, number: true, status: true } }),
      this.prisma.parameterSet.findFirst({ where: { status: 'vigente' }, select: { id: true, code: true } }),
      this.prisma.budgetRevisionEvent.findMany({ where: { revisionId: id }, orderBy: { createdAt: 'asc' } }),
      rev.budget.model === 'aws_sow' ? this.holidays() : Promise.resolve(null),
    ]);
    const set = rev.parameterSet;
    const aws = this.awsInfo(rev, project, holidays);
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
      sow: presentSow(rev.sow ?? null),
      aws,
      workflow: {
        allowedActions: allowedActions(rev.status, user),
        submitBlockers: rev.status === 'rascunho' ? [...submitBlockers(rev.result as never), ...(aws?.blockers ?? [])] : [],
        submittedAt: rev.submittedAt,
        approvedAt: rev.approvedAt,
        approvedByEmail: rev.approvedByEmail,
        decidedAt: rev.decidedAt,
        events: events.map((e) => ({
          id: e.id,
          action: e.action,
          label: EVENT_LABEL[e.action] ?? e.action,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          reason: e.reason,
          actorEmail: e.actorEmail,
          createdAt: e.createdAt,
        })),
      },
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
      const pending = budget.revisions.find((r) => r.status === 'em_aprovacao');
      if (pending) throw new ConflictException(`A revisão R${pending.number} está em aprovação. Aguarde a decisão ou peça a devolução.`);
      const won = budget.revisions.find((r) => r.status === 'ganha');
      if (won) throw new ConflictException(`A revisão R${won.number} foi ganha e é a linha de base do projeto; o orçamento não aceita novas revisões.`);
      const base = budget.revisions.find((r) => r.status !== 'descartada') ?? budget.revisions[0];
      const set = await this.currentParameterSet(tx);
      const inputs = base ? (base.inputs as unknown as BudgetInputs) : emptyInputs(set);
      const keys = new Set(set.roles.map((r) => r.roleKey));
      inputs.team = inputs.team.filter((t) => keys.has(t.roleKey));
      const number = (budget.revisions[0]?.number ?? 0) + 1;
      const rev = await tx.budgetRevision.create({
        data: { budgetId, number, parameterSetId: set.id, inputs: inputs as unknown as Prisma.InputJsonValue, ...this.persistFields(computeBudget(engineParams(set), inputs)), createdBy: user.userId, updatedBy: user.userId },
      });
      // A SOW lida (e corrigida) acompanha a nova revisão; importar de novo continua possível no rascunho.
      const baseSow = base ? await tx.budgetRevisionSow.findUnique({ where: { revisionId: base.id } }) : null;
      if (baseSow) {
        const { revisionId: _r, importedAt: _i, updatedAt: _u, ...copy } = baseSow;
        await tx.budgetRevisionSow.create({
          data: {
            ...copy,
            revisionId: rev.id,
            header: copy.header as Prisma.InputJsonValue,
            devices: copy.devices as Prisma.InputJsonValue,
            parsedCables: copy.parsedCables as Prisma.InputJsonValue,
            cables: copy.cables as Prisma.InputJsonValue,
            warnings: copy.warnings as Prisma.InputJsonValue,
            fieldHoursOverrides: copy.fieldHoursOverrides as Prisma.InputJsonValue,
            kpiJustifications: copy.kpiJustifications as Prisma.InputJsonValue,
            updatedBy: user.userId,
          },
        });
      }
      const baseBid = base ? await tx.revisionBidTemplate.findUnique({ where: { revisionId: base.id } }) : null;
      if (baseBid) {
        const { revisionId: _b, importedAt: _t, ...copyBid } = baseBid;
        await tx.revisionBidTemplate.create({ data: { ...copyBid, revisionId: rev.id, targets: copyBid.targets as Prisma.InputJsonValue } });
      }
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

  /** Dispensa um alerta do orçamento (quem aprova revisões confere e fecha). */
  async dismissAlert(budgetId: string, alertId: string, user: AuthenticatedUser) {
    if (!user.permissions.includes('budget:approve')) throw new ForbiddenException('Você não tem permissão para esta ação.');
    await this.prisma.$transaction(async (tx) => {
      const alert = await tx.budgetAlert.findFirst({ where: { id: alertId, budgetId } });
      if (!alert) throw new NotFoundException('Alerta não encontrado.');
      if (alert.resolvedAt) return;
      await tx.budgetAlert.update({ where: { id: alertId }, data: { resolvedAt: new Date(), resolvedBy: user.userId } });
      await this.audit.record(user.userId, 'budget_alert.dismissed', 'project_budget', budgetId, { alert: alert.kind, message: alert.message }, tx);
    });
  }

  async discard(id: string, user: AuthenticatedUser) {
    return this.transition(id, 'discard', user);
  }

  /**
   * Fluxo da revisão (§3.1): submeter, devolver, aprovar envio, ganha, perdida e descartar. Cada passo grava
   * o histórico e a auditoria na mesma transação. Aprovar o envio marca a revisão enviada anterior como
   * substituída. Quem orçou pode aprovar a própria revisão (P-03); a auditoria registra `selfApproved`.
   */
  async transition(
    id: string,
    action: WorkflowAction,
    user: AuthenticatedUser,
    reason?: string | null,
    /** Aprovar envio no aws_sow: grava a Bid e o outbox na mesma transação (BidService.approveSend). */
    onApproveSend?: (tx: Prisma.TransactionClient, approvedAt: Date) => Promise<unknown>,
  ) {
    const rule = WORKFLOW[action];
    if (!user.permissions.includes(rule.permission)) throw new ForbiddenException('Você não tem permissão para esta ação.');
    const why = reason?.trim() || null;
    if (rule.reasonRequired && (!why || why.length < 3)) throw new BadRequestException('Informe o motivo.');
    await this.prisma.$transaction(async (tx) => {
      const rev = await this.loadRevision(id, tx);
      if (rev.status !== rule.from) {
        throw new ConflictException(
          `A revisão R${rev.number} está "${REVISION_STATUS_LABEL[rev.status]}"; "${rule.label}" só vale para "${REVISION_STATUS_LABEL[rule.from]}".`,
        );
      }
      const now = new Date();
      const data: Prisma.BudgetRevisionUpdateInput = { status: rule.to, updatedBy: user.userId };
      const extra: Record<string, unknown> = {};
      if (action === 'submit') {
        const project = rev.budget.model === 'aws_sow' ? await this.project(rev.budget.axisProjectId).catch(() => null) : null;
        const holidays = rev.budget.model === 'aws_sow' ? await this.holidays(tx) : null;
        const blockers = [...submitBlockers(rev.result as never), ...(this.awsInfo(rev, project, holidays)?.blockers ?? [])];
        if (blockers.length) throw new BadRequestException(`Não dá para submeter: ${blockers.join(' ')}`);
        data.submittedAt = now;
      }
      if (action === 'return') data.submittedAt = null;
      if (action === 'approve_send' && rev.budget.model === 'aws_sow' && !onApproveSend) {
        throw new ConflictException('O envio de uma revisão aws_sow é aprovado pela geração da Bid.');
      }
      if (action === 'approve_send') {
        const previous = await tx.budgetRevision.findFirst({ where: { budgetId: rev.budgetId, status: 'enviada' }, select: { id: true, number: true } });
        if (previous) {
          await tx.budgetRevision.update({ where: { id: previous.id }, data: { status: 'substituida', updatedBy: user.userId } });
          await tx.budgetRevisionEvent.create({
            data: {
              revisionId: previous.id,
              action: 'superseded',
              fromStatus: 'enviada',
              toStatus: 'substituida',
              reason: `Substituída pela R${rev.number}.`,
              actorAxisId: user.userId,
              actorEmail: user.email,
            },
          });
          extra.superseded = previous.number;
        }
        Object.assign(data, { approvedAt: now, approvedBy: user.userId, approvedByEmail: user.email });
        const submitter = await tx.budgetRevisionEvent.findFirst({ where: { revisionId: id, action: 'submitted' }, orderBy: { createdAt: 'desc' }, select: { actorAxisId: true } });
        extra.selfApproved = submitter?.actorAxisId === user.userId;
      }
      if (action === 'won' || action === 'lost') data.decidedAt = now;
      await tx.budgetRevision.update({ where: { id }, data });
      if (action === 'approve_send' && onApproveSend) Object.assign(extra, await onApproveSend(tx, now));
      if (action === 'won') {
        // Mesmo lançamento do `project.approved` do Core (revision-won.ts): um caminho só, sem duplicar.
        const { status } = await postWonCommitments(tx, {
          revisionId: id,
          revisionNumber: rev.number,
          projectCode: rev.budget.projectCode,
          axisProjectId: rev.budget.axisProjectId,
          costCenterAxisId: await cachedCostCenter(tx, rev.budget.axisProjectId),
          competence: parseDate(todaySaoPaulo(now)),
          revenue: rev.revenue,
          result: rev.result,
          actor: user.userId,
        });
        const alert = commitmentAlert(status, rev.number);
        if (alert) await raiseBudgetAlert(tx, { budgetId: rev.budgetId, revisionId: id, ...alert });
        Object.assign(extra, { via: 'manual', commitments: status });
      }
      await tx.budgetRevisionEvent.create({
        data: { revisionId: id, action: rule.event, fromStatus: rule.from, toStatus: rule.to, reason: why, actorAxisId: user.userId, actorEmail: user.email },
      });
      await this.audit.record(
        user.userId,
        `budget_revision.${rule.event}`,
        'budget_revision',
        id,
        { project: rev.budget.projectCode, revision: rev.number, before: rule.from, after: rule.to, reason: why, ...extra } as Prisma.InputJsonValue,
        tx,
      );
    });
    return this.getRevision(id, user);
  }
}
