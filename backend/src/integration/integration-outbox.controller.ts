import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import type { OutboxStatus } from '@prisma/client';

/**
 * Read-only admin view over the transactional outbox (PLANNING.md 3.1/5.15) — not part of the
 * original satellite query/admin controllers, added for the ERP's event log screen and the
 * delivery-timeline slide-over. JWT-protected like the rest of the admin surface, reuses the
 * existing `integration:read` permission rather than introducing a new one.
 */
@Controller('integration/outbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationOutboxController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('integration:read')
  async list(
    @Query('status') status?: OutboxStatus,
    @Query('eventType') eventType?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const pageNum = Math.max(1, Number(page) || 1);
    const perPageNum = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where = {
      status,
      eventType: eventType ? { contains: eventType } : undefined,
    };
    const [data, total] = await Promise.all([
      this.prisma.integrationOutbox.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
      }),
      this.prisma.integrationOutbox.count({ where }),
    ]);
    return { data, meta: { page: pageNum, perPage: perPageNum, total } };
  }

  /** Delivery "timeline" for the slide-over: derived from the event's own fields — the outbox
   * schema doesn't track a separate log of each attempt, so this synthesizes the steps PLANNING.md
   * 3.1 describes (recorded → delivered/failed) from status/attempts/timestamps rather than a
   * stored history. */
  @Get(':id')
  @RequirePermissions('integration:read')
  async findOne(@Param('id') id: string) {
    const event = await this.prisma.integrationOutbox.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Outbox event not found');

    const timeline: Array<{ label: string; at: Date | null; done: boolean }> = [
      { label: 'Recebido pelo servidor', at: event.createdAt, done: true },
      {
        label: event.status === 'failed' ? 'Falha após as tentativas de entrega' : 'Entregue ao(s) satélite(s)',
        at: event.deliveredAt,
        done: event.status === 'delivered' || event.status === 'failed',
      },
    ];
    return { ...event, timeline };
  }
}
