import { BadRequestException, Injectable } from '@nestjs/common';
import type { CcEntry, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { hourlyCost } from '../budget-params/hourly-cost.js';
import { D, isAllocatedOn, parseDate, todaySaoPaulo, type AllocationSpan, type Dec } from './cc-engine.js';
import { refreshBudgetStatus } from './cc-budget-status.js';
import { CcContext, type ParamsWithRoles } from './cc-context.js';
import { FieldClient } from './field.client.js';
import { LABOR_REF_PREFIX, PENDING_LABEL, nextDay, planLabor, totalHours, type LaborResolver, type PendingReason } from './field-labor.js';

/** Ator dos lançamentos da importação diária das horas do Field. */
export const FIELD_SCHEDULER_ACTOR = 'sistema:field';
/** Mesmo limite do Field (`GET /api/integration/labor-hours`). */
export const MAX_IMPORT_DAYS = 62;
const DAY_MS = 86_400_000;

/** Linha que ainda vale: não é estorno e não foi estornada. */
const LIVE = { reversesId: null, reversedBy: { is: null } } satisfies Prisma.CcEntryWhereInput;

export interface FieldLaborPending {
  collaboratorId: string;
  collaboratorName: string | null;
  projectId: string;
  projectCode: string | null;
  reason: PendingReason;
  reasonLabel: string;
  days: number;
  hours: string;
}

/** Importação das horas reais do Field como mão de obra realizada do projeto (PT-10, PA-14). */
@Injectable()
export class FieldLaborService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ctx: CcContext,
    private readonly outbox: OutboxService,
    private readonly field: FieldClient,
  ) {}

  /**
   * Importa `[from, to]` (AAAA-MM-DD, até 62 dias). Idempotente por (colaborador, projeto, dia): igual fica; hora
   * diferente (ajuste no Field) estorna o par anterior e lança o novo; dia que sumiu do Field é estornado.
   * Colaborador sem função mapeada (ou outra pendência) não lança nada e aparece em `pending`.
   */
  async import(from: string, to: string, actor: string) {
    const start = parseDate(from, 'Início');
    const end = parseDate(to, 'Fim');
    if (end < start) throw new BadRequestException('O início do período não pode ser depois do fim.');
    if ((end.getTime() - start.getTime()) / DAY_MS + 1 > MAX_IMPORT_DAYS) throw new BadRequestException(`O período pode ter no máximo ${MAX_IMPORT_DAYS} dias.`);

    const { rows, invalid } = await this.field.laborHours(from, to);
    const [collaborators, projects, allocations] = await Promise.all([
      this.ctx.names('COLLABORATOR', rows.map((r) => r.axisCollaboratorId)),
      this.ctx.names('PROJECT', rows.map((r) => r.axisProjectId)),
      this.ctx.allocations(null, { start, end: new Date(end.getTime() + DAY_MS) }),
    ]);
    const roleMap = await this.ctx.roleMap();
    const today = parseDate(todaySaoPaulo());
    const paramsByDate = new Map<string, ParamsWithRoles | null>();
    for (const d of new Set(rows.map((r) => r.date))) {
      const at = parseDate(d);
      paramsByDate.set(d, await this.ctx.paramsAt(at > today ? today : at));
    }
    const allocsOf = new Map<string, AllocationSpan[]>();
    for (const a of allocations) allocsOf.set(a.collaboratorId, [...(allocsOf.get(a.collaboratorId) ?? []), a]);

    const resolver: LaborResolver = {
      project: (id) => {
        const p = projects.get(id);
        const cc = p?.data['cost_center_id'];
        return { known: !!p, costCenterId: typeof cc === 'string' && cc ? cc : null, code: p?.code ?? null };
      },
      roleOf: (id) => {
        const jt = collaborators.get(id)?.data['job_title_id'];
        return typeof jt === 'string' ? (roleMap.get(jt) ?? null) : null;
      },
      rateAt: (roleKey, date) => {
        const params = paramsByDate.get(date);
        const role = params?.roles.find((r) => r.roleKey === roleKey);
        const cost = params && role ? hourlyCost(params, role) : null;
        return cost?.ok ? new D(cost.value.costPerHour) : null;
      },
      originAt: (id, date) => {
        const day = parseDate(date);
        return (allocsOf.get(id) ?? []).find((a) => isAllocatedOn(a, day))?.costCenterId ?? null;
      },
    };
    const plan = planLabor(rows, resolver);

    const stats = await this.prisma.$transaction(
      async (tx) => {
        // O botão e o agendador não correm juntos: o segundo espera o primeiro e compara com o que ficou vigente.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'financeiro-field-labor'}))`;
        const current = await tx.ccEntry.findMany({
          where: { source: 'mao_de_obra', sourceRef: { gte: `${LABOR_REF_PREFIX}${from}`, lt: `${LABOR_REF_PREFIX}${nextDay(to)}` }, ...LIVE },
        });
        const byRef = new Map(current.map((e) => [e.sourceRef!, e]));
        const touched = new Map<string, Set<number>>();
        const touch = (cc: string, competence: Date) => touched.set(cc, (touched.get(cc) ?? new Set<number>()).add(competence.getUTCFullYear()));
        let created = 0;
        let replaced = 0;
        let unchanged = 0;
        const reverse = async (e: CcEntry, reason: string) => {
          await tx.ccEntry.create({
            data: {
              costCenterAxisId: e.costCenterAxisId, projectAxisId: e.projectAxisId, competence: e.competence, kind: e.kind, category: e.category, stage: e.stage, source: e.source,
              description: e.description, amount: new D(e.amount).negated(), reversesId: e.id, reason, createdBy: actor,
            },
          });
          touch(e.costCenterAxisId, e.competence);
        };
        for (const line of plan.lines) {
          const existing = byRef.get(line.ref);
          byRef.delete(line.ref);
          if (existing && new D(existing.amount).eq(line.amount) && existing.costCenterAxisId === line.costCenterAxisId && existing.projectAxisId === line.projectAxisId) {
            unchanged++;
            continue;
          }
          if (existing) {
            await reverse(existing, 'Horas do Field recalculadas');
            replaced++;
          } else created++;
          await tx.ccEntry.create({
            data: {
              costCenterAxisId: line.costCenterAxisId, projectAxisId: line.projectAxisId, competence: line.competence, kind: 'custo', category: 'folha', stage: 'realizado', source: 'mao_de_obra',
              amount: line.amount, description: line.description, sourceRef: line.ref, createdBy: actor,
            },
          });
          touch(line.costCenterAxisId, line.competence);
        }
        for (const e of byRef.values()) {
          await reverse(e, 'Não consta mais nas horas do Field');
          replaced++;
        }
        for (const [cc, years] of touched) for (const year of years) await refreshBudgetStatus(tx, this.outbox, cc, year);

        // Horas do período = estado da última importação (base do painel da equipe e das pendências).
        await tx.fieldLaborDay.deleteMany({ where: { date: { gte: start, lte: end } } });
        if (plan.days.length) {
          await tx.fieldLaborDay.createMany({
            data: plan.days.map((d) => ({
              collaboratorAxisId: d.collaboratorAxisId, projectAxisId: d.projectAxisId, date: parseDate(d.date), hours: d.hours, adjusted: d.adjusted, status: d.status,
              pendingReason: d.pendingReason, projectCostCenterAxisId: d.projectCostCenterAxisId, originCostCenterAxisId: d.originCostCenterAxisId,
            })),
          });
        }
        return { created, replaced, unchanged };
      },
      { timeout: 120_000 },
    );

    const pendingDays = plan.days.filter((d) => d.status === 'pendente');
    return {
      from,
      to,
      hours: totalHours(plan.days).toFixed(2),
      launchedHours: totalHours(plan.days.filter((d) => d.status === 'lancado')).toFixed(2),
      ...stats,
      invalidRows: invalid,
      pending: summarizePending(
        pendingDays.map((d) => ({ collaboratorId: d.collaboratorAxisId, projectId: d.projectAxisId, reason: d.pendingReason!, hours: d.hours })),
        (id) => collaborators.get(id)?.name ?? null,
        (id) => projects.get(id)?.code ?? null,
      ),
    };
  }

  /** Pendências vigentes (último estado importado) na faixa de dias. */
  async pending(from: string, to: string) {
    const rows = await this.prisma.fieldLaborDay.findMany({ where: { status: 'pendente', date: { gte: parseDate(from, 'Início'), lte: parseDate(to, 'Fim') } } });
    const [collaborators, projects] = await Promise.all([this.ctx.names('COLLABORATOR', rows.map((r) => r.collaboratorAxisId)), this.ctx.names('PROJECT', rows.map((r) => r.projectAxisId))]);
    return summarizePending(
      rows.map((r) => ({ collaboratorId: r.collaboratorAxisId, projectId: r.projectAxisId, reason: r.pendingReason as PendingReason, hours: new D(r.hours) })),
      (id) => collaborators.get(id)?.name ?? null,
      (id) => projects.get(id)?.code ?? null,
    );
  }
}

/** Agrupa as pendências por (colaborador, projeto, motivo), com dias e horas somados. */
export function summarizePending(
  list: Array<{ collaboratorId: string; projectId: string; reason: PendingReason; hours: Dec }>,
  nameOf: (collaboratorId: string) => string | null,
  codeOf: (projectId: string) => string | null,
): FieldLaborPending[] {
  const groups = new Map<string, FieldLaborPending & { total: Dec }>();
  for (const p of list) {
    const key = `${p.collaboratorId}|${p.projectId}|${p.reason}`;
    const g = groups.get(key) ?? { collaboratorId: p.collaboratorId, collaboratorName: nameOf(p.collaboratorId), projectId: p.projectId, projectCode: codeOf(p.projectId), reason: p.reason, reasonLabel: PENDING_LABEL[p.reason] ?? p.reason, days: 0, hours: '0.00', total: new D(0) };
    g.days++;
    g.total = g.total.plus(p.hours);
    g.hours = g.total.toFixed(2);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ total: _total, ...rest }) => rest).sort((a, b) => (a.collaboratorName ?? a.collaboratorId).localeCompare(b.collaboratorName ?? b.collaboratorId) || a.reason.localeCompare(b.reason));
}

