import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import type { AddressInfo } from 'net';
import { NotFoundException } from '@nestjs/common';
import { OutboxDispatcherService } from '../../src/integration/outbox-dispatcher.service.js';

// Regras do OutboxDispatcherService (backoff, lote, assinatura, dead-letter, retry) com Prisma mockado e um
// servidor HTTP local fazendo o papel do Axis. O lock advisory e a corrida entre duas instâncias são cobertos
// no e2e (sprint10-edge), porque dependem do Postgres real.

type Msg = {
  id: string; eventId: string; eventType: string; occurredAt: Date; correlationId: string | null; payload: unknown;
  attempts: number; createdAt: Date; status: string; direction: string; nextAttemptAt: Date | null; lastError: string | null;
};

const NOW = new Date('2026-11-01T12:00:00.000Z');
const SECRET = 'segredo-saida-unit';
let seq = 0;
const msg = (over: Partial<Msg> = {}): Msg => {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, eventId: `evt-${seq}`, eventType: 'stock.moved', occurredAt: NOW,
    correlationId: `corr-${seq}`, payload: { n: seq }, attempts: 0, createdAt: new Date(NOW.getTime() + seq), status: 'PENDING',
    direction: 'OUTBOUND', nextAttemptAt: null, lastError: null, ...over,
  };
};

/** Prisma mínimo: $transaction executa o callback com o mesmo tx; $queryRaw devolve o resultado do lock. */
function fakePrisma(due: Msg[], lockOk = true) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const findMany = vi.fn(async () => due);
  const tx = {
    $queryRaw: vi.fn(async () => [{ ok: lockOk }]),
    integrationMessage: {
      findMany,
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { updates.push({ id: where.id, data }); return {}; }),
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async () => null),
      groupBy: vi.fn(async () => []),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)), integrationMessage: tx.integrationMessage };
  return { prisma: prisma as never, findMany, updates, tx };
}

const config = (env: Record<string, string | undefined>) => ({ get: (k: string) => env[k] }) as never;

