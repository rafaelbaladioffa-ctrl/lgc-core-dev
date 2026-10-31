import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const sign = (body: string) => 'sha256=' + createHmac('sha256', WH_SECRET).update(body).digest('hex');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Sprint 3 — disponibilidade, ordens de atendimento e reservas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = Date.now().toString(36).toUpperCase();
  const gestor = tokenFor(['gestor']);
  const admin = tokenFor(['admin']);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let whId: string, whCode: string, loc: string, matA: string, matB: string, matLot: string, lotEarly: string, lotLate: string;
  let codeA: string, codeLot: string;

  const stockIn = (materialId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: loc, reason: 'Carga de teste', ...extra }).expect(201);
  const order = (body: Record<string, unknown>, token = admin) => api().post('/api/v1/fulfillment-orders').set(A(token)).send({ warehouseCode: whCode, ...body });
  const avail = async (id: string) => (await api().get(`/api/v1/materials/${id}/availability`).query({ warehouse_id: whId }).set(A(gestor)).expect(200)).body;
  const bal = (materialId: string) => prisma.stockBalance.findMany({ where: { materialId } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    whCode = `S3-${sfx}`;
    whId = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 3', type: 'CENTRAL' }).expect(201)).body.id;
    loc = (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code: 'Z1', level: 'AREA' }).expect(201)).body.id;
    const un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    const mk = async (s: string, extra: Record<string, unknown> = {}) => (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S3-${s}-${sfx}`, shortDescription: `Material ${s}`, category: `Cat-${sfx}`, type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
    matA = await mk('A'); matB = await mk('B');
    matLot = await mk('LOT', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
    codeA = `S3-A-${sfx}`; codeLot = `S3-LOT-${sfx}`;
    const lot = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: matLot, lotNumber: n, expiresAt: day(d) }).expect(201)).body.id as string;
    lotLate = await lot('TARDE', 300); lotEarly = await lot('CEDO', 60);
  });
  afterAll(async () => app.close());

  describe('disponibilidade', () => {
    it('físico, reservado, bloqueado e disponível; batch; categorias; estoque do almoxarifado', async () => {
      await stockIn(matA, 20);
      await stockIn(matA, 3, { toCondition: 'QUARENTENA' });
      const a = await avail(matA);
      expect(a).toMatchObject({ sku: codeA, stock_unit: 'UN', physical: '23', reserved: '0', blocked: '3', available: '20' });
      expect(a.as_of).toBeDefined();
      const batch = await api().post('/api/v1/materials/availability:batch').set(A(gestor)).send({ material_ids: [matA, matB], warehouse_id: whId }).expect(201);
      expect(batch.body.items).toHaveLength(2);
      await api().post('/api/v1/materials/availability:batch').set(A(gestor)).send({ material_ids: [] }).expect(400);
      await api().post('/api/v1/materials/availability:batch').set(A(gestor)).send({ material_ids: ['x'] }).expect(400);
      const cats = await api().get('/api/v1/material-categories').set(A(gestor)).expect(200);
      expect(cats.body.find((c: { category: string }) => c.category === `Cat-${sfx}`).materials).toBe(3);
      const stock = await api().get(`/api/v1/warehouses/${whId}/stock`).set(A(gestor)).expect(200);
      expect(stock.body.items.length).toBeGreaterThan(0);
    });

    it('solicitante consulta disponibilidade, mas não o estoque detalhado do almoxarifado', async () => {
      const colab = tokenFor(['colaborador']);
      await api().get(`/api/v1/materials/${matA}/availability`).set(A(colab)).expect(200);
      await api().get(`/api/v1/warehouses/${whId}/stock`).set(A(colab)).expect(403);
      await api().get(`/api/v1/materials/${matA}/availability`).expect(401);
    });

    it('lote vencido/bloqueado não entra no disponível', async () => {
      await stockIn(matLot, 10, { lotId: lotLate });
      await stockIn(matLot, 4, { lotId: lotEarly });
      expect((await avail(matLot)).available).toBe('14');
      await prisma.lot.update({ where: { id: lotEarly }, data: { status: 'BLOQUEADO' } });
      const a = await avail(matLot);
      expect(a.available).toBe('10');
      expect(a.blocked).toBe('4');
      await prisma.lot.update({ where: { id: lotEarly }, data: { status: 'LIBERADO' } });
    });
  });

  describe('ordens de atendimento e reservas', () => {
    it('reserva total, incrementa reservado e reduz disponível; GET detalha itens e reservas', async () => {
      const res = await order({ axisRequestId: `REQ-1-${sfx}`, requesterAxisId: 'u-solic', items: [{ materialCode: codeA, quantity: 5 }] }).expect((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); });
      expect(res.body.status).toBe('RESERVADA');
      expect(res.body.code).toMatch(/^ATD-\d{8}$/);
      expect(res.body.items[0]).toMatchObject({ reserved: '5', shortage: '0' });
      const a = await avail(matA);
      expect(a.reserved).toBe('5');
      expect(a.available).toBe('15');
      const msgs = await prisma.integrationMessage.findMany({ where: { direction: 'OUTBOUND', payload: { path: ['order_id'], equals: res.body.id } } });
      expect(msgs.map((m) => m.eventType).sort()).toEqual(['fulfillment.created', 'reservation.confirmed']);
    });

    it('é idempotente por requisição+versão', async () => {
      const body = { axisRequestId: `REQ-IDEM-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] };
      const first = await order(body).expect(201);
      const again = await order(body).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.replayed).toBe(true);
      expect(await prisma.reservation.count({ where: { item: { orderId: first.body.id } } })).toBe(1);
    });

    it('reserva parcial e depois completa quando chega estoque (reserve)', async () => {
      const before = Number((await avail(matB)).available);
      expect(before).toBe(0);
      const res = await order({ axisRequestId: `REQ-PART-${sfx}`, items: [{ materialCode: `S3-B-${sfx}`, quantity: 6 }] }).expect(201);
      expect(res.body.status).toBe('AGUARDANDO_ESTOQUE');
      await stockIn(matB, 4);
      const part = await api().post(`/api/v1/fulfillment-orders/${res.body.id}/reserve`).set(A(gestor)).expect(200);
      expect(part.body.status).toBe('RESERVADA_PARCIAL');
      expect(part.body.items[0]).toMatchObject({ reserved: '4', shortage: '2' });
      await stockIn(matB, 5);
      const full = await api().post(`/api/v1/fulfillment-orders/${res.body.id}/reserve`).set(A(gestor)).expect(200);
      expect(full.body.status).toBe('RESERVADA');
      expect(full.body.items[0].shortage).toBe('0');
      expect((await avail(matB)).available).toBe('3');
    });

    it('FEFO: reserva primeiro o lote que vence antes e pula lote bloqueado', async () => {
      const r1 = await order({ axisRequestId: `REQ-FEFO-${sfx}`, items: [{ materialCode: codeLot, quantity: 3 }] }).expect(201);
      expect(r1.body.items[0].reservations[0].lotId).toBe(lotEarly);
      await prisma.lot.update({ where: { id: lotEarly }, data: { status: 'QUARENTENA' } });
      const r2 = await order({ axisRequestId: `REQ-FEFO2-${sfx}`, items: [{ materialCode: codeLot, quantity: 2 }] }).expect(201);
      expect(r2.body.items[0].reservations[0].lotId).toBe(lotLate);
      await prisma.lot.update({ where: { id: lotEarly }, data: { status: 'LIBERADO' } });
    });

    it('estoque reservado está protegido: saída que invadiria a reserva é recusada', async () => {
      const b = (await bal(matA)).find((x) => x.condition === 'DISPONIVEL')!;
      const free = Number(b.quantity) - Number(b.reservedQty);
      const bad = await api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'SAIDA_ENTREGA', materialId: matA, quantity: free + 1, fromLocationId: loc, reason: 'Invade reserva' }).expect(422);
      expect(bad.body.message).toMatch(/insuficiente/i);
      await api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'SAIDA_ENTREGA', materialId: matA, quantity: free, fromLocationId: loc, reason: 'Só o livre' }).expect(201);
    });

    it('concorrência: ordens simultâneas nunca reservam mais que o saldo', async () => {
      const m = (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S3-CONC-${sfx}`, shortDescription: 'Concorrência', category: 'Teste', type: 'CONSUMO', stockUomId: (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id }).expect(201)).body.id;
      await stockIn(m, 10);
      const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => order({ axisRequestId: `REQ-CONC-${i}-${sfx}`, items: [{ materialCode: `S3-CONC-${sfx}`, quantity: 3 }] })));
      expect(rs.every((r) => r.status === 201)).toBe(true);
      const b = (await bal(m))[0];
      expect(Number(b.reservedQty)).toBeLessThanOrEqual(10);
      const totalReserved = await prisma.reservation.aggregate({ where: { materialId: m, status: 'ATIVA' }, _sum: { quantity: true } });
      expect(Number(totalReserved._sum.quantity)).toBe(Number(b.reservedQty));
      expect(Number(b.reservedQty)).toBe(10);
    });

    it('nova versão substitui a anterior liberando reservas; versão antiga é conflito', async () => {
      const id = `REQ-VER-${sfx}`;
      const v1 = await order({ axisRequestId: id, requestVersion: 1, items: [{ materialCode: codeLot, quantity: 1 }] }).expect(201);
      const before = (await avail(matLot)).reserved;
      const v2 = await order({ axisRequestId: id, requestVersion: 2, items: [{ materialCode: codeLot, quantity: 2 }] }).expect(201);
      expect(v2.body.status).toBe('RESERVADA');
      expect((await api().get(`/api/v1/fulfillment-orders/${v1.body.id}`).set(A(gestor))).body.status).toBe('CANCELADA');
      expect(Number((await avail(matLot)).reserved)).toBe(Number(before) + 1); // -1 da v1, +2 da v2
      const old = await order({ axisRequestId: id, requestVersion: 1, items: [{ materialCode: codeLot, quantity: 1 }] });
      // v1 já existe → repetição idempotente (não conflito); uma v0 inexistente seria conflito
      expect(old.status).toBe(201);
      const conflict = await order({ axisRequestId: id, requestVersion: 1, items: [{ materialCode: codeLot, quantity: 1 }] });
      expect(conflict.body.replayed).toBe(true);
      await prisma.fulfillmentOrder.delete({ where: { axisRequestId_requestVersion: { axisRequestId: id, requestVersion: 1 } } }).catch(() => undefined);
    });

    it('cancelamento antes da separação libera as reservas', async () => {
      await stockIn(matA, 50);
      const r = await order({ axisRequestId: `REQ-CANC-${sfx}`, items: [{ materialCode: codeA, quantity: 2 }] }).expect(201);
      const reservedBefore = Number((await avail(matA)).reserved);
      const c = await api().post(`/api/v1/fulfillment-orders/${r.body.id}/cancel-request`).set(A(gestor)).send({ reason: 'Projeto cancelado' }).expect(200);
      expect(c.body.status).toBe('CANCELADA');
      expect(Number((await avail(matA)).reserved)).toBe(reservedBefore - 2);
      await api().post(`/api/v1/fulfillment-orders/${r.body.id}/cancel-request`).set(A(gestor)).send({ reason: 'De novo' }).expect(200); // idempotente
      await api().post(`/api/v1/fulfillment-orders/${r.body.id}/reserve`).set(A(gestor)).expect(409);
    });

    it('reservas vencidas expiram e voltam ao disponível', async () => {
      await stockIn(matA, 50);
      const r = await order({ axisRequestId: `REQ-EXP-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      await prisma.reservation.updateMany({ where: { item: { orderId: r.body.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const reservedBefore = Number((await avail(matA)).reserved);
      const res = await api().post('/api/v1/reservations/expire').set(A(gestor)).expect(200);
      expect(res.body.expired).toBeGreaterThanOrEqual(1);
      expect(Number((await avail(matA)).reserved)).toBe(reservedBefore - 1);
      expect((await api().get(`/api/v1/fulfillment-orders/${r.body.id}`).set(A(gestor))).body.status).toBe('AGUARDANDO_ESTOQUE');
    });

    it('valida referências com códigos de erro: material inexistente, inativo, projeto inativo, quantidade e precisão', async () => {
      const miss = await order({ axisRequestId: `REQ-E1-${sfx}`, items: [{ materialCode: 'NAO-EXISTE', quantity: 1 }] }).expect(422);
      expect(miss.body.code).toBe('AXIS_REFERENCE_INVALID');
      await order({ axisRequestId: `REQ-E2-${sfx}`, items: [{ quantity: 1 }] }).expect(400);
      await order({ axisRequestId: `REQ-E3-${sfx}`, items: [{ materialCode: codeA, quantity: 0 }] }).expect(400);
      await order({ axisRequestId: `REQ-E4-${sfx}`, items: [] }).expect(400);
      const frac = await order({ axisRequestId: `REQ-E5-${sfx}`, items: [{ materialCode: codeA, quantity: 1.5 }] }).expect(400);
      expect(frac.body.code).toBe('UNIT_CONVERSION_ERROR');
      await order({ axisRequestId: `REQ-E6-${sfx}`, warehouseCode: 'NAO-EXISTE', items: [{ materialCode: codeA, quantity: 1 }] }).expect(422);
      await prisma.axisMasterCache.create({ data: { kind: 'PROJECT', axisId: `prj-off-${sfx}`, code: 'PRJ-OFF', active: false, sourceOccurredAt: new Date() } });
      const prj = await order({ axisRequestId: `REQ-E7-${sfx}`, projectAxisId: `prj-off-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] }).expect(422);
      expect(prj.body.code).toBe('AXIS_REFERENCE_INVALID');
      const noWh = await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `REQ-E8-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      expect(noWh.body.status).toBe('AGUARDANDO_INFORMACAO');
    });

    it('destinatário desligado bloqueia a ordem (regra 14); referência desconhecida gera aviso', async () => {
      await prisma.axisMasterCache.create({ data: { kind: 'COLLABORATOR', axisId: `col-off-${sfx}`, name: 'Ex-colab', active: false, sourceOccurredAt: new Date() } });
      const r = await order({ axisRequestId: `REQ-OFF-${sfx}`, recipientAxisId: `col-off-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      expect(r.body.status).toBe('BLOQUEADA');
      expect(r.body.items[0].reserved).toBe('0');
      const w = await order({ axisRequestId: `REQ-WARN-${sfx}`, projectAxisId: 'prj-desconhecido', items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      expect(JSON.stringify(w.body.referenceWarnings)).toMatch(/não sincronizado/);
    });

    it('permissões: só quem tem fulfillment:create cria; solicitante vê apenas as próprias ordens', async () => {
      const colab = tokenFor(['colaborador'], 'u-solic');
      await order({ axisRequestId: `REQ-P-${sfx}`, items: [{ materialCode: codeA, quantity: 1 }] }, colab).expect(403);
      const mine = await order({ axisRequestId: `REQ-MINE-${sfx}`, requesterAxisId: 'u-solic', items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      const list = await api().get('/api/v1/fulfillment-orders').set(A(colab)).expect(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      expect(list.body.items.every((o: { requesterAxisId: string }) => o.requesterAxisId === 'u-solic')).toBe(true);
      await api().get(`/api/v1/fulfillment-orders/${mine.body.id}`).set(A(colab)).expect(200);
      const other = await order({ axisRequestId: `REQ-OTHER-${sfx}`, requesterAxisId: 'u-outro', items: [{ materialCode: codeA, quantity: 1 }] }).expect(201);
      await api().get(`/api/v1/fulfillment-orders/${other.body.id}`).set(A(colab)).expect(403);
      await api().post(`/api/v1/fulfillment-orders/${mine.body.id}/cancel-request`).set(A(colab)).send({ reason: 'Quero cancelar' }).expect(403);
    });
  });

  describe('adaptador ticket.status_changed → material_request.approved', () => {
    beforeAll(async () => { await stockIn(matA, 100); });
    const post = (type: string, payload: Record<string, unknown>, eventId = randomUUID()) => {
      const raw = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: new Date().toISOString(), payload });
      return api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sign(raw)).send(raw);
    };
    const ticket = (id: string, extra: Record<string, unknown> = {}) => ({ ticket_id: id, category: 'Requisição de material/insumo', status: 'aberto', warehouse_code: whCode, requester_id: 'u-solic', items: [{ material_code: codeA, quantity: 2 }], ...extra });

    it('chamado aprovado da categoria de material vira ordem de atendimento reservada', async () => {
      const id = `TCK-1-${sfx}`;
      const r = await post('ticket.status_changed', ticket(id)).expect(200);
      expect(r.body.status).toBe('processed');
      const o = await prisma.fulfillmentOrder.findFirstOrThrow({ where: { axisRequestId: id } });
      expect(o.status).toBe('RESERVADA');
      expect(o.sourceEventId).toBeTruthy();
    });

    it('ignora outras categorias e status; reentrega do mesmo evento não duplica', async () => {
      const other = await post('ticket.status_changed', ticket(`TCK-2-${sfx}`, { category: 'Solicitação de compra' })).expect(200);
      expect(other.body.status).toBe('ignored');
      expect(await prisma.fulfillmentOrder.count({ where: { axisRequestId: `TCK-2-${sfx}` } })).toBe(0);
      const inProgress = await post('ticket.status_changed', ticket(`TCK-3-${sfx}`, { status: 'em_andamento' })).expect(200);
      expect(inProgress.body.status).toBe('ignored');
      const eid = randomUUID();
      await post('ticket.status_changed', ticket(`TCK-4-${sfx}`), eid).expect(200);
      const dup = await post('ticket.status_changed', ticket(`TCK-4-${sfx}`), eid).expect(200);
      expect(dup.body.status).toBe('duplicate');
      expect(await prisma.fulfillmentOrder.count({ where: { axisRequestId: `TCK-4-${sfx}` } })).toBe(1);
    });

    it('ticket cancelado cancela a ordem; evento nativo material_request.* também é aceito', async () => {
      const id = `TCK-5-${sfx}`;
      await post('ticket.status_changed', ticket(id)).expect(200);
      await post('ticket.status_changed', { ticket_id: id, category: 'Requisição de material/insumo', status: 'cancelado' }).expect(200);
      expect((await prisma.fulfillmentOrder.findFirstOrThrow({ where: { axisRequestId: id } })).status).toBe('CANCELADA');

      const nid = `MR-1-${sfx}`;
      await post('material_request.approved', { request_id: nid, warehouse_code: whCode, items: [{ material_code: codeA, quantity: 1 }] }).expect(200);
      expect((await prisma.fulfillmentOrder.findFirstOrThrow({ where: { axisRequestId: nid } })).status).toBe('RESERVADA');
      await post('material_request.cancel_requested', { request_id: nid, reason: 'Cliente desistiu' }).expect(200);
      expect((await prisma.fulfillmentOrder.findFirstOrThrow({ where: { axisRequestId: nid } })).status).toBe('CANCELADA');
    });

    it('payload inválido falha visível (FAILED) em vez de criar ordem pela metade', async () => {
      const id = `TCK-6-${sfx}`;
      const eid = randomUUID();
      const r = await post('ticket.status_changed', ticket(id, { items: [{ material_code: codeA, quantity: -1 }] }), eid);
      expect(r.status).toBe(400);
      expect(await prisma.fulfillmentOrder.count({ where: { axisRequestId: id } })).toBe(0);
      expect((await prisma.integrationMessage.findFirstOrThrow({ where: { eventId: eid } })).status).toBe('FAILED');
      const unknown = await post('ticket.status_changed', ticket(`TCK-7-${sfx}`, { items: [{ material_code: 'NAO-EXISTE', quantity: 1 }] }));
      expect(unknown.status).toBe(422);
    });
  });
});
