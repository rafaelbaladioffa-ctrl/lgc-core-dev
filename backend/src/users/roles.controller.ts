import { BadRequestException, Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { SaveRoleDto } from './dto/save-role.dto.js';

/** Read-only role listing, used to populate the role picker when creating/editing a login user. */
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('user:read')
  findAll() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { rolePermissions: { include: { permission: true } } },
    });
  }

  @Get('permissions')
  @RequirePermissions('user:read')
  findPermissions() {
    return this.prisma.permission.findMany({ orderBy: [{ resource: 'asc' }, { action: 'asc' }] });
  }

  @Post()
  @RequirePermissions('user:update')
  async create(@Body() dto: SaveRoleDto) {
    return this.save(null, dto);
  }

  @Put(':id')
  @RequirePermissions('user:update')
  async update(@Param('id') id: string, @Body() dto: SaveRoleDto) {
    return this.save(id, dto);
  }

  private async save(id: string | null, dto: SaveRoleDto) {
    const permissionCount = await this.prisma.permission.count({ where: { id: { in: dto.permissionIds } } });
    if (permissionCount !== dto.permissionIds.length) {
      throw new BadRequestException('Uma ou mais permissões não existem.');
    }
    return this.prisma.$transaction(async (tx) => {
      const role = id
        ? await tx.role.update({ where: { id }, data: { name: dto.name.trim(), description: dto.description?.trim() || null } })
        : await tx.role.create({ data: { name: dto.name.trim(), description: dto.description?.trim() || null } });
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (dto.permissionIds.length) {
        await tx.rolePermission.createMany({ data: dto.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
      }
      return tx.role.findUniqueOrThrow({ where: { id: role.id }, include: { rolePermissions: { include: { permission: true } } } });
    });
  }
}
