import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

const CACHE_TTL_MS = 30_000;

@Injectable()
export class RbacService {
  private cache = new Map<string, { at: number; permissions: string[] }>();

  constructor(private readonly prisma: PrismaService) {}

  /** Roles do Axis → perfis de Logística → permissões (união). Cache curto, invalidado ao alterar o mapeamento. */
  async resolvePermissions(axisRoles: string[]): Promise<string[]> {
    if (axisRoles.length === 0) return [];
    const key = [...axisRoles].sort().join('|');
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.permissions;

    const rows = await this.prisma.rolePermission.findMany({
      where: { role: { axisMappings: { some: { axisRole: { in: axisRoles } } } } },
      select: { permission: { select: { code: true } } },
    });
    const permissions = [...new Set(rows.map((r) => r.permission.code))].sort();
    this.cache.set(key, { at: Date.now(), permissions });
    return permissions;
  }

  invalidateCache() {
    this.cache.clear();
  }

  async logisticsRolesFor(axisRoles: string[]) {
    if (axisRoles.length === 0) return [];
    return this.prisma.logisticsRole.findMany({
      where: { axisMappings: { some: { axisRole: { in: axisRoles } } } },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Escopo por almoxarifado (seção 6): `warehouse:access_all` ou linha explícita em user_warehouse_access. */
  async assertWarehouseAccess(user: AuthenticatedUser, warehouseId: string): Promise<void> {
    if (user.permissions.includes('warehouse:access_all')) return;
    const row = await this.prisma.userWarehouseAccess.findUnique({
      where: { axisUserId_warehouseId: { axisUserId: user.userId, warehouseId } },
    });
    if (!row) throw new ForbiddenException('Sem acesso a este almoxarifado.');
  }

  async accessibleWarehouseIds(user: AuthenticatedUser): Promise<string[] | 'ALL'> {
    if (user.permissions.includes('warehouse:access_all')) return 'ALL';
    const rows = await this.prisma.userWarehouseAccess.findMany({ where: { axisUserId: user.userId }, select: { warehouseId: true } });
    return rows.map((r) => r.warehouseId);
  }
}
