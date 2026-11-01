import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Bordas do Sprint 8 (reposição, alertas, indicadores). Cada arquivo usa sufixo próprio e filtra por
// almoxarifados/ids criados aqui, porque o banco de teste é compartilhado.

const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const sign = (body: string) => 'sha256=' + createHmac('sha256', WH_SECRET).update(body).digest('hex');

describe('Sprint 8 (bordas) — reposição, alertas e indicadores', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = ('E' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s8e');
  const admin = tokenFor(['admin'], 'admin-s8e');
  const tecnico = tokenFor(['tecnico'], `tec8e-${sfx}`);
  const colab = tokenFor(['colaborador'], 'colab-s8e');
  const compras = tokenFor(['compras'], `compras8e-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let un: string;
  let kg: { id: string; precision: number };
  const newWh = async (tag: string) => {
    const code = `S8E${tag}-${sfx}`;
    const id = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code, name: `Almox ${code}`, type: 'CENTRAL' }).expect(201)).body.id as string;
    const loc = (await api().post(`/api/v1/warehouses/${id}/locations`).set(A(gestor)).send({ code: 'L1', level: 'AREA' }).expect(201)).body.id as string;
    return { id, code, loc };
  };
  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S8E-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const mv = (type: string, materialId: string, quantity: number, loc: string, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type, materialId, quantity, reason: 'Teste de borda S8', ...(type.startsWith('ENTRADA') ? { toLocationId: loc } : { fromLocationId: loc }), ...extra });
  const stockIn = (m: string, q: number, loc: string, extra: Record<string, unknown> = {}) => mv('ENTRADA_RECEBIMENTO', m, q, loc, extra).expect(201);
  const stockOut = (m: string, q: number, loc: string) => mv('SAIDA_ENTREGA', m, q, loc).expect(201);
  const policy = (materialId: string, warehouseId: string, body: Record<string, unknown>, token = gestor) => api().put('/api/v1/stock-policies').set(A(token)).send({ materialId, warehouseId, minQty: 0, ...body });
  const calc = (warehouseId: string, token = gestor) => api().post('/api/v1/replenishment/calculate').set(A(token)).send({ warehouseId });
  const sugOf = (materialId: string, wh: string) => prisma.replenishmentSuggestion.findMany({ where: { materialId, warehouseId: wh }, orderBy: { seq: 'asc' } });
  const scan = () => api().post('/api/v1/alerts/scan').set(A(gestor)).expect(200);
  const alertsOf = (refId: string) => prisma.alert.findMany({ where: { refId }, orderBy: { createdAt: 'asc' } });
  const webhook = (type: string, payload: Record<string, unknown>, eventId = randomUUID()) => {
    const raw = JSON.stringify({ event_id: eventId, event_type: type, occurred_at: new Date().toISOString(), payload });
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
    const k = await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } });
    kg = { id: k.id, precision: k.precision };
  });
  afterAll(async () => app.close());

  describe('reposição: cálculo', () => {
    it('consumo zero e lead time nulo: sem consumo a cobertura é só o alvo máximo', async () => {
      const w = await newWh('ZER');
      const m = await mk('ZER'); // sem leadTimeDays
      await policy(m, w.id, { minQty: 0, maxQty: 10 }).expect(200);
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions[0]).toMatchObject({ materialId: m, suggestedQty: '10' });
      const [s] = await sugOf(m, w.id);
      expect(s.justification).toMatchObject({ leadTimeDays: 0, avgDailyConsumption: '0.000000' });
    });

    it('reorderPoint explícito prevalece sobre o cálculo por consumo', async () => {
      const w = await newWh('RPE');
      const m = await mk('RPE', { leadTimeDays: 30 });
      await stockIn(m, 20, w.loc);
      await policy(m, w.id, { minQty: 0, maxQty: 50, reorderPoint: 15 }).expect(200);
      // 20 > 15: sem necessidade mesmo com lead time longo (que, sem o explícito, exigiria repor).
      expect((await calc(w.id).expect(200)).body.suggestions).toHaveLength(0);
      await stockOut(m, 10, w.loc); // sobra 10 ≤ 15
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions[0].suggestedQty).toBe('40'); // alvo 50 − posição 10
      expect((await sugOf(m, w.id))[0].justification).toMatchObject({ reorderPoint: '15' });
    });

    it('múltiplo de compra fracionado arredonda para cima no múltiplo exato', async () => {
      const w = await newWh('MUL');
      const m = await mk('MUL');
      await prisma.material.update({ where: { id: m }, data: { purchaseMultiple: 2.5 } });
      await stockIn(m, 3, w.loc);
      await policy(m, w.id, { minQty: 0, maxQty: 100, reorderPoint: 10 }).expect(200);
      // alvo 100 − posição 3 = 97 → ceil(97 / 2,5) = 39 → 39 × 2,5 = 97,5
      expect((await calc(w.id).expect(200)).body.suggestions[0].suggestedQty).toBe('97.5');
    });

    it('unidade com casas decimais (KG): aceita até a precisão da unidade e rejeita mais casas', async () => {
      const w = await newWh('KGS');
      const m = (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S8E-KG-${sfx}`, shortDescription: 'Material KG', category: 'Teste', type: 'CONSUMO', stockUomId: kg.id }).expect(201)).body.id as string;
      const over = Number(`1.${'1'.repeat(kg.precision + 1)}`);
      await policy(m, w.id, { minQty: over }).expect(400);
      await policy(m, w.id, { minQty: 1.5 }).expect(200);
      await stockIn(m, 0.25, w.loc);
      await policy(m, w.id, { minQty: 1.5, maxQty: 4 }).expect(200);
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions[0]).toMatchObject({ materialId: m, suggestedQty: '3.75' }); // 4 − 0,25
    });

    it('transferência em trânsito para o destino abate a necessidade', async () => {
      const w = await newWh('TRD'); const origem = await newWh('TRO');
      const m = await mk('TRD');
      await policy(m, w.id, { minQty: 0, maxQty: 20, reorderPoint: 10 }).expect(200);
      await stockIn(m, 2, origem.loc); // estoque de outro almoxarifado não conta para o destino
      await calc(w.id).expect(200);
      const [antes] = await sugOf(m, w.id);
      expect(Number(antes.suggestedQty)).toBe(20);
      await prisma.transfer.create({
        data: { fromWarehouseId: origem.id, toWarehouseId: w.id, status: 'EM_TRANSITO', reason: 'Teste S8E', requestedBy: 'x', dispatchedAt: new Date(),
          items: { create: [{ materialId: m, fromLocationId: origem.loc, quantity: 5 }] } },
      });
      const depois = (await calc(w.id).expect(200)).body;
      expect(depois.suggestions[0]).toMatchObject({ action: 'atualizada' });
      expect(Number(depois.suggestions[0].suggestedQty)).toBe(15); // alvo 20 − 5 em trânsito
    });

    it('compra parcialmente atendida em aberto conta só o saldo aprovado', async () => {
      const w = await newWh('PAR');
      const m = await mk('PAR');
      await policy(m, w.id, { minQty: 0, maxQty: 10, reorderPoint: 6 }).expect(200);
      await prisma.replenishmentSuggestion.create({ data: { materialId: m, warehouseId: w.id, status: 'APROVADA_AXIS', suggestedQty: 50, approvedQty: 4, justification: {} } });
      // posição = 0 + 4 em aberto ≤ 6 → repor até 10: falta 6
      expect(Number((await calc(w.id).expect(200)).body.suggestions[0].suggestedQty)).toBe(6);
    });

    it('material inativo nunca gera sugestão e não é contado como calculado', async () => {
      const w = await newWh('INA');
      const m = await mk('INA');
      await policy(m, w.id, { minQty: 5, maxQty: 20 }).expect(200);
      await prisma.material.update({ where: { id: m }, data: { status: 'INATIVO' } });
      const r = (await calc(w.id).expect(200)).body;
      expect(r.suggestions).toHaveLength(0);
      expect(r.skipped).toBe(1);
      expect(await sugOf(m, w.id)).toHaveLength(0);
    });

    it('demanda aprovada de vários projetos e datas aparece separada nas evidências', async () => {
      const w = await newWh('MPR');
      const m = await mk('MPR');
      await policy(m, w.id, { minQty: 0, maxQty: 200 }).expect(200);
      const order = (project: string, neededBy: string, qty: number) =>
        api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8E-${randomUUID()}`, warehouseCode: w.code, projectAxisId: project, neededBy, items: [{ materialCode: `S8E-MPR-${sfx}`, quantity: qty }] }).expect(201);
      await order('prj-x', day(5), 10);
      await order('prj-x', day(9), 7);
      await order('prj-y', day(5), 4);
      await calc(w.id).expect(200);
      const j = (await sugOf(m, w.id))[0].justification as { approvedDemand: Array<{ project: string; neededBy: string; qty: string }> };
      const keys = j.approvedDemand.map((d) => `${d.project}|${d.neededBy}|${d.qty}`).sort();
      expect(keys).toEqual([`prj-x|${day(5)}|10`, `prj-x|${day(9)}|7`, `prj-y|${day(5)}|4`].sort());
    });

    // BUG: calculate lê a sugestão ABERTA e só depois cria; duas chamadas simultâneas criam duas ABERTA (não há índice único parcial).
    it('duas calculate simultâneas não duplicam sugestão ABERTA', async () => {
      const w = await newWh('RCE');
      const m = await mk('RCE');
      await policy(m, w.id, { minQty: 0, maxQty: 50, reorderPoint: 5 }).expect(200);
      await Promise.all([1, 2, 3, 4].map(() => calc(w.id).expect(200)));
      expect((await sugOf(m, w.id)).filter((s) => s.status === 'ABERTA')).toHaveLength(1);
    });
  });

  describe('reposição: integração com o Axis', () => {
    it('payload malformado do purchase_order.approved é rejeitado sem criar sugestão', async () => {
      const w = await newWh('MAL');
      const m = await mk('MAL');
      expect((await webhook('purchase_order.approved', { purchase_order_id: `PO-MAL-${sfx}`, warehouse_code: w.code, items: 'nao-e-lista' })).status).toBe(400);
      expect((await webhook('purchase_order.approved', { purchase_order_id: `PO-MAL-${sfx}`, warehouse_code: w.code, items: [{ material_code: `S8E-MAL-${sfx}`, quantity: 'abc' }] })).status).toBe(400);
      expect((await webhook('purchase_order.approved', { purchase_order_id: `PO-MAL-${sfx}`, warehouse_code: w.code, items: [] })).status).toBe(400);
      expect((await webhook('purchase_order.approved', { warehouse_code: w.code, items: [{ material_code: `S8E-MAL-${sfx}`, quantity: 1 }] })).status).toBe(400);
      expect(await sugOf(m, w.id)).toHaveLength(0);
    });

    it('mesmo event_id reenviado não cria a previsão de novo', async () => {
      const w = await newWh('IDM');
      const m = await mk('IDM');
      const eid = randomUUID();
      const payload = { purchase_order_id: `PO-IDM-${sfx}`, warehouse_code: w.code, items: [{ material_code: `S8E-IDM-${sfx}`, quantity: 8 }] };
      expect((await webhook('purchase_order.approved', payload, eid)).body.status).toBe('processed');
      expect((await webhook('purchase_order.approved', payload, eid)).body.status).toBe('duplicate');
      expect(await sugOf(m, w.id)).toHaveLength(1);
    });

    // BUG: dois itens do mesmo material sem sugestão prévia; o 2º sobrescreve approvedQty do 1º (fica 10 em vez de 20).
    it('itens duplicados do mesmo material no pedido não perdem quantidade', async () => {
      const w = await newWh('DUP');
      const m = await mk('DUP');
      const res = await webhook('purchase_order.approved', { purchase_order_id: `PO-DUP-${sfx}`, warehouse_code: w.code, items: [{ material_code: `S8E-DUP-${sfx}`, quantity: 10 }, { material_code: `S8E-DUP-${sfx}`, quantity: 10 }] });
      expect(res.status).toBe(200);
      const soma = (await sugOf(m, w.id)).reduce((s, x) => s + Number(x.approvedQty ?? 0), 0);
      expect(soma).toBe(20);
    });
  });

  describe('alertas', () => {
    it('lote no limite de 8 dias cai no balde de 30 e no de 31 dias no balde de 60', async () => {
      const w = await newWh('LIM');
      const m = await mk('LIM', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const lot = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m, lotNumber: `${n}-${sfx}`, expiresAt: day(d) }).expect(201)).body.id as string;
      const l8 = await lot('L8', 8); const l31 = await lot('L31', 31);
      await stockIn(m, 1, w.loc, { lotId: l8 }); await stockIn(m, 1, w.loc, { lotId: l31 });
      await scan();
      expect((await alertsOf(l8)).map((a) => (a.data as { bucket: number }).bucket)).toEqual([30]);
      expect((await alertsOf(l31)).map((a) => (a.data as { bucket: number }).bucket)).toEqual([60]);
    });

    it('reabre o alerta quando a condição volta, mantendo o anterior como RESOLVIDO', async () => {
      const w = await newWh('REA');
      const m = await mk('REA');
      await policy(m, w.id, { minQty: 5 }).expect(200);
      await stockIn(m, 20, w.loc);
      await scan();
      expect(await alertsOf(m)).toHaveLength(0);
      await stockOut(m, 20, w.loc); // zera → ruptura
      await scan();
      expect((await alertsOf(m)).map((a) => a.status)).toEqual(['ABERTO']);
      await stockIn(m, 30, w.loc);
      await scan();
      expect((await alertsOf(m)).map((a) => a.status)).toEqual(['RESOLVIDO']);
      await stockOut(m, 30, w.loc); // volta a faltar
      await scan();
      expect((await alertsOf(m)).map((a) => a.status)).toEqual(['RESOLVIDO', 'ABERTO']);
    });

    it('severidade sobe (ATENÇÃO → CRÍTICO) e desce no mesmo alerta, sem criar outro', async () => {
      const w = await newWh('SEV');
      const m = await mk('SEV');
      await policy(m, w.id, { minQty: 5 }).expect(200);
      await stockIn(m, 3, w.loc);
      await scan();
      const [a1] = await alertsOf(m);
      expect(a1.severity).toBe('ATENCAO');
      await stockOut(m, 3, w.loc);
      await scan();
      const lista = await alertsOf(m);
      expect(lista).toHaveLength(1);
      expect(lista[0]).toMatchObject({ id: a1.id, severity: 'CRITICO' });
    });

    // BUG: scan lê os alertas abertos e cria sem lock nem índice único em dedupe_key para status ABERTO; duas varreduras paralelas duplicam.
    it('varreduras concorrentes não duplicam alerta ABERTO', async () => {
      const w = await newWh('CON');
      const m = await mk('CON');
      await policy(m, w.id, { minQty: 5 }).expect(200);
      await Promise.all([1, 2, 3, 4].map(() => scan()));
      const abertos = (await alertsOf(m)).filter((a) => a.status === 'ABERTO');
      expect(abertos).toHaveLength(1);
    });

    it('reconhecer alerta RESOLVIDO devolve 409', async () => {
      const w = await newWh('ACK');
      const m = await mk('ACK');
      await policy(m, w.id, { minQty: 5 }).expect(200);
      await scan();
      const [a] = await alertsOf(m);
      await prisma.alert.update({ where: { id: a.id }, data: { status: 'RESOLVIDO', resolvedAt: new Date() } });
      await api().post(`/api/v1/alerts/${a.id}/acknowledge`).set(A(gestor)).expect(409);
    });

    it('alerta de almoxarifado não aparece para quem não tem acesso a ele', async () => {
      const w = await newWh('ESC');
      const m = await mk('ESC');
      await policy(m, w.id, { minQty: 5 }).expect(200);
      await scan();
      const [a] = await alertsOf(m);
      const lista = (await api().get('/api/v1/alerts').set(A(tecnico)).expect(200)).body as Array<{ id: string }>;
      expect(lista.map((x) => x.id)).not.toContain(a.id);
      const dono = (await api().get('/api/v1/alerts').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body as Array<{ id: string }>;
      expect(dono.map((x) => x.id)).toContain(a.id);
    });
  });

  describe('indicadores', () => {
    // BUG: KpiQuery não valida a ordem de from/to; período invertido responde 200 em vez de 400.
    it('período com from > to é rejeitado', async () => {
      await api().get('/api/v1/dashboard/kpis').query({ from: day(5), to: day(-5) }).set(A(gestor)).expect(400);
    });

    it('almoxarifado sem dados retorna zeros e nulos, sem erro', async () => {
      const w = await newWh('VAZ');
      const r = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id, from: '1990-01-01', to: '1990-12-31' }).set(A(gestor)).expect(200)).body;
      expect(r.accuracy).toEqual({ counted: 0, matched: 0, pct: null });
      expect(r.cycleHours).toEqual({ approvalToReservation: null, reservationToPicking: null, pickingToDispatch: null, dispatchToDelivery: null });
      expect(r.transit.avgHours).toBeNull();
    });

    it('acuracidade conta linhas DIVERGENTE de inventário concluído', async () => {
      const w = await newWh('ACU');
      const m = await mk('ACU');
      const cnt = await prisma.stockCount.create({ data: { type: 'GERAL', warehouseId: w.id, status: 'CONCLUIDA', createdBy: 'x', closedAt: new Date() } });
      await prisma.stockCountLine.createMany({ data: [
        { countId: cnt.id, materialId: m, locationId: w.loc, systemQty: 5, status: 'CONFERIDO' },
        { countId: cnt.id, materialId: m, locationId: w.loc, systemQty: 5, status: 'DIVERGENTE' },
        { countId: cnt.id, materialId: m, locationId: w.loc, systemQty: 5, status: 'DIVERGENTE' },
        { countId: cnt.id, materialId: m, locationId: w.loc, systemQty: 5, status: 'CONFERIDO' },
      ] as never });
      const r = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(r.accuracy).toMatchObject({ counted: 4, matched: 2, pct: 50 });
    });

    it('nível de serviço: entrega após a data necessária não conta como no prazo', async () => {
      const w = await newWh('ATR');
      const m = await mk('ATR');
      await stockIn(m, 6, w.loc);
      const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8E-${randomUUID()}`, warehouseCode: w.code, neededBy: day(-5), items: [{ materialCode: `S8E-ATR-${sfx}`, quantity: 6 }] }).expect(201)).body;
      const rel = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
      const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(gestor)).send(b);
      await t('start').expect(200);
      await t('scan', { pickingItemId: rel.items[0].id, locationId: w.loc, materialId: m, quantity: 6 }).expect(200);
      await t('complete').expect(200);
      const pack = (await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: rel.items[0].id, quantity: 6 }] }] }).expect(201)).body;
      await api().post(`/api/v1/shipments/${pack.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }).expect(200);
      await api().post(`/api/v1/shipments/${pack.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(200);
      const r = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(r.serviceLevel).toMatchObject({ orders: 1, delivered: 1, onTime: 0, fillRatePct: 0 });
    });

    it('ciclo com ordem sem etapas: métricas de etapas ausentes ficam nulas', async () => {
      const w = await newWh('CIC');
      const m = await mk('CIC');
      await stockIn(m, 5, w.loc);
      await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S8E-${randomUUID()}`, warehouseCode: w.code, items: [{ materialCode: `S8E-CIC-${sfx}`, quantity: 1 }] }).expect(201);
      const r = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(r.cycleHours.reservationToPicking).toBeNull();
      expect(r.cycleHours.dispatchToDelivery).toBeNull();
      expect(r.serviceLevel.delivered).toBe(0);
    });

    it('custo oculto sem material:read_cost: o valor do consumo some para perfil de compras', async () => {
      const w = await newWh('CST');
      const m = await mk('CST', {});
      await stockIn(m, 5, w.loc, { unitCost: 10 });
      await stockOut(m, 2, w.loc);
      const comCusto = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      expect(comCusto.consumption).toHaveProperty('valueByProject');
      const semCusto = await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(compras));
      expect([200, 403]).toContain(semCusto.status);
      if (semCusto.status === 200) {
        expect(semCusto.body.consumption).not.toHaveProperty('valueByProject');
        expect(JSON.stringify(semCusto.body)).not.toMatch(/R\$/);
      }
    });

    it('nada no painel expõe identificadores de operadores', async () => {
      const w = await newWh('OPE');
      const r = (await api().get('/api/v1/dashboard/kpis').query({ warehouseId: w.id }).set(A(gestor)).expect(200)).body;
      const texto = JSON.stringify(r);
      for (const id of ['gestor-s8e', `tec8e-${sfx}`, `compras8e-${sfx}`, 'colab-s8e', 'admin-s8e']) expect(texto).not.toContain(id);
      await api().get('/api/v1/dashboard/kpis').set(A(colab)).expect(403);
      await api().get('/api/v1/dashboard/kpis').set(A(tecnico)).expect(403);
    });
  });
});
