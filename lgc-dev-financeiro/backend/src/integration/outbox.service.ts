import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { requestContext } from '../audit/correlation.middleware.js';

/**
 * Grava um evento Financeiro → Core no outbox. Chame SEMPRE com o mesmo `tx` da escrita de negócio,
 * para o evento e a mudança confirmarem (ou desfazerem) juntos (regra 6 do AGENTS.md).
 */
@Injectable()
export class OutboxService {
  record(tx: Prisma.TransactionClient, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({
      data: {
        direction: 'OUTBOUND',
        eventId: randomUUID(),
        eventType,
        occurredAt: new Date(),
        payload: payload as Prisma.InputJsonValue,
        status: 'PENDING',
        correlationId: requestContext.getStore()?.correlationId,
      },
    });
  }
}
