import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { buildDelivery, OutboxDispatcherService } from './outbox-dispatcher.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { corsOrigins } from '../common/cors.js';

const message = { eventId: 'e1', eventType: 'payable.paid', occurredAt: new Date('2026-11-07T12:00:00Z'), correlationId: null, payload: { payable_id: 'p1' } };

describe('buildDelivery', () => {
  it('assina o corpo exato enviado e usa o event_id como chave de idempotência', () => {
    const { body, headers } = buildDelivery(message, 'segredo');
    expect(JSON.parse(body)).toEqual({ event_id: 'e1', event_type: 'payable.paid', occurred_at: '2026-11-07T12:00:00.000Z', correlation_id: null, source: 'financeiro', payload: { payable_id: 'p1' } });
    expect(headers['Idempotency-Key']).toBe('e1');
    expect(headers['X-Financeiro-Signature']).toBe(`sha256=${createHmac('sha256', 'segredo').update(body).digest('hex')}`);
  });

  it('sem segredo, não envia assinatura', () => {
    expect(buildDelivery(message, undefined).headers['X-Financeiro-Signature']).toBeUndefined();
  });
});

describe('OutboxDispatcherService', () => {
  it('sem AXIS_EVENTS_URL não toca no banco e mantém os eventos pendentes', async () => {
    const prisma = { $transaction: vi.fn() };
    const dispatcher = new OutboxDispatcherService(prisma as unknown as PrismaService, { get: () => undefined } as unknown as ConfigService);
    await expect(dispatcher.dispatchOnce()).resolves.toEqual({ enabled: false, delivered: 0, retried: 0, deadLettered: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('corsOrigins', () => {
  it('separa por vírgula e descarta vazios', () => {
    expect(corsOrigins(' http://a.lgc , ,http://b.lgc')).toEqual(['http://a.lgc', 'http://b.lgc']);
    expect(corsOrigins(undefined)).toEqual([]);
  });
});
