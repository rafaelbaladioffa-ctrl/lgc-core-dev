import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { IntegrationInbox, InboxStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { InboundEvent } from './inbound-handler.js';
import { InboundHandlerRegistry } from './inbound-handler.registry.js';

export interface InboundResult {
  /** `processed` → 200; `ignored` (sem handler) → 202. */
  status: Exclude<InboxStatus, 'failed'>;
  eventId: string;
  duplicate: boolean;
}

const MAX_ERROR_LENGTH = 500;

type Headers = Record<string, string | string[] | undefined>;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function asDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Normaliza o envelope `{event_id, event_type, occurred_at, correlation_id, source, payload}` enviado
 * pelos outbox dos satélites. `Idempotency-Key`/`X-Event-Id` valem quando o corpo não traz `event_id`.
 */
export function parseEnvelope(body: unknown, headers: Headers) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('Corpo deve ser um objeto JSON.');
  }
  const envelope = body as Record<string, unknown>;
  const header = (name: string) => {
    const value = headers[name];
    return asString(Array.isArray(value) ? value[0] : value);
  };
  const headerKey = header('idempotency-key') ?? header('x-event-id');
  const bodyEventId = asString(envelope.event_id);
  const eventId = bodyEventId ?? headerKey;
  if (!eventId) throw new BadRequestException('event_id ausente (corpo ou Idempotency-Key).');
  if (bodyEventId && headerKey && bodyEventId !== headerKey) {
    throw new BadRequestException('Idempotency-Key difere do event_id do corpo.');
  }
  const eventType = asString(envelope.event_type);
  if (!eventType) throw new BadRequestException('event_type ausente.');
  const payload = envelope.payload ?? {};
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new BadRequestException('payload deve ser um objeto.');
  }
  return {
    eventId,
    eventType,
    occurredAt: asDate(envelope.occurred_at),
    correlationId: asString(envelope.correlation_id),
    payload: payload as Record<string, unknown>,
  };
}

/**
 * Caixa de entrada dos eventos dos satélites (docs/arquitetura.md §6). Deduplica por
 * `(satellite_id, event_id)`, despacha para o handler do `event_type` na mesma transação que grava a
 * linha da inbox e guarda o desfecho (`processed|ignored|failed`).
 *
 * - repetido já `processed`/`ignored`: devolve o mesmo resultado, sem reprocessar;
 * - repetido `failed`: reprocessa (é o reenvio que o 5xx pediu) e atualiza a mesma linha;
 * - sem handler: grava `ignored` e responde 202;
 * - handler lança: desfaz o efeito de negócio, grava `failed` com a mensagem e responde 500.
 */
@Injectable()
export class InboundEventsService {
  private readonly logger = new Logger(InboundEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: InboundHandlerRegistry,
  ) {}

  async receive(satellite: { id: string; name: string }, body: unknown, headers: Headers): Promise<InboundResult> {
    // Só id e nome chegam aos handlers: a linha do satélite carrega o hash da API key e o segredo cifrado.
    const event: InboundEvent = { satellite: { id: satellite.id, name: satellite.name }, ...parseEnvelope(body, headers) };

    const existing = await this.find(satellite.id, event.eventId);
    if (existing && existing.status !== 'failed') return this.duplicateResult(existing);

    const handler = this.registry.get(event.eventType);
    if (!handler) return this.record(existing, event, 'ignored', null);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await handler.handle(tx, event);
        return this.record(existing, event, 'processed', null, tx);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        // Outra entrega do mesmo evento gravou primeiro; o efeito desta tentativa foi desfeito.
        const winner = await this.find(satellite.id, event.eventId);
        if (winner && winner.status !== 'failed') return this.duplicateResult(winner);
      }
      const message = ((e as Error)?.message ?? 'Erro desconhecido').slice(0, MAX_ERROR_LENGTH);
      this.logger.error(`Evento ${event.eventType} ${event.eventId} de ${satellite.name} falhou: ${message}`);
      await this.record(existing, event, 'failed', message).catch((err: Error) =>
        this.logger.error(`Não consegui gravar a falha do evento ${event.eventId}: ${err.message}`),
      );
      throw new InternalServerErrorException('Falha ao processar o evento; reenvie.');
    }
  }

  private find(satelliteId: string, eventId: string) {
    return this.prisma.integrationInbox.findUnique({ where: { satelliteId_eventId: { satelliteId, eventId } } });
  }

  private duplicateResult(row: IntegrationInbox): InboundResult {
    return { status: row.status as InboundResult['status'], eventId: row.eventId, duplicate: true };
  }

  /** Cria a linha da inbox ou, se já existia como `failed`, atualiza a mesma linha. */
  private async record(
    existing: IntegrationInbox | null,
    event: InboundEvent,
    status: InboxStatus,
    error: string | null,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<InboundResult> {
    const data = {
      eventType: event.eventType,
      payload: event.payload as Prisma.InputJsonValue,
      status,
      error,
      processedAt: new Date(),
    };
    try {
      if (existing) {
        await tx.integrationInbox.update({ where: { id: existing.id }, data });
      } else {
        await tx.integrationInbox.create({ data: { satelliteId: event.satellite.id, eventId: event.eventId, ...data } });
      }
    } catch (e) {
      // Corrida entre duas entregas do mesmo evento sem handler: a outra já gravou.
      if (status === 'ignored' && isUniqueViolation(e)) return { status: 'ignored', eventId: event.eventId, duplicate: true };
      throw e;
    }
    return { status: status as InboundResult['status'], eventId: event.eventId, duplicate: false };
  }
}
