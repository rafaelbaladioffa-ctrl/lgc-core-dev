import type { Prisma } from '@prisma/client';

/** Evento de satélite já validado (assinatura, envelope) entregue ao handler. */
export interface InboundEvent {
  satellite: { id: string; name: string };
  eventId: string;
  eventType: string;
  occurredAt: Date | null;
  correlationId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Trata um ou mais tipos de evento recebidos de satélites. `handle` roda na MESMA transação que grava a
 * linha da `integration_inbox`: se lançar, o efeito de negócio é desfeito e a mensagem fica `failed`
 * (o satélite recebe 5xx e reenvia). Escritas de negócio que emitem evento usam o `tx` também
 * (AGENTS.md, regra 6).
 */
export interface InboundEventHandler {
  readonly eventTypes: readonly string[];
  handle(tx: Prisma.TransactionClient, event: InboundEvent): Promise<void>;
}

/**
 * Token de injeção da lista de handlers. O módulo começa com a lista vazia (PT-02); os handlers de
 * negócio (PT-09) entram trocando o `useValue: []` por um `useFactory` que injeta cada handler.
 */
export const INBOUND_EVENT_HANDLERS = Symbol('INBOUND_EVENT_HANDLERS');
