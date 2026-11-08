import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service.js';
import { SatelliteInboundGuard } from '../guards/satellite-inbound.guard.js';
import { SatelliteThrottlerGuard } from '../guards/satellite-throttler.guard.js';
import { InboundEventsController } from './inbound-events.controller.js';
import { InboundEventsService } from './inbound-events.service.js';
import { InboundHandlerRegistry } from './inbound-handler.registry.js';
import { INBOUND_EVENT_HANDLERS, type InboundEvent, type InboundEventHandler } from './inbound-handler.js';

/**
 * Receptor de eventos dos satélites ponta a ponta no HTTP (guard + controller + serviço), com Prisma
 * simulado em memória. As mensagens são montadas EXATAMENTE como os outbox dos satélites montam:
 * `lgc-dev-logistica/backend/src/integration/outbox-dispatcher.service.ts` (`send`) e
 * `lgc-dev-financeiro/backend/src/integration/outbox-dispatcher.service.ts` (`buildDelivery`).
 */

const ENCRYPTION_KEY = 'a'.repeat(64);
const fieldEncryption = new FieldEncryptionService({ get: () => ENCRYPTION_KEY } as never);

interface TestSatellite {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  hmacSecret: string;
  apiKey: string;
  apiKeyHash: string;
  hmacSecretEnc: string;
}

async function makeSatellite(name: string): Promise<TestSatellite> {
  const hmacSecret = `segredo-${name}-${randomUUID()}`;
  const apiKey = `axis_sat_${randomUUID()}`;
  return {
    id: `sat-${name}`,
    name,
    status: 'active',
    hmacSecret,
    apiKey,
    apiKeyHash: await bcrypt.hash(apiKey, 4),
    hmacSecretEnc: fieldEncryption.encrypt(hmacSecret),
  };
}

