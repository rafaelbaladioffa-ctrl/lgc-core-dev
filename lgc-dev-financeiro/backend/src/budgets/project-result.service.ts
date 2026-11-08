import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { isoDate } from '../cost-centers/cc-engine.js';
import { COST_PERMISSION, projectInfo } from './budgets.service.js';
import { buildProjectResult, type EntrySum } from './project-result.js';
import { WON_SOURCE_PREFIX } from './won-commitments.js';

/** Cotado × comprometido × realizado do projeto (PA-16), a partir dos lançamentos do CC e da revisão ganha. */
@Injectable()
export class ProjectResultService {
  constructor(private readonly prisma: PrismaService) {}

  async get(axisProjectId: string, user: AuthenticatedUser) {
    const cached = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: axisProjectId } } });
    if (!cached) throw new NotFoundException('Projeto não encontrado no cache do Core. Atualize a lista de projetos.');
    const project = projectInfo(cached, null);
    const [won, groups, committedEntry] = await Promise.all([
      this.prisma.budgetRevision.findMany({ where: { status: 'ganha', budget: { axisProjectId } }, include: { budget: { select: { model: true } } } }),
      this.prisma.ccEntry.groupBy({ by: ['kind', 'stage', 'category', 'source'], where: { projectAxisId: axisProjectId }, _sum: { amount: true } }),
      this.prisma.ccEntry.findFirst({ where: { projectAxisId: axisProjectId, source: 'projeto', sourceRef: { startsWith: WON_SOURCE_PREFIX } }, select: { costCenterAxisId: true, competence: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    // A cotação AWS é a que segue para o Core e a que o cliente aceita; vem antes do orçamento genérico.
    const revision = [...won].sort((a, b) => Number(b.budget.model === 'aws_sow') - Number(a.budget.model === 'aws_sow'))[0] ?? null;
    const baseline = revision
      ? { revisionId: revision.id, revisionNumber: revision.number, revenue: revision.revenue, groups: ((revision.result as { groups?: Array<{ key: string; cost: string }> } | null)?.groups ?? []).map((g) => ({ key: g.key, cost: g.cost })) }
      : null;
    const rows: EntrySum[] = groups.map((g) => ({ kind: g.kind, stage: g.stage, category: g.category, source: g.source, amount: g._sum.amount }));
    const alerts = await this.prisma.budgetAlert.findMany({ where: { resolvedAt: null, budget: { axisProjectId } }, orderBy: { createdAt: 'asc' }, select: { id: true, budgetId: true, kind: true, message: true } });
    return {
      projectId: axisProjectId,
      code: project.code,
      name: project.name,
      costCenter: project.costCenter,
      costCenterId: committedEntry?.costCenterAxisId ?? ((cached.data as Record<string, unknown> | null)?.['cost_center_id'] as string | undefined) ?? null,
      revision: revision ? { id: revision.id, number: revision.number, decidedAt: revision.decidedAt, committedOn: committedEntry ? isoDate(committedEntry.competence) : null } : null,
      /** Revisão ganha sem comprometido lançado (ex.: projeto sem CC no cache quando o Core aprovou). */
      commitmentsPending: !!revision && !committedEntry,
      alerts,
      ...buildProjectResult(baseline, rows, user.permissions.includes(COST_PERMISSION)),
    };
  }
}
