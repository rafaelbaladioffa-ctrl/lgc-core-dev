import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';

class AuditQueryDto {
  @IsOptional() @IsString() @MaxLength(60) aggregateType?: string;
  @IsOptional() @IsString() @MaxLength(80) aggregateId?: string;
  @IsOptional() @IsString() @MaxLength(80) actorAxisId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) per_page?: number;
}

@Controller('audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(@Query() q: AuditQueryDto) {
    const page = q.page ?? 1;
    const perPage = q.per_page ?? 50;
    const where = { aggregateType: q.aggregateType, aggregateId: q.aggregateId, actorAxisId: q.actorAxisId };
    const [data, total] = await Promise.all([
      this.prisma.auditEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { data, meta: { page, per_page: perPage, total } };
  }
}
