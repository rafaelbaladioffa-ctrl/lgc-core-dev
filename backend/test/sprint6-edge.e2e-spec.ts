import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda extras do Sprint 6 (devoluções, custódia, cancelamento, etiquetas, documentos).
// Não altera src/. Bugs confirmados ficam em it.fails com comentário.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 6 — casos de borda', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = `E${Date.now().toString(36).toUpperCase()}`;
  const gestor = tokenFor(['gestor'], `gestor-s6e-${sfx}`);
  const admin = tokenFor(['admin'], `admin-s6e-${sfx}`);
  const rec = tokenFor(['tecnico'], `rec-s6e-${sfx}`);
  const emp = `emp-s6e-${sfx}`;
  const colab = tokenFor(['colaborador'], emp);
  const picker = tokenFor(['gestor'], `picker-s6e-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let whCode: string, wh: string, otherWh: string, doca: string, shelf: string, shelfOther: string, un: string;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S6E-${s}-${sfx}`, shortDescription: `Borda ${s}`, category: 'Teste', type: 'FERRAMENTA', returnable: true, stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: shelf, reason: 'Carga de teste', unitCost: 10, ...extra }).expect(201);
  const lot = async (materialId: string, lotNumber: string, expiresAt: string) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId, lotNumber, expiresAt }).expect(201)).body.id as string;
  const sums = async (materialId: string, condition?: string, lotId?: string) =>
    Number((await prisma.stockBalance.aggregate({ where: { materialId, ...(condition && { condition: condition as never }), ...(lotId && { lotId }) }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const reserved = async (materialId: string) => Number((await prisma.stockBalance.aggregate({ where: { materialId }, _sum: { reservedQty: true } }))._sum.reservedQty ?? 0);
  const newReturn = (body: Record<string, unknown>, token = rec) => api().post('/api/v1/returns').set(A(token)).send({ type: 'FERRAMENTA', warehouseId: wh, receivingLocationId: doca, ...body });
  const classify = (rid: string, iid: string, body: Record<string, unknown>, token = rec) => api().post(`/api/v1/returns/${rid}/items/${iid}/classify`).set(A(token)).send(body);

  /** Ordem → separação → embalagem → despacho → entrega com custódia (materiais sem lote). */
  const flow = async (code: string, quantity: number) => {
    const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S6E-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s6e', items: [{ materialCode: code, quantity }] }).expect(201)).body;
    const rel = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(picker)).send(b);
    const item = rel.items[0];
    await t('start').expect(200);
    await t('scan', { pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, quantity }).expect(200);
    const done = (await t('complete').expect(200)).body;
    if (done.status === 'EM_CONFERENCIA') await api().post(`/api/v1/picking-tasks/${rel.id}/check`).set(A(tokenFor(['gestor'], `checker-s6e-${sfx}`))).send({}).expect(200);
    const pack = (await api().post(`/api/v1/fulfillment-orders/${order.id}/pack`).set(A(gestor)).send({ packages: [{ items: [{ pickingItemId: item.id, quantity }] }] }).expect(201)).body;
    return {
      order, task: rel, shipment: pack,
      dispatch: () => api().post(`/api/v1/shipments/${pack.id}/dispatch`).set(A(gestor)).send({ carrier: 'Frota' }),
      deliver: (extra: Record<string, unknown> = {}) => api().post(`/api/v1/shipments/${pack.id}/confirm-delivery`).set(A(gestor)).send({ outcome: 'ENTREGUE', receiverName: 'Fulano', receiverAxisId: emp, signatureRef: 'ASS-E', expectedReturnAt: '2030-01-31', ...extra }),
    };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S6E-${sfx}`;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox borda 6', type: 'CENTRAL' }).expect(201)).body.id;
    otherWh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `S6EX-${sfx}`, name: 'Almox outro', type: 'CENTRAL' }).expect(201)).body.id;
    const loc = async (w: string, code: string) => (await api().post(`/api/v1/warehouses/${w}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    doca = await loc(wh, 'DEV'); shelf = await loc(wh, 'PRAT'); shelfOther = await loc(otherWh, 'OUT');
    await api().put(`/api/v1/rbac/users/rec-s6e-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => app.close());

  describe('DTOs de devolução (validação HTTP)', () => {
    it('tipo, lista de itens, quantidade zero e mais de 6 casas decimais são recusados antes do service', async () => {
      const m = await mk('DTO');
      await newReturn({ type: 'NAO_EXISTE', items: [{ materialId: m, quantity: 1 }] }).expect(400);
      await newReturn({ items: [] }).expect(400);
      await newReturn({ items: [{ materialId: m, quantity: 0 }] }).expect(400);
      await newReturn({ items: [{ materialId: m, quantity: 1.1234567 }] }).expect(400);
      await newReturn({ items: [{ materialId: 'nao-uuid', quantity: 1 }] }).expect(400);
      await newReturn({ items: 'texto' }).expect(400);
    });

    it('quantidade fracionária para UM sem casas decimais é recusada (UNIT_CONVERSION_ERROR)', async () => {
      const m = await mk('UM');
      const r = await newReturn({ items: [{ materialId: m, quantity: 1.5 }] }).expect(400);
      expect(JSON.stringify(r.body)).toMatch(/UNIT_CONVERSION_ERROR|casa/);
    });
  });

  describe('devolução sem termo (EPI / consumível)', () => {
    it('SOBRA e TROCA_TAMANHO não geram termo; entram em quarentena e vão ao disponível após inspeção', async () => {
      const m = await mk('EPI', { type: 'CONSUMO', returnable: false });
      await stockIn(m, 5);
      for (const type of ['SOBRA', 'TROCA_TAMANHO']) {
        const r = (await newReturn({ type, items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
        expect(r.custodyTermId).toBeNull();
        expect(r.returnedByAxisId).toBeNull();
        await classify(r.id, r.items[0].id, { disposition: 'DISPONIVEL', notes: 'Conferido ok' }).expect(200);
      }
      expect(await sums(m, 'QUARENTENA')).toBe(0);
      expect(await sums(m, 'DISPONIVEL')).toBe(7);
      expect(await prisma.custodyTerm.count({ where: { materialId: m } })).toBe(0);
    });
  });

  describe('devolução com lote', () => {
    it('devolução usa o lote informado; classificação em manutenção bloqueia só esse lote', async () => {
      const m = await mk('LOT', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const lotA = await lot(m, `A-${sfx}`, '2030-01-01');
      const lotB = await lot(m, `B-${sfx}`, '2031-01-01');
      await stockIn(m, 3, { lotId: lotA });
      await stockIn(m, 3, { lotId: lotB });

      await newReturn({ items: [{ materialId: m, quantity: 1 }] }).expect(400); // lote obrigatório
      const r = (await newReturn({ items: [{ materialId: m, quantity: 2, lotId: lotB }] }).expect(201)).body;
      expect(await sums(m, 'QUARENTENA', lotB)).toBe(2);
      expect(await sums(m, 'QUARENTENA', lotA)).toBe(0);
      await classify(r.id, r.items[0].id, { disposition: 'MANUTENCAO', notes: 'Lote precisa de limpeza' }).expect(200);
      expect(await sums(m, 'BLOQUEADO', lotB)).toBe(2);
      expect(await sums(m, 'DISPONIVEL', lotA)).toBe(3);
      expect(await sums(m, 'DISPONIVEL', lotB)).toBe(3);
    });

    it('lote de outro material não pode ser devolvido como se fosse deste material', async () => {
      const m = await mk('LOTX', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const other = await mk('LOTY', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const foreignLot = await lot(other, `F-${sfx}`, '2031-01-01');
      const res = await newReturn({ items: [{ materialId: m, quantity: 1, lotId: foreignLot }] });
      expect(res.status).not.toBe(201);
    });

    it('sucata de item com lote baixa somente o saldo em quarentena desse lote e exige aprovação', async () => {
      const m = await mk('SCL', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const l = await lot(m, `S-${sfx}`, '2031-06-01');
      await stockIn(m, 4, { lotId: l });
      const r = (await newReturn({ items: [{ materialId: m, quantity: 2, lotId: l }] }).expect(201)).body;
      await classify(r.id, r.items[0].id, { disposition: 'SUCATA', notes: 'Vencido após uso' }).expect(422); // sem aprovação
      await classify(r.id, r.items[0].id, { disposition: 'SUCATA', notes: 'Vencido após uso', approvalRef: 'DSP-L1' }).expect(200);
      expect(await sums(m, 'QUARENTENA', l)).toBe(0);
      expect(await sums(m, 'DISPONIVEL', l)).toBe(4);
      const mv = await prisma.stockMovement.findFirstOrThrow({ where: { materialId: m, type: 'DESCARTE' } });
      expect(mv).toMatchObject({ axisApprovalRef: 'DSP-L1', lotId: l });
    });

    it('SUCATA sem saldo em quarentena é recusada e o item continua pendente de inspeção', async () => {
      const m = await mk('SNS', { returnable: false, type: 'CONSUMO' });
      await stockIn(m, 2);
      const r = (await newReturn({ items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
      await prisma.stockBalance.updateMany({ where: { materialId: m, condition: 'QUARENTENA' }, data: { quantity: 0 } });
      await classify(r.id, r.items[0].id, { disposition: 'SUCATA', notes: 'Sem saldo', approvalRef: 'DSP-X' }).expect(422);
      const item = await prisma.returnItem.findUniqueOrThrow({ where: { id: r.items[0].id } });
      expect(item.status).toBe('PENDENTE_INSPECAO');
      expect(await prisma.stockMovement.count({ where: { materialId: m, type: 'DESCARTE' } })).toBe(0);
    });

    it('classificação simultânea do mesmo item: só uma passa e o estoque não duplica', async () => {
      const m = await mk('RACE1', { returnable: false, type: 'CONSUMO' });
      await stockIn(m, 1);
      const r = (await newReturn({ items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
      const res = await Promise.all([
        classify(r.id, r.items[0].id, { disposition: 'DISPONIVEL', notes: 'Primeira' }),
        classify(r.id, r.items[0].id, { disposition: 'DISPONIVEL', notes: 'Segunda' }),
      ]);
      expect(res.map((x) => x.status).filter((s) => s === 200)).toHaveLength(1);
      expect(await sums(m, 'DISPONIVEL')).toBe(2);
      expect(await sums(m, 'QUARENTENA')).toBe(0);
    });
  });

  describe('custódia — borda', () => {
    it('devolução parcial em partes: pendente é respeitado até o termo fechar; excesso recusado', async () => {
      const m = await mk('PARC', { returnable: true });
      await stockIn(m, 4);
      const f = await flow(`S6E-PARC-${sfx}`, 4);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      expect(Number(term.quantity)).toBe(4);
      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(201);
      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 2 }] }).expect(201);
      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 2 }] }).expect(422); // pendente é 1
      const last = await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(201);
      expect(last.body.returnedByAxisId).toBe(emp);
      const t = await prisma.custodyTerm.findUniqueOrThrow({ where: { id: term.id } });
      expect(t.status).toBe('DEVOLVIDO');
      expect(Number(t.returnedQty)).toBe(4);
    });

    it('mark-lost de termo não-serial encerra como PERDIDO sem mexer em série nem no saldo', async () => {
      const m = await mk('LOSTN');
      await stockIn(m, 4);
      const f = await flow(`S6E-LOSTN-${sfx}`, 2);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const before = await sums(m);
      const res = await api().post(`/api/v1/custody/${term.id}/mark-lost`).set(A(gestor)).send({ notes: 'Extravio no pátio', approvalRef: 'EXT-N1' }).expect(200);
      expect(res.body).toMatchObject({ status: 'PERDIDO', serialId: null });
      expect(await sums(m)).toBe(before);
      await newReturn({ custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] }).expect(409); // termo encerrado
    });

    it('colaborador desligado: USER inativo entra nas pendências; colaborador ativo não', async () => {
      const usr = `usr-s6e-${sfx}`;
      const act = `act-s6e-${sfx}`;
      const m1 = await mk('OFF1'); const m2 = await mk('OFF2');
      await stockIn(m1, 1); await stockIn(m2, 1);
      const f1 = await flow(`S6E-OFF1-${sfx}`, 1);
      await f1.dispatch().expect(200); await f1.deliver({ receiverAxisId: usr }).expect(200);
      const f2 = await flow(`S6E-OFF2-${sfx}`, 1);
      await f2.dispatch().expect(200); await f2.deliver({ receiverAxisId: act }).expect(200);
      await prisma.axisMasterCache.create({ data: { kind: 'USER', axisId: usr, name: 'Usuário desligado', active: false, sourceOccurredAt: new Date() } });
      await prisma.axisMasterCache.create({ data: { kind: 'COLLABORATOR', axisId: act, name: 'Colaborador ativo', active: true, sourceOccurredAt: new Date() } });
      const t1 = await prisma.custodyTerm.findFirstOrThrow({ where: { custodianAxisId: usr } });
      const t2 = await prisma.custodyTerm.findFirstOrThrow({ where: { custodianAxisId: act } });
      const pend = (await api().get('/api/v1/custody/offboarded-pending').set(A(gestor)).expect(200)).body.map((t: { id: string }) => t.id);
      expect(pend).toContain(t1.id);
      expect(pend).not.toContain(t2.id);
    });

    it('escopo custody: colaborador lista só os próprios termos e não filtra pelo custodiante de outro', async () => {
      const m = await mk('SCOPE');
      await stockIn(m, 1);
      const f = await flow(`S6E-SCOPE-${sfx}`, 1);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const outro = tokenFor(['colaborador'], `outro-s6e-${sfx}`);
      const seen = (await api().get('/api/v1/custody').query({ pageSize: 100 }).set(A(outro)).expect(200)).body;
      expect(seen.items.map((t: { id: string }) => t.id)).not.toContain(term.id);
      await api().get('/api/v1/custody').query({ custodianAxisId: emp }).set(A(outro)).expect(403);
      const mine = (await api().get('/api/v1/custody').query({ custodianAxisId: emp }).set(A(colab)).expect(200)).body;
      expect(mine.items.map((t: { id: string }) => t.id)).toContain(term.id);
    });

    // BUG: não há trava (SELECT ... FOR UPDATE ou updateMany condicional) no termo. As duas requisições leem
    // returnedQty = 0, ambas passam na checagem e ambas gravam returnedQty = 1: duas devoluções de 1 unidade
    // contra um termo de 1 unidade, e o estoque em quarentena fica com 2.
    // Passos: termo de 1 pendente → POST /returns ×2 em paralelo com custodyTermId → ambas 201.
    it.fails('duas devoluções simultâneas contra o mesmo termo pendente de 1 unidade: só uma passa', async () => {
      const m = await mk('CONC', { returnable: true });
      await stockIn(m, 3);
      const f = await flow(`S6E-CONC-${sfx}`, 1);
      await f.dispatch().expect(200); await f.deliver().expect(200);
      const term = await prisma.custodyTerm.findFirstOrThrow({ where: { materialId: m } });
      const body = { custodyTermId: term.id, items: [{ materialId: m, quantity: 1 }] };
      const res = await Promise.all([newReturn(body), newReturn(body)]);
      expect(res.map((x) => x.status).filter((s) => s === 201)).toHaveLength(1);
      expect(await sums(m, 'QUARENTENA')).toBe(1);
    });
  });

  describe('cancelamento — borda', () => {
    it('resolve-cancellation libera várias reservas em lotes diferentes com reserved_qty exato', async () => {
      const m = await mk('MLOT', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      await stockIn(m, 3, { lotId: await lot(m, `M1-${sfx}`, '2030-03-01') });
      await stockIn(m, 3, { lotId: await lot(m, `M2-${sfx}`, '2030-04-01') });
      const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S6E-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s6e', items: [{ materialCode: `S6E-MLOT-${sfx}`, quantity: 4 }] }).expect(201)).body;
      await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201);
      expect(await reserved(m)).toBe(4);
      const nRes = await prisma.reservation.count({ where: { item: { orderId: order.id }, status: 'ATIVA' } });
      expect(nRes).toBeGreaterThanOrEqual(2);
      await api().post(`/api/v1/fulfillment-orders/${order.id}/cancel-request`).set(A(gestor)).send({ reason: 'Projeto parado' }).expect(200);
      const res = await api().post(`/api/v1/fulfillment-orders/${order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Liberar tudo' }).expect(200);
      expect(res.body.releasedReservations).toBe(nRes);
      expect(await reserved(m)).toBe(0);
      expect(await sums(m)).toBe(6);
    });

    it('tarefa parcialmente separada: cancela a tarefa, libera a reserva sem mover estoque e é idempotente', async () => {
      const m = await mk('PART', { returnable: false, type: 'CONSUMO' });
      await stockIn(m, 5);
      const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S6E-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s6e', items: [{ materialCode: `S6E-PART-${sfx}`, quantity: 3 }] }).expect(201)).body;
      const rel = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
      const t = (a: string, b: Record<string, unknown> = {}) => api().post(`/api/v1/picking-tasks/${rel.id}/${a}`).set(A(picker)).send(b);
      await t('start').expect(200);
      const item = rel.items[0];
      await t('scan', { pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, quantity: 1 }).expect(200);
      await api().post(`/api/v1/fulfillment-orders/${order.id}/cancel-request`).set(A(gestor)).send({ reason: 'Cliente desistiu' }).expect(200);
      await api().post(`/api/v1/fulfillment-orders/${order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'Parcial liberada' }).expect(200);
      expect(await reserved(m)).toBe(0);
      expect(await sums(m)).toBe(5);
      expect((await prisma.pickingTask.findUniqueOrThrow({ where: { id: rel.id } })).status).toBe('CANCELADA');
      await api().post(`/api/v1/fulfillment-orders/${order.id}/resolve-cancellation`).set(A(gestor)).send({ reason: 'De novo' }).expect(409);
      expect(await reserved(m)).toBe(0);
    });
  });

  describe('etiquetas — borda', () => {
    it('ZPL de material com ^ ~ \\ e acentos mantém o texto legível e sem barra invertida', async () => {
      const m = await mk('ZPL', { shortDescription: 'Chave ^ ~ \\ Ç ação' });
      const z = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: m, format: 'zpl' }).expect(201)).body.zpl as string;
      expect(z).toContain('Ç ação');
      expect(z).toContain('Chave');
      expect(z).not.toContain('\\');
      expect(z.startsWith('^XA')).toBe(true);
    });

    it('etiqueta de endereço de outro almoxarifado é recusada para quem não tem acesso', async () => {
      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: shelfOther }).expect(403);
      await api().post('/api/v1/labels/print').set(A(gestor)).send({ kind: 'LOCATION', refId: shelfOther }).expect(201);
    });

    it('reimpressão com lote usa chave composta: outro lote do mesmo material não exige motivo', async () => {
      const m = await mk('RPL', { returnable: false, type: 'CONSUMO', lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const l1 = await lot(m, `R1-${sfx}`, '2031-02-01');
      const l2 = await lot(m, `R2-${sfx}`, '2031-03-01');
      const first = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: m, lotId: l1 }).expect(201)).body;
      expect(first.isReprint).toBe(false);
      await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: m, lotId: l1 }).expect(400);
      const other = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: m, lotId: l2 }).expect(201)).body;
      expect(other.isReprint).toBe(false);
      const re = (await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'MATERIAL', refId: m, lotId: l1, reason: 'Etiqueta suja' }).expect(201)).body;
      expect(re.isReprint).toBe(true);
    });

    it('copies inválido é recusado e nenhuma impressão é gravada', async () => {
      const before = await prisma.labelPrint.count({ where: { refId: shelf } });
      for (const copies of [0, 101, 2.5, 'três']) {
        await api().post('/api/v1/labels/print').set(A(rec)).send({ kind: 'LOCATION', refId: shelf, copies }).expect(400);
      }
      expect(await prisma.labelPrint.count({ where: { refId: shelf } })).toBe(before);
    });
  });

  describe('documentos — borda', () => {
    // Regressão: data inválida no extrato já é recusada com 400 (validação da consulta).
    it('extrato com data inválida retorna 400, não erro interno', async () => {
      await api().get('/api/v1/documents/movements').query({ from: '31/12/2026' }).set(A(gestor)).expect(400);
    });

    it('extrato não mostra movimentos de almoxarifado sem acesso do usuário', async () => {
      const m = await mk('EXTW', { returnable: false, type: 'CONSUMO' });
      await stockIn(m, 2, { toLocationId: shelfOther });
      const mine = (await api().get('/api/v1/documents/movements').query({ materialId: m }).set(A(rec)).expect(200)).body;
      expect(mine.table.rows).toHaveLength(0);
      const all = (await api().get('/api/v1/documents/movements').query({ materialId: m }).set(A(gestor)).expect(200)).body;
      expect(all.table.rows).toHaveLength(1);
    });

    it('comprovante de devolução de outro almoxarifado é recusado para usuário sem acesso', async () => {
      const m = await mk('RETW', { returnable: false, type: 'CONSUMO' });
      await stockIn(m, 1);
      const r = (await newReturn({ items: [{ materialId: m, quantity: 1 }] }).expect(201)).body;
      const outsider = tokenFor(['tecnico'], `outsider-s6e-${sfx}`);
      await api().put(`/api/v1/rbac/users/outsider-s6e-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [otherWh] }).expect(200);
      await api().get(`/api/v1/documents/returns/${r.id}`).set(A(outsider)).expect(403);
      expect((await api().get(`/api/v1/documents/returns/${r.id}`).set(A(rec)).expect(200)).body.number).toMatch(/^DEV-\d{8}$/);
    });
  });
});