type Hit = { headers: IncomingHttpHeaders; raw: string };
/** Servidor do "Axis": `respond` decide o status; `hang` não responde (para testar timeout). */
function sink(respond: (hit: Hit) => { status: number } | 'hang' = () => ({ status: 200 })) {
  const hits: Hit[] = [];
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const hit = { headers: req.headers, raw };
      hits.push(hit);
      const r = respond(hit);
      if (r === 'hang') return;
      res.statusCode = r.status;
      res.end('{}');
    });
  });
  return {
    hits,
    start: () => new Promise<string>((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/events`))),
    stop: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

describe('OutboxDispatcherService (unit)', () => {
  let s: ReturnType<typeof sink>;
  let url: string;

  beforeAll(async () => { s = sink(); url = await s.start(); });
  afterAll(async () => { await s.stop(); });
  beforeEach(() => { s.hits.length = 0; });

  const dispatcher = (due: Msg[], env: Record<string, string | undefined> = { AXIS_EVENTS_URL: url, AXIS_OUTBOUND_SECRET: SECRET }, lockOk = true) => {
    const f = fakePrisma(due, lockOk);
    return { ...f, svc: new OutboxDispatcherService(f.prisma, config(env)) };
  };

  describe('backoff e dead-letter', () => {
    // Uma tentativa a mais falhando: 1 min, 5 min, 30 min, 2 h. Na 5ª falha vai para FAILED.
    it.each([
      [0, 60],
      [1, 300],
      [2, 1800],
      [3, 7200],
    ])('falha com %i tentativa(s) prévias agenda a próxima em %i s', async (attempts, seconds) => {
      // O Axis responde 500 para este evento.
      const bad = sink(() => ({ status: 500 }));
      const badUrl = await bad.start();
      try {
        const d = dispatcher([msg({ attempts })], { AXIS_EVENTS_URL: badUrl });
        const r = await d.svc.dispatchOnce(50, NOW);
        expect(r).toMatchObject({ enabled: true, retried: 1, deadLettered: 0, delivered: 0 });
        expect(d.updates[0].data).toMatchObject({ attempts: attempts + 1, lastError: 'HTTP 500' });
        expect(d.updates[0].data.nextAttemptAt).toEqual(new Date(NOW.getTime() + seconds * 1000));
        expect(d.updates[0].data).not.toHaveProperty('status');
      } finally { await bad.stop(); }
    });

    it('a 5ª falha consecutiva vai para dead-letter (FAILED), sem próxima tentativa', async () => {
      const bad = sink(() => ({ status: 503 }));
      const badUrl = await bad.start();
      try {
        const d = dispatcher([msg({ attempts: 4 })], { AXIS_EVENTS_URL: badUrl });
        const r = await d.svc.dispatchOnce(50, NOW);
        expect(r).toMatchObject({ retried: 0, deadLettered: 1 });
        expect(d.updates[0].data).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'HTTP 503', nextAttemptAt: null });
      } finally { await bad.stop(); }
    });

    it('um evento que falha não impede a entrega dos demais do lote', async () => {
      const bad = sink((h) => (h.raw.includes('"n":1') ? { status: 500 } : { status: 200 }));
      const mixedUrl = await bad.start();
      try {
        const first = msg({ payload: { n: 1 } });
        const second = msg({ payload: { n: 2 } });
        const d = dispatcher([first, second], { AXIS_EVENTS_URL: mixedUrl });
        const r = await d.svc.dispatchOnce(50, NOW);
        expect(r).toMatchObject({ delivered: 1, retried: 1 });
        expect(d.updates.find((u) => u.id === second.id)?.data).toMatchObject({ status: 'DELIVERED' });
      } finally { await bad.stop(); }
    });
  });

  describe('lote, ordem e filtro', () => {
    it('busca no máximo 50 mensagens por padrão e respeita o limite informado', async () => {
      const d = dispatcher([]);
      await d.svc.dispatchOnce();
      expect(d.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50 }));
      await d.svc.dispatchOnce(7, NOW);
      expect(d.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 7 }));
    });

    it('consulta só OUTBOUND PENDING com próxima tentativa vencida ou nula, por createdAt crescente', async () => {
      const d = dispatcher([]);
      await d.svc.dispatchOnce(50, NOW);
      expect(d.findMany).toHaveBeenCalledWith({
        where: { direction: 'OUTBOUND', status: 'PENDING', OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: NOW } }] },
        orderBy: { createdAt: 'asc' },
        take: 50,
      });
    });

    it('entrega na ordem recebida (createdAt crescente) e não envia FAILED nem mensagens futuras', async () => {
      const a = msg(), b = msg(), c = msg();
      const d = dispatcher([a, b, c]);
      const r = await d.svc.dispatchOnce(50, NOW);
      expect(r.delivered).toBe(3);
      expect(s.hits.map((h) => JSON.parse(h.raw).event_id)).toEqual([a.eventId, b.eventId, c.eventId]);
    });
  });

  describe('entrega bem-sucedida', () => {
    it('grava DELIVERED, incrementa tentativas e limpa erro e próxima tentativa', async () => {
      const m = msg({ attempts: 2, lastError: 'HTTP 500', nextAttemptAt: NOW });
      const d = dispatcher([m]);
      await d.svc.dispatchOnce(50, NOW);
      expect(d.updates[0].id).toBe(m.id);
      expect(d.updates[0].data).toMatchObject({ status: 'DELIVERED', attempts: 3, lastError: null, nextAttemptAt: null });
      expect(d.updates[0].data.processedAt).toBeInstanceOf(Date);
    });

    it('envia o corpo esperado com source "logistica" e a data em ISO', async () => {
      const m = msg({ correlationId: 'corr-x', payload: { a: 1 } });
      await dispatcher([m]).svc.dispatchOnce(50, NOW);
      const body = JSON.parse(s.hits[0].raw);
      expect(body).toEqual({ event_id: m.eventId, event_type: 'stock.moved', occurred_at: NOW.toISOString(), correlation_id: 'corr-x', source: 'logistica', payload: { a: 1 } });
    });

    it('assina o corpo EXATO enviado com HMAC-SHA256 (X-Logistica-Signature)', async () => {
      await dispatcher([msg()]).svc.dispatchOnce(50, NOW);
      const h = s.hits[0];
      const expected = 'sha256=' + createHmac('sha256', SECRET).update(h.raw).digest('hex');
      expect(h.headers['x-logistica-signature']).toBe(expected);
    });

    it('a assinatura muda se um byte do corpo muda (não é assinatura do objeto reserializado)', async () => {
      await dispatcher([msg({ payload: { v: 'a' } })]).svc.dispatchOnce(50, NOW);
      const h = s.hits[0];
      const tampered = h.raw.replace('"v":"a"', '"v":"b"');
      const sigOfTampered = 'sha256=' + createHmac('sha256', SECRET).update(tampered).digest('hex');
      expect(h.headers['x-logistica-signature']).not.toBe(sigOfTampered);
    });

    it('envia Idempotency-Key e X-Event-Id iguais ao event_id', async () => {
      const m = msg();
      await dispatcher([m]).svc.dispatchOnce(50, NOW);
      expect(s.hits[0].headers['idempotency-key']).toBe(m.eventId);
      expect(s.hits[0].headers['x-event-id']).toBe(m.eventId);
      expect(s.hits[0].headers['content-type']).toContain('application/json');
    });

    it('sem AXIS_OUTBOUND_SECRET não envia assinatura (mas mantém a Idempotency-Key)', async () => {
      const m = msg();
      await dispatcher([m], { AXIS_EVENTS_URL: url }).svc.dispatchOnce(50, NOW);
      expect(s.hits[0].headers['x-logistica-signature']).toBeUndefined();
      expect(s.hits[0].headers['idempotency-key']).toBe(m.eventId);
    });
  });

  describe('falhas de transporte', () => {
    it('resposta 4xx conta como falha e fica com o erro HTTP registrado', async () => {
      const bad = sink(() => ({ status: 422 }));
      const u = await bad.start();
      try {
        const m = msg();
        const d = dispatcher([m], { AXIS_EVENTS_URL: u });
        const r = await d.svc.dispatchOnce(50, NOW);
        expect(r.retried).toBe(1);
        expect(d.updates[0].data).toMatchObject({ attempts: 1, lastError: 'HTTP 422' });
      } finally { await bad.stop(); }
    });

    it('timeout (Axis não responde) conta como falha e não trava o ciclo além de 10 s', async () => {
      const silent = sink(() => 'hang');
      const u = await silent.start();
      try {
        const d = dispatcher([msg()], { AXIS_EVENTS_URL: u });
        const t0 = Date.now();
        const r = await d.svc.dispatchOnce(50, NOW);
        const took = Date.now() - t0;
        expect(r.retried).toBe(1);
        expect(d.updates[0].data.lastError).toMatch(/timeout|aborted/i);
        expect(took).toBeGreaterThanOrEqual(9_000);
        expect(took).toBeLessThan(20_000);
      } finally { await silent.stop(); }
    }, 30_000);

    it('erro de conexão (porta fechada) registra a falha sem derrubar o ciclo', async () => {
      const probe = sink();
      const closedUrl = await probe.start();
      await probe.stop();
      const d = dispatcher([msg()], { AXIS_EVENTS_URL: closedUrl });
      const r = await d.svc.dispatchOnce(50, NOW);
      expect(r.retried).toBe(1);
      expect(d.updates[0].data.lastError).toBeTruthy();
    });
  });

  describe('sem configuração e lock', () => {
    it('sem AXIS_EVENTS_URL não consulta nem envia nada', async () => {
      const d = dispatcher([msg()], { AXIS_OUTBOUND_SECRET: SECRET });
      const r = await d.svc.dispatchOnce(50, NOW);
      expect(r).toEqual({ enabled: false, delivered: 0, retried: 0, deadLettered: 0 });
      expect(d.findMany).not.toHaveBeenCalled();
      expect(s.hits).toHaveLength(0);
    });

    it('se o lock advisory não é obtido, pula o ciclo sem consultar mensagens', async () => {
      const d = dispatcher([msg()], undefined, false);
      const r = await d.svc.dispatchOnce(50, NOW);
      expect(r).toMatchObject({ skippedLock: true, delivered: 0 });
      expect(d.findMany).not.toHaveBeenCalled();
      expect(s.hits).toHaveLength(0);
    });
  });

  describe('retry e status', () => {
    const svcWith = (row: Partial<Msg> | null) => {
      const f = fakePrisma([]);
      (f.prisma as unknown as { integrationMessage: { findUnique: ReturnType<typeof vi.fn> } }).integrationMessage.findUnique = vi.fn(async () => row);
      const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
      (f.prisma as unknown as { integrationMessage: { update: typeof update } }).integrationMessage.update = update;
      return { svc: new OutboxDispatcherService(f.prisma, config({})), update };
    };

    it('retry de mensagem FAILED recoloca em PENDING com tentativas zeradas', async () => {
      const { svc, update } = svcWith({ direction: 'OUTBOUND', status: 'FAILED', attempts: 5, lastError: 'HTTP 500' });
      await svc.retry('00000000-0000-4000-8000-000000000001');
      expect(update).toHaveBeenCalledWith({ where: { id: '00000000-0000-4000-8000-000000000001' }, data: { status: 'PENDING', attempts: 0, lastError: null, nextAttemptAt: null } });
    });

    it('retry de mensagem que não está FAILED não altera nada (devolve a própria linha)', async () => {
      const row = { id: 'x', direction: 'OUTBOUND', status: 'PENDING', attempts: 1 };
      const { svc, update } = svcWith(row);
      await expect(svc.retry('x')).resolves.toBe(row);
      expect(update).not.toHaveBeenCalled();
    });

    it('retry de mensagem de entrada (INBOUND) ou inexistente é 404', async () => {
      await expect(svcWith({ direction: 'INBOUND', status: 'FAILED' }).svc.retry('x')).rejects.toBeInstanceOf(NotFoundException);
      await expect(svcWith(null).svc.retry('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('status() informa configurado, contagens e a pendência mais antiga', async () => {
      const oldest = new Date('2026-10-30T00:00:00.000Z');
      const f = fakePrisma([]);
      const im = f.prisma as unknown as { integrationMessage: Record<string, ReturnType<typeof vi.fn>> };
      im.integrationMessage.groupBy = vi.fn(async () => [{ direction: 'OUTBOUND', status: 'PENDING', _count: { _all: 3 } }]);
      im.integrationMessage.findFirst = vi.fn(async () => ({ createdAt: oldest }));
      const st = await new OutboxDispatcherService(f.prisma, config({ AXIS_EVENTS_URL: url })).status();
      expect(st).toEqual({ configured: true, counts: [{ direction: 'OUTBOUND', status: 'PENDING', count: 3 }], oldestPendingAt: oldest.toISOString() });
    });

    it('status() sem pendências devolve oldestPendingAt nulo e configured falso sem URL', async () => {
      const st = await new OutboxDispatcherService(fakePrisma([]).prisma, config({})).status();
      expect(st).toMatchObject({ configured: false, counts: [], oldestPendingAt: null });
    });
  });
});
