import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

/**
 * Read-only listing over `sensitive_data_access_logs` (PLANNING.md 5.2) — previously write-only
 * (recorded on every `GET /collaborators/:id/sensitive`, never surfaced). Gated by
 * `collaborator:read_sensitive`, the same permission that triggers the logging in the first
 * place, so only roles that can see sensitive data can audit who else saw it.
 */
@Controller('sensitive-access-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SensitiveAccessLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('collaborator:read_sensitive')
  async list(
    @Query('collaboratorId') collaboratorId?: string,
    @Query('actorUserId') actorUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const perPageNum = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where = {
      collaboratorId,
      actorUserId,
      createdAt: from || to ? { gte: from ? new Date(from) : undefined, lte: to ? new Date(to) : undefined } : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.sensitiveDataAccessLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
        include: {
          collaborator: { select: { id: true, fullName: true } },
          actor: { select: { id: true, email: true } },
        },
      }),
      this.prisma.sensitiveDataAccessLog.count({ where }),
    ]);
    return { data, meta: { page: pageNum, perPage: perPageNum, total } };
  }
}
