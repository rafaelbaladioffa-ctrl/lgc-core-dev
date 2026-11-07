import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ArrayUnique, IsArray, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from './permissions.decorator.js';
import { RbacService } from './rbac.service.js';

class FinanceRolesDto {
  @IsArray({ message: 'Informe a lista de perfis do Financeiro.' })
  @ArrayUnique({ message: 'Perfis repetidos.' })
  @IsString({ each: true, message: 'Código de perfil inválido.' })
  financeRoles!: string[];
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
    const rows = await this.prisma.financeRole.findMany({
      orderBy: { code: 'asc' },
      select: { code: true, name: true, description: true, permissions: { select: { permission: { select: { code: true } } } } },
    });
    return rows.map((r) => ({ ...r, permissions: r.permissions.map((p) => p.permission.code).sort() }));
  }

  @Get('axis-role-mapping')
  @RequirePermissions('rbac:read')
  async mapping() {
    const rows = await this.prisma.axisRoleToFinanceRole.findMany({ select: { axisRole: true, financeRole: { select: { code: true } } } });
    const out: Record<string, string[]> = {};
    for (const r of rows) (out[r.axisRole] ??= []).push(r.financeRole.code);
    return out;
  }

  private async findRoles(codes: string[]) {
    const roles = await this.prisma.financeRole.findMany({ where: { code: { in: codes } } });
    if (roles.length !== codes.length) {
      const known = new Set(roles.map((r) => r.code));
      throw new BadRequestException(`Perfis inexistentes: ${codes.filter((c) => !known.has(c)).join(', ')}.`);
    }
    return roles;
  }

  /** Substitui os perfis do Financeiro de um papel do Core. */
  @Put('axis-role-mapping/:axisRole')
  @RequirePermissions('rbac:write')
  async setMapping(@Param('axisRole') axisRole: string, @Body() dto: FinanceRolesDto, @CurrentUser() user: AuthenticatedUser) {
    const roles = await this.findRoles(dto.financeRoles);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.axisRoleToFinanceRole.findMany({ where: { axisRole }, select: { financeRole: { select: { code: true } } } });
      await tx.axisRoleToFinanceRole.deleteMany({ where: { axisRole } });
      await tx.axisRoleToFinanceRole.createMany({ data: roles.map((r) => ({ axisRole, financeRoleId: r.id })) });
      await this.audit.record(user.userId, 'rbac.axis_role_mapping_changed', 'axis_role', axisRole, { before: before.map((b) => b.financeRole.code), after: dto.financeRoles }, tx);
    });
    this.rbac.invalidateCache();
    return { axisRole, financeRoles: dto.financeRoles };
  }

  @Get('users/:axisUserId/roles')
  @RequirePermissions('rbac:read')
  async userRoles(@Param('axisUserId') axisUserId: string) {
    const rows = await this.prisma.userFinanceRole.findMany({ where: { axisUserId }, select: { financeRole: { select: { code: true } } } });
    return { axisUserId, financeRoles: rows.map((r) => r.financeRole.code).sort() };
  }

  /** Perfis concedidos diretamente a um usuário do Core. Ninguém altera os próprios perfis. */
  @Put('users/:axisUserId/roles')
  @RequirePermissions('rbac:write')
  async setUserRoles(@Param('axisUserId') axisUserId: string, @Body() dto: FinanceRolesDto, @CurrentUser() user: AuthenticatedUser) {
    if (axisUserId === user.userId) throw new BadRequestException('Você não pode alterar os próprios perfis.');
    const roles = await this.findRoles(dto.financeRoles);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.userFinanceRole.findMany({ where: { axisUserId }, select: { financeRole: { select: { code: true } } } });
      await tx.userFinanceRole.deleteMany({ where: { axisUserId } });
      await tx.userFinanceRole.createMany({ data: roles.map((r) => ({ axisUserId, financeRoleId: r.id, grantedBy: user.userId })) });
      await this.audit.record(user.userId, 'rbac.user_roles_changed', 'axis_user', axisUserId, { before: before.map((b) => b.financeRole.code), after: dto.financeRoles }, tx);
    });
    this.rbac.invalidateCache();
    return { axisUserId, financeRoles: dto.financeRoles };
  }
}
