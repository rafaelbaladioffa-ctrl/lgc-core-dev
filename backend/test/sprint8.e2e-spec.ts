import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const sign = (body: string) => 'sha256=' + createHmac('sha256', WH_SECRET).update(body).digest('hex');

describe('Sprint 8 — reposição, alertas e indicadores', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s8');
  const admin = tokenFor(['admin'], 'admin-s8');
  const rec = tokenFor(['tecnico'], `rec8-${sfx}`);
  const outsider = tokenFor(['tecnico'], `out8-${sfx}`);
  const colab = tokenFor(['colaborador'], 'colab-s8');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let un: string;
  const newWh = async (tag: string) => {
    const code = `S8${tag}-${sfx}`;
    const id = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code, name: `Almox ${code}`, type: 'CENTRAL' }).expect(201)).body.id as string;
    const loc = (await api().post(`/api/v1/warehouses/${id}/locations`).set(A(gestor)).send({ code: 'L1', level: 'AREA' }).expect(201)).body.id as string;
    return { id, code, loc };
  };
  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S8-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const mv = (type: string, materialId: string, quantity: number, loc: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type, materialId, quantity, reason: 'Teste de reposição', ...(type.startsWith('ENTRADA') ? { toLocationId: loc } : { fromLocationId: loc }), ...extra });
  const stockIn = (m: string, q: number, loc: string, extra: Record<string, unknown> = {}) => mv('ENTRADA_RECEBIMENTO', m, q, loc, extra).expect(201);
  const policy = (materialId: string, warehouseId: string, body: Record<string, unknown>, token = gestor) => api().put('/api/v1/stock-policies').set(A(token)).send({ materialId, warehouseId, minQty: 0, ...body });
  const calc = (warehouseId: string, token = gestor) => api().post('/api/v1/replenishment/calculate').set(A(token)).send({ warehouseId });
  const sugOf = async (materialId: string, wh: string) => prisma.replenishmentSuggestion.findMany({ where: { materialId, warehouseId: wh }, orderBy: { seq: 'asc' } });
  const scan = () => api().post('/api/v1/alerts/scan').set(A(gestor)).expect(200);
  const alertsOf = async (refId: string) => prisma.alert.findMany({ where: { refId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
  });
  afterAll(async () => app.close());

  describe('parâmetros e cálculo de reposição', () => {
    it('valida os parâmetros e as permissões', async () => {
      const w = await newWh('POL'); const m = await mk('POL');
      await policy(m, w.id, { minQty: 10, maxQty: 5 }).expect(400); // máximo < mínimo
      await policy(m, w.id, { minQty: -1 }).expect(400);
      await policy(m, w.id, { minQty: 1.5 }).expect(400); // UN inteiro
      await policy('x', w.id, {}).expect(400);
      await policy(randomUUID(), w.id, {}).expect(404);
      await policy(m, w.id, {}, rec).expect(403);
      await policy(m, w.id, {}, colab).expect(403);
      const ok = await policy(m, w.id, { minQty: 5, maxQty: 50, safetyQty: 2 }).expect(200);
      expect(ok.body).toMatchObject({ materialId: m, warehouseId: w.id });
      await policy(m, w.id, { minQty: 6, maxQty: 60 }, admin).expect(403); // admin técnico não tem escopo operacional
      await policy(m, w.id, { minQty: 6, maxQty: 60 }).expect(200); // upsert
      expect(await prisma.stockPolicy.count({ where: { materialId: m, warehouseId: w.id } })).toBe(1);
      const list = await api().get('/api/v1/stock-policies').query({ warehouseId: w.id }).set(A(gestor)).expect(200);
      expect(list.body).toHaveLength(1);
    });

    it('calcula por consumo, lead time, segurança e múltiplo de compra; recalcula sem duplicar', async () => {
      const w = await newWh('CAL');
      const m = await mk('CAL', { leadTimeDays: 5, purchaseMultiple: 10 });
      await stockIn(m, 20, w.loc);
      await mv('SAIDA_ENTREGA', m, 9, w.loc).expect(201); // consumo: 9 em 90 dias → 0,1/dia; saldo 11
      await policy(m, w.id, { minQty: 30, maxQty: 100, safetyQty: 5 }).expect(200);
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions).toHaveLength(1);
      expect(r.suggestions[0]).toMatchObject({ materialId: m, suggestedQty: '90', action: 'criada' }); // alvo 100 − posição 11 = 89 → múltiplo de 10
      expect(r.suggestions[0].code).toMatch(/^REP-\d{8}$/);
      const [s] = await sugOf(m, w.id);
      expect(s.status).toBe('ABERTA');
      expect(s.justification).toMatchObject({ available: '11', incoming: '0', leadTimeDays: 5, safetyQty: '5', reorderPoint: '6', minQty: '30', maxQty: '100', purchaseMultiple: '10' });
      expect(Number((s.justification as { avgDailyConsumption: string }).avgDailyConsumption)).toBeCloseTo(0.1, 5);

      const again = (await calc(w.id).expect(200)).body;
      expect(again.suggestions[0].action).toBe('atualizada');
      expect(await sugOf(m, w.id)).toHaveLength(1);
      await calc(w.id, outsider).expect(403);
      await calc(w.id, colab).expect(403);
      await api().post('/api/v1/replenishment/calculate').set(A(gestor)).send({ warehouseId: 'x' }).expect(400);
    });

    it('item sem necessidade não gera sugestão; sugestão aberta superada é descartada no recálculo', async () => {
      const w = await newWh('SUP');
      const m = await mk('SUP');
      await stockIn(m, 3, w.loc);
      await policy(m, w.id, { minQty: 10, maxQty: 40 }).expect(200);
      await calc(w.id).expect(200);
      const [s] = await sugOf(m, w.id);
      expect(s.status).toBe('ABERTA');
      expect(Number(s.suggestedQty)).toBe(37);
      await stockIn(m, 60, w.loc); // chegou material por outro caminho
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions).toHaveLength(0);
      expect(r.superseded).toBe(1);
      const after = await prisma.replenishmentSuggestion.findUniqueOrThrow({ where: { id: s.id } });
      expect(after).toMatchObject({ status: 'DESCARTADA', discardReason: 'Necessidade superada no recálculo' });
    });

    it('considera a demanda aprovada futura e a consolida por projeto/data nas evidências', async () => {
      const w = await newWh('DEM');
      const m = await mk('DEM');
      await stockIn(m, 10, w.loc);
      await policy(m, w.id, { minQty: 0, maxQty: 100 }).expect(200);
      const order = async (qty: number, project: string, neededBy: string) => api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8-${randomUUID()}`, warehouseCode: w.code, projectAxisId: project, neededBy, items: [{ materialCode: `S8-DEM-${sfx}`, quantity: qty }] }).expect(201);
      await order(30, 'prj-a', day(10)); // reserva os 10 e deixa 20 sem cobertura
      await order(15, 'prj-b', day(10));
      await calc(w.id).expect(200);
      const [s] = await sugOf(m, w.id);
      const j = s.justification as { approvedDemand: Array<{ project: string; qty: string }>; projectedOnHorizon: string };
      expect(j.approvedDemand.map((d) => `${d.project}:${d.qty}`).sort()).toEqual(['prj-a:20', 'prj-b:15']);
      expect(Number(s.suggestedQty)).toBeGreaterThanOrEqual(35);
    });

    it('envia ao Axis sem criar pedido; compra em aberto evita nova sugestão; pedido aprovado vira previsão; recebimento atende', async () => {
      const w = await newWh('FLW');
      const m = await mk('FLW', { purchaseMultiple: 10 });
      await policy(m, w.id, { minQty: 20, maxQty: 100 }).expect(200);
      await stockIn(m, 5, w.loc);
      await calc(w.id).expect(200);
      const [s] = await sugOf(m, w.id);
      expect(Number(s.suggestedQty)).toBe(100 - 5 > 0 ? 100 : 0); // 95 → 100
      await api().post(`/api/v1/replenishment/suggestions/${s.id}/send`).set(A(colab)).expect(403);
      const sent = await api().post(`/api/v1/replenishment/suggestions/${s.id}/send`).set(A(gestor)).expect(200);
      expect(sent.body.status).toBe('ENVIADA_AXIS');
      await api().post(`/api/v1/replenishment/suggestions/${s.id}/send`).set(A(gestor)).expect(409);
      const evt = await prisma.integrationMessage.findFirstOrThrow({ where: { eventType: 'replenishment.suggested', correlationId: s.id } });
      expect(evt.payload).toMatchObject({ suggestion_id: s.id, material_code: `S8-FLW-${sfx}`, quantity: '100', warehouse_id: w.id });
      expect(JSON.stringify(evt.payload)).toMatch(/justification/);
      expect(await prisma.fulfillmentOrder.count({ where: { warehouseId: w.id } })).toBe(0); // nenhum pedido autônomo

      const none = (await calc(w.id).expect(200)).body;
      expect(none.suggestions).toHaveLength(0); // compra em aberto cobre a necessidade
      await api().post(`/api/v1/replenishment/suggestions/${s.id}/discard`).set(A(gestor)).send({ reason: 'x' }).expect(400);

      // Axis aprova o pedido (evento purchase_order.approved) com previsão.
      const po = `PO-${sfx}`;
      const post = (type: string, payload: Record<string, unknown>) => {
        const raw = JSON.stringify({ event_id: randomUUID(), event_type: type, occurred_at: new Date().toISOString(), payload });
        return api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sign(raw)).send(raw);
      };
      await post('purchase_order.approved', { purchase_order_id: po, warehouse_code: w.code, expected_date: day(7), items: [{ material_code: `S8-FLW-${sfx}`, quantity: 90, suggestion_id: s.id }] }).expect(200);
      const approved = await prisma.replenishmentSuggestion.findUniqueOrThrow({ where: { id: s.id } });
      expect(approved).toMatchObject({ status: 'APROVADA_AXIS', axisPurchaseOrderId: po });
      expect(Number(approved.approvedQty)).toBe(90);
      expect(approved.expectedAt?.toISOString().slice(0, 10)).toBe(day(7));
      expect((await post('purchase_order.approved', { purchase_order_id: po, warehouse_code: 'NAO-EXISTE', items: [{ material_code: `S8-FLW-${sfx}`, quantity: 1 }] })).status).toBe(400);
      expect((await post('purchase_order.approved', { purchase_order_id: po, warehouse_code: w.code, items: [{ material_code: `S8-FLW-${sfx}`, quantity: -3 }] })).status).toBe(400);
      expect((await post('purchase_order.cancelled', { purchase_order_id: po })).body.status).toBe('ignored');

      // Recebimento contra o pedido encerra o ciclo.
      await api().put(`/api/v1/rbac/users/rec8-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [w.id] }).expect(200);
      const r = (await api().post('/api/v1/receipts').set(A(rec)).send({ warehouseId: w.id, receivingLocationId: w.loc, axisPurchaseOrderId: po }).expect(201)).body;
      await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(rec)).send({ materialId: m, quantity: 90 }).expect(201);
      await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(rec)).expect(200);
      expect((await prisma.replenishmentSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ATENDIDA');
      await api().post(`/api/v1/replenishment/suggestions/${s.id}/discard`).set(A(gestor)).send({ reason: 'Tarde demais' }).expect(409);
    });

    it('pedido do Axis sem sugestão prévia entra como previsão; descarte exige motivo e lista filtra por status e escopo', async () => {
      const w = await newWh('ORF');
      const m = await mk('ORF');
      const raw = JSON.stringify({ event_id: randomUUID(), event_type: 'purchase_order.approved', occurred_at: new Date().toISOString(), payload: { purchase_order_id: `PO-ORF-${sfx}`, warehouse_code: w.code, items: [{ material_code: `S8-ORF-${sfx}`, quantity: 12 }] } });
      await api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sign(raw)).send(raw).expect(200);
      const [s] = await sugOf(m, w.id);
      expect(s).toMatchObject({ status: 'APROVADA_AXIS' });
      await policy(m, w.id, { minQty: 15, maxQty: 20 }).expect(200);
      await stockIn(m, 1, w.loc);
      expect((await calc(w.id).expect(200)).body.suggestions[0].suggestedQty).toBe('7'); // 20 − (1 + 12 a caminho)

      const open = await api().get('/api/v1/replenishment/suggestions').query({ warehouseId: w.id, status: 'ABERTA' }).set(A(gestor)).expect(200);
      expect(open.body).toHaveLength(1);
      await api().post(`/api/v1/replenishment/suggestions/${open.body[0].id}/discard`).set(A(gestor)).send({ reason: 'Compra já feita por fora' }).expect(200);
      await api().get('/api/v1/replenishment/suggestions').query({ status: 'INVENTADO' }).set(A(gestor)).expect(400);
      const hidden = await api().get('/api/v1/replenishment/suggestions').query({ warehouseId: w.id }).set(A(outsider)).expect(403);
      void hidden;
    });
  });

  describe('alertas', () => {
    it('estoque abaixo do ponto de reposição e ruptura: idempotente, crítico gera evento e se resolve sozinho', async () => {
      const w = await newWh('ALR');
      const m = await mk('ALR');
      await policy(m, w.id, { minQty: 5, maxQty: 20 }).expect(200);
      const first = (await scan()).body;
      expect(first.created).toBeGreaterThanOrEqual(1);
      const [a] = await alertsOf(m);
      expect(a).toMatchObject({ kind: 'ESTOQUE_ABAIXO_PONTO_REPOSICAO', severity: 'CRITICO', status: 'ABERTO', responsibleRole: 'COMPRAS', warehouseId: w.id });
      expect(await prisma.integrationMessage.count({ where: { eventType: 'alert.raised', payload: { path: ['alert_id'], equals: a.id } } })).toBe(1);
      await scan();
      expect(await alertsOf(m)).toHaveLength(1); // sem duplicar
      expect(await prisma.integrationMessage.count({ where: { eventType: 'alert.raised', payload: { path: ['alert_id'], equals: a.id } } })).toBe(1);

      await stockIn(m, 3, w.loc); // abaixo do ponto, mas com estoque: rebaixa para ATENÇÃO
      await scan();
      expect((await alertsOf(m))[0]).toMatchObject({ severity: 'ATENCAO', status: 'ABERTO' });
      await stockIn(m, 30, w.loc);
      await scan();
      expect((await alertsOf(m))[0]).toMatchObject({ status: 'RESOLVIDO' });
      expect((await alertsOf(m))[0].resolvedAt).not.toBeNull();

      // ruptura prevista: demanda aprovada maior que o disponível
      const r = await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8-${randomUUID()}`, warehouseCode: w.code, neededBy: day(3), items: [{ materialCode: `S8-ALR-${sfx}`, quantity: 80 }] }).expect(201);
      expect(r.body.status).toBe('RESERVADA_PARCIAL');
      await scan();
      expect((await alertsOf(m)).some((x) => x.kind === 'RUPTURA_PREVISTA' || x.kind === 'ESTOQUE_ABAIXO_PONTO_REPOSICAO')).toBe(true);
    });

    it('lotes vencendo (90/60/30/7 dias e vencido), reserva expirando e material bloqueado ainda reservado', async () => {
      const w = await newWh('LOT');
      const m = await mk('LOT', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const lot = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m, lotNumber: `${n}-${sfx}`, expiresAt: day(d) }).expect(201)).body.id as string;
      const l5 = await lot('A', 5); const l25 = await lot('B', 25); const l55 = await lot('C', 55); const l85 = await lot('D', 85); const l200 = await lot('E', 200);
      for (const id of [l5, l25, l55, l85, l200]) await stockIn(m, 2, w.loc, { lotId: id });
      const lx = await lot('X', 200);
      await stockIn(m, 1, w.loc, { lotId: lx });
      await prisma.lot.update({ where: { id: lx }, data: { expiresAt: new Date(day(-2)) } }); // vence depois de entrar
      await scan();
      const sev = async (id: string) => (await alertsOf(id)).map((a) => `${a.kind}:${a.severity}:${(a.data as { bucket?: number }).bucket}`);
      expect(await sev(l5)).toEqual(['LOTE_VENCENDO:CRITICO:7']);
      expect(await sev(l25)).toEqual(['LOTE_VENCENDO:ATENCAO:30']);
      expect(await sev(l55)).toEqual(['LOTE_VENCENDO:INFO:60']);
      expect(await sev(l85)).toEqual(['LOTE_VENCENDO:INFO:90']);
      expect(await sev(l200)).toEqual([]);
      expect(await sev(lx)).toEqual(['LOTE_VENCENDO:CRITICO:0']);
      expect((await alertsOf(lx))[0].message).toMatch(/VENCIDO/);

      // reserva expirando em < 48 h e lote bloqueado com reserva ativa
      const o = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8-${randomUUID()}`, warehouseCode: w.code, items: [{ materialCode: `S8-LOT-${sfx}`, quantity: 2 }] }).expect(201)).body;
      const resv = await prisma.reservation.findFirstOrThrow({ where: { item: { orderId: o.id } } });
      await prisma.reservation.update({ where: { id: resv.id }, data: { expiresAt: new Date(Date.now() + 3_600_000) } });
      await prisma.lot.update({ where: { id: resv.lotId! }, data: { status: 'BLOQUEADO' } });
      await scan();
      const kinds = (await alertsOf(resv.id)).map((a) => `${a.kind}:${a.severity}`).sort();
      expect(kinds).toEqual(['MATERIAL_BLOQUEADO_RESERVADO:CRITICO', 'RESERVA_EXPIRANDO:ATENCAO']);
    });

    it('requisição parada, trânsito atrasado, custódia vencida, inventário apurado e falhas de integração', async () => {
      const w = await newWh('MIX'); const w2 = await newWh('MX2');
      const m = await mk('MIX'); await stockIn(m, 10, w.loc);
      const o = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8-${randomUUID()}`, warehouseCode: w.code, items: [{ materialCode: `S8-MIX-${sfx}`, quantity: 1 }] }).expect(201)).body;
      await prisma.fulfillmentOrder.update({ where: { id: o.id }, data: { updatedAt: new Date(Date.now() - 30 * 3_600_000) } });
      const trf = await prisma.transfer.create({ data: { fromWarehouseId: w.id, toWarehouseId: w2.id, status: 'EM_TRANSITO', reason: 'Teste', requestedBy: 'x', dispatchedAt: new Date(Date.now() - 4 * 86_400_000) } });
      const cus = await prisma.custodyTerm.create({ data: { custodianAxisId: `emp-${sfx}`, materialId: m, quantity: 1, expectedReturnAt: new Date(day(-3)), createdBy: 'x' } });
      const cnt = await prisma.stockCount.create({ data: { type: 'GERAL', warehouseId: w.id, status: 'APURADA', createdBy: 'x' } });
      const failed = await prisma.integrationMessage.create({ data: { direction: 'INBOUND', eventId: randomUUID(), eventType: 'project.created', occurredAt: new Date(), payload: {}, status: 'FAILED', lastError: 'project_id ausente' } });
      await scan();
      expect((await alertsOf(o.id)).map((a) => a.kind)).toEqual(['REQUISICAO_SEM_MOVIMENTO']);
      expect((await alertsOf(trf.id)).map((a) => a.kind)).toEqual(['TRANSITO_NAO_RECEBIDO']);
      expect((await alertsOf(cus.id))[0]).toMatchObject({ kind: 'CUSTODIA_VENCIDA', responsibleRole: 'CONTROLE_PATRIMONIO' });
      expect((await alertsOf(cnt.id))[0]).toMatchObject({ kind: 'DIVERGENCIA_INVENTARIO', warehouseId: w.id });
      expect((await alertsOf(failed.id))[0]).toMatchObject({ kind: 'FALHA_INTEGRACAO', severity: 'CRITICO', responsibleRole: 'ADMIN_TECNICO' });
      expect((await alertsOf(failed.id))[0].message).toMatch(/project_id ausente/);

      // resolvido o motivo, a varredura encerra o alerta
      await prisma.custodyTerm.update({ where: { id: cus.id }, data: { status: 'DEVOLVIDO' } });
      await prisma.stockCount.update({ where: { id: cnt.id }, data: { status: 'CONCLUIDA' } });
      await prisma.integrationMessage.update({ where: { id: failed.id }, data: { status: 'PROCESSED' } });
      await scan();
      expect((await alertsOf(cus.id))[0].status).toBe('RESOLVIDO');
      expect((await alertsOf(cnt.id))[0].status).toBe('RESOLVIDO');
      expect((await alertsOf(failed.id))[0].status).toBe('RESOLVIDO');
      expect((await alertsOf(o.id))[0].status).toBe('ABERTO');
    });

    it('lista com filtros e escopo; reconhecer; permissões', async () => {
      const w = await newWh('LST');
      const m = await mk('LST'); await policy(m, w.id, { minQty: 5 }).expect(200);
      await scan();
      const [a] = await alertsOf(m);
      const all = await api().get('/api/v1/alerts').query({ warehouseId: w.id, severity: 'CRITICO', role: 'COMPRAS' }).set(A(gestor)).expect(200);
      expect(all.body.map((x: { id: string }) => x.id)).toContain(a.id);
      await api().get('/api/v1/alerts').query({ severity: 'ENORME' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/alerts').set(A(colab)).expect(403);
      const scoped = await api().get('/api/v1/alerts').set(A(outsider)).expect(200); // almoxarife sem acesso ao almoxarifado
      expect(scoped.body.map((x: { id: string }) => x.id)).not.toContain(a.id);
      await api().post(`/api/v1/alerts/${a.id}/acknowledge`).set(A(outsider)).expect(403);
      await api().post(`/api/v1/alerts/${randomUUID()}/acknowledge`).set(A(gestor)).expect(404);
      const ack = await api().post(`/api/v1/alerts/${a.id}/acknowledge`).set(A(gestor)).expect(200);
      expect(ack.body).toMatchObject({ status: 'RECONHECIDO', acknowledgedBy: 'gestor-s8' });
      await api().post(`/api/v1/alerts/${a.id}/acknowledge`).set(A(gestor)).expect(409);
      await scan();
      expect((await alertsOf(m))[0].status).toBe('RECONHECIDO'); // varredura não reabre nem duplica
      await api().post('/api/v1/alerts/scan').set(A(rec)).expect(403);
      await api().post('/api/v1/alerts/scan').set(A(colab)).expect(403);
    });
  });

  describe('indicadores', () => {
    it('KPIs do almoxarifado: acuracidade, nível de serviço, ciclo, estoque, vencimentos, consumo e integração', async () => {
      const w = await newWh('KPI');
      const m = await mk('KPI'); await prisma.material.update({ where: { id: m }, data: { averageCost: 5 } });
      const lm = await mk('KPL', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const lot = (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lm, lotNumber: `K-${sfx}`, expiresAt: day(20) }).expect(201)).body.id as string;
      await stockIn(m, 20, w.loc, { unitCost: 5 }); await stockIn(lm, 4, w.loc, { lotId: lot });
      await policy(m, w.id, { minQty: 50 }).expect(200);
      const dry = await mk('DRY'); await policy(dry, w.id, { minQty: 3 }).expect(200);

      // pedido entregue no prazo
      const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8-${randomUUID()}`, warehouseCode: w.code, projectAxisId: `prj-kpi-${sfx}`, costCenterAxisId: `cc-kpi-${sfx}`, neededBy: day(2), items: [{ materialCode: `S8-KPI-${sfx}`, quantity: 6 }] }).expect(201)).body;
      const rel = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
      const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(gestor)).send(b);
      await t('start').expect(200);
      await t('scan', { pickingItemId: rel.items[0].id, locationId: w.loc, materialId: m, quantity: 6 }).expect(200);
      await t('complete').expect(200);
      const pack = (await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: rel.items[0].id, quantity: 6 }] }] }).expect(201)).body;
      await api().post(`/api/v1/shipments/${pack.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }).expect(200);
      await api().post(`/api/v1/shipments/${pack.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(200);

      // inventário concluído sem divergência
      const cnt = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ITEM', warehouseId: w.id, scope: { materialIds: [m] } }).expect(201)).body;
      await api().post(`/api/v1/stock-counts/${cnt.id}/start`).set(A(gestor)).expect(200);
      const lines = (await api().get(`/api/v1/stock-counts/${cnt.id}`).set(A(gestor)).expect(200)).body.lines as Array<{ id: string; systemQty: string }>;
      for (const l of lines) await api().post(`/api/v1/stock-counts/${cnt.id}/counts`).set(A(gestor)).send({ lineId: l.id, quantity: Number(l.systemQty) }).expect(200);
      expect((await api().post(`/api/v1/stock-counts/${cnt.id}/close-round`).set(A(gestor)).expect(200)).body.status).toBe('CONCLUIDA');
      await scan();

      const k = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(k.accuracy).toMatchObject({ counted: 1, matched: 1, pct: 100 });
      expect(k.serviceLevel).toMatchObject({ orders: 1, delivered: 1, onTime: 1, fillRatePct: 100 });
      for (const key of ['approvalToReservation', 'reservationToPicking', 'pickingToDispatch', 'dispatchToDelivery']) expect(typeof k.cycleHours[key]).toBe('number');
      expect(k.stock).toMatchObject({ policies: 2, stockouts: 1, belowMin: 2 });
      expect(k.expiring.ate30).toBe(1);
      expect(k.consumption.top[0]).toMatchObject({ project: `prj-kpi-${sfx}`, costCenter: `cc-kpi-${sfx}`, quantity: '6' });
      expect(k.consumption.valueByProject.find((v: { project: string }) => v.project === `prj-kpi-${sfx}`).valueBRL).toMatch(/R\$\s30,00/);
      expect(k.lossesAndAdjustments).toEqual([]);
      expect(k.custody).toEqual({ byStatus: expect.any(Object), overdue: expect.any(Number) });
      expect(k.integration).toMatchObject({ pendingOutbound: expect.any(Number), failedInbound: expect.any(Number) });
      expect(k.alerts).toEqual(expect.any(Object));
      expect(JSON.stringify(k)).not.toMatch(/picker|pickedBy|userId/); // sem ranking individual
    });

    it('permissões, escopo e validação; sem custo, o valor do consumo não aparece', async () => {
      const w = await newWh('KP2');
      await api().get('/api/v1/dashboard/kpis').set(A(colab)).expect(403);
      await api().get('/api/v1/dashboard/kpis').set(A(rec)).expect(403); // almoxarife não vê o painel gerencial
      await api().get('/api/v1/dashboard/kpis').set(A(admin)).expect(403);
      await api().get('/api/v1/dashboard/kpis').query({ warehouseId: 'x' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/dashboard/kpis').query({ from: '31/12/2026' }).set(A(gestor)).expect(400);
      const empty = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(empty.accuracy.pct).toBeNull();
      expect(empty.serviceLevel).toMatchObject({ orders: 0, fillRatePct: null });
      expect(empty.stock.avgCoverageDays).toBeNull();
      expect(empty.occupancy.locationsWithCapacity).toBe(0);
    });
  });
});
