import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

const CACHE_TTL_MS = 30_000;

@Injectable()
export class RbacService {
  private cache = new Map<string, { at: number; permissions: string[] }>();

  constructor(private readonly prisma: PrismaService) {}

  private roleFilter(axisRoles: string[], axisUserId?: string) {
    return {
      OR: [{ axisMappings: { some: { axisRole: { in: axisRoles } } } }, ...(axisUserId ? [{ userGrants: { some: { axisUserId } } }] : [])],
    };
  }

  /** Papéis do Core (mapeamento) + perfis concedidos ao usuário → permissões (união). Cache curto, limpo a cada alteração. */
  async resolvePermissions(axisRoles: string[], axisUserId?: string): Promise<string[]> {
    if (axisRoles.length === 0 && !axisUserId) return [];
    const key = `${[...axisRoles].sort().join('|')}#${axisUserId ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.permissions;

    const rows = await this.prisma.rolePermission.findMany({
      where: { role: this.roleFilter(axisRoles, axisUserId) },
      select: { permission: { select: { code: true } } },
    });
    const permissions = [...new Set(rows.map((r) => r.permission.code))].sort();
    this.cache.set(key, { at: Date.now(), permissions });
    return permissions;
  }

  invalidateCache() {
    this.cache.clear();
  }

  financeRolesFor(axisRoles: string[], axisUserId?: string) {
    if (axisRoles.length === 0 && !axisUserId) return Promise.resolve([]);
    return this.prisma.financeRole.findMany({
      where: this.roleFilter(axisRoles, axisUserId),
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }
}
