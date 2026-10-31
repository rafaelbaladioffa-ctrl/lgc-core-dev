import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda extras dos Sprints 2 e 3 (estornos, ownership, condições, categorias por endereço, validade,
// paginação/filtros, projeção, expiração de reservas, duplicidade de itens, versões, webhook).
// Não altera src/. Bugs confirmados ficam em it.fails com comentário.

const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const sign = (body: string, secret = WH_SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const HOUR = 3_600_000;

describe('Sprints 2 e 3 — casos de borda extras', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = Date.now().toString(36).toUpperCase();
  const gestor = tokenFor(['gestor']);
  const admin = tokenFor(['admin']);
  const tecnico = tokenFor(['tecnico'], 'u-edge23-tecnico');
  const solic = tokenFor(['colaborador'], 'u-edge23-solic');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let uomUN: string;
  let whA: string, whACode: string, whB: string, locA: string, locB: string, locR: string;
  const FERR = `Ferr-${sfx}`;
  const CAT = `Teste-${sfx}`;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    uomUN = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whACode = `E23A-${sfx}`;
    whA = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whACode, name: 'Almox E23 A', type: 'CENTRAL' }).expect(201)).body.id;
    whB = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `E23B-${sfx}`, name: 'Almox E23 B', type: 'CENTRAL' }).expect(201)).body.id;
    const area = async (wh: string, code: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    locA = await area(whA, 'EA');
    locR = await area(whA, 'ER');
    locB = await area(whB, 'EB');
    await api().put('/api/v1/rbac/users/u-edge23-tecnico/warehouses').set(A(admin)).send({ warehouseIds: [whA] }).expect(200);
    // Endereço restrito a uma categoria (regra de categoria por endereço).
    await prisma.location.update({ where: { id: locR }, data: { allowedCategories: [FERR] } });
  });
  afterAll(async () => app.close());

  const mk = async (name: string, extra: Record<string, unknown> = {}, category = CAT) => {
    const code = `E23-${name}-${sfx}`;
    const id = (await api().post('/api/v1/materials').set(A(admin)).send({ code, shortDescription: `Edge ${name}`, category, type: 'CONSUMO', stockUomId: uomUN, ...extra }).expect(201)).body.id as string;
    return { id, code };
  };
  const move = (body: Record<string, unknown>, token = gestor) => api().post('/api/v1/stock/movements').set(A(token)).set('Idempotency-Key', randomUUID()).send(body);
  const entry = (materialId: string, quantity: number, toLocationId = locA, extra: Record<string, unknown> = {}) =>
    move({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId, reason: 'Recebimento de borda', ...extra });
  const exit = (materialId: string, quantity: number, fromLocationId = locA, extra: Record<string, unknown> = {}) =>
    move({ type: 'SAIDA_ENTREGA', materialId, quantity, fromLocationId, reason: 'Entrega de borda', ...extra });
  const reverse = (id: string, reason = 'Lançado por engano', token = gestor) =>
    api().post(`/api/v1/stock/movements/${id}/reverse`).set(A(token)).set('Idempotency-Key', randomUUID()).send({ reason });
  const rows = async (materialId: string, locationId?: string, token = gestor) =>
    (await api().get('/api/v1/stock/balances').query({ materialId, ...(locationId && { locationId }) }).set(A(token)).expect(200)).body.items as Array<{
      locationId: string; quantity: string; available: string; reserved: string; condition: string; ownership: string;
    }>;
  const qty = async (materialId: string, locationId: string) =>
    (await rows(materialId, locationId)).filter((r) => r.ownership === 'PROPRIO' && r.condition === 'DISPONIVEL').reduce((s, r) => s + Number(r.quantity), 0);
  const avail = async (materialId: string, query: Record<string, unknown> = {}, token = gestor) =>
    (await api().get(`/api/v1/materials/${materialId}/availability`).query({ warehouse_id: whA, ...query }).set(A(token)).expect(200)).body;
  const order = (body: Record<string, unknown>, token = admin) => api().post('/api/v1/fulfillment-orders').set(A(token)).send({ warehouseCode: whACode, ...body });

  describe('estornos', () => {
    it('estorno de saída devolve a quantidade ao endereço de origem', async () => {
      const m = await mk('EST-SAI');
      await entry(m.id, 10).expect(201);
      const out = await exit(m.id, 4).expect(201);
      expect(await qty(m.id, locA)).toBe(6);
      const rev = await reverse(out.body.id).expect(201);
      expect(rev.body.toLocationId).toBe(locA);
      expect(rev.body.fromLocationId).toBeNull();
      expect(rev.body.type).toBe('SAIDA_ENTREGA');
      expect(await qty(m.id, locA)).toBe(10);
    });

    it('estorno de transferência devolve os dois lados ao estado anterior', async () => {
      const m = await mk('EST-TRF');
      await entry(m.id, 5, locA).expect(201);
      const t = await move({ type: 'TRANSFERENCIA', materialId: m.id, quantity: 3, fromLocationId: locA, toLocationId: locB, reason: 'Reposição' }).expect(201);
      expect(await qty(m.id, locA)).toBe(2);
      expect(await qty(m.id, locB)).toBe(3);
      await reverse(t.body.id).expect(201);
      expect(await qty(m.id, locA)).toBe(5);
      expect(await qty(m.id, locB)).toBe(0);
    });

    it('estorno de entrada já consumida é recusado (422) e não deixa rastro no ledger', async () => {
      const m = await mk('EST-CONS');
      const e = await entry(m.id, 5).expect(201);
      await exit(m.id, 5).expect(201);
      const r = await reverse(e.body.id).expect(422);
      expect(r.body.message).toMatch(/Saldo insuficiente/);
      expect(await prisma.stockMovement.count({ where: { reversesMovementId: e.body.id } })).toBe(0);
      expect(await qty(m.id, locA)).toBe(0);
    });

    it('estorno concorrente do mesmo movimento: exatamente um vale, os demais são 409', async () => {
      const m = await mk('EST-RACE');
      await entry(m.id, 2).expect(201);
      const out = await exit(m.id, 1).expect(201);
      const rs = await Promise.all(Array.from({ length: 4 }, () => reverse(out.body.id)));
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      expect(rs.filter((r) => r.status === 409)).toHaveLength(3);
      expect(await qty(m.id, locA)).toBe(2);
    });

    it('estorno de entrada de série devolve a série ao estoque (sem endereço)', async () => {
      const s = await mk('EST-SER', { serialControlled: true, assetTagged: true, exitMethod: 'SERIE_ESPECIFICA' });
      const serial = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: s.id, serial: `SN-EST-${sfx}` }).expect(201)).body.id as string;
      const e = await entry(s.id, 1, locA, { serialId: serial }).expect(201);
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: serial } })).currentLocationId).toBe(locA);
      await reverse(e.body.id).expect(201);
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: serial } })).currentLocationId).toBeNull();
      await entry(s.id, 1, locB, { serialId: serial }).expect(201); // volta a poder entrar em outro endereço
    });

    it('estorno de baixa de série devolve a série localizada e utilizável', async () => {
      // Bug corrigido (ver commit): o teste agora valida o comportamento esperado.
      const s = await mk('EST-BXA', { serialControlled: true, assetTagged: true, exitMethod: 'SERIE_ESPECIFICA' });
      const serial = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: s.id, serial: `SN-BXA-${sfx}` }).expect(201)).body.id as string;
      await entry(s.id, 1, locA, { serialId: serial }).expect(201);
      const baixa = await move({ type: 'BAIXA_PERDA', materialId: s.id, quantity: 1, fromLocationId: locA, serialId: serial, reason: 'Extravio', axisApprovalRef: 'BXA-E23' }).expect(201);
      await reverse(baixa.body.id).expect(201);
      const back = await prisma.serialNumber.findUniqueOrThrow({ where: { id: serial } });
      expect(back.currentLocationId).toBe(locA);
      expect(back.condition).not.toBe('BAIXADO');
    });
  });

  describe('ownership e condição', () => {
    it('saldo de terceiro não é consumido por saída própria; saída com a propriedade certa consome só ela', async () => {
      const m = await mk('OWN');
      await entry(m.id, 5, locA, { ownership: 'TERCEIRO_CONSIGNADO' }).expect(201);
      await exit(m.id, 1).expect(422); // default PROPRIO: não há saldo próprio
      await exit(m.id, 2, locA, { ownership: 'TERCEIRO_CONSIGNADO' }).expect(201);
      const consigned = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: m.id, ownership: 'TERCEIRO_CONSIGNADO' } });
      expect(consigned.quantity.toNumber()).toBe(3);
      expect(await prisma.stockBalance.count({ where: { materialId: m.id, ownership: 'PROPRIO' } })).toBe(0);
    });

    it('disponibilidade do material ignora propriedade de terceiros (físico só PROPRIO)', async () => {
      const m = await mk('OWN-AV');
      await entry(m.id, 2).expect(201);
      await entry(m.id, 5, locA, { ownership: 'CLIENTE' }).expect(201);
      const a = await avail(m.id);
      expect(a).toMatchObject({ physical: '2', available: '2', reserved: '0' });
    });

    it('saldo de TERCEIRO_CONSIGNADO não aparece como disponível em /stock/balances', async () => {
      // Bug corrigido (ver commit): o teste agora valida o comportamento esperado.
      const m = await mk('OWN-BAL');
      await entry(m.id, 4, locA, { ownership: 'TERCEIRO_CONSIGNADO' }).expect(201);
      const [row] = await rows(m.id, locA);
      expect(row.ownership).toBe('TERCEIRO_CONSIGNADO');
      expect(row.available).toBe('0');
    });

    it('quarentena não compõe disponível, aparece como bloqueado e não é reservada', async () => {
      const m = await mk('QUA');
      await entry(m.id, 6, locA, { toCondition: 'QUARENTENA' }).expect(201);
      expect(await qty(m.id, locA)).toBe(0);
      expect(await avail(m.id)).toMatchObject({ physical: '6', blocked: '6', available: '0' });
      const o = await order({ axisRequestId: `QUA-${sfx}`, items: [{ materialCode: m.code, quantity: 2 }] }).expect(201);
      expect(o.body.status).toBe('AGUARDANDO_ESTOQUE');
      expect(o.body.items[0].reserved).toBe('0');
    });

    it.each(['BLOQUEADO', 'AVARIADO'] as const)('condição %s não é reservada nem vira disponível', async (condition) => {
      const m = await mk(`CND-${condition}`);
      await entry(m.id, 3, locA, { toCondition: condition }).expect(201);
      expect(await avail(m.id)).toMatchObject({ blocked: '3', available: '0' });
      const o = await order({ axisRequestId: `CND-${condition}-${sfx}`, items: [{ materialCode: m.code, quantity: 1 }] }).expect(201);
      expect(o.body.status).toBe('AGUARDANDO_ESTOQUE');
    });

    it('transferência de quarentena para disponível no mesmo endereço libera o estoque para reserva', async () => {
      const m = await mk('QUA-LIB');
      await entry(m.id, 6, locA, { toCondition: 'QUARENTENA' }).expect(201);
      await move({ type: 'TRANSFERENCIA', materialId: m.id, quantity: 6, fromLocationId: locA, toLocationId: locA, fromCondition: 'QUARENTENA', toCondition: 'DISPONIVEL', reason: 'Inspeção aprovada' }).expect(201);
      expect(await qty(m.id, locA)).toBe(6);
      const o = await order({ axisRequestId: `QUA-LIB-${sfx}`, items: [{ materialCode: m.code, quantity: 6 }] }).expect(201);
      expect(o.body.status).toBe('RESERVADA');
    });
  });

  describe('categorias restritas por endereço', () => {
    it('endereço com categorias permitidas recusa outra categoria (entrada e transferência) e aceita a permitida', async () => {
      const outro = await mk('CAT-OUT');
      const ferr = await mk('CAT-FERR', {}, FERR);
      const ferrLower = await mk('CAT-LOWER', {}, FERR.toLowerCase());
      await entry(outro.id, 1, locR).expect(422).then((r) => expect(r.body.message).toMatch(/não aceita a categoria/));
      await entry(ferrLower.id, 1, locR).expect(422); // comparação de categoria é exata
      await entry(ferr.id, 4, locR).expect(201);
      await entry(outro.id, 2, locA).expect(201);
      await move({ type: 'TRANSFERENCIA', materialId: outro.id, quantity: 1, fromLocationId: locA, toLocationId: locR, reason: 'Mover' }).expect(422);
    });

    it('restrição vale só para destino: saída de material permitido do endereço restrito é normal', async () => {
      const ferr = await mk('CAT-SAI', {}, FERR);
      await entry(ferr.id, 3, locR).expect(201);
      await exit(ferr.id, 2, locR).expect(201);
      expect(await qty(ferr.id, locR)).toBe(1);
    });
  });

  describe('vida útil mínima', () => {
    // Datas com folga de 1 dia: a data de hoje em São Paulo pode ser um dia antes da UTC.
    it('lote com vida útil abaixo do mínimo é recusado na entrada de recebimento; acima passa', async () => {
      const m = await mk('VIDA', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: 30 });
      const lot = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m.id, lotNumber: n, expiresAt: day(d) }).expect(201)).body.id as string;
      const curto = await lot('CURTO', 28);
      const longo = await lot('LONGO', 31);
      const r = await entry(m.id, 2, locA, { lotId: curto }).expect(422);
      expect(r.body.message).toMatch(/Vida útil restante/);
      await entry(m.id, 2, locA, { lotId: longo }).expect(201);
    });

    it('entrada de devolução não aplica a vida útil mínima de recebimento', async () => {
      const m = await mk('VIDA-DEV', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: 30 });
      const curto = (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: m.id, lotNumber: 'DEV', expiresAt: day(5) }).expect(201)).body.id as string;
      await move({ type: 'ENTRADA_DEVOLUCAO', materialId: m.id, quantity: 1, toLocationId: locA, lotId: curto, reason: 'Devolução de cliente' }).expect(201);
    });
  });

  describe('paginação e filtros', () => {
    it('movimentos paginam sem sobreposição, em ordem decrescente de sequência', async () => {
      const m = await mk('PAG');
      for (let i = 0; i < 5; i++) await entry(m.id, 1).expect(201);
      const p1 = await api().get('/api/v1/stock/movements').query({ materialId: m.id, pageSize: 2, page: 1 }).set(A(gestor)).expect(200);
      const p2 = await api().get('/api/v1/stock/movements').query({ materialId: m.id, pageSize: 2, page: 2 }).set(A(gestor)).expect(200);
      const p3 = await api().get('/api/v1/stock/movements').query({ materialId: m.id, pageSize: 2, page: 3 }).set(A(gestor)).expect(200);
      expect(p1.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect(p3.body.items).toHaveLength(1);
      const ids = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i: { id: string }) => i.id);
      expect(new Set(ids).size).toBe(5);
      const seqs = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((i: { seq: number }) => i.seq);
      expect([...seqs].sort((a, b) => b - a)).toEqual(seqs);
    });

    it('filtros por tipo e por material combinam; tipo sem registros devolve total zero', async () => {
      const m = await mk('FLT');
      await entry(m.id, 3).expect(201);
      await exit(m.id, 1).expect(201);
      const ent = await api().get('/api/v1/stock/movements').query({ materialId: m.id, type: 'ENTRADA_RECEBIMENTO' }).set(A(gestor)).expect(200);
      expect(ent.body.total).toBe(1);
      expect(ent.body.items.every((i: { type: string }) => i.type === 'ENTRADA_RECEBIMENTO')).toBe(true);
      const sai = await api().get('/api/v1/stock/movements').query({ materialId: m.id, type: 'SAIDA_ENTREGA' }).set(A(gestor)).expect(200);
      expect(sai.body.total).toBe(1);
      const none = await api().get('/api/v1/stock/movements').query({ materialId: m.id, type: 'DESCARTE' }).set(A(gestor)).expect(200);
      expect(none.body.total).toBe(0);
    });

    it('filtro por local casa origem ou destino', async () => {
      const m = await mk('FLT-LOC');
      await entry(m.id, 2, locB).expect(201);
      const inB = await api().get('/api/v1/stock/movements').query({ materialId: m.id, locationId: locB }).set(A(gestor)).expect(200);
      expect(inB.body.total).toBe(1);
      expect(inB.body.items[0].toLocationId).toBe(locB);
      const inA = await api().get('/api/v1/stock/movements').query({ materialId: m.id, locationId: locA }).set(A(gestor)).expect(200);
      expect(inA.body.total).toBe(0);
    });

    it('filtro de data usa effectiveAt (não registeredAt) com limites inclusivos', async () => {
      const m = await mk('FLT-DATA');
      await entry(m.id, 1, locA, { effectiveAt: '2001-06-15T12:00:00.000Z' }).expect(201);
      const q = (from: string, to: string) => api().get('/api/v1/stock/movements').query({ materialId: m.id, from, to }).set(A(gestor)).expect(200);
      expect((await q('2001-06-01T00:00:00.000Z', '2001-06-30T23:59:59.000Z')).body.total).toBe(1);
      expect((await q('2001-06-15T12:00:00.000Z', '2001-06-15T12:00:00.000Z')).body.total).toBe(1);
      expect((await q('2001-06-16T00:00:00.000Z', '2001-12-31T00:00:00.000Z')).body.total).toBe(0);
    });

    it('parâmetros inválidos de movimentos e saldos são 400', async () => {
      await api().get('/api/v1/stock/movements').query({ pageSize: 101 }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/movements').query({ page: 0 }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/movements').query({ pageSize: 'abc' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/movements').query({ type: 'INVENTADO' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/movements').query({ from: 'nao-data' }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/balances').query({ pageSize: 201 }).set(A(gestor)).expect(400);
      await api().get('/api/v1/stock/balances').query({ condition: 'INEXISTENTE' }).set(A(gestor)).expect(400);
    });

    it('saldos: filtro por condição, saldo zerado não aparece e paginação funciona', async () => {
      const m = await mk('BAL');
      await entry(m.id, 2, locA, { toCondition: 'QUARENTENA' }).expect(201);
      await entry(m.id, 3, locA).expect(201);
      await exit(m.id, 3).expect(201); // zera o disponível
      const quar = await api().get('/api/v1/stock/balances').query({ materialId: m.id, condition: 'QUARENTENA' }).set(A(gestor)).expect(200);
      expect(quar.body.items.map((i: { condition: string }) => i.condition)).toEqual(['QUARENTENA']);
      expect((await rows(m.id)).some((r) => r.condition === 'DISPONIVEL')).toBe(false);
      const paged = await api().get('/api/v1/stock/balances').query({ materialId: m.id, pageSize: 1, page: 2 }).set(A(gestor)).expect(200);
      expect(paged.body).toMatchObject({ total: 1, page: 2, items: [] });
    });

    it('escopo por almoxarifado: usuário restrito não vê movimentos nem saldos de outro almoxarifado', async () => {
      const m = await mk('SCOPE');
      await entry(m.id, 2, locA).expect(201);
      await entry(m.id, 4, locB).expect(201);
      const mov = await api().get('/api/v1/stock/movements').query({ materialId: m.id }).set(A(tecnico)).expect(200);
      expect(mov.body.total).toBe(1);
      expect(mov.body.items[0].toLocationId).toBe(locA);
      const byB = await api().get('/api/v1/stock/movements').query({ materialId: m.id, locationId: locB }).set(A(tecnico)).expect(200);
      expect(byB.body.total).toBe(0);
      const bal = await api().get('/api/v1/stock/balances').query({ materialId: m.id, warehouseId: whB }).set(A(tecnico)).expect(200);
      expect(bal.body.items).toEqual([]);
      const balAll = await api().get('/api/v1/stock/balances').query({ materialId: m.id }).set(A(tecnico)).expect(200);
      expect(balAll.body.items.every((i: { warehouseId: string }) => i.warehouseId === whA)).toBe(true);
    });
  });

  describe('projeção e expiração de reservas', () => {
    it('projected_on_needed_by desconta a demanda aberta até a data consultada, ignorando ordens posteriores', async () => {
      const m = await mk('PRJ');
      await entry(m.id, 10).expect(201);
      const a = await order({ axisRequestId: `PRJ-A-${sfx}`, neededBy: day(5), items: [{ materialCode: m.code, quantity: 12 }] }).expect(201);
      expect(a.body.status).toBe('RESERVADA_PARCIAL');
      const b = await order({ axisRequestId: `PRJ-B-${sfx}`, neededBy: day(20), items: [{ materialCode: m.code, quantity: 3 }] }).expect(201);
      expect(b.body.status).toBe('AGUARDANDO_ESTOQUE');
      expect(await avail(m.id)).toMatchObject({ physical: '10', reserved: '10', available: '0', projected_on_needed_by: '0' });
      expect((await avail(m.id, { needed_by: day(10) })).projected_on_needed_by).toBe('-2'); // só a ordem A (2 em aberto)
      expect((await avail(m.id, { needed_by: day(25) })).projected_on_needed_by).toBe('-5'); // A (2) + B (3)
    });

    it('expiração: reserva vencida volta ao disponível e a ordem só vai a AGUARDANDO_ESTOQUE quando não sobra reserva ativa', async () => {
      const x1 = await mk('EXP-1');
      const x2 = await mk('EXP-2');
      await entry(x1.id, 5).expect(201);
      await entry(x2.id, 5).expect(201);
      const o = await order({ axisRequestId: `EXP-${sfx}`, neededBy: day(3), items: [{ materialCode: x1.code, quantity: 5 }, { materialCode: x2.code, quantity: 5 }] }).expect(201);
      expect(o.body.status).toBe('RESERVADA');
      const soon = new Date(Date.now() - 1000);
      await prisma.reservation.updateMany({ where: { materialId: x1.id, status: 'ATIVA', item: { orderId: o.body.id } }, data: { expiresAt: soon } });

      const first = await api().post('/api/v1/reservations/expire').set(A(gestor)).expect(200);
      expect(first.body.expired).toBeGreaterThanOrEqual(1);
      expect((await prisma.reservation.findFirstOrThrow({ where: { materialId: x1.id, item: { orderId: o.body.id } } })).status).toBe('EXPIRADA');
      expect((await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: o.body.id } })).status).toBe('RESERVADA');
      expect(await avail(x1.id)).toMatchObject({ reserved: '0', available: '5' });
      expect(await avail(x2.id)).toMatchObject({ reserved: '5' });

      await prisma.reservation.updateMany({ where: { materialId: x2.id, status: 'ATIVA', item: { orderId: o.body.id } }, data: { expiresAt: soon } });
      await api().post('/api/v1/reservations/expire').set(A(gestor)).expect(200);
      const after = await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: o.body.id } });
      expect(after.status).toBe('AGUARDANDO_ESTOQUE');
      expect(after.statusReason).toMatch(/Reservas expiradas/);

      // Segunda rodada não libera de novo a reserva já expirada (sem liberação dupla).
      const releasedAt = (await prisma.reservation.findFirstOrThrow({ where: { materialId: x1.id, item: { orderId: o.body.id } } })).releasedAt;
      await api().post('/api/v1/reservations/expire').set(A(gestor)).expect(200);
      expect((await prisma.reservation.findFirstOrThrow({ where: { materialId: x1.id, item: { orderId: o.body.id } } })).releasedAt).toEqual(releasedAt);
      expect(await avail(x1.id)).toMatchObject({ reserved: '0', available: '5' });
    });
  });

  describe('itens duplicados e versões', () => {
    it('mesmo material em duas linhas (código e id) vira um item com a soma', async () => {
      const d = await mk('DUP');
      await entry(d.id, 10).expect(201);
      const o = await order({ axisRequestId: `DUP-${sfx}`, items: [{ materialCode: d.code, quantity: 2, notes: 'primeira' }, { materialId: d.id, quantity: 3 }] }).expect(201);
      expect(o.body.items).toHaveLength(1);
      expect(Number(o.body.items[0].quantity)).toBe(5);
      expect(Number(o.body.items[0].reserved)).toBe(5);
      expect(o.body.status).toBe('RESERVADA');
    });

    it('cancelamento antes da separação libera o estoque; reenviar a mesma versão não reativa a ordem', async () => {
      const v = await mk('VER');
      await entry(v.id, 10).expect(201);
      const v1 = await order({ axisRequestId: `VER-${sfx}`, requestVersion: 1, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      expect(v1.body.status).toBe('RESERVADA');
      await api().post(`/api/v1/fulfillment-orders/${v1.body.id}/cancel-request`).set(A(gestor)).send({ reason: 'Desistência do solicitante' }).expect(200);
      expect(await avail(v.id)).toMatchObject({ reserved: '0', available: '10' });
      const again = await order({ axisRequestId: `VER-${sfx}`, requestVersion: 1, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      expect(again.body).toMatchObject({ id: v1.body.id, status: 'CANCELADA', replayed: true });
    });

    it('nova versão após cancelamento cria ordem separada e mantém a versão cancelada', async () => {
      const v = await mk('VER2');
      await entry(v.id, 10).expect(201);
      const v1 = await order({ axisRequestId: `VER2-${sfx}`, requestVersion: 1, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      await api().post(`/api/v1/fulfillment-orders/${v1.body.id}/cancel-request`).set(A(gestor)).send({ reason: 'Desistência do solicitante' }).expect(200);
      const v2 = await order({ axisRequestId: `VER2-${sfx}`, requestVersion: 2, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      expect(v2.body.id).not.toBe(v1.body.id);
      expect(v2.body.replayed).toBe(false);
      expect((await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: v1.body.id } })).status).toBe('CANCELADA');
    });

    it('nova versão após cancelamento de versão não iniciada reserva normalmente', async () => {
      // Bug corrigido (ver commit): o teste agora valida o comportamento esperado.
      const v = await mk('VER3');
      await entry(v.id, 10).expect(201);
      const v1 = await order({ axisRequestId: `VER3-${sfx}`, requestVersion: 1, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      await api().post(`/api/v1/fulfillment-orders/${v1.body.id}/cancel-request`).set(A(gestor)).send({ reason: 'Desistência do solicitante' }).expect(200);
      const v2 = await order({ axisRequestId: `VER3-${sfx}`, requestVersion: 2, items: [{ materialCode: v.code, quantity: 4 }] }).expect(201);
      expect(v2.body.status).toBe('RESERVADA');
    });

    it('solicitante não cancela a própria ordem (403): cancelar exige fulfillment:manage', async () => {
      const v = await mk('SOL');
      await entry(v.id, 1).expect(201);
      const mine = await order({ axisRequestId: `SOL-${sfx}`, requesterAxisId: 'u-edge23-solic', items: [{ materialCode: v.code, quantity: 1 }] }).expect(201);
      await api().post(`/api/v1/fulfillment-orders/${mine.body.id}/cancel-request`).set(A(solic)).send({ reason: 'Quero cancelar' }).expect(403);
    });
  });

  describe('webhook do Axis — bordas', () => {
    const envelope = (type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ event_id: randomUUID(), event_type: type, occurred_at: new Date().toISOString(), payload, ...extra });
    const post = (raw: string, sig?: string) => api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sig ?? sign(raw)).send(raw);

    it('corpo acima de 100 kB é recusado com 413 e nada é registrado', async () => {
      const id = randomUUID();
      const raw = JSON.stringify(envelope('client.created', { client_id: `cl-${id}`, name: 'x'.repeat(200_000) }, { event_id: id }));
      const r = await post(raw);
      expect(r.status).toBe(413);
      expect(await prisma.integrationMessage.count({ where: { eventId: id } })).toBe(0);
    });

    it('corpo perto do limite (~90 kB) é processado normalmente', async () => {
      const id = randomUUID();
      const raw = JSON.stringify(envelope('client.created', { client_id: `cl-${id}`, name: 'y'.repeat(90_000) }, { event_id: id }));
      const r = await post(raw).expect(200);
      expect(r.body.status).toBe('processed');
    });

    it('acentos, cedilha e emoji são preservados e a assinatura vale sobre os bytes UTF-8', async () => {
      const cid = `cl-${randomUUID()}`;
      const raw = JSON.stringify(envelope('client.created', { client_id: cid, name: 'Ação & Ç 🚚 — São Paulo' }));
      await post(raw).expect(200);
      const row = await prisma.axisMasterCache.findUniqueOrThrow({ where: { kind_axisId: { kind: 'CLIENT', axisId: cid } } });
      expect(row.name).toBe('Ação & Ç 🚚 — São Paulo');
    });

    it('mesmo JSON com cedilha escrita como \\u00e7 não bate com a assinatura do texto literal', async () => {
      const literal = JSON.stringify(envelope('client.created', { client_id: `cl-${randomUUID()}`, name: 'Ação' }));
      const escaped = literal.replace('ç', '\\u00e7');
      expect(escaped).not.toBe(literal);
      await post(escaped, sign(literal)).expect(401);
    });

    it('janela de replay: 71 h atrás passa; 73 h atrás é 400 e não grava nada', async () => {
      const ok = envelope('project.created', { project_id: `p-${randomUUID()}`, code: 'PRJ-71', status: 'ativo' }, { occurred_at: new Date(Date.now() - 71 * HOUR).toISOString() });
      await post(JSON.stringify(ok)).expect(200);
      const late = envelope('project.created', { project_id: `p-${randomUUID()}`, code: 'PRJ-73', status: 'ativo' }, { occurred_at: new Date(Date.now() - 73 * HOUR).toISOString() });
      await post(JSON.stringify(late)).expect(400);
      expect(await prisma.integrationMessage.count({ where: { eventId: late.event_id } })).toBe(0);
    });

    it('chamado de material com occurred_at fora da janela não gera ordem de atendimento', async () => {
      const v = await mk('WH-OLD');
      const axisId = `TCK-OLD-${sfx}`;
      const raw = JSON.stringify(envelope('ticket.status_changed', {
        ticket_id: axisId, category: 'Requisição de material/insumo', status: 'aberto', warehouse_code: whACode, items: [{ material_code: v.code, quantity: 1 }],
      }, { occurred_at: new Date(Date.now() - 80 * HOUR).toISOString() }));
      await post(raw).expect(400);
      expect(await prisma.fulfillmentOrder.count({ where: { axisRequestId: axisId } })).toBe(0);
    });
  });
});
