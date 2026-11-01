import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OutboxDispatcherService } from '../src/integration/outbox-dispatcher.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';

// Bordas do Sprint 10 contra o banco real: lock do outbox, backoff persistido, dead-letter ponta a ponta,
// reconciliação por tipo (divergência criada direto no banco), idempotência, fechamento automático,
// resolução manual, trilha de auditoria (correlação, falhas, sensíveis, concorrência) e filtros/paginação.
// O banco é compartilhado: todo fixture tem sufixo único, eventType com prefixo "s10e." e filtra pelos próprios ids.
// Mensagens do outbox usam createdAt = 1970 para ficarem na frente da fila; assim dispatchOnce(1) entrega só as nossas.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EPOCH = new Date(0);

type Hit = { body: { event_id: string; event_type: string; source: string; correlation_id: string | null }; headers: IncomingHttpHeaders; raw: string };

describe('Sprint 10 (bordas) — hardening', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let disp: OutboxDispatcherService;
  let rec: ReconciliationService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s10e');
  const admin = tokenFor(['admin'], 'admin-s10e');
  const colab = tokenFor(['colaborador'], `emp10e-${sfx}`);
  const tec = tokenFor(['tecnico'], `tec10e-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const corr = (n: string) => `s10e-${sfx}-${n}`;

  let un: string, whCode: string, prat: string;

  // Servidor que faz o papel do Axis: `mode` controla a resposta a cada teste.
  let mode: { status: number; delayMs: number } = { status: 200, delayMs: 0 };
  const hits: Hit[] = [];
  let sinkServer: Server;
  let sinkUrl: string;

  const mkMat = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S10E-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: prat, reason: 'Carga de teste' }).expect(201);
  /** Material novo com 10 unidades no almoxarifado de teste: base para cada divergência. */
  const fresh = async (s: string) => {
    const materialId = await mkMat(s);
    await stockIn(materialId, 10);
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { materialId, locationId: prat } });
    return { materialId, bal };
  };
  const orderFor = async (materialId: string, qty = 4) => {
    const materialCode = (await prisma.material.findUniqueOrThrow({ where: { id: materialId } })).code;
    return (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S10E-${randomUUID()}`, warehouseCode: whCode, items: [{ materialCode, quantity: qty }] }).expect(201)).body as { id: string; status: string };
  };
  const runRec = () => api().post('/api/v1/reconciliation/run').set(A(admin)).send({}).expect(200);
  const openIssues = (refId: string) => prisma.reconciliationIssue.findMany({ where: { refId, status: 'ABERTA' } });
  const sendMsg = (over: Partial<{ status: 'PENDING' | 'FAILED' | 'DELIVERED'; attempts: number; eventType: string; lastError: string | null }> = {}) =>
    prisma.integrationMessage.create({
      data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType: over.eventType ?? 's10e.evento', occurredAt: new Date(), status: over.status ?? 'PENDING', attempts: over.attempts ?? 0, lastError: over.lastError ?? null, payload: { k: sfx }, createdAt: EPOCH },
    });
  const auditOf = (correlationId: string) => prisma.auditEvent.findMany({ where: { correlationId } });
  /** A trilha é gravada em segundo plano após a resposta: espera até `n` linhas aparecerem (ou estoura o prazo). */
  const waitAudit = async (correlationId: string, n: number, action?: string) => {
    const until = Date.now() + 10_000;
    for (;;) {
      const rows = await prisma.auditEvent.findMany({ where: { correlationId, ...(action && { action }) } });
      if (rows.length >= n || Date.now() > until) return rows;
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    sinkServer = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        hits.push({ body: JSON.parse(raw), headers: req.headers, raw });
        setTimeout(() => { res.statusCode = mode.status; res.end('{}'); }, mode.delayMs);
      });
    });
    await new Promise<void>((r) => sinkServer.listen(0, '127.0.0.1', () => r()));
    sinkUrl = `http://127.0.0.1:${(sinkServer.address() as AddressInfo).port}/events`;

    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    disp = app.get(OutboxDispatcherService);
    rec = app.get(ReconciliationService);

    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S10E-${sfx}`;
    const wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 10 bordas', type: 'CENTRAL' }).expect(201)).body.id;
    prat = (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code: 'PRAT', level: 'AREA' }).expect(201)).body.id;
    await api().put(`/api/v1/rbac/users/tec10e-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });

  afterAll(async () => {
    delete process.env.AXIS_EVENTS_URL;
    delete process.env.AXIS_OUTBOUND_SECRET;
    await new Promise<void>((r) => { sinkServer.closeAllConnections(); sinkServer.close(() => r()); });
    await app.close();
  });

  beforeEach(async () => {
    // Sobras de testes anteriores deste arquivo saem da fila (não são enviadas depois).
    await prisma.integrationMessage.updateMany({ where: { eventType: { startsWith: 's10e.' }, status: 'PENDING' }, data: { status: 'FAILED', lastError: 'limpeza de teste' } });
    hits.length = 0;
    mode = { status: 200, delayMs: 0 };
    process.env.AXIS_EVENTS_URL = sinkUrl;
    process.env.AXIS_OUTBOUND_SECRET = 'segredo-s10e';
  });

  describe('outbox — lock, backoff e dead-letter', () => {
    it('duas execuções simultâneas do ciclo não enviam o mesmo evento duas vezes (lock advisory)', async () => {
      const m = await sendMsg({ eventType: 's10e.lock' });
      mode = { status: 200, delayMs: 1_500 }; // a 1ª transação fica aberta enquanto a 2ª tenta o lock
      const [a, b] = await Promise.all([disp.dispatchOnce(1), disp.dispatchOnce(1)]);
      expect(hits.filter((h) => h.body.event_id === m.eventId)).toHaveLength(1);
      expect([a, b].filter((s) => s.delivered === 1)).toHaveLength(1);
      expect([a, b].filter((s) => s.skippedLock === true)).toHaveLength(1);
      expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('DELIVERED');
    }, 30_000);

    it('primeira falha (HTTP 500) agenda a próxima tentativa para +60 s, gravada no banco', async () => {
      const m = await sendMsg({ eventType: 's10e.backoff' });
      mode = { status: 500, delayMs: 0 };
      const now = new Date();
      await disp.dispatchOnce(1, now);
      const row = await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } });
      expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'HTTP 500' });
      expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000);
    });

    it('mensagem com próxima tentativa no futuro não é enviada antes do horário', async () => {
      const m = await sendMsg({ eventType: 's10e.futuro' });
      await prisma.integrationMessage.update({ where: { id: m.id }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
      await disp.dispatchOnce(1); // a fila pode trazer mensagens de outros testes; só importa a nossa
      expect(hits.some((h) => h.body.event_id === m.eventId)).toBe(false);
      expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('PENDING');
    });

    it('a 5ª falha consecutiva vai para dead-letter e aparece na reconciliação como OUTBOX_DEAD_LETTER', async () => {
      const m = await sendMsg({ eventType: 's10e.dlq', attempts: 4 });
      mode = { status: 503, delayMs: 0 };
      const r = await disp.dispatchOnce(1);
      expect(r.deadLettered).toBe(1);
      expect(await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'FAILED', attempts: 5, lastError: 'HTTP 503', nextAttemptAt: null });
      await runRec();
      const issue = (await openIssues(m.id)).find((i) => i.kind === 'OUTBOX_DEAD_LETTER');
      expect(issue).toMatchObject({ severity: 'CRITICO', refType: 'integration_message' });
      expect(issue?.details).toMatchObject({ eventType: 's10e.dlq', attempts: 5, lastError: 'HTTP 503' });
    });

    it('retry pelo endpoint devolve a mensagem FAILED para a fila e ela é entregue na sequência', async () => {
      const m = await sendMsg({ eventType: 's10e.retry', status: 'FAILED', attempts: 5, lastError: 'HTTP 500' });
      const out = await api().post(`/api/v1/integration/outbox/${m.id}/retry`).set(A(admin)).send({}).expect(200);
      expect(out.body).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null });
      await disp.dispatchOnce(1);
      expect(hits.filter((h) => h.body.event_id === m.eventId)).toHaveLength(1);
      expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('DELIVERED');
    });

    it('retry de mensagem que não está FAILED não mexe nela', async () => {
      const m = await sendMsg({ eventType: 's10e.retry-ok', status: 'DELIVERED', attempts: 1 });
      await api().post(`/api/v1/integration/outbox/${m.id}/retry`).set(A(admin)).send({}).expect(200);
      expect(await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ status: 'DELIVERED', attempts: 1 });
    });

    it('retry de id inexistente é 404, de id mal formado é 400, e de entrada (INBOUND) é 404', async () => {
      await api().post(`/api/v1/integration/outbox/${randomUUID()}/retry`).set(A(admin)).send({}).expect(404);
      await api().post('/api/v1/integration/outbox/nao-e-uuid/retry').set(A(admin)).send({}).expect(400);
      const inbound = await prisma.integrationMessage.create({ data: { direction: 'INBOUND', eventId: randomUUID(), eventType: 's10e.in', occurredAt: new Date(), status: 'FAILED', payload: {} } });
      await api().post(`/api/v1/integration/outbox/${inbound.id}/retry`).set(A(admin)).send({}).expect(404);
    });

    it('sem AXIS_EVENTS_URL o disparo manual responde enabled:false e não consome a fila', async () => {
      delete process.env.AXIS_EVENTS_URL;
      const m = await sendMsg({ eventType: 's10e.sem-url' });
      const out = await api().post('/api/v1/integration/outbox/dispatch').set(A(admin)).send({}).expect(200);
      expect(out.body).toEqual({ enabled: false, delivered: 0, retried: 0, deadLettered: 0 });
      expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: m.id } })).status).toBe('PENDING');
    });

    it('GET /integration/outbox/status informa configuração e a pendência mais antiga', async () => {
      await sendMsg({ eventType: 's10e.status' });
      const out = await api().get('/api/v1/integration/outbox/status').set(A(admin)).expect(200);
      expect(out.body.configured).toBe(true);
      expect(Array.isArray(out.body.counts)).toBe(true);
      expect(out.body.oldestPendingAt).toBeTruthy();
    });

    it('colaborador não dispara o ciclo (403) e a negação entra na trilha', async () => {
      const c = corr('disp-403');
      await api().post('/api/v1/integration/outbox/dispatch').set(A(colab)).set('X-Correlation-Id', c).send({}).expect(403);
      const rows = await waitAudit(c, 1, 'access.denied');
      expect(rows[0]).toMatchObject({ actorAxisId: `emp10e-${sfx}`, action: 'access.denied' });
    });

    // Aviso: o Axis recebe o corpo e a assinatura; conferido no e2e para o corpo realmente gravado no banco.
    it('a assinatura do corpo entregue confere com HMAC-SHA256 do segredo configurado', async () => {
      const m = await sendMsg({ eventType: 's10e.hmac' });
      await disp.dispatchOnce(1);
      const hit = hits.find((h) => h.body.event_id === m.eventId)!;
      const { createHmac } = await import('crypto');
      expect(hit.headers['x-logistica-signature']).toBe('sha256=' + createHmac('sha256', 'segredo-s10e').update(hit.raw).digest('hex'));
      expect(hit.headers['idempotency-key']).toBe(m.eventId);
    });
  });

  describe('reconciliação — um teste por tipo, criando a divergência direto no banco', () => {
    it('BALANCE_VS_LEDGER: saldo alterado sem movimento vira item CRITICO com os dois valores', async () => {
      const { bal } = await fresh('BVL');
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: { increment: 3 } } });
      await runRec();
      const issue = (await openIssues(bal.id)).find((i) => i.kind === 'BALANCE_VS_LEDGER');
      expect(issue).toMatchObject({ severity: 'CRITICO', refType: 'stock_balance' });
      expect(issue?.details).toMatchObject({ balance: '13', ledger: '10', locationId: prat });
    });

    it('RESERVED_DRIFT: reservado no saldo sem reserva ativa vira item ATENCAO', async () => {
      const { bal } = await fresh('RD');
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { reservedQty: { increment: 2 } } });
      await runRec();
      const issue = (await openIssues(bal.id)).find((i) => i.kind === 'RESERVED_DRIFT');
      expect(issue).toMatchObject({ severity: 'ATENCAO', refType: 'stock_balance' });
      expect(issue?.details).toMatchObject({ reservedOnBalance: '2', activeReservations: '0' });
    });

    it('ORPHAN_RESERVATION: reserva ATIVA de pedido cancelado vira item ATENCAO', async () => {
      const { materialId } = await fresh('ORF');
      const order = await orderFor(materialId, 4);
      const res = await prisma.reservation.findFirstOrThrow({ where: { item: { orderId: order.id } } });
      await prisma.fulfillmentOrder.update({ where: { id: order.id }, data: { status: 'CANCELADA' } });
      await runRec();
      const issue = (await openIssues(res.id)).find((i) => i.kind === 'ORPHAN_RESERVATION');
      expect(issue).toMatchObject({ severity: 'ATENCAO', refType: 'reservation' });
      expect(issue?.details).toMatchObject({ orderStatus: 'CANCELADA' });
    });

    it('DELIVERED_WITHOUT_LEDGER: pedido ENTREGUE sem saída no ledger vira item CRITICO com o código ATD', async () => {
      const { materialId } = await fresh('DWL');
      const order = await orderFor(materialId, 2);
      const seq = (await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: order.id } })).seq;
      await prisma.fulfillmentOrder.update({ where: { id: order.id }, data: { status: 'ENTREGUE' } });
      await runRec();
      const issue = (await openIssues(order.id)).find((i) => i.kind === 'DELIVERED_WITHOUT_LEDGER');
      expect(issue).toMatchObject({ severity: 'CRITICO', refType: 'fulfillment_order' });
      expect(issue?.details).toEqual({ code: `ATD-${String(seq).padStart(8, '0')}` });
    });

    it('OUTBOX_DEAD_LETTER: mensagem FAILED vira item CRITICO', async () => {
      const m = await sendMsg({ eventType: 's10e.dl2', status: 'FAILED', attempts: 5, lastError: 'HTTP 500' });
      await runRec();
      const issue = (await openIssues(m.id)).find((i) => i.kind === 'OUTBOX_DEAD_LETTER');
      expect(issue).toMatchObject({ severity: 'CRITICO', refType: 'integration_message' });
    });

    it('idempotência: rodar de novo não duplica o item nem troca o id, só atualiza lastSeenAt', async () => {
      const { bal } = await fresh('IDEM');
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: { increment: 1 } } });
      await runRec();
      const first = (await openIssues(bal.id)).filter((i) => i.kind === 'BALANCE_VS_LEDGER');
      await new Promise((r) => setTimeout(r, 20));
      await runRec();
      await runRec();
      const again = (await openIssues(bal.id)).filter((i) => i.kind === 'BALANCE_VS_LEDGER');
      expect(again).toHaveLength(1);
      expect(again[0].id).toBe(first[0].id);
      expect(again[0].lastSeenAt.getTime()).toBeGreaterThan(first[0].lastSeenAt.getTime());
    });

    it('fechamento automático: divergência corrigida pelo fluxo normal fecha o item sem intervenção', async () => {
      const { bal } = await fresh('CLOSE');
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: { increment: 2 } } });
      await runRec();
      expect(await openIssues(bal.id)).toHaveLength(1);
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: { decrement: 2 } } });
      await runRec();
      const closed = await prisma.reconciliationIssue.findFirstOrThrow({ where: { refId: bal.id, kind: 'BALANCE_VS_LEDGER' }, orderBy: { detectedAt: 'desc' } });
      expect(closed).toMatchObject({ status: 'RESOLVIDA', resolvedBy: 'sistema' });
      expect(closed.resolution).toContain('não detectada');
    });

    it('a execução do agendador/manual é registrada na auditoria com o ator e os totais', async () => {
      const t0 = new Date();
      await runRec();
      const rows = await prisma.auditEvent.findMany({ where: { action: 'reconciliation.run', actorAxisId: 'admin-s10e', createdAt: { gte: t0 } } });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].diff).toMatchObject({ found: expect.any(Number), created: expect.any(Number), refreshed: expect.any(Number), closed: expect.any(Number) });
    });

    it('resolução manual: registra quem e como, audita, e um segundo resolve dá 409', async () => {
      const { materialId } = await fresh('MAN');
      const order = await orderFor(materialId, 1);
      const res = await prisma.reservation.findFirstOrThrow({ where: { item: { orderId: order.id } } });
      await prisma.fulfillmentOrder.update({ where: { id: order.id }, data: { status: 'CANCELADA' } });
      await runRec();
      const issue = (await openIssues(res.id)).find((i) => i.kind === 'ORPHAN_RESERVATION')!;
      const c = corr('resolve-ok');
      const ok = await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).set('X-Correlation-Id', c).send({ resolution: 'Reserva encerrada pela operação' }).expect(200);
      expect(ok.body).toMatchObject({ status: 'RESOLVIDA', resolvedBy: 'admin-s10e', resolution: 'Reserva encerrada pela operação' });
      expect((await waitAudit(c, 1, 'request.post')).length).toBe(1); // requisição gravada com a correlação
      const audit = await prisma.auditEvent.findMany({ where: { action: 'reconciliation.resolved', aggregateId: issue.id } });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actorAxisId: 'admin-s10e', aggregateType: 'reconciliation_issue' });
      await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).send({ resolution: 'de novo' }).expect(409);
    });

    it('resolução com id inexistente é 404; sem motivo válido é 400', async () => {
      await api().post(`/api/v1/reconciliation/issues/${randomUUID()}/resolve`).set(A(admin)).send({ resolution: 'motivo válido' }).expect(404);
      await api().post(`/api/v1/reconciliation/issues/${randomUUID()}/resolve`).set(A(admin)).send({ resolution: 'ab' }).expect(400);
      await api().post(`/api/v1/reconciliation/issues/${randomUUID()}/resolve`).set(A(admin)).send({}).expect(400);
    });

    it('divergência que ainda existe reabre como novo item depois de resolvida à mão (comportamento esperado)', async () => {
      const { bal } = await fresh('REOPEN');
      await prisma.stockBalance.update({ where: { id: bal.id }, data: { reservedQty: { increment: 1 } } });
      await runRec();
      const issue = (await openIssues(bal.id)).find((i) => i.kind === 'RESERVED_DRIFT')!;
      await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).send({ resolution: 'Vou tratar depois' }).expect(200);
      await runRec();
      const reopened = await openIssues(bal.id);
      expect(reopened.filter((i) => i.kind === 'RESERVED_DRIFT')).toHaveLength(1);
      expect(reopened.find((i) => i.kind === 'RESERVED_DRIFT')!.id).not.toBe(issue.id);
    });

    it('colaborador não executa nem lê a reconciliação (403)', async () => {
      await api().post('/api/v1/reconciliation/run').set(A(colab)).send({}).expect(403);
      await api().get('/api/v1/reconciliation/issues').set(A(colab)).expect(403);
    });

    it.fails('BUG: com mais de 200 divergências a varredura corta em 200 (sem ORDER BY) e encerra os itens que ficaram de fora', async () => {
      // Reprodução: a consulta de saldo reservado tem LIMIT 200 e nenhuma ordem. Com mais de 200 saldos divergentes,
      // a execução só enxerga um subconjunto; o resto deixa de ser "detectado" e cai no fechamento automático.
      const N = 205;
      const codes = Array.from({ length: N }, (_, i) => `S10E-TR-${i}-${sfx}`);
      await prisma.material.createMany({ data: codes.map((code) => ({ code, shortDescription: 'Teste de truncamento', category: 'Teste', type: 'CONSUMO', stockUomId: un, createdBy: 'admin-s10e' })) });
      const mats = await prisma.material.findMany({ where: { code: { in: codes } }, select: { id: true } });
      await prisma.stockBalance.createMany({ data: mats.map((m) => ({ materialId: m.id, locationId: prat, reservedQty: 1 })) });
      const matIds = mats.map((m) => m.id);
      try {
        await runRec();
        await runRec();
        const bals = await prisma.stockBalance.findMany({ where: { materialId: { in: matIds } }, select: { id: true } });
        const open = await prisma.reconciliationIssue.count({ where: { kind: 'RESERVED_DRIFT', status: 'ABERTA', refId: { in: bals.map((b) => b.id) } } });
        expect(open).toBe(N);
      } finally {
        // Zera o reservado dos saldos de teste para não poluir a varredura dos outros testes da suíte.
        await prisma.stockBalance.updateMany({ where: { materialId: { in: matIds } }, data: { reservedQty: 0 } });
        await runRec();
      }
    }, 60_000);

    it.fails('BUG: duas execuções simultâneas (cron + manual) não criam dois itens ABERTA para a mesma divergência', async () => {
      // Reprodução: a divergência é uma mensagem FAILED. Duas chamadas concorrentes leem `open` antes de qualquer insert
      // e ambas criam o item, porque não há unique em (kind, ref_id) nem lock na reconciliação.
      const m = await sendMsg({ eventType: 's10e.race', status: 'FAILED', attempts: 5, lastError: 'HTTP 500' });
      await Promise.all([rec.run('cron'), rec.run('manual')]);
      expect(await openIssues(m.id)).toHaveLength(1);
    });
  });

  describe('auditoria — correlação, falhas, sensíveis, guards e concorrência', () => {
    it('X-Correlation-Id válido é devolvido; inválido, curto ou longo é substituído por UUID', async () => {
      const ok = await api().get('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', corr('hdr-ok')).expect(200);
      expect(ok.headers['x-correlation-id']).toBe(corr('hdr-ok'));
      for (const bad of ['bad id with spaces', 'a'.repeat(81), 'curto']) {
        const r = await api().get('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', bad).expect(200);
        expect(r.headers['x-correlation-id']).toMatch(UUID_RE);
      }
      const edge = await api().get('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', 'a'.repeat(80)).expect(200);
      expect(edge.headers['x-correlation-id']).toBe('a'.repeat(80));
    });

    it('CRLF no cabeçalho nem chega ao servidor: o cliente recusa a requisição', async () => {
      await expect(api().get('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', 'abc\r\nX-Evil: 1')).rejects.toThrow();
    });

    it('mutação com 400 (validação) não gera request.* de sucesso', async () => {
      const c = corr('fail-400');
      await api().post('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', c).send({}).expect(400);
      await new Promise((r) => setTimeout(r, 300));
      expect((await auditOf(c)).filter((r) => r.action.startsWith('request.'))).toHaveLength(0);
    });

    it('mutação com 404 não gera request.* de sucesso', async () => {
      const c = corr('fail-404');
      await api().post(`/api/v1/reconciliation/issues/${randomUUID()}/resolve`).set(A(admin)).set('X-Correlation-Id', c).send({ resolution: 'motivo válido' }).expect(404);
      await new Promise((r) => setTimeout(r, 300));
      expect((await auditOf(c)).filter((r) => r.action.startsWith('request.'))).toHaveLength(0);
    });

    it('mutação com 409 não gera request.* de sucesso; a de sucesso gera (controle)', async () => {
      const m = await sendMsg({ eventType: 's10e.409', status: 'FAILED', attempts: 5 });
      await runRec();
      const issue = (await openIssues(m.id))[0];
      const ok = corr('c409-ok'), conflict = corr('c409-conflict');
      await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).set('X-Correlation-Id', ok).send({ resolution: 'primeira resolução' }).expect(200);
      await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).set('X-Correlation-Id', conflict).send({ resolution: 'segunda' }).expect(409);
      expect((await waitAudit(ok, 1, 'request.post')).length).toBe(1); // controle: o caminho de sucesso grava
      await new Promise((r) => setTimeout(r, 300));
      expect((await auditOf(conflict)).filter((r) => r.action.startsWith('request.'))).toHaveLength(0);
    });

    it('regra de negócio recusada (estoque insuficiente) não gera request.* de sucesso', async () => {
      const materialId = await mkMat('NOSTOCK');
      const c = corr('fail-stock');
      const res = await api().post('/api/v1/stock/movements').set(A(gestor)).set('X-Correlation-Id', c).set('Idempotency-Key', randomUUID())
        .send({ type: 'SAIDA_ENTREGA', materialId, quantity: 999, fromLocationId: prat, reason: 'Teste de saldo' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      await new Promise((r) => setTimeout(r, 300));
      expect((await auditOf(c)).filter((r) => r.action.startsWith('request.'))).toHaveLength(0);
    });

    it('403 do guard (sem permissão na rota) grava access.denied com ator e correlação', async () => {
      const c = corr('guard-403');
      await api().get('/api/v1/audit/events').set(A(colab)).set('X-Correlation-Id', c).expect(403);
      const rows = await waitAudit(c, 1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'access.denied', actorAxisId: `emp10e-${sfx}`, aggregateType: 'audit' });
      expect(rows[0].diff).toMatchObject({ method: 'GET', route: '/api/v1/audit/events', status: 403 });
    });

    it('403 lançado pelo serviço (permissão específica do tipo de movimento) também grava access.denied, e não request.post', async () => {
      const materialId = await mkMat('ADJ');
      const c = corr('svc-403');
      const res = await api().post('/api/v1/stock/movements').set(A(tec)).set('X-Correlation-Id', c).set('Idempotency-Key', randomUUID())
        .send({ type: 'AJUSTE_POSITIVO', materialId, quantity: 1, toLocationId: prat, reason: 'Teste', axisApprovalRef: 'APR-1' });
      expect(res.status).toBe(403);
      const rows = await waitAudit(c, 1, 'access.denied');
      expect(rows[0]).toMatchObject({ actorAxisId: `tec10e-${sfx}`, action: 'access.denied' });
      expect((await auditOf(c)).filter((r) => r.action.startsWith('request.'))).toHaveLength(0);
    });

    it('sem token: 401, nenhuma linha de auditoria (não há ator)', async () => {
      const c = corr('noauth');
      await api().get('/api/v1/audit/events').set('X-Correlation-Id', c).expect(401);
      await api().post('/api/v1/materials').set('X-Correlation-Id', c).send({ code: 'X', shortDescription: 'y' }).expect(401);
      await new Promise((r) => setTimeout(r, 300));
      expect(await auditOf(c)).toHaveLength(0);
    });

    it('o corpo nunca é gravado: só os nomes dos campos, nem na trilha nem no diff', async () => {
      const c = corr('sens-body');
      const secret = `SEGREDO-CORPO-${sfx}`;
      await api().post('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', c).send({ code: `S10E-SENS-${sfx}`, shortDescription: secret, category: 'Teste', type: 'CONSUMO', stockUomId: un }).expect(201);
      const rows = await waitAudit(c, 1, 'request.post');
      expect(rows[0].diff).toMatchObject({ bodyFields: expect.arrayContaining(['shortDescription', 'code']) });
      expect(JSON.stringify(rows)).not.toContain(secret);
    });

    it('query string não entra na rota gravada; só os nomes dos parâmetros', async () => {
      const c = corr('qs-names');
      const leak = `VALOR-QS-${sfx}`;
      await api().post(`/api/v1/materials?leak=${leak}`).set(A(admin)).set('X-Correlation-Id', c).send({ code: `S10E-QS-${sfx}`, shortDescription: 'Consulta com query string', category: 'Teste', type: 'CONSUMO', stockUomId: un }).expect(201);
      const rows = await waitAudit(c, 1, 'request.post');
      expect(rows[0].diff).toMatchObject({ route: '/api/v1/materials', queryFields: ['leak'] });
      expect(JSON.stringify(rows)).not.toContain(leak);
    });

    it('rota com UUID é gravada com :id e o UUID vai para aggregateId', async () => {
      const c = corr('uuid-route');
      const { materialId } = await fresh('UR');
      await api().patch(`/api/v1/materials/${materialId}`).set(A(admin)).set('X-Correlation-Id', c).send({ shortDescription: 'Material renomeado' }).expect(200);
      const rows = await waitAudit(c, 1, 'request.patch');
      expect(rows[0]).toMatchObject({ aggregateId: materialId });
      expect(rows[0].diff).toMatchObject({ route: '/api/v1/materials/:id' });
    });

    it('leitura de rota sensível (documentos/auditoria) grava access.sensitive com os nomes da query', async () => {
      const c = corr('sens-read');
      await api().get('/api/v1/audit/events?pageSize=1&actor=ninguem').set(A(admin)).set('X-Correlation-Id', c).expect(200);
      const rows = await waitAudit(c, 1, 'access.sensitive');
      expect(rows[0].diff).toMatchObject({ method: 'GET', queryFields: ['pageSize', 'actor'] });
    });

    it.fails('BUG: eventos gravados pelo serviço (ex.: reconciliation.resolved) não trazem o correlation_id da requisição', async () => {
      // Reprodução: AuditService.record() não recebe nem grava correlationId, então a trilha do serviço não liga
      // ao X-Correlation-Id da requisição que a originou (seção 20: ligar requisição, eventos e movimentos).
      const { materialId } = await fresh('CORR');
      const order = await orderFor(materialId, 1);
      const res = await prisma.reservation.findFirstOrThrow({ where: { item: { orderId: order.id } } });
      await prisma.fulfillmentOrder.update({ where: { id: order.id }, data: { status: 'CANCELADA' } });
      await runRec();
      const issue = (await openIssues(res.id)).find((i) => i.kind === 'ORPHAN_RESERVATION')!;
      const c = corr('svc-corr');
      await api().post(`/api/v1/reconciliation/issues/${issue.id}/resolve`).set(A(admin)).set('X-Correlation-Id', c).send({ resolution: 'Correlação do serviço' }).expect(200);
      const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'reconciliation.resolved', aggregateId: issue.id } });
      expect(ev.correlationId).toBe(c);
    });

    it('muitas mutações em paralelo: nenhuma perde o registro de auditoria', async () => {
      const N = 20;
      const cs = Array.from({ length: N }, (_, i) => corr(`par-${i}`));
      const responses = await Promise.all(cs.map((c, i) =>
        api().post('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', c).send({ code: `S10E-PAR-${i}-${sfx}`, shortDescription: `Paralelo ${i}`, category: 'Teste', type: 'CONSUMO', stockUomId: un })));
      expect(responses.every((r) => r.status === 201)).toBe(true);
      const counts = await Promise.all(cs.map((c) => waitAudit(c, 1, 'request.post')));
      expect(counts.map((rows) => rows.length)).toEqual(Array(N).fill(1));
    });
  });

  describe('GET /audit/events — filtros, paginação e validação', () => {
    it('filtros combinados devolvem só linhas que satisfazem todos eles', async () => {
      const c = corr('filter-combo');
      const from = new Date(Date.now() - 60_000).toISOString();
      await api().post('/api/v1/materials').set(A(admin)).set('X-Correlation-Id', c).send({ code: `S10E-FLT-${sfx}`, shortDescription: 'Filtro', category: 'Teste', type: 'CONSUMO', stockUomId: un }).expect(201);
      await waitAudit(c, 1, 'request.post');
      const to = new Date(Date.now() + 60_000).toISOString();
      const out = await api().get('/api/v1/audit/events').query({ aggregateType: 'materials', action: 'request.post', actor: 'admin-s10e', correlationId: c, from, to }).set(A(admin)).expect(200);
      expect(out.body.total).toBe(1);
      expect(out.body.items[0]).toMatchObject({ aggregateType: 'materials', action: 'request.post', actorAxisId: 'admin-s10e', correlationId: c });
    });

    it('filtro por ator sem correspondência devolve total 0 e lista vazia', async () => {
      const out = await api().get('/api/v1/audit/events').query({ actor: `ninguem-${sfx}` }).set(A(admin)).expect(200);
      expect(out.body).toEqual({ total: 0, page: 1, pageSize: 50, items: [] });
    });

    it('paginação: páginas não se repetem, somam o total e vêm em ordem decrescente de data', async () => {
      const base = { aggregateType: 'materials', action: 'request.post', actor: 'admin-s10e' };
      const p1 = (await api().get('/api/v1/audit/events').query({ ...base, page: 1, pageSize: 7 }).set(A(admin)).expect(200)).body;
      const p2 = (await api().get('/api/v1/audit/events').query({ ...base, page: 2, pageSize: 7 }).set(A(admin)).expect(200)).body;
      expect(p1.total).toBeGreaterThanOrEqual(21);
      expect(p1.total).toBe(p2.total);
      expect(p1.items).toHaveLength(7);
      const ids1 = new Set(p1.items.map((i: { id: string }) => i.id));
      expect(p2.items.some((i: { id: string }) => ids1.has(i.id))).toBe(false);
      const times = p1.items.map((i: { createdAt: string }) => Date.parse(i.createdAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it('página além do fim devolve lista vazia com o total certo', async () => {
      const out = await api().get('/api/v1/audit/events').query({ actor: 'admin-s10e', action: 'request.post', page: 100000, pageSize: 50 }).set(A(admin)).expect(200);
      expect(out.body.items).toEqual([]);
      expect(out.body.total).toBeGreaterThan(0);
    });

    it('validação: pageSize acima de 200, page zero e datas inválidas são 400', async () => {
      await api().get('/api/v1/audit/events').query({ pageSize: 201 }).set(A(admin)).expect(400);
      await api().get('/api/v1/audit/events').query({ page: 0 }).set(A(admin)).expect(400);
      await api().get('/api/v1/audit/events').query({ from: 'nao-e-data' }).set(A(admin)).expect(400);
    });

    it('sem audit:read a consulta é 403', async () => {
      await api().get('/api/v1/audit/events').set(A(colab)).expect(403);
    });
  });
});
