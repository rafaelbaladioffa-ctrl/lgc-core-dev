import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ArrayUnique, IsArray, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from './permissions.decorator.js';
import { RbacService } from './rbac.service.js';

class SetMappingDto {
  @IsArray({ message: 'Informe a lista de perfis de Logística.' })
  @ArrayUnique({ message: 'Perfis repetidos.' })
  @IsString({ each: true, message: 'Código de perfil inválido.' })
  logisticsRoles!: string[];
}

class WarehouseAccessDto {
  @IsArray({ message: 'Informe a lista de almoxarifados.' })
  @ArrayUnique({ message: 'Almoxarifados repetidos.' })
  @IsString({ each: true, message: 'Identificador de almoxarifado inválido.' })
  warehouseIds!: string[];
}

@Controller('rbac')
export class RbacController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  @Get('roles')
  @RequirePermissions('rbac:read')
  async roles() {
    const rows = await this.prisma.logisticsRole.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, name: true, description: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    return rows.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.code).sort() }));
  }

  @Get('axis-role-mapping')
  @RequirePermissions('rbac:read')
  async mapping() {
    const rows = await this.prisma.axisRoleToLogisticsRole.findMany({ select: { axisRole: true, logisticsRole: { select: { code: true } } } });
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.axisRole] ??= []).push(r.logisticsRole.code);
    return out;
  }

  /** Substitui os perfis de Logística de uma role do Axis. Editável sem redeploy do Axis (0.3). */
  @Put('axis-role-mapping/:axisRole')
  @RequirePermissions('rbac:write')
  async setMapping(@Param('axisRole') axisRole: string, @Body() dto: SetMappingDto, @CurrentUser() user: AuthenticatedUser) {
    const roles = await this.prisma.logisticsRole.findMany({ where: { code: { in: dto.logisticsRoles } } });
    if (roles.length !== dto.logisticsRoles.length) {
      const known = new Set(roles.map((r) => r.code));
      throw new BadRequestException(`Perfis inexistentes: ${dto.logisticsRoles.filter((c) => !known.has(c)).join(', ')}.`);
    }
    const before = await this.prisma.axisRoleToLogisticsRole.findMany({ where: { axisRole }, select: { logisticsRole: { select: { code: true } } } });
    await this.prisma.$transaction([
      this.prisma.axisRoleToLogisticsRole.deleteMany({ where: { axisRole } }),
      this.prisma.axisRoleToLogisticsRole.createMany({ data: roles.map((r) => ({ axisRole, logisticsRoleId: r.id })) }),
    ]);
    this.rbac.invalidateCache();
    await this.audit.record(user.userId, 'rbac.axis_role_mapping_changed', 'axis_role', axisRole, {
      before: before.map((b) => b.logisticsRole.code),
      after: dto.logisticsRoles,
    });
    return { axisRole, logisticsRoles: dto.logisticsRoles };
  }

  @Get('users/:axisUserId/warehouses')
  @RequirePermissions('rbac:read')
  async userWarehouses(@Param('axisUserId') axisUserId: string) {
    const rows = await this.prisma.userWarehouseAccess.findMany({ where: { axisUserId }, select: { warehouseId: true } });
    return { axisUserId, warehouseIds: rows.map((r) => r.warehouseId) };
  }

  @Put('users/:axisUserId/warehouses')
  @RequirePermissions('rbac:write')
  async setUserWarehouses(@Param('axisUserId') axisUserId: string, @Body() dto: WarehouseAccessDto, @CurrentUser() user: AuthenticatedUser) {
    const found = await this.prisma.warehouse.count({ where: { id: { in: dto.warehouseIds } } });
    if (found !== dto.warehouseIds.length) throw new BadRequestException('Almoxarifado inexistente na lista.');
    await this.prisma.$transaction([
      this.prisma.userWarehouseAccess.deleteMany({ where: { axisUserId } }),
      this.prisma.userWarehouseAccess.createMany({ data: dto.warehouseIds.map((warehouseId) => ({ axisUserId, warehouseId, grantedBy: user.userId })) }),
    ]);
    await this.audit.record(user.userId, 'rbac.user_warehouse_access_changed', 'axis_user', axisUserId, { warehouseIds: dto.warehouseIds });
    return { axisUserId, warehouseIds: dto.warehouseIds };
  }
}
