import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/** Trilha append-only (seção 20): só existe `record`; nenhuma rota de atualização ou remoção. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    actorAxisId: string,
    action: string,
    aggregateType: string,
    aggregateId: string,
    diff?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    return (tx ?? this.prisma).auditEvent.create({ data: { actorAxisId, action, aggregateType, aggregateId, diff, origin: 'api' } });
  }
}
