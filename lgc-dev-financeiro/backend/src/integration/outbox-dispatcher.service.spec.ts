import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { buildDelivery, OutboxDispatcherService, PermanentDeliveryError } from './outbox-dispatcher.service.js';
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

describe('situação do orçamento do CC para o Core', () => {
  const cfg = { get: (k: string) => ({ AXIS_API_URL: 'http://core/api/v1/', AXIS_API_KEY: 'chave' })[k] } as unknown as ConfigService;
  const payload = { cost_center_id: 'cc-1', year: 2026, budget: '1000.00', committed: '0.00', realized: '850.00', percent: 85, status: 'alerta', computed_at: '2026-11-08T12:00:00Z' };

  it('faz PUT no CC com a API key e sem o id no corpo', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await new OutboxDispatcherService({} as PrismaService, cfg).deliverBudgetStatus(payload, fetchFn);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('http://core/api/v1/integration/cost-centers/cc-1/budget-status');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer chave');
    expect(JSON.parse(init.body)).toEqual({ year: 2026, budget: '1000.00', committed: '0.00', realized: '850.00', percent: 85, status: 'alerta', computed_at: '2026-11-08T12:00:00Z' });
  });

  it('404 é definitivo; 503 tenta de novo', async () => {
    const d = new OutboxDispatcherService({} as PrismaService, cfg);
    await expect(d.deliverBudgetStatus(payload, vi.fn().mockResolvedValue(new Response('x', { status: 404 })))).rejects.toBeInstanceOf(PermanentDeliveryError);
    const err = await d.deliverBudgetStatus(payload, vi.fn().mockResolvedValue(new Response('x', { status: 503 }))).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(PermanentDeliveryError);
  });
});

describe('corsOrigins', () => {
  it('separa por vírgula e descarta vazios', () => {
    expect(corsOrigins(' http://a.lgc , ,http://b.lgc')).toEqual(['http://a.lgc', 'http://b.lgc']);
    expect(corsOrigins(undefined)).toEqual([]);
  });
});
