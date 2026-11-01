import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda extras do Sprint 4 (separação, conferência, embalagem, expedição, entrega).
// Não altera src/. Bugs confirmados ficam em it.fails com comentário de reprodução.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Sprint 4 — casos de borda extras', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor']);
  const admin = tokenFor(['admin']);
  const picker = tokenFor(['tecnico'], `e4-picker-${sfx}`);
  const outsider = tokenFor(['tecnico'], `e4-outsider-${sfx}`); // sem almoxarifado atribuído
  const colab = tokenFor(['colaborador'], `e4-colab-${sfx}`); // sem permissões de expedição
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let whCode: string, whId: string, locA: string, locB: string, un: string;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S4E-${s}-${sfx}`, shortDescription: `Borda ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to = locA, extra: Record<string, unknown> = {}) =>
    api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de borda', unitCost: 10, ...extra }).expect(201);
  const lot = async (materialId: string, lotNumber: string, d: number) =>
    (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId, lotNumber, expiresAt: day(d) }).expect(201)).body.id as string;
  const serial = async (materialId: string, s: string) =>
    (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId, serial: s }).expect(201)).body.id as string;
  const orderWith = async (items: Array<{ materialCode: string; quantity: number }>, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S4E-${randomUUID()}`, warehouseCode: whCode, projectAxisId: 'prj-s4e', costCenterAxisId: 'cc-s4e', items, ...extra }).expect(201)).body;
  const release = (orderId: string, body: Record<string, unknown> = {}, token = gestor) => api().post(`/api/v1/fulfillment-orders/${orderId}/release-picking`).set(A(token)).send(body);
  const task = (id: string, action: string, body: Record<string, unknown> = {}, token = picker) => api().post(`/api/v1/picking-tasks/${id}/${action}`).set(A(token)).send(body);
  const scanItem = (taskId: string, item: { id: string; locationId: string; materialId: string; lotId?: string | null }, quantity: number, extra: Record<string, unknown> = {}, token = picker) =>
    task(taskId, 'scan', { pickingItemId: item.id, locationId: item.locationId, materialId: item.materialId, lotId: item.lotId ?? undefined, quantity, ...extra }, token);
  const pack = (orderId: string, packages: unknown[], token = gestor) => api().post(`/api/v1/fulfillment-orders/${orderId}/pack`).set(A(token)).send({ packages });
  const dispatch = (shipmentId: string, token = gestor) => api().post(`/api/v1/shipments/${shipmentId}/dispatch`).set(A(token)).send({ carrier: 'Frota própria' });
  const confirm = (shipmentId: string, body: Record<string, unknown>, token = gestor) => api().post(`/api/v1/shipments/${shipmentId}/confirm-delivery`).set(A(token)).send(body);
  const onHand = async (materialId: string) => (await prisma.stockBalance.aggregate({ where: { materialId }, _sum: { quantity: true, reservedQty: true } }))._sum;
  const orderStatus = async (id: string) => (await prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id } })).status;

  /** Libera e inicia; devolve a tarefa com os itens. */
  const liberarEIniciar = async (orderId: string, body: Record<string, unknown> = {}) => {
    const rel = await release(orderId, body).expect(201);
    await task(rel.body.id, 'start').expect(200);
    return rel.body as { id: string; items: Array<{ id: string; locationId: string; materialId: string; lotId: string | null; quantityPlanned: string }> };
  };
  /** Separa todos os itens por inteiro e completa. */
  const separarTudo = async (orderId: string) => {
    const t = await liberarEIniciar(orderId);
    for (const it of t.items) await scanItem(t.id, it, Number(it.quantityPlanned)).expect(200);
    await task(t.id, 'complete').expect(200);
    return t;
  };
  /** Embala todos os itens separados em um único volume e despacha. */
  const embalarEDespachar = async (orderId: string, items: Array<{ id: string; quantityPlanned: string }>) => {
    const p = await pack(orderId, [{ items: items.map((i) => ({ pickingItemId: i.id, quantity: Number(i.quantityPlanned) })) }]).expect(201);
    await dispatch(p.body.id).expect(200);
    return p.body as { id: string; packages: Array<{ id: string }> };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S4E-${sfx}`;
    whId = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 4 borda', type: 'CENTRAL' }).expect(201)).body.id;
    const area = async (code: string) => (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    locA = await area('QA'); locB = await area('QB');
    for (const u of [`e4-picker-${sfx}`, `e4-checker-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [whId] }).expect(200);
  });
  afterAll(async () => app.close());

  // -------------------------------------------------------------------------------------------
  describe('leitura (scan)', () => {
    it('validação HTTP: quantidade inválida, UUIDs e código longo são 400 antes de tocar no estoque', async () => {
      const m = await mk('VAL');
      await stockIn(m, 3);
      const o = await orderWith([{ materialCode: `S4E-VAL-${sfx}`, quantity: 3 }]);
      const item = (await liberarEIniciar(o.id)).items[0];
      const t = (await prisma.pickingTask.findFirstOrThrow({ where: { orderId: o.id } })).id;
      await scanItem(t, item, 'abc' as unknown as number).expect(400);
      await scanItem(t, item, 0).expect(400);
      await scanItem(t, item, -1).expect(400);
      await scanItem(t, item, 1.1234567).expect(400);
      await scanItem(t, item, 1, { barcode: '9'.repeat(81) }).expect(400);
      await task(t, 'scan', { pickingItemId: 'nao-uuid', locationId: locA, materialId: m, quantity: 1 }).expect(400);
      await scanItem(t, item, 1, { campoInventado: true }).expect(400); // forbidNonWhitelisted
      expect((await prisma.pickingItem.findUniqueOrThrow({ where: { id: item.id } })).quantityPicked.toString()).toBe('0');
    });

    it('quantidade fracionada em material de unidade inteira (UN) é recusada com UNIT_CONVERSION_ERROR', async () => {
      const m = await mk('DEC');
      await stockIn(m, 3);
      const o = await orderWith([{ materialCode: `S4E-DEC-${sfx}`, quantity: 3 }]);
      const t = await liberarEIniciar(o.id);
      const r = await scanItem(t.id, t.items[0], 1.5).expect(400);
      expect(r.body.code).toBe('UNIT_CONVERSION_ERROR');
    });

    it('lote lido diferente do reservado (ou ausente) é recusado; o lote certo passa', async () => {
      const m = await mk('LOT', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const l1 = await lot(m, `L1-${sfx}`, 30);
      const l2 = await lot(m, `L2-${sfx}`, 200);
      await stockIn(m, 5, locA, { lotId: l1 });
      await stockIn(m, 5, locA, { lotId: l2 });
      const o = await orderWith([{ materialCode: `S4E-LOT-${sfx}`, quantity: 2 }]);
      const t = await liberarEIniciar(o.id);
      expect(t.items[0].lotId).toBe(l1); // FEFO: lote que vence primeiro
      await scanItem(t.id, t.items[0], 1, { lotId: l2 }).expect(422);
      await task(t.id, 'scan', { pickingItemId: t.items[0].id, locationId: locA, materialId: m, quantity: 1 }).expect(422); // sem lote informado
      await scanItem(t.id, t.items[0], 1, { lotId: l1 }).expect(200);
    });

    it('série que está em outro endereço é recusada na leitura', async () => {
      const m = await mk('SERLOC', { serialControlled: true, exitMethod: 'SERIE_ESPECIFICA' });
      const sX = await serial(m, `SX-${sfx}`);
      const sY = await serial(m, `SY-${sfx}`);
      await stockIn(m, 1, locA, { serialId: sX });
      await stockIn(m, 1, locB, { serialId: sY });
      const o = await orderWith([{ materialCode: `S4E-SERLOC-${sfx}`, quantity: 1 }]);
      const t = await liberarEIniciar(o.id);
      await scanItem(t.id, t.items[0], 1, { serialId: sY }).expect(422); // Y está em locB
      await scanItem(t.id, t.items[0], 1, { serialId: sX }).expect(200);
    });

    it('série em condição BAIXADO não é separada', async () => {
      const m = await mk('SERBX', { serialControlled: true, exitMethod: 'SERIE_ESPECIFICA' });
      const s = await serial(m, `SBX-${sfx}`);
      await stockIn(m, 1, locA, { serialId: s });
      const o = await orderWith([{ materialCode: `S4E-SERBX-${sfx}`, quantity: 1 }]);
      const t = await liberarEIniciar(o.id);
      await prisma.serialNumber.update({ where: { id: s }, data: { condition: 'BAIXADO' } }); // simula baixa após a liberação
      const r = await scanItem(t.id, t.items[0], 1, { serialId: s }).expect(422);
      expect(r.body.message).toMatch(/condição de uso/);
    });

    it('série já lida em outra tarefa em separação é recusada com SERIAL_DUPLICATE', async () => {
      const m = await mk('SERDUP', { serialControlled: true, exitMethod: 'SERIE_ESPECIFICA' });
      const s1 = await serial(m, `SD1-${sfx}`);
      const s2 = await serial(m, `SD2-${sfx}`);
      await stockIn(m, 1, locA, { serialId: s1 });
      await stockIn(m, 1, locA, { serialId: s2 });
      const o1 = await orderWith([{ materialCode: `S4E-SERDUP-${sfx}`, quantity: 1 }]);
      const o2 = await orderWith([{ materialCode: `S4E-SERDUP-${sfx}`, quantity: 1 }]);
      const t1 = await liberarEIniciar(o1.id);
      const t2 = await liberarEIniciar(o2.id, {}); // tarefa separada da primeira
      await scanItem(t1.id, t1.items[0], 1, { serialId: s1 }).expect(200);
      const dup = await scanItem(t2.id, t2.items[0], 1, { serialId: s1 }, picker).expect(409);
      expect(dup.body.code).toBe('SERIAL_DUPLICATE');
    });

    it('código de embalagem é aceito na leitura (companheiro do bug de fator abaixo)', async () => {
      const m = await mk('PKGOK');
      await prisma.materialBarcode.create({ data: { materialId: m, code: `PKGOK-${sfx}`, kind: 'EMBALAGEM', factor: 12 } });
      await stockIn(m, 12);
      const o = await orderWith([{ materialCode: `S4E-PKGOK-${sfx}`, quantity: 12 }]);
      const t = await liberarEIniciar(o.id);
      await scanItem(t.id, t.items[0], 1, { barcode: `PKGOK-${sfx}`, materialId: undefined }).expect(200);
    });

    // Bug: MaterialBarcode.factor (embalagem = 12) é ignorado na leitura. Uma caixa lida com quantity 1
    // conta 1 unidade, e não 12. Reprodução: estoque 12 UN, código de embalagem fator 12, scan barcode quantity 1.
    it('código de embalagem converte pelo fator (1 caixa = 12 UN)', async () => {
      const m = await mk('PKGF');
      await prisma.materialBarcode.create({ data: { materialId: m, code: `PKGF-${sfx}`, kind: 'EMBALAGEM', factor: 12 } });
      await stockIn(m, 12);
      const o = await orderWith([{ materialCode: `S4E-PKGF-${sfx}`, quantity: 12 }]);
      const t = await liberarEIniciar(o.id);
      await scanItem(t.id, t.items[0], 1, { barcode: `PKGF-${sfx}`, materialId: undefined }).expect(200);
      expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: t.items[0].id } })).quantityPicked)).toBe(12);
    });

    it('scan após complete é recusado (409) e não altera o item', async () => {
      const m = await mk('AFTER');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-AFTER-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      await scanItem(t.id, t.items[0], 1).expect(409);
      expect((await prisma.pickingItem.findUniqueOrThrow({ where: { id: t.items[0].id } })).quantityPicked.toString()).toBe('2');
    });

    it('scan de item de outra tarefa é 404', async () => {
      const m = await mk('OTHER');
      await stockIn(m, 2);
      const o1 = await orderWith([{ materialCode: `S4E-OTHER-${sfx}`, quantity: 1 }]);
      const o2 = await orderWith([{ materialCode: `S4E-OTHER-${sfx}`, quantity: 1 }]);
      const t1 = await liberarEIniciar(o1.id);
      const t2 = await liberarEIniciar(o2.id);
      await scanItem(t1.id, t2.items[0], 1).expect(404);
    });

    it('fechar item com divergência exige motivo e quantidade positiva (zero não fecha item)', async () => {
      const m = await mk('CLZ');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-CLZ-${sfx}`, quantity: 2 }]);
      const t = await liberarEIniciar(o.id);
      await scanItem(t.id, t.items[0], 0, { closeShort: true, divergenceReason: 'Não encontrado' }).expect(400);
      await scanItem(t.id, t.items[0], 1, { closeShort: true }).expect(400); // sem motivo
      await task(t.id, 'complete').expect(422);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('conclusão da separação', () => {
    // Bug: não há caminho pela API para encerrar um item sem nenhuma unidade. O DTO exige quantity > 0
    // (inclusive com closeShort), então complete com todos os itens zerados nunca chega a DIVERGENCIA:
    // responde 422 e a ordem fica presa em EM_SEPARACAO. Reprodução: release → start → complete.
    it('complete sem nenhuma leitura não fecha a tarefa (422) e a ordem não avança', async () => {
      const m = await mk('NOPICK');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-NOPICK-${sfx}`, quantity: 2 }]);
      const t = await liberarEIniciar(o.id);
      await task(t.id, 'complete').expect(422);
      expect(await orderStatus(o.id)).toBe('EM_SEPARACAO');
    });

    it('item não encontrado no endereço (notFound) em todos os itens leva a ordem a DIVERGENCIA', async () => {
      const m = await mk('ZERO');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-ZERO-${sfx}`, quantity: 2 }]);
      const t = await liberarEIniciar(o.id);
      await task(t.id, 'scan', { pickingItemId: t.items[0].id, locationId: t.items[0].locationId, notFound: true }).expect(400); // sem motivo
      await task(t.id, 'scan', { pickingItemId: t.items[0].id, locationId: t.items[0].locationId, notFound: true, divergenceReason: 'Não está na prateleira' }).expect(200);
      await task(t.id, 'complete').expect(200);
      expect(await orderStatus(o.id)).toBe('DIVERGENCIA');
    });

    it('completar uma tarefa já completada é 409 e não duplica a liberação de reservas', async () => {
      const m = await mk('DBLC');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-DBLC-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      await task(t.id, 'complete').expect(409);
      expect(Number((await onHand(m)).reservedQty)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('embalagem', () => {
    it('volume com item de outra ordem é recusado (400) e nenhum embarque é criado', async () => {
      const ma = await mk('PKA');
      const mb = await mk('PKB');
      await stockIn(ma, 2); await stockIn(mb, 2);
      const oa = await orderWith([{ materialCode: `S4E-PKA-${sfx}`, quantity: 2 }]);
      const ob = await orderWith([{ materialCode: `S4E-PKB-${sfx}`, quantity: 2 }]);
      await separarTudo(oa.id);
      const tb = await separarTudo(ob.id);
      const before = await prisma.shipment.count({ where: { orderId: oa.id } });
      await pack(oa.id, [{ items: [{ pickingItemId: tb.items[0].id, quantity: 2 }] }]).expect(400);
      expect(await prisma.shipment.count({ where: { orderId: oa.id } })).toBe(before);
    });

    it('o mesmo item pode ser dividido em duas linhas, mas a soma tem que bater com o separado', async () => {
      const m = await mk('SPLIT');
      await stockIn(m, 5);
      const o = await orderWith([{ materialCode: `S4E-SPLIT-${sfx}`, quantity: 5 }]);
      const t = await separarTudo(o.id);
      await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 3 }, { pickingItemId: t.items[0].id, quantity: 3 }] }]).expect(422); // 6 de 5
      const ok = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }, { items: [{ pickingItemId: t.items[0].id, quantity: 3 }] }]).expect(201);
      expect(ok.body.packages).toHaveLength(2);
    });

    // Bug: a embalagem não valida a casa decimal da unidade (o scan valida; o pack não). Com UN, dois
    // volumes de 2,5 somam 5 e são aceitos, gerando 2,5 unidade por volume.
    // Reprodução: separar 5 UN → pack com [{items:[{pi, 2.5}]}, {items:[{pi, 2.5}]}] → hoje 201.
    it('embalagem de UN não aceita quantidade fracionada (2,5 + 2,5 → 422)', async () => {
      const m = await mk('FRAC');
      await stockIn(m, 5);
      const o = await orderWith([{ materialCode: `S4E-FRAC-${sfx}`, quantity: 5 }]);
      const t = await separarTudo(o.id);
      const r = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 2.5 }] }, { items: [{ pickingItemId: t.items[0].id, quantity: 2.5 }] }]);
      expect(r.status).toBe(422);
    });

    it('pacote com item separado em quantidade zero não pode ser embalado', async () => {
      const m = await mk('ZPK');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-ZPK-${sfx}`, quantity: 2 }]);
      const rel = await release(o.id).expect(201);
      await task(rel.body.id, 'start').expect(200);
      await task(rel.body.id, 'complete').expect(422); // nada separado
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('expedição e entrega', () => {
    // Bug: após RECUSADA a ordem fica em DIVERGENCIA, e pack exige SEPARADA — a checagem
    // "shipment.status != RECUSADA" é inalcançável e não há como reembalar/reentregar.
    // Reprodução: separar → embalar → despachar → confirm RECUSADA (notes) → pack de novo → hoje 409.
    // Decisão: após RECUSADA a ordem fica em DIVERGENCIA e exige tratamento (cancelar/devolver, Sprint 6); não reembala sozinha.
    it('após RECUSADA a ordem exige tratamento e não aceita nova embalagem (409)', async () => {
      const m = await mk('REP');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-REP-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      const sh = await embalarEDespachar(o.id, t.items);
      await confirm(sh.id, { outcome: 'RECUSADA', receiverName: 'Portaria', notes: 'Cliente recusou' }).expect(200);
      const again = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }]);
      expect(again.status).toBe(409);
    });

    it('dispatch e confirmação exigem shipment:execute (colaborador recebe 403)', async () => {
      const m = await mk('PERM');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-PERM-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      const p = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }]).expect(201);
      await dispatch(p.body.id, colab).expect(403);
      await dispatch(p.body.id).expect(200);
      await confirm(p.body.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }, colab).expect(403);
    });

    it('dispatch de usuário sem acesso ao almoxarifado da ordem é 403 e não muda o status', async () => {
      const m = await mk('SCOPE');
      await stockIn(m, 2);
      const o = await orderWith([{ materialCode: `S4E-SCOPE-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      const p = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }]).expect(201);
      await dispatch(p.body.id, outsider).expect(403);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('PRONTO');
      await dispatch(p.body.id).expect(200);
      await confirm(p.body.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }, outsider).expect(403);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('EXPEDIDA');
    });

    it('confirmação com validação HTTP: coordenadas, data e recebedor são 400', async () => {
      const fake = randomUUID();
      await confirm(fake, { outcome: 'ENTREGUE', receiverName: 'Fulano', latitude: 91 }).expect(400);
      await confirm(fake, { outcome: 'ENTREGUE', receiverName: 'Fulano', longitude: -181 }).expect(400);
      await confirm(fake, { outcome: 'ENTREGUE', receiverName: 'Fulano', deliveredAt: 'ontem' }).expect(400);
      await confirm(fake, { outcome: 'ENTREGUE', receiverName: 'A' }).expect(400);
      await confirm(fake, { outcome: 'PERDIDA', receiverName: 'Fulano' }).expect(400);
    });

    // Entrega com lote bloqueado no meio: o item do lote bloqueado deve impedir a entrega inteira.
    // Nenhum movimento pode ter sido gravado para o atendimento (rollback total).
    it('entrega com um lote bloqueado no meio: rollback total, nenhum movimento parcial e nada gravado', async () => {
      const mx = await mk('RBX');
      const my = await mk('RBY', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      await stockIn(mx, 2);
      const ly = await lot(my, `RBY-${sfx}`, 60);
      await stockIn(my, 2, locA, { lotId: ly });
      const o = await orderWith([{ materialCode: `S4E-RBX-${sfx}`, quantity: 2 }, { materialCode: `S4E-RBY-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      const sh = await embalarEDespachar(o.id, t.items);
      await prisma.lot.update({ where: { id: ly }, data: { status: 'BLOQUEADO', statusReason: 'Teste de rollback' } });

      const r = await confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' });
      expect([409, 422]).toContain(r.status);
      expect(await prisma.stockMovement.count({ where: { correlationId: o.id } })).toBe(0);
      expect(Number((await onHand(mx)).quantity)).toBe(2);
      expect(Number((await onHand(mx)).reservedQty)).toBe(2);
      expect((await prisma.shipment.findUniqueOrThrow({ where: { id: sh.id } })).status).toBe('EXPEDIDA');
      expect(await prisma.package.count({ where: { shipmentId: sh.id, status: 'EXPEDIDO' } })).toBe(1);
      expect(await prisma.integrationMessage.count({ where: { eventType: 'delivery.confirmed', payload: { path: ['order_id'], equals: o.id } } })).toBe(0);

      // Depois de desbloquear, a mesma entrega passa inteira (prova que nada ficou pela metade).
      await prisma.lot.update({ where: { id: ly }, data: { status: 'LIBERADO' } });
      await confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(200);
      expect(Number((await onHand(mx)).quantity)).toBe(0);
      expect(Number((await onHand(my)).quantity)).toBe(0);
    });

    it('confirmação ENTREGUE repetida não dá segunda baixa (409) e preserva o saldo', async () => {
      const m = await mk('REPD');
      await stockIn(m, 4);
      const o = await orderWith([{ materialCode: `S4E-REPD-${sfx}`, quantity: 4 }]);
      const t = await separarTudo(o.id);
      const sh = await embalarEDespachar(o.id, t.items);
      await confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(200);
      await confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(409);
      expect(Number((await onHand(m)).quantity)).toBe(0);
      expect(await prisma.stockMovement.count({ where: { correlationId: o.id } })).toBe(1);
    });

    it('PARCIAL repetida com o mesmo volume não entrega de novo (422) e não mexe no saldo', async () => {
      const m = await mk('PREP');
      await stockIn(m, 6);
      const o = await orderWith([{ materialCode: `S4E-PREP-${sfx}`, quantity: 6 }]);
      const t = await separarTudo(o.id);
      const sh = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 4 }] }, { items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }]).expect(201);
      await dispatch(sh.body.id).expect(200);
      const [p1] = sh.body.packages;
      await confirm(sh.body.id, { outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [p1.id] }).expect(200);
      const onceMore = await confirm(sh.body.id, { outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [p1.id] });
      expect(onceMore.status).toBe(422);
      expect(Number((await onHand(m)).quantity)).toBe(2);
    });

    // Concorrência: duas confirmações ENTREGUE simultâneas do mesmo embarque. Só uma pode baixar.
    it('duas entregas simultâneas do mesmo embarque: exatamente uma baixa', async () => {
      const m = await mk('CONC');
      await stockIn(m, 5);
      const o = await orderWith([{ materialCode: `S4E-CONC-${sfx}`, quantity: 5 }]);
      const t = await separarTudo(o.id);
      const sh = await embalarEDespachar(o.id, t.items);
      const rs = await Promise.all([1, 2].map(() => confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(rs.filter((r) => [409, 422].includes(r.status))).toHaveLength(1); // a segunda perde por saldo ou por estado
      expect(Number((await onHand(m)).quantity)).toBe(0);
      expect(Number((await onHand(m)).reservedQty)).toBe(0);
      expect(await prisma.stockMovement.count({ where: { correlationId: o.id } })).toBe(1);
    });

    // Concorrência: duas entregas PARCIAIS simultâneas do mesmo volume.
    it('duas entregas parciais simultâneas do mesmo volume: uma só, saldo baixado uma vez', async () => {
      const m = await mk('CONCP');
      await stockIn(m, 6);
      const o = await orderWith([{ materialCode: `S4E-CONCP-${sfx}`, quantity: 6 }]);
      const t = await separarTudo(o.id);
      const sh = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 4 }] }, { items: [{ pickingItemId: t.items[0].id, quantity: 2 }] }]).expect(201);
      await dispatch(sh.body.id).expect(200);
      const [p1] = sh.body.packages;
      const rs = await Promise.all([1, 2].map(() => confirm(sh.body.id, { outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [p1.id] })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
      expect(Number((await onHand(m)).quantity)).toBe(2);
      expect(Number((await onHand(m)).reservedQty)).toBe(2);
    });

    it('eventos de outbox por etapa: parcial, recusa e disponibilidade após a entrega', async () => {
      const m = await mk('EVT');
      await stockIn(m, 4);
      const o = await orderWith([{ materialCode: `S4E-EVT-${sfx}`, quantity: 4 }]);
      const t = await separarTudo(o.id);
      const sh = await pack(o.id, [{ items: [{ pickingItemId: t.items[0].id, quantity: 3 }] }, { items: [{ pickingItemId: t.items[0].id, quantity: 1 }] }]).expect(201);
      await dispatch(sh.body.id).expect(200);
      const [p1] = sh.body.packages;
      await confirm(sh.body.id, { outcome: 'PARCIAL', receiverName: 'Recebedor', packageIds: [p1.id] }).expect(200);
      const partial = await prisma.integrationMessage.findFirstOrThrow({ where: { eventType: 'delivery.partial', payload: { path: ['shipment_id'], equals: sh.body.id } } });
      expect(partial.payload).toMatchObject({ order_id: o.id, pending_packages: 1 });
      expect(partial.status).toBe('PENDING');
      await confirm(sh.body.id, { outcome: 'ENTREGUE', receiverName: 'Recebedor' }).expect(200);
      const avail = await prisma.integrationMessage.findFirst({ where: { eventType: 'availability.changed', payload: { path: ['warehouse_id'], equals: whId } }, orderBy: { occurredAt: 'desc' } });
      expect(avail).not.toBeNull();
      expect(await prisma.integrationMessage.count({ where: { eventType: 'delivery.confirmed', payload: { path: ['shipment_id'], equals: sh.body.id } } })).toBe(1);

      // Recusa emite delivery.refused com o motivo.
      await stockIn(m, 1);
      const o2 = await orderWith([{ materialCode: `S4E-EVT-${sfx}`, quantity: 1 }]);
      const t2 = await separarTudo(o2.id);
      const sh2 = await embalarEDespachar(o2.id, t2.items);
      await confirm(sh2.id, { outcome: 'RECUSADA', receiverName: 'Portaria', notes: 'Endereço errado' }).expect(200);
      const refused = await prisma.integrationMessage.findFirstOrThrow({ where: { eventType: 'delivery.refused', payload: { path: ['shipment_id'], equals: sh2.id } } });
      expect(refused.payload).toMatchObject({ reason: 'Endereço errado' });
    });

    it('custo oculto: movimentos de entrega só trazem unitCost com material:read_cost', async () => {
      const m = await mk('COST');
      await stockIn(m, 2, locA, { unitCost: 12.5 });
      const o = await orderWith([{ materialCode: `S4E-COST-${sfx}`, quantity: 2 }]);
      const t = await separarTudo(o.id);
      const sh = await embalarEDespachar(o.id, t.items);
      await confirm(sh.id, { outcome: 'ENTREGUE', receiverName: 'Fulano' }).expect(200);

      const sem = await api().get('/api/v1/stock/movements').query({ materialId: m, type: 'SAIDA_ENTREGA' }).set(A(picker)).expect(200);
      expect(sem.body.items.length).toBeGreaterThan(0);
      expect(sem.body.items.every((i: Record<string, unknown>) => !('unitCost' in i))).toBe(true);

      const com = await api().get('/api/v1/stock/movements').query({ materialId: m, type: 'SAIDA_ENTREGA' }).set(A(gestor)).expect(200);
      expect(com.body.items.some((i: Record<string, unknown>) => 'unitCost' in i)).toBe(true);
    });
  });
});