const sign = (secret: string, body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** Outbox da Logística (`send`): corpo JSON, `Idempotency-Key`, `X-Event-Id`, `X-Logistica-Signature`. */
function logisticaDelivery(secret: string, eventId: string, eventType: string, payload: unknown) {
  const body = JSON.stringify({ event_id: eventId, event_type: eventType, occurred_at: new Date('2026-11-08T12:00:00Z').toISOString(), correlation_id: null, source: 'logistica', payload });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': eventId, 'X-Event-Id': eventId };
  headers['X-Logistica-Signature'] = sign(secret, body);
  return { body, headers };
}

/** Outbox do Financeiro (`buildDelivery`): igual, com `source: 'financeiro'` e `X-Financeiro-Signature`. */
function financeiroDelivery(secret: string, eventId: string, eventType: string, payload: unknown) {
  const body = JSON.stringify({ event_id: eventId, event_type: eventType, occurred_at: new Date('2026-11-08T12:00:00Z').toISOString(), correlation_id: 'corr-1', source: 'financeiro', payload });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Idempotency-Key': eventId, 'X-Event-Id': eventId };
  headers['X-Financeiro-Signature'] = sign(secret, body);
  return { body, headers };
}

/** Prisma simulado: satélites e `integration_inbox` em memória, com a chave única (satélite, evento). */
function fakePrisma(satellites: TestSatellite[]) {
  const inbox = new Map<string, Record<string, any>>();
  const key = (satelliteId: string, eventId: string) => `${satelliteId}|${eventId}`;
  const prisma: any = {
    integrationSatellite: { findMany: vi.fn().mockImplementation(() => Promise.resolve(satellites.filter((s) => s.status === 'active'))) },
    integrationInbox: {
      findUnique: vi.fn().mockImplementation(({ where }) => {
        const { satelliteId, eventId } = where.satelliteId_eventId;
        return Promise.resolve(inbox.get(key(satelliteId, eventId)) ?? null);
      }),
      create: vi.fn().mockImplementation(({ data }) => {
        const row = { id: randomUUID(), receivedAt: new Date(), ...data };
        inbox.set(key(data.satelliteId, data.eventId), row);
        return Promise.resolve(row);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        const row = [...inbox.values()].find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return Promise.resolve(row);
      }),
    },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma, inbox };
}

async function buildApp(satellites: TestSatellite[], handlers: InboundEventHandler[]) {
  const { prisma, inbox } = fakePrisma(satellites);
  const moduleRef = await Test.createTestingModule({
    controllers: [InboundEventsController],
    providers: [
      SatelliteInboundGuard,
      InboundEventsService,
      InboundHandlerRegistry,
      { provide: INBOUND_EVENT_HANDLERS, useValue: handlers },
      { provide: PrismaService, useValue: prisma },
      { provide: FieldEncryptionService, useValue: fieldEncryption },
    ],
  })
    .overrideGuard(SatelliteThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  return { app, prisma, inbox };
}

const post = (app: INestApplication, { body, headers }: { body: string; headers: Record<string, string> }) =>
  request(app.getHttpServer()).post('/integration/inbound').set(headers).send(body);

describe('POST /integration/inbound — receptor de eventos dos satélites', () => {
  let logistica: TestSatellite;
  let financeiro: TestSatellite;
  let app: INestApplication;
  let inbox: Map<string, Record<string, any>>;
  let handle: ReturnType<typeof vi.fn>;

  async function start(handlers: InboundEventHandler[] = []) {
    const built = await buildApp([logistica, financeiro], handlers);
    app = built.app;
    inbox = built.inbox;
  }

  beforeEach(async () => {
    logistica = await makeSatellite('logistica');
    financeiro = await makeSatellite('financeiro');
    handle = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await app?.close();
  });

  const handlerFor = (...eventTypes: string[]): InboundEventHandler => ({
    eventTypes,
    handle: (tx, event: InboundEvent) => handle(tx, event),
  });

  describe('autenticação', () => {
    it('assinatura errada → 401, nada gravado e handler não chamado', async () => {
      await start([handlerFor('receipt.divergent')]);
      const msg = logisticaDelivery('outro-segredo', 'ev-1', 'receipt.divergent', { receipt_id: 'r1' });
      const res = await post(app, msg);
      expect(res.status).toBe(401);
      expect(inbox.size).toBe(0);
      expect(handle).not.toHaveBeenCalled();
    });

    it('sem assinatura → 401', async () => {
      await start();
      const { body, headers } = logisticaDelivery(logistica.hmacSecret, 'ev-1', 'alert.raised', {});
      delete headers['X-Logistica-Signature'];
      expect((await post(app, { body, headers })).status).toBe(401);
    });

    it('corpo adulterado depois de assinado → 401', async () => {
      await start();
      const { body, headers } = logisticaDelivery(logistica.hmacSecret, 'ev-1', 'alert.raised', { qtd: 1 });
      expect((await post(app, { body: body.replace('"qtd":1', '"qtd":2'), headers })).status).toBe(401);
    });

    it('assinatura que não é hex de SHA-256 → 401', async () => {
      await start();
      const { body, headers } = logisticaDelivery(logistica.hmacSecret, 'ev-1', 'alert.raised', {});
      headers['X-Logistica-Signature'] = 'sha256=nao-e-hex';
      expect((await post(app, { body, headers })).status).toBe(401);
    });

    it('API key inválida → 401, mesmo com assinatura correta', async () => {
      await start();
      const { body, headers } = logisticaDelivery(logistica.hmacSecret, 'ev-1', 'alert.raised', {});
      expect((await post(app, { body, headers: { ...headers, Authorization: 'Bearer axis_sat_errada' } })).status).toBe(401);
    });

    it('API key de um satélite com a assinatura de outro → 401', async () => {
      await start();
      const { body, headers } = financeiroDelivery(financeiro.hmacSecret, 'ev-1', 'payable.paid', {});
      expect((await post(app, { body, headers: { ...headers, Authorization: `Bearer ${logistica.apiKey}` } })).status).toBe(401);
    });

    it('satélite inativo → 401', async () => {
      await start();
      logistica.status = 'inactive';
      const { body, headers } = logisticaDelivery(logistica.hmacSecret, 'ev-1', 'alert.raised', {});
      expect((await post(app, { body, headers })).status).toBe(401);
    });
  });

  describe('formato real dos satélites', () => {
    it('mensagem do outbox da Logística é aceita e identifica o satélite', async () => {
      await start([handlerFor('shipment.dispatched')]);
      const res = await post(app, logisticaDelivery(logistica.hmacSecret, 'ev-log-1', 'shipment.dispatched', { order_code: 'OF-1' }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'processed', event_id: 'ev-log-1', duplicate: false });
      const event = handle.mock.calls[0][1] as InboundEvent;
      expect(event.satellite).toEqual({ id: logistica.id, name: 'logistica' });
      expect(event.eventType).toBe('shipment.dispatched');
      expect(event.payload).toEqual({ order_code: 'OF-1' });
      expect(event.occurredAt?.toISOString()).toBe('2026-11-08T12:00:00.000Z');
    });

    it('mensagem do outbox do Financeiro é aceita (sem handler → 202 ignorada)', async () => {
      await start();
      const res = await post(app, financeiroDelivery(financeiro.hmacSecret, 'ev-fin-1', 'payable.paid', { payable_id: 'p1' }));
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ status: 'ignored', event_id: 'ev-fin-1', duplicate: false });
      const row = [...inbox.values()][0];
      expect(row).toMatchObject({ satelliteId: financeiro.id, eventId: 'ev-fin-1', eventType: 'payable.paid', status: 'ignored', payload: { payable_id: 'p1' } });
    });

    it('aceita X-Field-Signature e a API key correta junto com a assinatura', async () => {
      const field = await makeSatellite('field');
      const built = await buildApp([logistica, financeiro, field], [handlerFor('field.project.created')]);
      app = built.app;
      const { body, headers } = logisticaDelivery(field.hmacSecret, 'ev-field-1', 'field.project.created', { field_project_id: 7 });
      delete headers['X-Logistica-Signature'];
      headers['X-Field-Signature'] = sign(field.hmacSecret, body);
      headers.Authorization = `Bearer ${field.apiKey}`;
      const res = await post(app, { body, headers });
      expect(res.status).toBe(200);
      expect((handle.mock.calls[0][1] as InboundEvent).satellite).toEqual({ id: field.id, name: 'field' });
    });

    it('sem event_id no corpo usa o Idempotency-Key', async () => {
      await start();
      const body = JSON.stringify({ event_type: 'alert.raised', payload: {} });
      const headers = { 'Content-Type': 'application/json', 'Idempotency-Key': 'so-no-header', 'X-Logistica-Signature': sign(logistica.hmacSecret, body) };
      const res = await post(app, { body, headers });
      expect(res.status).toBe(202);
      expect(res.body.event_id).toBe('so-no-header');
    });

    it('Idempotency-Key diferente do event_id → 400; sem nenhum dos dois → 400; sem event_type → 400', async () => {
      await start();
      const make = (obj: unknown, extra: Record<string, string> = {}) => {
        const body = JSON.stringify(obj);
        return { body, headers: { 'Content-Type': 'application/json', 'X-Logistica-Signature': sign(logistica.hmacSecret, body), ...extra } };
      };
      expect((await post(app, make({ event_id: 'a', event_type: 'x', payload: {} }, { 'Idempotency-Key': 'b' }))).status).toBe(400);
      expect((await post(app, make({ event_type: 'x', payload: {} }))).status).toBe(400);
      expect((await post(app, make({ event_id: 'a', payload: {} }))).status).toBe(400);
      expect((await post(app, make({ event_id: 'a', event_type: 'x', payload: [1] }))).status).toBe(400);
    });
  });

  describe('deduplicação', () => {
    it('evento repetido não reprocessa: devolve o mesmo resultado', async () => {
      await start([handlerFor('delivery.confirmed')]);
      const msg = logisticaDelivery(logistica.hmacSecret, 'ev-dup', 'delivery.confirmed', { order_code: 'OF-9' });
      const first = await post(app, msg);
      const second = await post(app, msg);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ status: 'processed', event_id: 'ev-dup', duplicate: true });
      expect(handle).toHaveBeenCalledTimes(1);
      expect(inbox.size).toBe(1);
    });

    it('repetido sem handler continua 202 e não duplica a linha', async () => {
      await start();
      const msg = financeiroDelivery(financeiro.hmacSecret, 'ev-dup-2', 'payable.approved', {});
      expect((await post(app, msg)).status).toBe(202);
      const again = await post(app, msg);
      expect(again.status).toBe(202);
      expect(again.body.duplicate).toBe(true);
      expect(inbox.size).toBe(1);
    });

    it('o mesmo event_id em satélites diferentes são eventos diferentes', async () => {
      await start([handlerFor('x.created')]);
      expect((await post(app, logisticaDelivery(logistica.hmacSecret, 'mesmo-id', 'x.created', {}))).status).toBe(200);
      expect((await post(app, financeiroDelivery(financeiro.hmacSecret, 'mesmo-id', 'x.created', {}))).status).toBe(200);
      expect(handle).toHaveBeenCalledTimes(2);
      expect(inbox.size).toBe(2);
    });
  });

  describe('handlers', () => {
    it('sem handler → 202 e guardado como ignorado, com o payload', async () => {
      await start([handlerFor('outro.evento')]);
      const res = await post(app, logisticaDelivery(logistica.hmacSecret, 'ev-sem', 'receipt.divergent', { a: 1 }));
      expect(res.status).toBe(202);
      const row = [...inbox.values()][0];
      expect(row).toMatchObject({ status: 'ignored', eventType: 'receipt.divergent', payload: { a: 1 }, error: null });
      expect(row.processedAt).toBeInstanceOf(Date);
      expect(handle).not.toHaveBeenCalled();
    });

    it('handler roda na transação que grava a inbox', async () => {
      await start([handlerFor('delivery.confirmed')]);
      const built = await post(app, logisticaDelivery(logistica.hmacSecret, 'ev-tx', 'delivery.confirmed', {}));
      expect(built.status).toBe(200);
      expect(handle).toHaveBeenCalledTimes(1);
      expect([...inbox.values()][0].status).toBe('processed');
    });

    it('handler com erro → 500, linha failed com a mensagem; o reenvio reprocessa e atualiza a mesma linha', async () => {
      await start([handlerFor('delivery.refused')]);
      handle.mockRejectedValueOnce(new Error('requisição não encontrada'));
      const msg = logisticaDelivery(logistica.hmacSecret, 'ev-falha', 'delivery.refused', { order_code: 'OF-2' });

      const first = await post(app, msg);
      expect(first.status).toBe(500);
      expect(inbox.size).toBe(1);
      const row = [...inbox.values()][0];
      expect(row).toMatchObject({ status: 'failed', error: 'requisição não encontrada' });
      const rowId = row.id;

      const retry = await post(app, msg);
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual({ status: 'processed', event_id: 'ev-falha', duplicate: false });
      expect(handle).toHaveBeenCalledTimes(2);
      expect(inbox.size).toBe(1);
      expect([...inbox.values()][0]).toMatchObject({ id: rowId, status: 'processed', error: null });
    });

    it('registro com dois handlers para o mesmo tipo falha na criação', () => {
      expect(() => new InboundHandlerRegistry([handlerFor('a'), handlerFor('a')])).toThrow(/Mais de um handler/);
    });
  });
});
