import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Seção 23 do PLANNING_LOGISTICA.md — os 20 cenários obrigatórios, ponta a ponta contra o banco real.
 */
const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const sign = (body: string) => 'sha256=' + createHmac('sha256', WH_SECRET).update(body).digest('hex');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Seção 23 — cenários de teste obrigatórios', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s10');
  const admin = tokenFor(['admin'], 'admin-s10');
  const rec = tokenFor(['tecnico'], `rec10-${sfx}`);
  const colab = tokenFor(['colaborador'], `emp-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let wh: string, whCode: string, un: string, prat: string, prat2: string, doca: string;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S10-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const code = (s: string) => `S10-${s}-${sfx}`;
  const mv = (body: Record<string, unknown>, key = randomUUID(), token = gestor) => api().post('/api/v1/stock/movements').set(A(token)).set('Idempotency-Key', key).send({ reason: 'Teste de cenário', ...body });
  const stockIn = (materialId: string, quantity: number, to = prat, extra: Record<string, unknown> = {}) => mv({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, ...extra }).expect(201);
  const sums = async (materialId: string, where: Record<string, unknown> = {}) => { const a = await prisma.stockBalance.aggregate({ where: { materialId, ...where }, _sum: { quantity: true, reservedQty: true } }); return { q: Number(a._sum.quantity ?? 0), r: Number(a._sum.reservedQty ?? 0) }; };
  const order = (codeStr: string, quantity: number, extra: Record<string, unknown> = {}) => api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S10-${randomUUID()}`, warehouseCode: whCode, projectAxisId: `prj-${sfx}`, items: [{ materialCode: codeStr, quantity }], ...extra });
  const orderStatus = async (id: string) => (await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id } })).status;

  /** Ordem → liberação → separação completa → embalagem (1 volume). */
  const pickAndPack = async (codeStr: string, materialId: string, quantity: number, extra: Record<string, unknown> = {}, serials: string[] = []) => {
    const o = (await order(codeStr, quantity, extra).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${o.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(tokenFor(['gestor'], 'picker10'))).send(b);
    await t('start').expect(200);
    for (const it of rel.items) {
      if (serials.length) for (const sid of serials) await t('scan', { pickingItemId: it.id, locationId: it.locationId, materialId, serialId: sid, quantity: 1 }).expect(200);
      else await t('scan', { pickingItemId: it.id, locationId: it.locationId, materialId, ...(it.lotId ? { lotId: it.lotId } : {}), quantity: Number(it.quantityPlanned) }).expect(200);
    }
    const doneTask = (await t('complete').expect(200)).body;
    if (doneTask.status === 'EM_CONFERENCIA') await api().post(`/api/v1/picking-tasks/${rel.id}/check`).set(A(tokenFor(['gestor'], 'checker10'))).send({}).expect(200);
    const pack = (await api().post(`/api/v1/fulfillment-orders/${o.id}/pack`).set(A(gestor)).send({ packages: [{ items: rel.items.map((it: { id: string; quantityPlanned: string }) => ({ pickingItemId: it.id, quantity: Number(it.quantityPlanned) })) }] }).expect(201)).body;
    return { o, rel, pack };
  };
  const dispatch = (shipmentId: string) => api().post(`/api/v1/shipments/${shipmentId}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' });
  const deliver = (shipmentId: string, body: Record<string, unknown> = {}) => api().post(`/api/v1/shipments/${shipmentId}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano', ...body });
  const post = (type: string, payload: Record<string, unknown>, eventId = randomUUID(), occurredAt = new Date()) => {
    const raw = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: occurredAt.toISOString(), payload });
    return api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sign(raw)).send(raw);
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S10-${sfx}`;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 10', type: 'CENTRAL' }).expect(201)).body.id;
    const loc = async (c: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code: c, level: 'AREA' }).expect(201)).body.id as string;
    prat = await loc('PRAT'); prat2 = await loc('PRAT2'); doca = await loc('DOCA');
    await api().put(`/api/v1/rbac/users/rec10-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => { delete process.env.AXIS_EVENTS_URL; await app.close(); });

  it('1. duas requisições disputam o último saldo simultaneamente', async () => {
    const m = await mk('C1'); await stockIn(m, 5);
    const rs = await Promise.all(Array.from({ length: 4 }, () => order(code('C1'), 3)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect((await sums(m)).r).toBe(5); // reservou tudo, nunca mais que o saldo
    const reserved = await prisma.reservation.aggregate({ where: { materialId: m, status: 'ATIVA' }, _sum: { quantity: true } });
    expect(Number(reserved._sum.quantity)).toBe(5);
    expect(rs.filter((r) => r.body.status === 'RESERVADA')).toHaveLength(1); // só uma ordem completa; as outras parcial/sem estoque
  });

  it('2. Axis repete o mesmo comando após timeout (ordem, movimento e webhook)', async () => {
    const m = await mk('C2'); await stockIn(m, 10);
    const body = { axisRequestId: `S10-REPEAT-${sfx}`, warehouseCode: whCode, items: [{ materialCode: code('C2'), quantity: 2 }] };
    const a = await api().post('/api/v1/fulfillment-orders').set(A(admin)).send(body).expect(201);
    const b = await api().post('/api/v1/fulfillment-orders').set(A(admin)).send(body).expect(201);
    expect(b.body.id).toBe(a.body.id); expect(b.body.replayed).toBe(true);
    expect((await sums(m)).r).toBe(2);
    const key = randomUUID();
    const m1 = await mv({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: 1, toLocationId: prat }, key).expect(201);
    const m2 = await mv({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: 1, toLocationId: prat }, key).expect(201);
    expect(m2.body.id).toBe(m1.body.id); expect((await sums(m)).q).toBe(11);
    const ev = randomUUID();
    expect((await post('ping', {}, ev).expect(200)).body.status).toBe('ignored');
    expect((await post('ping', {}, ev).expect(200)).body.status).toBe('duplicate');
  });

  it('3. item solicitado fica bloqueado depois da reserva: entrega não baixa estoque bloqueado e o alerta aparece', async () => {
    const m = await mk('C3', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
    const lot = (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m, lotNumber: `C3-${sfx}`, expiresAt: day(200) }).expect(201)).body.id as string;
    await stockIn(m, 4, prat, { lotId: lot });
    const { pack, o } = await pickAndPack(code('C3'), m, 2);
    await dispatch(pack.id).expect(200);
    await prisma.lot.update({ where: { id: lot }, data: { status: 'BLOQUEADO' } }); // HSE bloqueou depois da reserva
    const r = await deliver(pack.id).expect(422);
    expect(r.body.message).toMatch(/bloqueado|quarentena/i);
    expect((await sums(m)).q).toBe(4);
    expect(await orderStatus(o.id)).toBe('EXPEDIDA');
    await api().post('/api/v1/alerts/scan').set(A(gestor)).expect(200);
    expect((await prisma.alert.findMany({ where: { kind: 'MATERIAL_BLOQUEADO_RESERVADO', status: { not: 'RESOLVIDO' } } })).length).toBeGreaterThan(0);
  });

  it('4. separação FEFO com lotes em endereços diferentes', async () => {
    const m = await mk('C4', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
    const lot = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m, lotNumber: `${n}-${sfx}`, expiresAt: day(d) }).expect(201)).body.id as string;
    const l90 = await lot('A90', 90), l30 = await lot('B30', 30), l60 = await lot('C60', 60);
    await stockIn(m, 2, prat, { lotId: l90 }); await stockIn(m, 2, prat2, { lotId: l30 }); await stockIn(m, 2, doca, { lotId: l60 });
    const o = (await order(code('C4'), 5).expect(201)).body;
    const rs = await prisma.reservation.findMany({ where: { item: { orderId: o.id } }, orderBy: { createdAt: 'asc' } });
    expect(rs.map((r) => [r.lotId, Number(r.quantity)])).toEqual([[l30, 2], [l60, 2], [l90, 1]]); // vence antes sai antes
    expect(rs.map((r) => r.locationId)).toEqual([prat2, doca, prat]); // e o separador é levado ao endereço de cada lote
  });

  it('5. série duplicada no recebimento', async () => {
    const m = await mk('C5', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
    const r = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO5-${sfx}` }).expect(201)).body;
    await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(gestor)).send({ materialId: m, quantity: 2, serials: [`C5A-${sfx}`, `C5B-${sfx}`] }).expect(201);
    await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(gestor)).expect(200);
    const r2 = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO5B-${sfx}` }).expect(201)).body;
    const dup = await api().post(`/api/v1/receipts/${r2.id}/items:scan`).set(A(gestor)).send({ materialId: m, quantity: 1, serials: [`C5A-${sfx}`] }).expect(409);
    expect(dup.body.code).toBe('SERIAL_DUPLICATE');
  });

  it('6. recebimento parcial, excedente e item diferente do pedido', async () => {
    const a = await mk('C6A'); const b = await mk('C6B'); const c = await mk('C6C');
    const r = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO6-${sfx}`, expectedItems: [{ materialId: a, quantity: 10 }, { materialId: b, quantity: 5 }] }).expect(201)).body;
    for (const [mat, q] of [[a, 8], [b, 7], [c, 1]] as const) await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(gestor)).send({ materialId: mat, quantity: q }).expect(201);
    await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(gestor)).expect(200);
    const done = await prisma.receipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe('DIVERGENTE');
    const notes = JSON.stringify(done.divergenceNotes);
    expect(notes).toMatch(/previsto 10, recebido 8/); expect(notes).toMatch(/previsto 5, recebido 7/); expect(notes).toMatch(/sem constar no pedido/);
    expect(await prisma.integrationMessage.count({ where: { eventType: 'receipt.divergent', payload: { path: ['receipt_id'], equals: r.id } } })).toBe(1); // ocorrência para Compras
  });

  it('7. conversão caixa → unidade pelo fator do código de embalagem; fração em unidade inteira é erro', async () => {
    const m = await mk('C7'); await stockIn(m, 24);
    await prisma.materialBarcode.create({ data: { materialId: m, code: `CX12-${sfx}`, kind: 'EMBALAGEM', factor: 12 } });
    const o = (await order(code('C7'), 24).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${o.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(gestor)).send(b);
    await t('start').expect(200);
    await t('scan', { pickingItemId: rel.items[0].id, locationId: prat, barcode: `CX12-${sfx}`, quantity: 1 }).expect(200);
    expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: rel.items[0].id } })).quantityPicked)).toBe(12); // 1 caixa = 12 UN
    const frac = await t('scan', { pickingItemId: rel.items[0].id, locationId: prat, materialId: m, quantity: 1.5 }).expect(400);
    expect(frac.body.code).toBe('UNIT_CONVERSION_ERROR');
  });

  it('8. cancelamento antes da reserva, durante o picking e após a expedição', async () => {
    const m = await mk('C8');
    const semEstoque = (await order(code('C8'), 2).expect(201)).body; // nada em estoque: antes da reserva
    expect(semEstoque.status).toBe('AGUARDANDO_ESTOQUE');
    expect((await api().post(`/api/v1/fulfillment-orders/${semEstoque.id}/cancel-request`).set(A(gestor)).send({ reason: 'Projeto cancelado' }).expect(200)).body.status).toBe('CANCELADA');

    await stockIn(m, 10);
    const d = (await order(code('C8'), 3).expect(201)).body; // durante o picking
    const rel = (await api().post(`/api/v1/fulfillment-orders/${d.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    await api().post(`/api/v1/picking-tasks/${rel.id}/start`).set(A(gestor)).expect(200);
    expect((await api().post(`/api/v1/fulfillment-orders/${d.id}/cancel-request`).set(A(gestor)).send({ reason: 'Cliente desistiu' }).expect(200)).body.status).toBe('CANCELAMENTO_SOLICITADO'); // não desfaz sozinho
    expect((await sums(m)).r).toBe(3);
    await api().post(`/api/v1/fulfillment-orders/${d.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Itens voltaram à prateleira' }).expect(200);
    expect((await sums(m)).r).toBe(0);

    const { pack, o } = await pickAndPack(code('C8'), m, 2); // após a expedição
    await dispatch(pack.id).expect(200);
    await api().post(`/api/v1/fulfillment-orders/${o.id}/cancel-request`).set(A(gestor)).send({ reason: 'Cliente desistiu' }).expect(200);
    await api().post(`/api/v1/fulfillment-orders/${o.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Tentativa' }).expect(409); // em trânsito: aguarda retorno
    expect((await sums(m)).q).toBe(10);
  });

  it('9. entrega parcial e recusa pelo recebedor', async () => {
    const m = await mk('C9'); await stockIn(m, 10);
    const o = (await order(code('C9'), 6).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${o.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(gestor)).send(b);
    await t('start').expect(200);
    await t('scan', { pickingItemId: rel.items[0].id, locationId: prat, materialId: m, quantity: 6 }).expect(200); await t('complete').expect(200);
    const pack = (await api().post(`/api/v1/fulfillment-orders/${o.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: rel.items[0].id, quantity: 4 }] }, { items: [{ pickingItemId: rel.items[0].id, quantity: 2 }] }] }).expect(201)).body;
    await dispatch(pack.id).expect(200);
    await deliver(pack.id, { outcome: 'PARCIAL', packageIds: [pack.packages[0].id] }).expect(200);
    expect((await sums(m)).q).toBe(6); expect(await orderStatus(o.id)).toBe('EXPEDIDA'); // pendência mantida
    await deliver(pack.id, { outcome: 'RECUSADA', notes: 'Recebedor recusou o restante' }).expect(200);
    expect(await orderStatus(o.id)).toBe('DIVERGENCIA'); expect((await sums(m)).q).toBe(6); // o recusado não foi baixado
  });

  it('10. transferência expedida, divergente e não recebida no prazo', async () => {
    const w2 = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `S10B-${sfx}`, name: 'Destino', type: 'CENTRAL' }).expect(201)).body.id as string;
    const l2 = (await api().post(`/api/v1/warehouses/${w2}/locations`).set(A(gestor)).send({ code: 'D1', level: 'AREA' }).expect(201)).body.id as string;
    const m = await mk('C10'); await stockIn(m, 10);
    const t = (await api().post('/api/v1/transfers').set(A(gestor)).send({ toWarehouseId: w2, reason: 'Reposição', urgent: true, items: [{ materialId: m, fromLocationId: prat, quantity: 6 }] }).expect(201)).body;
    await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(tokenFor(['gestor'], 'aprovador10'))).expect(200);
    const out = (await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(gestor)).expect(200)).body;
    await prisma.transfer.update({ where: { id: t.id }, data: { dispatchedAt: new Date(Date.now() - 5 * 86_400_000) } }); // passou do prazo
    await api().post('/api/v1/alerts/scan').set(A(gestor)).expect(200);
    expect((await prisma.alert.findFirstOrThrow({ where: { kind: 'TRANSITO_NAO_RECEBIDO', refId: t.id } })).status).not.toBe('RESOLVIDO');
    const rcv = (await api().post(`/api/v1/transfers/${t.id}/receive`).set(A(gestor)).send({ items: [{ itemId: out.items[0].id, receivedQty: 4, toLocationId: l2 }] }).expect(200)).body;
    expect(rcv.hasDivergence).toBe(true);
    expect((await sums(m, { location: { isVirtual: true } })).q).toBe(2); // o que faltou segue em trânsito, sem ajuste automático
    await api().post(`/api/v1/transfers/${t.id}/close`).set(A(gestor)).expect(422);
  });

  it('11. devolução de ferramenta avariada com manutenção', async () => {
    const m = await mk('C11', { type: 'FERRAMENTA', returnable: true, serialControlled: true, assetTagged: true, exitMethod: 'SERIE_ESPECIFICA' });
    const sn = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: m, serial: `C11-${sfx}`, assetTag: `PAT11-${sfx}` }).expect(201)).body.id as string;
    await stockIn(m, 1, prat, { serialId: sn });
    const { pack } = await pickAndPack(code('C11'), m, 1, {}, [sn]);
    await dispatch(pack.id).expect(200);
    await deliver(pack.id, { receiverAxisId: `emp-${sfx}` }).expect(200);
    const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
    const ret = (await api().post('/api/v1/returns').set(A(gestor)).send({ type: 'AVARIA', warehouseId: wh, receivingLocationId: doca, custodyTermId: term.id, items: [{ materialId: m, quantity: 1, serialId: sn }] }).expect(201)).body;
    await api().post(`/api/v1/returns/${ret.id}/items/${ret.items[0].id}/classify`).set(A(gestor)).send({ disposition: 'MANUTENCAO', notes: 'Cabo rompido; enviar à manutenção' }).expect(200);
    expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sn } })).condition).toBe('EM_MANUTENCAO');
    expect((await prisma.custodyTerm.findUniqueOrThrow({ where: { id: term.id } })).status).toBe('DEVOLVIDO');
    const av = (await api().get(`/api/v1/materials/${m}/availability`).set(A(gestor)).expect(200)).body;
    expect(av.available).toBe('0'); expect(av.blocked).toBe('1'); // fora do disponível até voltar da manutenção
  });

  it('12. EPI por tamanho, CA e lote entregue ao colaborador (termo de custódia)', async () => {
    const epi = await mk('C12M', { type: 'EPI', requiresCa: true, lotControlled: true, hasSizeGrid: true, shortDescription: 'Luva nitrílica — tamanho M' }); // cada tamanho é um SKU
    const r = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO12-${sfx}` }).expect(201)).body;
    const item = (await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(gestor)).send({ materialId: epi, quantity: 5, lotNumber: `L12-${sfx}` }).expect(201)).body;
    expect(item.inspectionReason).toMatch(/CA/); // CA conferido na inspeção antes de liberar
    await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(gestor)).expect(200);
    await api().put(`/api/v1/rbac/axis-role-mapping/hse-${sfx}`).set(A(admin)).send({ logisticsRoles: ['HSE_QUALIDADE'] }).expect(200);
    const hse = tokenFor([`hse-${sfx}`], `hse10-${sfx}`);
    await api().put(`/api/v1/rbac/users/hse10-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
    await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'CA 12345 válido conferido' }).expect(200);
    const put = await prisma.putawayTask.findFirstOrThrow({ where: { materialId: epi } });
    await api().post(`/api/v1/putaway-tasks/${put.id}/confirm`).set(A(gestor)).send({ locationId: prat }).expect(200);
    const lotId = (await prisma.lot.findFirstOrThrow({ where: { materialId: epi } })).id;
    const { pack } = await pickAndPack(code('C12M'), epi, 2);
    await dispatch(pack.id).expect(200);
    await deliver(pack.id, { receiverName: 'Colaborador', expectedReturnAt: day(180) }).expect(422); // EPI exige identificar o colaborador
    await deliver(pack.id, { receiverName: 'Colaborador', receiverAxisId: `emp-${sfx}`, signatureRef: 'ASS-EPI' }).expect(200);
    const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: epi } });
    expect(term).toMatchObject({ custodianAxisId: `emp-${sfx}`, lotId, acceptanceRef: 'ASS-EPI' });
    const doc = (await api().get(`/api/v1/documents/custody/${term.id}`).set(A(colab)).expect(200)).body;
    expect(doc.title).toBe('Termo de entrega e custódia');
  });

  it('13. desligamento com ativos e ferramentas pendentes', async () => {
    const m = await mk('C13', { type: 'FERRAMENTA', returnable: true }); await stockIn(m, 3);
    const { pack } = await pickAndPack(code('C13'), m, 1);
    await dispatch(pack.id).expect(200);
    await deliver(pack.id, { receiverAxisId: `gone-${sfx}` }).expect(200);
    const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
    await post('collaborator.created', { collaborator_id: `gone-${sfx}`, name: 'Fulano' }, randomUUID(), new Date(Date.now() - 60_000)).expect(200);
    await post('collaborator.offboarded', { collaborator_id: `gone-${sfx}`, offboarded_at: new Date().toISOString() }).expect(200);
    const pend = (await api().get('/api/v1/custody/offboarded-pending').set(A(gestor)).expect(200)).body;
    expect(pend.map((t: { id: string }) => t.id)).toContain(term.id);
    const novo = await pickAndPack(code('C13'), m, 1, { recipientAxisId: `gone-${sfx}` }).catch((e: Error) => e); // nova ordem já nasce bloqueada
    void novo;
    const o2 = (await order(code('C13'), 1, { recipientAxisId: `gone-${sfx}` }).expect(201)).body;
    expect(o2.status).toBe('BLOQUEADA');
  });

  it('14. inventário durante tentativa concorrente de movimentação', async () => {
    const m = await mk('C14'); await stockIn(m, 10, prat2);
    const c = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ENDERECO', warehouseId: wh, scope: { locationIds: [prat2] } }).expect(201)).body;
    const rs = await Promise.all([mv({ type: 'SAIDA_ENTREGA', materialId: m, quantity: 1, fromLocationId: prat2 }), mv({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: 1, toLocationId: prat2 })]);
    expect(rs.map((r) => r.status)).toEqual([422, 422]);
    expect((await sums(m)).q).toBe(10);
    await api().post(`/api/v1/stock-counts/${c.id}/cancel`).set(A(gestor)).send({ reason: 'Fim do cenário' }).expect(200);
    await mv({ type: 'SAIDA_ENTREGA', materialId: m, quantity: 1, fromLocationId: prat2 }).expect(201);
  });

  it('15. ajuste acima da tolerância sem e com aprovação do Axis', async () => {
    const m = await mk('C15'); await stockIn(m, 10, prat2);
    await mv({ type: 'AJUSTE_NEGATIVO', materialId: m, quantity: 2, fromLocationId: prat2 }).expect(400); // sem aprovação
    const c = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ITEM', warehouseId: wh, scope: { materialIds: [m] }, tolerancePct: 5 }).expect(201)).body;
    await api().post(`/api/v1/stock-counts/${c.id}/start`).set(A(gestor)).expect(200);
    const line = (await api().get(`/api/v1/stock-counts/${c.id}`).set(A(gestor)).expect(200)).body.lines[0];
    const cnt = (token: string, q: number) => api().post(`/api/v1/stock-counts/${c.id}/counts`).set(A(token)).send({ lineId: line.id, quantity: q });
    await cnt(rec, 7).expect(200);
    expect((await api().post(`/api/v1/stock-counts/${c.id}/close-round`).set(A(gestor)).expect(200)).body.status).toBe('EM_RECONTAGEM'); // 30% > 5%
    await cnt(tokenFor(['tecnico'], `rec10b-${sfx}`), 7).expect(403); // sem acesso ao almoxarifado
    await api().put(`/api/v1/rbac/users/rec10b-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
    await cnt(tokenFor(['tecnico'], `rec10b-${sfx}`), 7).expect(200);
    expect((await api().post(`/api/v1/stock-counts/${c.id}/close-round`).set(A(gestor)).expect(200)).body).toEqual({ status: 'APURADA', variances: 1 });
    const adj = (body: Record<string, unknown>) => api().post(`/api/v1/stock-counts/${c.id}/adjustments`).set(A(gestor)).send(body);
    await adj({ lines: [{ lineId: line.id, reason: 'PERDA' }] }).expect(400);
    await adj({ approvalRef: 'APR-S10', lines: [{ lineId: line.id, reason: 'PERDA' }] }).expect(200);
    expect((await sums(m)).q).toBe(7);
  });

  it('16. operação offline repetida e conflito ao sincronizar', async () => {
    const m = await mk('C16'); await stockIn(m, 10);
    const o = (await order(code('C16'), 2).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${o.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const op = (type: string, payload: Record<string, unknown>) => ({ opId: randomUUID(), type, payload, clientAt: new Date().toISOString() });
    const sync = (operations: unknown[], token: string, deviceId = `DEV-${sfx}`) => api().post('/api/v1/sync/batch').set(A(token)).send({ deviceId, operations });
    const start = op('picking.start', { id: rel.id });
    const scan = op('picking.scan', { id: rel.id, pickingItemId: rel.items[0].id, locationId: prat, materialId: m, quantity: 2 });
    const first = (await sync([start, scan], gestor).expect(200)).body.results;
    expect(first.map((r: { status: string }) => r.status)).toEqual(['APLICADA', 'APLICADA']);
    const again = (await sync([start, scan], gestor).expect(200)).body.results; // reenvio por perda de resposta
    expect(again.map((r: { status: string }) => r.status)).toEqual(['DUPLICADA', 'DUPLICADA']);
    const other = (await sync([op('picking.start', { id: rel.id })], tokenFor(['gestor'], 'outro-operador')).expect(200)).body.results[0]; // outro operador, tarefa já assumida
    expect(other.status).toBe('CONFLITO');
    expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: rel.items[0].id } })).quantityPicked)).toBe(2);
  });

  it('17. evento fora de ordem e webhook com assinatura inválida', async () => {
    const uid = `usr-${randomUUID()}`;
    await post('user.updated', { user_id: uid, roles: ['novo'] }, randomUUID(), new Date(Date.now() - 10_000)).expect(200);
    await post('user.updated', { user_id: uid, roles: ['antigo'] }, randomUUID(), new Date(Date.now() - 50_000)).expect(200); // chegou atrasado
    const row = await prisma.axisMasterCache.findUniqueOrThrow({ where: { kind_axisId: { kind: 'USER', axisId: uid } } });
    expect((row.data as { roles: string[] }).roles).toEqual(['novo']);
    const raw = JSON.stringify({ event_id: randomUUID(), event_type: 'ping', occurred_at: new Date().toISOString(), payload: {} });
    await api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', 'sha256=' + '0'.repeat(64)).send(raw).expect(401);
    await api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').send(raw).expect(401);
  });

  it('18. falha do Axis após movimento confirmado e reconciliação posterior', async () => {
    const m = await mk('C18'); const mov = (await stockIn(m, 3)).body;
    const ev = await prisma.integrationMessage.findFirstOrThrow({ where: { direction: 'OUTBOUND', eventType: 'stock.movement.posted', payload: { path: ['movement_id'], equals: mov.id } } });
    await prisma.integrationMessage.updateMany({ where: { direction: 'OUTBOUND', status: 'PENDING', id: { not: ev.id } }, data: { status: 'DELIVERED' } }); // isola este evento

    // Axis fora do ar: o movimento continua válido e o evento fica pendente com backoff.
    process.env.AXIS_EVENTS_URL = 'http://127.0.0.1:9/events';
    for (let i = 1; i <= 5; i++) {
      await prisma.integrationMessage.update({ where: { id: ev.id }, data: { nextAttemptAt: null } });
      const r = (await api().post('/api/v1/integration/outbox/dispatch').set(A(admin)).expect(200)).body;
      const row = await prisma.integrationMessage.findUniqueOrThrow({ where: { id: ev.id } });
      expect(row.attempts).toBe(i);
      if (i < 5) { expect(row.status).toBe('PENDING'); expect(row.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now()); expect(r.retried).toBeGreaterThanOrEqual(1); }
    }
    expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('FAILED'); // dead-letter
    expect((await sums(m)).q).toBe(3); // estoque intacto

    // Reconciliação: dead-letter e (adulteração direta do saldo) viram fila — sem correção silenciosa.
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: m } });
    await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: 4 } });
    const run = (await api().post('/api/v1/reconciliation/run').set(A(gestor)).expect(200)).body;
    expect(run.created).toBeGreaterThanOrEqual(2);
    const issues = (await api().get('/api/v1/reconciliation/issues').set(A(gestor)).expect(200)).body as Array<{ id: string; kind: string; refId: string; details: Record<string, string> }>;
    const drift = issues.find((i) => i.kind === 'BALANCE_VS_LEDGER' && i.refId === bal.id)!;
    expect(drift.details).toMatchObject({ balance: '4', ledger: '3' });
    expect(issues.some((i) => i.kind === 'OUTBOX_DEAD_LETTER' && i.refId === ev.id)).toBe(true);
    expect((await sums(m)).q).toBe(4); // a reconciliação detecta, não corrige
    await api().post('/api/v1/reconciliation/run').set(A(colab)).expect(403);

    // Axis volta: reenfileira a dead-letter; o evento chega assinado e idempotente.
    const received: Array<{ headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const server: Server = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.writeHead(200).end('{}'); }); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      process.env.AXIS_EVENTS_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/events`;
      process.env.AXIS_OUTBOUND_SECRET = 'segredo-saida-teste';
      await api().post(`/api/v1/integration/outbox/${ev.id}/retry`).set(A(admin)).expect(200);
      await api().post('/api/v1/integration/outbox/dispatch').set(A(admin)).expect(200);
      const got = received.find((r) => (JSON.parse(r.body) as { event_id: string }).event_id === ev.eventId)!;
      expect(got.headers['idempotency-key']).toBe(ev.eventId);
      expect(got.headers['x-logistica-signature']).toBe('sha256=' + createHmac('sha256', 'segredo-saida-teste').update(got.body).digest('hex'));
      expect((await prisma.integrationMessage.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('DELIVERED');
    } finally { server.close(); delete process.env.AXIS_EVENTS_URL; delete process.env.AXIS_OUTBOUND_SECRET; }

    await api().post(`/api/v1/reconciliation/issues/${drift.id}/resolve`).set(A(gestor)).send({ resolution: 'Saldo conferido fisicamente e ajustado por inventário' }).expect(200);
    await api().post(`/api/v1/reconciliation/issues/${drift.id}/resolve`).set(A(gestor)).send({ resolution: 'De novo' }).expect(409);
    await prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: 3 } });
  });

  it('19. material de terceiro é separado do estoque próprio', async () => {
    const m = await mk('C19');
    await stockIn(m, 5); await stockIn(m, 8, prat, { ownership: 'CLIENTE' });
    const av = (await api().get(`/api/v1/materials/${m}/availability`).query({ warehouse_id: wh }).set(A(gestor)).expect(200)).body;
    expect(av).toMatchObject({ physical: '5', available: '5' }); // só o próprio entra em disponível e em reserva
    const o = (await order(code('C19'), 7).expect(201)).body;
    expect(o.status).toBe('RESERVADA_PARCIAL'); expect(o.items[0].reserved).toBe('5');
    const bal = (await api().get('/api/v1/stock/balances').query({ materialId: m }).set(A(gestor)).expect(200)).body.items as Array<{ ownership: string; available: string }>;
    expect(bal.find((b) => b.ownership === 'CLIENTE')!.available).toBe('0');
    await mv({ type: 'SAIDA_ENTREGA', materialId: m, quantity: 6, fromLocationId: prat }).expect(422); // não consome o próprio com saldo de terceiro
  });

  it('20. lote vencido, próximo do vencimento e validade insuficiente no recebimento', async () => {
    const m = await mk('C20', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: 30 });
    const r = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO20-${sfx}` }).expect(201)).body;
    const scan = (lotNumber: string, d: number) => api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(gestor)).send({ materialId: m, quantity: 2, lotNumber: `${lotNumber}-${sfx}`, expiresAt: day(d) }).expect(201);
    await scan('VENC', -3); await scan('CURTA', 10); await scan('PROXIMO', 45); await scan('OK', 300);
    await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(gestor)).expect(200);
    const cond = async (l: string) => (await prisma.stockBalance.findMany({ where: { materialId: m, lot: { lotNumber: `${l}-${sfx}` } } })).map((b) => b.condition);
    expect(await cond('VENC')).toEqual(['BLOQUEADO']);
    expect(await cond('CURTA')).toEqual(['QUARENTENA']); // validade menor que o mínimo: inspeção decide
    expect(await cond('PROXIMO')).toEqual(['DISPONIVEL']); // dentro do mínimo, mas sob alerta de vencimento
    expect(await cond('OK')).toEqual(['DISPONIVEL']);
    await api().post('/api/v1/alerts/scan').set(A(gestor)).expect(200);
    const lotP = await prisma.lot.findFirstOrThrow({ where: { materialId: m, lotNumber: `PROXIMO-${sfx}` } });
    expect((await prisma.alert.findFirstOrThrow({ where: { kind: 'LOTE_VENCENDO', refId: lotP.id } })).data).toMatchObject({ bucket: 60 });
    const av = (await api().get(`/api/v1/materials/${m}/availability`).query({ warehouse_id: wh }).set(A(gestor)).expect(200)).body;
    expect(av).toMatchObject({ available: '4', blocked: '4' }); // vencido e em quarentena fora do disponível
  });
});

