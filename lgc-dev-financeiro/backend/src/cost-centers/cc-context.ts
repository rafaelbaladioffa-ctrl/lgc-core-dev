import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { D, descendantsMap, type AllocationSpan, type Period } from './cc-engine.js';
import type { PayrollParams, RoleCostInput } from '../budget-params/hourly-cost.js';

export type CcKind = 'divisao' | 'administrativo' | 'operacional' | 'equipe_tecnica';

export interface CcNode {
  id: string;
  code: string | null;
  shortCode: string | null;
  name: string | null;
  kind: CcKind | null;
  parentId: string | null;
  responsibleCollaboratorId: string | null;
  active: boolean;
}

const KINDS: CcKind[] = ['divisao', 'administrativo', 'operacional', 'equipe_tecnica'];
const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);

export interface ParamsWithRoles extends PayrollParams {
  id: string;
  code: string;
  kmRate: Prisma.Decimal | null;
  roles: Array<RoleCostInput & { roleKey: string; label: string }>;
}

/** Leituras compartilhadas: CCs do cache, nomes, visibilidade, alocações e parâmetros vigentes. */
@Injectable()
export class CcContext {
  constructor(private readonly prisma: PrismaService) {}

  async nodes(): Promise<CcNode[]> {
    const rows = await this.prisma.axisMasterCache.findMany({ where: { kind: 'COST_CENTER' }, orderBy: { code: 'asc' } });
    return rows.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const kind = s(data['kind']);
      return {
        id: r.axisId,
        code: r.code,
        shortCode: s(data['short_code']),
        name: r.name,
        kind: kind && (KINDS as string[]).includes(kind) ? (kind as CcKind) : null,
        parentId: s(data['parent_cost_center_id']),
        responsibleCollaboratorId: s(data['responsible_collaborator_id']),
        active: r.active,
      };
    });
  }

  /** CCs que o usuário pode ver: todos (`cost_center:read`) ou os dele e os abaixo (`cost_center:read_own`). */
  visible(user: AuthenticatedUser, nodes: CcNode[]): Set<string> {
    if (user.permissions.includes('cost_center:read')) return new Set(nodes.map((n) => n.id));
    if (!user.permissions.includes('cost_center:read_own') || !user.collaboratorId) return new Set();
    const desc = descendantsMap(nodes);
    const out = new Set<string>();
    for (const n of nodes) {
      if (n.responsibleCollaboratorId !== user.collaboratorId) continue;
      out.add(n.id);
      for (const d of desc.get(n.id) ?? []) out.add(d);
    }
    return out;
  }

  async requireVisible(user: AuthenticatedUser, id: string): Promise<{ node: CcNode; nodes: CcNode[]; visible: Set<string> }> {
    const nodes = await this.nodes();
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new NotFoundException('Centro de custo não encontrado no Financeiro. Atualize os cadastros do Core.');
    const visible = this.visible(user, nodes);
    if (!visible.has(id)) throw new ForbiddenException('Você não tem acesso a este centro de custo.');
    return { node, nodes, visible };
  }

  async names(kind: 'PROJECT' | 'COLLABORATOR', ids: Iterable<string>) {
    const list = [...new Set(ids)].filter(Boolean);
    if (list.length === 0) return new Map<string, { code: string | null; name: string | null; data: Record<string, unknown> }>();
    const rows = await this.prisma.axisMasterCache.findMany({ where: { kind, axisId: { in: list } } });
    return new Map(rows.map((r) => [r.axisId, { code: r.code, name: r.name, data: (r.data ?? {}) as Record<string, unknown> }]));
  }

  async allocations(costCenterIds: string[] | null, period: Pick<Period, 'start' | 'end'>): Promise<AllocationSpan[]> {
    const rows = await this.prisma.ccAllocation.findMany({
      where: { ...(costCenterIds && { costCenterAxisId: { in: costCenterIds } }), validFrom: { lt: period.end }, OR: [{ validTo: null }, { validTo: { gt: period.start } }] },
    });
    return rows.map((r) => ({ collaboratorId: r.collaboratorAxisId, costCenterId: r.costCenterAxisId, validFrom: r.validFrom, validTo: r.validTo }));
  }

  /** Conjunto de parâmetros publicado vigente na data (o de início mais recente até ela). */
  async paramsAt(date: Date): Promise<ParamsWithRoles | null> {
    const set = await this.prisma.parameterSet.findFirst({
      where: { status: { in: ['vigente', 'arquivado'] }, publishedAt: { not: null }, effectiveFrom: { lte: date } },
      orderBy: [{ effectiveFrom: 'desc' }, { publishedAt: 'desc' }],
      include: { roles: true },
    });
    const fallback = set ?? (await this.prisma.parameterSet.findFirst({ where: { status: 'vigente' }, include: { roles: true } }));
    if (!fallback) return null;
    return { ...fallback, roles: fallback.roles } as unknown as ParamsWithRoles;
  }

  /** Cargo do Core (id) → função do orçamento. */
  async roleMap() {
    const rows = await this.prisma.jobTitleRoleMap.findMany();
    return new Map(rows.map((r) => [r.axisJobTitleId, r.roleKey]));
  }

  hoursPerDay(params: ParamsWithRoles | null) {
    const h = params?.hoursPerDay;
    return h === null || h === undefined || h === '' ? null : new D(h);
  }
}
