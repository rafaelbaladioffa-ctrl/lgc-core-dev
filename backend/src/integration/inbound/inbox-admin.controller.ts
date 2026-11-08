import { BadRequestException, Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import type { InboxStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../rbac/permissions.guard.js';
import { RequirePermissions } from '../../rbac/permissions.decorator.js';

const INBOX_STATUSES: InboxStatus[] = ['processed', 'ignored', 'failed'];

/** Mensagens recebidas dos satélites, para a tela Integrações (somente leitura). */
@Controller('integration/inbox')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InboxAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('integration:read')
  async list(
    @Query('satelliteId') satelliteId?: string,
    @Query('status') status?: string,
    @Query('eventType') eventType?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    if (status && !INBOX_STATUSES.includes(status as InboxStatus)) throw new BadRequestException('Status inválido.');
    const pageNum = Math.max(1, Number(page) || 1);
    const perPageNum = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where = {
      satelliteId: satelliteId || undefined,
      status: (status as InboxStatus) || undefined,
      eventType: eventType ? { contains: eventType } : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.integrationInbox.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        skip: (pageNum - 1) * perPageNum,
        take: perPageNum,
        select: {
          id: true,
          satelliteId: true,
          satellite: { select: { name: true } },
          eventId: true,
          eventType: true,
          status: true,
          error: true,
          receivedAt: true,
          processedAt: true,
        },
      }),
      this.prisma.integrationInbox.count({ where }),
    ]);
    const data = rows.map(({ satellite, ...row }) => ({ ...row, satelliteName: satellite.name }));
    return { data, meta: { page: pageNum, perPage: perPageNum, total } };
  }

  @Get(':id')
  @RequirePermissions('integration:read')
  async findOne(@Param('id') id: string) {
    const row = await this.prisma.integrationInbox.findUnique({
      where: { id },
      include: { satellite: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Mensagem não encontrada.');
    const { satellite, ...rest } = row;
    return { ...rest, satelliteName: satellite.name };
  }
}