describe('Sprint 10 — auditoria completa', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], `gestor-aud-${sfx}`);
  const admin = tokenFor(['admin'], 'admin-s10');
  const colab = tokenFor(['colaborador'], `colab-aud-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const wait = () => new Promise((r) => setTimeout(r, 150)); // a gravação da auditoria não bloqueia a resposta

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  it('toda mutação é auditada com ator, rota e correlation id; só nomes de campos, nunca valores', async () => {
    const res = await api().post('/api/v1/warehouses').set(A(gestor)).set('X-Correlation-Id', `corr-${sfx}-0001`).send({ code: `AUD-${sfx}`, name: 'Segredo do almoxarifado', type: 'CENTRAL' }).expect(201);
    expect(res.headers['x-correlation-id']).toBe(`corr-${sfx}-0001`);
    await wait();
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { correlationId: `corr-${sfx}-0001`, action: 'request.post' } });
    expect(ev).toMatchObject({ actorAxisId: `gestor-aud-${sfx}`, aggregateType: 'warehouses', aggregateId: res.body.id });
    expect(ev.diff).toMatchObject({ method: 'POST', route: '/api/v1/warehouses', status: 201, bodyFields: ['code', 'name', 'type'] });
    expect(JSON.stringify(ev.diff)).not.toMatch(/Segredo/);
    const gen = await api().get('/api/v1/health').expect(200);
    expect(gen.headers['x-correlation-id']).toMatch(/^[\w-]{8,}/); // gerado quando o cliente não envia
  });

  it('acessos sensíveis (documentos, painel, custódia, trilha) e negações de permissão são registrados', async () => {
    await api().get('/api/v1/dashboard/kpis').set(A(gestor)).set('X-Correlation-Id', `corr-${sfx}-0002`).expect(200);
    await api().get('/api/v1/documents/movements').set(A(gestor)).set('X-Correlation-Id', `corr-${sfx}-0003`).expect(200);
    await api().get('/api/v1/dashboard/kpis').set(A(colab)).set('X-Correlation-Id', `corr-${sfx}-0004`).expect(403);
    await api().get('/api/v1/materials').set(A(colab)).expect(200); // leitura comum não polui a trilha
    await wait();
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { correlationId: `corr-${sfx}-0002` } })).action).toBe('access.sensitive');
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { correlationId: `corr-${sfx}-0003` } })).action).toBe('access.sensitive');
    expect(await prisma.auditEvent.findFirstOrThrow({ where: { correlationId: `corr-${sfx}-0004` } })).toMatchObject({ action: 'access.denied', actorAxisId: `colab-aud-${sfx}` });
    expect(await prisma.auditEvent.count({ where: { actorAxisId: `colab-aud-${sfx}`, action: 'request.get' } })).toBe(0);
  });

  it('consulta da trilha: filtros, paginação e permissão; registros não podem ser alterados nem apagados', async () => {
    const q = (qs: Record<string, string>, token = gestor) => api().get('/api/v1/audit/events').query(qs).set(A(token));
    const byCorr = (await q({ correlationId: `corr-${sfx}-0001` }).expect(200)).body;
    expect(byCorr.total).toBeGreaterThanOrEqual(1);
    const byActor = (await q({ actor: `colab-aud-${sfx}`, action: 'access.denied' }).expect(200)).body;
    expect(byActor.items.every((i: { actorAxisId: string }) => i.actorAxisId === `colab-aud-${sfx}`)).toBe(true);
    expect((await q({ pageSize: '2' }).expect(200)).body.items).toHaveLength(2);
    await q({ pageSize: '500' }).expect(400);
    await q({ from: '31/12/2026' }).expect(400);
    await q({}, colab).expect(403);
    await expect(prisma.auditEvent.updateMany({ data: { action: 'adulterado' } })).rejects.toThrow();
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow();
    // A própria consulta da trilha é registrada como acesso sensível.
    await wait();
    expect(await prisma.auditEvent.count({ where: { actorAxisId: `gestor-aud-${sfx}`, aggregateType: 'audit', action: 'access.sensitive' } })).toBeGreaterThan(0);
  });

  it('agendador desligado por padrão; fila de saída só é consultada por quem integra', async () => {
    expect(process.env.SCHEDULER_ENABLED).not.toBe('true');
    const st = (await api().get('/api/v1/integration/outbox/status').set(A(admin)).expect(200)).body;
    expect(st).toHaveProperty('counts'); expect(st).toHaveProperty('configured');
    await api().get('/api/v1/integration/outbox/status').set(A(colab)).expect(403);
    process.env.AXIS_EVENTS_URL = '';
    const d = (await api().post('/api/v1/integration/outbox/dispatch').set(A(admin)).expect(200)).body;
    expect(d).toMatchObject({ enabled: false, delivered: 0 }); // sem URL configurada nada é enviado nem perdido
    await api().post(`/api/v1/integration/outbox/${randomUUID()}/retry`).set(A(admin)).expect(404);
  });
});
