import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

/** Espera entre tentativas (12.1): 1 min, 5 min, 30 min, 2 h; depois dead-letter (FAILED) para intervenção. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const TIMEOUT_MS = 10_000;

export interface DispatchSummary { enabled: boolean; delivered: number; retried: number; deadLettered: number; skippedLock?: boolean }

/**
 * Entrega ao Axis os eventos gravados no outbox transacional (Logística → Axis, 12.3).
 * Cada entrega é assinada (HMAC-SHA256 do corpo) e leva `Idempotency-Key = event_id`; o Axis deduplica.
 * Uma falha do Axis nunca desfaz movimento já confirmado: o evento fica pendente e é reenviado (12.4).
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private async send(url: string, secret: string | undefined, m: { id: string; eventId: string; eventType: string; occurredAt: Date; correlationId: string | null; payload: unknown }) {
    const body = JSON.stringify({ event_id: m.eventId, event_type: m.eventType, occurred_at: m.occurredAt.toISOString(), correlation_id: m.correlationId, source: 'logistica', payload: m.payload });
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': m.eventId, 'X-Event-Id': m.eventId };
    if (secret) headers['X-Logistica-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async dispatchOnce(limit = 50, now = new Date()): Promise<DispatchSummary> {
    const url = this.config.get<string>('AXIS_EVENTS_URL');
    if (!url) return { enabled: false, delivered: 0, retried: 0, deadLettered: 0 };
    const secret = this.config.get<string>('AXIS_OUTBOUND_SECRET');
    const summary: DispatchSummary = { enabled: true, delivered: 0, retried: 0, deadLettered: 0 };

    return this.prisma.$transaction(async (tx) => {
      // Uma instância por vez (a VPS pode ter réplicas): quem não obtém o lock simplesmente pula o ciclo.
      const [{ ok }] = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext('outbox-dispatch')) AS ok`;
      if (!ok) return { ...summary, skippedLock: true };
      const due = await tx.integrationMessage.findMany({ where: { direction: 'OUTBOUND', status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: [{ createdAt: 'asc' }, { occurredAt: 'asc' }], take: limit }); // createdAt = início da transação: eventos da mesma escrita desempatam por occurredAt
      for (const m of due) {
        try {
          await this.send(url, secret, m);
          await tx.integrationMessage.update({ where: { id: m.id }, data: { status: 'DELIVERED', processedAt: new Date(), attempts: m.attempts + 1, lastError: null, nextAttemptAt: null } });
          summary.delivered++;
        } catch (e) {
          const attempts = m.attempts + 1;
          const error = (e as Error).message.slice(0, 300);
          if (attempts >= MAX_ATTEMPTS) {
            await tx.integrationMessage.update({ where: { id: m.id }, data: { status: 'FAILED', attempts, lastError: error, nextAttemptAt: null } });
            this.logger.error(`Evento ${m.eventType} ${m.eventId} foi para a dead-letter após ${attempts} tentativas: ${error}`);
            summary.deadLettered++;
          } else {
            await tx.integrationMessage.update({ where: { id: m.id }, data: { attempts, lastError: error, nextAttemptAt: new Date(now.getTime() + BACKOFF_SECONDS[attempts - 1] * 1000) } });
            summary.retried++;
          }
        }
      }
      return summary;
    }, { timeout: 120_000, maxWait: 10_000 });
  }

  async status() {
    const rows = await this.prisma.integrationMessage.groupBy({ by: ['direction', 'status'], _count: { _all: true } });
    const oldest = await this.prisma.integrationMessage.findFirst({ where: { direction: 'OUTBOUND', status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return { configured: !!this.config.get('AXIS_EVENTS_URL'), counts: rows.map((r) => ({ direction: r.direction, status: r.status, count: r._count._all })), oldestPendingAt: oldest?.createdAt.toISOString() ?? null };
  }

  /** Recoloca uma mensagem da dead-letter na fila, após o problema ser tratado. */
  async retry(id: string) {
    const m = await this.prisma.integrationMessage.findUnique({ where: { id } });
    if (!m || m.direction !== 'OUTBOUND') throw new NotFoundException('Mensagem de saída não encontrada.');
    if (m.status !== 'FAILED') return m;
    return this.prisma.integrationMessage.update({ where: { id }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: null } });
  }
}
