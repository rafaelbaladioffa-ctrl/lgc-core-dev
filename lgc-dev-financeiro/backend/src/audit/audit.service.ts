import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { requestContext } from './correlation.middleware.js';

/** Trilha append-only (especificação §9): só existe `record`. O banco recusa UPDATE/DELETE em audit_events. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(actorAxisId: string, action: string, aggregateType: string, aggregateId: string, diff?: Prisma.InputJsonValue, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).auditEvent.create({
      data: { actorAxisId, action, aggregateType, aggregateId, diff, origin: 'api', correlationId: requestContext.getStore()?.correlationId },
    });
  }
}
