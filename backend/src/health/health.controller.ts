import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RbacService } from '../rbac/rbac.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'axis-logistica' };
  }

  /** Identidade resolvida a partir do JWT do Axis + perfis/permissões locais. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return {
      userId: user.userId,
      email: user.email,
      collaboratorId: user.collaboratorId,
      axisRoles: user.axisRoles,
      logisticsRoles: await this.rbac.logisticsRolesFor(user.axisRoles),
      permissions: user.permissions,
    };
  }
}
