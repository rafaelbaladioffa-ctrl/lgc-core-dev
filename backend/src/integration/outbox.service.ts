import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type TxOrClient = Prisma.TransactionClient | PrismaClient;

/**
 * Writes an integration event to the outbox. Always call this with the SAME transaction
 * client used to persist the state change it describes, so the event and the change commit
 * (or roll back) atomically — never lose an event to a failure after a partial commit
 * (PLANNING.md 3.1, step 1).
 */
@Injectable()
export class OutboxService {
  async record(tx: TxOrClient, eventType: string, payload: Record<string, unknown>): Promise<void> {
    await tx.integrationOutbox.create({ data: { eventType, payload: payload as Prisma.InputJsonValue } });
  }
}
