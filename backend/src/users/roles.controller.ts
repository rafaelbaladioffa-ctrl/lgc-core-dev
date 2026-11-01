import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

/** Read-only role listing, used to populate the role picker when creating/editing a login user. */
@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('user:read')
  findAll() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' } });
  }
}
