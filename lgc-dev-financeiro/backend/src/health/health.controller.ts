import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
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
  @SkipThrottle()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'axis-financeiro' };
  }

  /** Identidade do token do Core + perfis e permissões locais. Qualquer usuário autenticado. */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return {
      userId: user.userId,
      email: user.email,
      collaboratorId: user.collaboratorId,
      axisRoles: user.axisRoles,
      financeRoles: await this.rbac.financeRolesFor(user.axisRoles, user.userId),
      permissions: user.permissions,
    };
  }
}
