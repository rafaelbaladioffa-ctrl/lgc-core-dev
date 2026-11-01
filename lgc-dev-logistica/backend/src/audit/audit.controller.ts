import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

export class AuditQuery {
  @IsOptional() @IsString() @MaxLength(60) aggregateType?: string;
  @IsOptional() @IsString() @MaxLength(80) aggregateId?: string;
  @IsOptional() @IsString() @MaxLength(80) actor?: string;
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsString() @MaxLength(80) correlationId?: string;
  @IsOptional() @IsDateString({}, { message: 'Data inicial inválida.' }) from?: string;
  @IsOptional() @IsDateString({}, { message: 'Data final inválida.' }) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

/** Consulta da trilha (somente leitura; a tabela é protegida por trigger contra UPDATE/DELETE). */
@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('events') @RequirePermissions('audit:read')
  async events(@Query() q: AuditQuery) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where = {
      ...(q.aggregateType && { aggregateType: q.aggregateType }), ...(q.aggregateId && { aggregateId: q.aggregateId }), ...(q.actor && { actorAxisId: q.actor }),
      ...(q.action && { action: q.action }), ...(q.correlationId && { correlationId: q.correlationId }),
      ...((q.from || q.to) && { createdAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) } }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.auditEvent.count({ where }),
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items };
  }
}
