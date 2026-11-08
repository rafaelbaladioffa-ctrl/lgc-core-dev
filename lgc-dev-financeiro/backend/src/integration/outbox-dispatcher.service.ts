import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CORE_QUOTE_EVENT } from '../budgets/bid/core-quote.js';

/** Espera entre tentativas: 1 min, 5 min, 30 min, 2 h; depois FAILED (dead-letter) para reenvio manual. */
export const BACKOFF_SECONDS = [60, 300, 1800, 7200];
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const TIMEOUT_MS = 10_000;

export interface DispatchSummary {
  enabled: boolean;
  delivered: number;
  retried: number;
  deadLettered: number;
  skippedLock?: boolean;
}

interface OutboundMessage {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  correlationId: string | null;
  payload: unknown;
}

/** Resposta do Core que não adianta reenviar: vai direto para a dead-letter, para análise (§13.1). */
export class PermanentDeliveryError extends Error {}

/** Corpo e cabeçalhos de uma entrega: assinatura HMAC-SHA256 do corpo exato enviado. */
export function buildDelivery(m: OutboundMessage, secret: string | undefined) {
  const body = JSON.stringify({ event_id: m.eventId, event_type: m.eventType, occurred_at: m.occurredAt.toISOString(), correlation_id: m.correlationId, source: 'financeiro', payload: m.payload });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': m.eventId, 'X-Event-Id': m.eventId };
  if (secret) headers['X-Financeiro-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return { body, headers };
}

/**
 * Entrega ao Core os eventos do outbox (especificação §2.4). Uma falha do Core nunca desfaz a escrita
 * já confirmada: o evento fica pendente e é reenviado.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Ligado só com SCHEDULER_ENABLED=true, em UMA instância. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async scheduled() {
    if (this.config.get<string>('SCHEDULER_ENABLED') !== 'true') return;
    try {
      await this.dispatchOnce();
    } catch (e) {
      this.logger.error(`Ciclo do outbox falhou: ${(e as Error).message}`);
    }
  }

  private get apiBase() {
    return (this.config.get<string>('AXIS_API_URL') || 'http://localhost:3000/api/v1').replace(/\/+$/, '');
  }

  /**
   * `POST /integration/projects/:id/quotes` do Core com a Bid guardada na revisão. 400/403/404/409 são
   * definitivos (reenviar não muda nada); rede e 5xx tentam de novo.
   */
  async deliverQuote(tx: Prisma.TransactionClient, payload: unknown, fetchFn: typeof fetch = fetch): Promise<void> {
    const message = payload as { axis_project_id: string; revision_id: string; quote: Record<string, unknown> };
    const bid = await tx.revisionBidOutput.findUnique({ where: { revisionId: message.revision_id }, select: { filename: true, content: true } });
    if (!bid) throw new PermanentDeliveryError('Bid da revisão não encontrada.');
    const body = JSON.stringify({ ...message.quote, bid: { filename: bid.filename, content_base64: Buffer.from(bid.content).toString('base64') } });
    const res = await fetchFn(`${this.apiBase}/integration/projects/${encodeURIComponent(message.axis_project_id)}/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.get<string>('AXIS_API_KEY')}` },
      body,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return;
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if ([400, 403, 404, 409].includes(res.status)) throw new PermanentDeliveryError(`HTTP ${res.status} ${detail}`);
    throw new Error(`HTTP ${res.status} ${detail}`);
  }

  async dispatchOnce(limit = 50, now = new Date()): Promise<DispatchSummary> {
    const url = this.config.get<string>('AXIS_EVENTS_URL');
    const apiKey = this.config.get<string>('AXIS_API_KEY');
    if (!url && !apiKey) return { enabled: false, delivered: 0, retried: 0, deadLettered: 0 };
    const secret = this.config.get<string>('AXIS_OUTBOUND_SECRET');
    const summary: DispatchSummary = { enabled: true, delivered: 0, retried: 0, deadLettered: 0 };

    return this.prisma.$transaction(
      async (tx) => {
        // Uma instância por vez: quem não obtém o lock pula o ciclo.
        const [{ ok }] = await tx.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext('financeiro-outbox-dispatch')) AS ok`;
        if (!ok) return { ...summary, skippedLock: true };
        const due = await tx.integrationMessage.findMany({
          where: { direction: 'OUTBOUND', status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          orderBy: { createdAt: 'asc' },
          take: limit,
        });
        for (const m of due) {
          const isQuote = m.eventType === CORE_QUOTE_EVENT;
          // Sem destino configurado para este tipo: continua pendente, sem contar tentativa.
          if ((isQuote && !apiKey) || (!isQuote && !url)) continue;
          try {
            if (isQuote) {
              await this.deliverQuote(tx, m.payload);
            } else {
              const { body, headers } = buildDelivery(m, secret);
              const res = await fetch(url!, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
            }
            await tx.integrationMessage.update({ where: { id: m.id }, data: { status: 'DELIVERED', processedAt: new Date(), attempts: m.attempts + 1, lastError: null, nextAttemptAt: null } });
            summary.delivered++;
          } catch (e) {
            const attempts = m.attempts + 1;
            const error = (e as Error).message.slice(0, 300);
            if (attempts >= MAX_ATTEMPTS || e instanceof PermanentDeliveryError) {
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
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  async status() {
    const rows = await this.prisma.integrationMessage.groupBy({ by: ['direction', 'status'], _count: { _all: true } });
    const oldest = await this.prisma.integrationMessage.findFirst({ where: { direction: 'OUTBOUND', status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      configured: !!this.config.get('AXIS_EVENTS_URL'),
      quotesConfigured: !!this.config.get('AXIS_API_KEY'),
      counts: rows.map((r) => ({ direction: r.direction, status: r.status, count: r._count._all })),
      oldestPendingAt: oldest?.createdAt.toISOString() ?? null,
    };
  }

  /** Recoloca uma mensagem da dead-letter na fila, depois de o problema ser tratado. */
  async retry(id: string) {
    const m = await this.prisma.integrationMessage.findUnique({ where: { id } });
    if (!m || m.direction !== 'OUTBOUND') throw new NotFoundException('Mensagem de saída não encontrada.');
    if (m.status !== 'FAILED') return m;
    return this.prisma.integrationMessage.update({ where: { id }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: null } });
  }
}
