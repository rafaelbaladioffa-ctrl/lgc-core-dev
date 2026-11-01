import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 4 — separação, embalagem, expedição e entrega', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor']);
  const admin = tokenFor(['admin']);
  const picker = tokenFor(['tecnico'], `picker-${sfx}`);
  const checker = tokenFor(['tecnico'], `checker-${sfx}`);
  const outsider = tokenFor(['tecnico'], `outsider-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let whId: string, whCode: string, locA: string, locB: string, un: string;
  let consum: string, consumCode: string, serialMat: string, serialCode: string;

  const mk = async (s: string, extra: Record<string, unknown>) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S4-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to = locA, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de teste', ...extra }).expect(201);
  const newOrder = async (code: string, quantity: number, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S4-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s4', costCenterAxisId: 'cc-s4', items: [{ materialCode: code, quantity }], ...extra }).expect(201)).body;
  const release = (orderId: string, body: Record<string, unknown> = {}, token = gestor) => api().post(`/api/v1/fulfillment-orders/${orderId}/release-picking`).set(A(token)).send(body);
  const task = (id: string, action: string, body: Record<string, unknown> = {}, token = picker) => api().post(`/api/v1/picking-tasks/${id}/${action}`).set(A(token)).send(body);
  const onHand = async (materialId: string) => (await prisma.stockBalance.aggregate({ where: { materialId }, _sum: { quantity: true, reservedQty: true } }))._sum;
  const orderStatus = async (id: string) => (await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id } })).status;

  /** Cria, libera, separa tudo e completa; devolve ids para as próximas etapas. */
  const pickAll = async (orderId: string, materialId: string, qty: number, extra: Record<string, unknown> = {}) => {
    const rel = await release(orderId, extra).expect(201);
    await task(rel.body.id, 'start').expect(200);
    const item = rel.body.items[0];
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId, lotId: item.lotId ?? undefined, quantity: qty }).expect(200);
    return { taskId: rel.body.id as string, item };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S4-${sfx}`;
    whId = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 4', type: 'CENTRAL' }).expect(201)).body.id;
    const area = async (code: string) => (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    locA = await area('PA'); locB = await area('PB');
    for (const u of [`picker-${sfx}`, `checker-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [whId] }).expect(200);

    consum = await mk('CONS', {}); consumCode = `S4-CONS-${sfx}`;
    serialMat = await mk('SER', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO' }); serialCode = `S4-SER-${sfx}`;
  });
  afterAll(async () => app.close());

  it('fluxo completo de consumível: separação → embalagem → expedição → entrega baixa o estoque só no fim', async () => {
    await stockIn(consum, 20);
    const base = await onHand(consum);
    const order = await newOrder(consumCode, 5);
    const rel = await release(order.id).expect(201);
    expect(rel.body.code).toMatch(/^SEP-\d{8}$/);
    expect(rel.body.requiresCheck).toBe(false);
    expect(await orderStatus(order.id)).toBe('LIBERADA_SEPARACAO');
    const item = rel.body.items[0];

    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: consum, quantity: 1 }).expect(409); // ainda não iniciada
    await task(rel.body.id, 'start').expect(200);
    expect(await orderStatus(order.id)).toBe('EM_SEPARACAO');
    await task(rel.body.id, 'start', {}, checker).expect(409);
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: consum, quantity: 1 }, checker).expect(403); // outro usuário
    const wrongLoc = await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: locB, materialId: consum, quantity: 1 }).expect(422);
    expect(wrongLoc.body.code).toBe('INVALID_LOCATION');
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: serialMat, quantity: 1 }).expect(422); // material errado
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: consum, quantity: 6 }).expect(422); // acima do planejado
    await task(rel.body.id, 'complete').expect(422); // item pendente
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, barcode: consumCode, quantity: 3 }).expect(200); // por SKU/código
    const done = await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: consum, quantity: 2 }).expect(200);
    expect(done.body.status).toBe('SEPARADO');
    const completed = await task(rel.body.id, 'complete').expect(200);
    expect(completed.body.status).toBe('SEPARADA');
    expect(await orderStatus(order.id)).toBe('SEPARADA');

    // Embalagem: precisa cobrir exatamente o separado.
    await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 4 }] }] }).expect(422);
    await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ weightKg: -1, items: [{ pickingItemId: item.id, quantity: 5 }] }] }).expect(400);
    const pack = await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ weightKg: 2.5, lengthCm: 30, widthCm: 20, heightCm: 10, seal: 'LAC-1', items: [{ pickingItemId: item.id, quantity: 3 }] }, { items: [{ pickingItemId: item.id, quantity: 2 }] }] }).expect(201);
    expect(pack.body.packages).toHaveLength(2);
    expect(pack.body.packages[0].code).toMatch(/^VOL-\d{8}$/);
    expect(await orderStatus(order.id)).toBe('PRONTA_EXPEDICAO');
    await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 5 }] }] }).expect(409);

    // Estoque ainda intacto antes da entrega.
    expect(Number((await onHand(consum)).quantity)).toBe(Number(base.quantity));
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(409); // não expedida
    await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({}).expect(400); // transportador obrigatório
    const disp = await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota própria', route: 'Rota 1' }).expect(200);
    expect(disp.body.manifestCode).toMatch(/^ROM-\d{8}$/);
    expect(await orderStatus(order.id)).toBe('EXPEDIDA');
    await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'X1' }).expect(409);
    expect(Number((await onHand(consum)).quantity)).toBe(Number(base.quantity));

    const del = await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano de Tal', latitude: -23.55, longitude: -46.63, notes: 'Sem avarias' }).expect(200);
    expect(del.body.status).toBe('ENTREGUE');
    expect(del.body.proofs).toHaveLength(1);
    const after = await onHand(consum);
    expect(Number(after.quantity)).toBe(Number(base.quantity) - 5);
    expect(Number(after.reservedQty)).toBe(Number(base.reservedQty));
    expect(await orderStatus(order.id)).toBe('ENTREGUE');
    const mv = await prisma.stockMovement.findMany({ where: { correlationId: order.id } });
    expect(mv).toHaveLength(2);
    expect(mv.every((m) => m.type === 'SAIDA_ENTREGA' && m.projectAxisId === 'prj-s4' && m.costCenterAxisId === 'cc-s4' && m.axisDocumentRef === order.axisRequestId)).toBe(true);
    const events = (await prisma.integrationMessage.findMany({ where: { direction: 'OUTBOUND', payload: { path: ['order_id'], equals: order.id } } })).map((e) => e.eventType);
    expect(events).toEqual(expect.arrayContaining(['picking.started', 'picking.completed', 'shipment.dispatched', 'delivery.confirmed']));
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(409); // sem dupla baixa
  });

  it('atendimento parcial exige aceite; falta na separação devolve o reservado ao disponível', async () => {
    const m = await mk('PART', {});
    await stockIn(m, 4);
    const order = await newOrder(`S4-PART-${sfx}`, 10);
    expect(order.status).toBe('RESERVADA_PARCIAL');
    const noAccept = await release(order.id).expect(422);
    expect(noAccept.body.code).toBe('APPROVAL_REQUIRED');
    const rel = await release(order.id, { acceptPartial: true }).expect(201);
    await task(rel.body.id, 'start').expect(200);
    const item = rel.body.items[0];
    expect(Number(item.quantityPlanned)).toBe(4);
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: locA, materialId: m, quantity: 3, closeShort: true }).expect(400); // sem motivo
    await task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: locA, materialId: m, quantity: 3, closeShort: true, divergenceReason: 'Uma unidade avariada' }).expect(200);
    expect(Number((await onHand(m)).reservedQty)).toBe(4);
    const c = await task(rel.body.id, 'complete').expect(200);
    expect(c.body.items[0].status).toBe('DIVERGENTE');
    expect(Number((await onHand(m)).reservedQty)).toBe(3); // 1 voltou ao disponível
    expect(await orderStatus(order.id)).toBe('SEPARADA');
  });

  it('item seriado: série obrigatória/única, conferência independente, custódia e baixa por série', async () => {
    const sn = await Promise.all([1, 2].map(async (i) => (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: serialMat, serial: `S4SN${i}-${sfx}`, assetTag: `S4PAT${i}-${sfx}` }).expect(201)).body.id as string));
    for (const id of sn) await stockIn(serialMat, 1, locA, { serialId: id });
    const order = await newOrder(serialCode, 2, { recipientAxisId: `rcpt-${sfx}` });
    const rel = await release(order.id).expect(201);
    expect(rel.body.requiresCheck).toBe(true);
    await task(rel.body.id, 'start').expect(200);
    const item = rel.body.items[0];
    const scan = (serialId: string | undefined, token = picker) => task(rel.body.id, 'scan', { pickingItemId: item.id, locationId: locA, materialId: serialMat, serialId, quantity: 1 }, token);
    await scan(undefined).expect(400);
    await scan(sn[0]).expect(200);
    const dup = await scan(sn[0]).expect(409);
    expect(dup.body.code).toBe('SERIAL_DUPLICATE');
    await scan(sn[1]).expect(200);
    const c = await task(rel.body.id, 'complete').expect(200);
    expect(c.body.status).toBe('EM_CONFERENCIA');
    expect(await orderStatus(order.id)).toBe('EM_CONFERENCIA');
    await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 2 }] }] }).expect(422); // conferência pendente
    await task(rel.body.id, 'check', {}, picker).expect(403); // segregação
    await task(rel.body.id, 'check', {}, checker).expect(200);
    const pack = await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 2 }] }] }).expect(201);
    await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'Entrega local' }).expect(200);
    const noRecv = await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Beltrano' }).expect(422);
    expect(noRecv.body.code).toBe('AXIS_REFERENCE_INVALID');
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Beltrano', receiverAxisId: `rcpt-${sfx}` }).expect(200);
    const serials = await prisma.serialNumber.findMany({ where: { id: { in: sn } } });
    expect(serials.every((s) => s.currentLocationId === null)).toBe(true);
    const mv = await prisma.stockMovement.findMany({ where: { correlationId: order.id } });
    expect(mv).toHaveLength(2);
    expect(mv.every((m) => m.custodianAxisId === `rcpt-${sfx}` && m.serialId)).toBe(true);
  });

  it('entrega parcial mantém pendência e a segunda entrega encerra', async () => {
    const m = await mk('PD', {});
    await stockIn(m, 6);
    const order = await newOrder(`S4-PD-${sfx}`, 6);
    const { taskId, item } = await pickAll(order.id, m, 6);
    await task(taskId, 'complete').expect(200);
    const pack = await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 4 }] }, { items: [{ pickingItemId: item.id, quantity: 2 }] }] }).expect(201);
    await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'Transportadora X' }).expect(200);
    const [p1, p2] = pack.body.packages;
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'PARCIAL', receiverName: 'Recebedor' }).expect(400); // sem packageIds
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [randomUUID()] }).expect(422);
    const part = await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [p1.id] }).expect(200);
    expect(part.body.status).toBe('PARCIAL');
    expect(await orderStatus(order.id)).toBe('EXPEDIDA');
    let sums = await onHand(m);
    expect(Number(sums.quantity)).toBe(2);
    expect(Number(sums.reservedQty)).toBe(2);
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'PARCIAL', receiverName: 'R', packageIds: [p2.id] }).expect(400); // último volume: use ENTREGUE
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Recebedor' }).expect(200);
    sums = await onHand(m);
    expect(Number(sums.quantity)).toBe(0);
    expect(Number(sums.reservedQty)).toBe(0);
    expect(await orderStatus(order.id)).toBe('ENTREGUE');
    expect(await prisma.deliveryProof.count({ where: { shipmentId: pack.body.id } })).toBe(2);
  });

  it('recusa exige motivo, não baixa estoque e marca divergência', async () => {
    const m = await mk('RF', {});
    await stockIn(m, 3);
    const order = await newOrder(`S4-RF-${sfx}`, 3);
    const { taskId, item } = await pickAll(order.id, m, 3);
    await task(taskId, 'complete').expect(200);
    const pack = await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 3 }] }] }).expect(201);
    await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }).expect(200);
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'RECUSADA', receiverName: 'Portaria' }).expect(400);
    await api().post(`/api/v1/shipments/${pack.body.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'RECUSADA', receiverName: 'Portaria', notes: 'Cliente recusou' }).expect(200);
    expect(await orderStatus(order.id)).toBe('DIVERGENCIA');
    expect(Number((await onHand(m)).quantity)).toBe(3);
  });

  it('proteções: escopo de almoxarifado, permissões, destinatário desligado e reservas não expiram em separação', async () => {
    const m = await mk('GD', {});
    await stockIn(m, 2);
    const order = await newOrder(`S4-GD-${sfx}`, 2, { recipientAxisId: `gone-${sfx}` });
    const rel = await release(order.id).expect(201);
    await task(rel.body.id, 'start', {}, outsider).expect(403); // sem acesso ao almoxarifado
    await api().get(`/api/v1/picking-tasks/${rel.body.id}`).set(A(outsider)).expect(403);
    await release(order.id, {}, tokenFor(['colaborador'])).expect(403);
    await release(order.id).expect(409); // já liberada
    const list = await api().get('/api/v1/picking-tasks').query({ orderId: order.id }).set(A(picker)).expect(200);
    expect(list.body).toHaveLength(1);

    await prisma.reservation.updateMany({ where: { item: { orderId: order.id } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api().post('/api/v1/reservations/expire').set(A(gestor)).expect(200);
    expect(Number((await onHand(m)).reservedQty)).toBe(2); // em separação: não expira

    const { taskId, item } = await (async () => { await task(rel.body.id, 'start').expect(200); const it = rel.body.items[0]; await task(rel.body.id, 'scan', { pickingItemId: it.id, locationId: locA, materialId: m, quantity: 2 }).expect(200); return { taskId: rel.body.id as string, item: it }; })();
    await task(taskId, 'complete').expect(200);
    const pack = await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity: 2 }] }] }).expect(201);
    await prisma.axisMasterCache.create({ data: { kind: 'COLLABORATOR', axisId: `gone-${sfx}`, name: 'Desligado', active: false, sourceOccurredAt: new Date() } });
    const blocked = await api().post(`/api/v1/shipments/${pack.body.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }).expect(422);
    expect(blocked.body.code).toBe('AXIS_REFERENCE_INVALID');
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: pack.body.id } })).status).toBe('PRONTO');
  });

  it('cancelamento após a liberação não desfaz a separação: fica CANCELAMENTO_SOLICITADO', async () => {
    const m = await mk('CX', {});
    await stockIn(m, 2);
    const order = await newOrder(`S4-CX-${sfx}`, 2);
    await release(order.id).expect(201);
    const c = await api().post(`/api/v1/fulfillment-orders/${order.id}/cancel-request`).set(A(gestor)).send({ reason: 'Projeto parado' }).expect(200);
    expect(c.body.status).toBe('CANCELAMENTO_SOLICITADO');
    expect(Number((await onHand(m)).reservedQty)).toBe(2);
  });
});
