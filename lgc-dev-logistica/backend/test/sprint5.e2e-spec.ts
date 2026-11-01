import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Sprint 5 — recebimento, inspeção, armazenagem e transferências', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s5');
  const admin = tokenFor(['admin'], 'admin-s5');
  const rec = tokenFor(['tecnico'], `rec-${sfx}`); // Almoxarife
  const outsider = tokenFor(['tecnico'], `out-${sfx}`);
  const hse = tokenFor([`qualidade-${sfx}`], `hse-${sfx}`);
  const colab = tokenFor(['colaborador'], 'colab-s5');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let w1: string, w2: string, docA: string, locA: string, locB: string, locC: string, loc2: string, un: string;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S5-${s}-${sfx}`, shortDescription: `Material ${s}`, category: `Cat${sfx}`, type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const newReceipt = (extra: Record<string, unknown> = {}, token = rec) => api().post('/api/v1/receipts').set(A(token)).send({ warehouseId: w1, receivingLocationId: docA, axisPurchaseOrderId: `PO-${sfx}`, ...extra });
  const scan = (rid: string, body: Record<string, unknown>, token = rec) => api().post(`/api/v1/receipts/${rid}/items:scan`).set(A(token)).send(body);
  const complete = (rid: string, token = rec) => api().post(`/api/v1/receipts/${rid}/complete`).set(A(token));
  const sums = async (materialId: string, locationId: string, condition?: string) =>
    Number((await prisma.stockBalance.aggregate({ where: { materialId, locationId, ...(condition && { condition: condition as never }) }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  const getReceipt = async (id: string) => (await api().get(`/api/v1/receipts/${id}`).set(A(gestor)).expect(200)).body;
  const events = async (key: string, value: string) => (await prisma.integrationMessage.findMany({ where: { direction: 'OUTBOUND', payload: { path: [key], equals: value } } })).map((e) => e.eventType);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;

    const wh = async (code: string) => (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code, name: `Almox ${code}`, type: 'CENTRAL' }).expect(201)).body.id as string;
    const loc = async (w: string, code: string) => (await api().post(`/api/v1/warehouses/${w}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    w1 = await wh(`S5A-${sfx}`); w2 = await wh(`S5B-${sfx}`);
    docA = await loc(w1, 'DOCA'); locA = await loc(w1, 'ARM-A'); locB = await loc(w1, 'ARM-B'); locC = await loc(w1, 'ARM-C'); loc2 = await loc(w2, 'ARM-2');
    for (const u of [`rec-${sfx}`, `hse-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [w1, w2] }).expect(200);
    await api().put(`/api/v1/rbac/axis-role-mapping/qualidade-${sfx}`).set(A(admin)).send({ logisticsRoles: ['HSE_QUALIDADE'] }).expect(200);
  });
  afterAll(async () => {
    await api().put(`/api/v1/rbac/axis-role-mapping/qualidade-${sfx}`).set(A(admin)).send({ logisticsRoles: [] });
    await app.close();
  });

  describe('recebimento e armazenagem', () => {
    it('recebimento sem pedido exige exceção aprovada; endereço de recebimento é validado', async () => {
      const r = await newReceipt({ axisPurchaseOrderId: undefined }).expect(422);
      expect(r.body.code).toBe('APPROVAL_REQUIRED');
      await newReceipt({ axisPurchaseOrderId: undefined, exceptionApprovalRef: 'EXC-1' }).expect(201);
      const bad = await newReceipt({ receivingLocationId: loc2 }).expect(422);
      expect(bad.body.code).toBe('INVALID_LOCATION');
      await newReceipt({}, outsider).expect(403);
      await newReceipt({}, colab).expect(403);
    });

    it('fluxo simples: conferir → concluir → entrada no ledger → armazenar no endereço sugerido', async () => {
      const m = await mk('SIMPLE');
      const r = (await newReceipt({ invoiceNumber: 'NF-1', volumes: 2, expectedItems: [{ materialCode: `S5-SIMPLE-${sfx}`, quantity: 10 }] }).expect(201)).body;
      expect(r.code).toMatch(/^REC-\d{8}$/);
      await complete(r.id).expect(409); // ainda sem conferência
      await scan(r.id, { materialId: m, quantity: 0 }).expect(400);
      await scan(r.id, { materialId: m, quantity: 1.5 }).expect(400); // UN inteiro
      await scan(r.id, { materialId: m, quantity: 1, lotNumber: 'L1' }).expect(400); // sem controle de lote
      await scan(r.id, { barcode: `S5-SIMPLE-${sfx}`, quantity: 10, unitCost: 4.5 }).expect(201); // por SKU
      await complete(r.id).expect(200);
      const done = await getReceipt(r.id);
      expect(done.status).toBe('LIBERADO');
      expect(await sums(m, docA, 'DISPONIVEL')).toBe(10);
      await scan(r.id, { materialId: m, quantity: 1 }).expect(409); // já concluído
      await api().post(`/api/v1/receipts/${r.id}/items:qualquer`).set(A(rec)).send({ materialId: m, quantity: 1 }).expect(404); // rota literal, não curinga
      expect(await events('receipt_id', r.id)).toContain('receipt.confirmed');

      const tasks = (await api().get('/api/v1/putaway-tasks').set(A(rec)).expect(200)).body as Array<{ id: string; materialId: string; suggestedLocationId: string }>;
      const t = tasks.find((x) => x.materialId === m)!;
      expect(t.suggestedLocationId).toBeTruthy();
      expect(t.suggestedLocationId).not.toBe(docA);
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: docA }).expect(422); // a própria doca
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: loc2 }).expect(422); // outro almoxarifado
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: t.suggestedLocationId }).expect(200);
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: t.suggestedLocationId }).expect(409);
      expect(await sums(m, docA)).toBe(0);
      expect(await sums(m, t.suggestedLocationId)).toBe(10);
      expect((await getReceipt(r.id)).status).toBe('ARMAZENADO');
    });

    it('divergências de quantidade e item não previsto geram DIVERGENTE e evento para Compras', async () => {
      const a = await mk('DIVA'); const b = await mk('DIVB');
      const r = (await newReceipt({ expectedItems: [{ materialId: a, quantity: 10 }] }).expect(201)).body;
      await scan(r.id, { materialId: a, quantity: 8 }).expect(201);
      await scan(r.id, { materialId: b, quantity: 1 }).expect(201);
      await complete(r.id).expect(200);
      const done = await getReceipt(r.id);
      expect(done.status).toBe('DIVERGENTE');
      expect(done.hasDivergence).toBe(true);
      expect(JSON.stringify(done.divergenceNotes)).toMatch(/previsto 10, recebido 8/);
      expect(JSON.stringify(done.divergenceNotes)).toMatch(/sem constar no pedido/);
      expect(await events('receipt_id', r.id)).toContain('receipt.divergent');
      expect(await sums(a, docA)).toBe(8); // o físico é registrado, a divergência vai para tratamento
    });

    it('lote e validade: exige dados, vida útil mínima manda para quarentena e só reprova', async () => {
      const m = await mk('LOTE', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: 30 });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 5 }).expect(400); // sem lote
      await scan(r.id, { materialId: m, quantity: 5, lotNumber: 'LX' }).expect(400); // sem validade
      await scan(r.id, { materialId: m, quantity: 5, lotNumber: 'LX', expiresAt: day(10), manufacturedAt: day(20) }).expect(400);
      const item = (await scan(r.id, { materialId: m, quantity: 5, lotNumber: `LC-${sfx}`, expiresAt: day(10) }).expect(201)).body;
      expect(item.inspectionRequired).toBe(true);
      expect(item.inspectionReason).toMatch(/validade mínima/);
      await complete(r.id).expect(200);
      expect(await sums(m, docA, 'QUARENTENA')).toBe(5);
      expect(await sums(m, docA, 'DISPONIVEL')).toBe(0);
      expect((await prisma.lot.findFirstOrThrow({ where: { materialId: m } })).status).toBe('QUARENTENA');
      expect((await getReceipt(r.id)).status).toBe('RECEBIDO_PENDENTE_INSPECAO');

      await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(rec)).send({ decision: 'APROVADO', notes: 'ok ok' }).expect(403); // almoxarife não inspeciona
      const ap = await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Visual ok' }).expect(422);
      expect(ap.body.code).toBe('INSPECTION_REQUIRED');
      const rej = await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'REPROVADO', notes: 'Validade curta demais' }).expect(200);
      expect(rej.body.status).toBe('REJEITADO');
      expect(await sums(m, docA, 'BLOQUEADO')).toBe(5);
      expect((await prisma.lot.findFirstOrThrow({ where: { materialId: m } })).status).toBe('BLOQUEADO');
      expect((await getReceipt(r.id)).status).toBe('REJEITADO');
      await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Tarde demais' }).expect(409);
    });

    it('certificado: aprovação exige certificateRef; liberada gera quarentena→disponível e armazenagem', async () => {
      const m = await mk('CERT', { requiresCertificate: true });
      const r = (await newReceipt().expect(201)).body;
      const item = (await scan(r.id, { materialId: m, quantity: 3 }).expect(201)).body;
      expect(item.inspectionReason).toMatch(/certificado/);
      await complete(r.id).expect(200);
      expect(await sums(m, docA, 'QUARENTENA')).toBe(3);
      await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Sem certificado' }).expect(422);
      const ok = await api().post(`/api/v1/receipts/${r.id}/items/${item.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Certificado conferido', certificateRef: 'CERT-123', checklist: { rotulo: true } }).expect(200);
      expect(ok.body.status).toBe('LIBERADO');
      expect(ok.body.putaways).toHaveLength(1);
      expect(await sums(m, docA, 'DISPONIVEL')).toBe(3);
      expect(await sums(m, docA, 'QUARENTENA')).toBe(0);
      expect((await getReceipt(r.id)).status).toBe('LIBERADO');
    });

    it('lote vencido no recebimento fica bloqueado e gera divergência', async () => {
      const m = await mk('VENC', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 2, lotNumber: `LV-${sfx}`, expiresAt: day(-3) }).expect(201);
      await complete(r.id).expect(200);
      expect(await sums(m, docA, 'BLOQUEADO')).toBe(2);
      expect((await getReceipt(r.id)).hasDivergence).toBe(true);
      expect((await prisma.lot.findFirstOrThrow({ where: { materialId: m } })).status).toBe('BLOQUEADO');
    });

    it('séries: uma por unidade, sem duplicar (nem entre recebimentos); criadas no endereço de recebimento e armazenadas', async () => {
      const m = await mk('SER', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 2, serials: ['A1'] }).expect(400);
      const dup = await scan(r.id, { materialId: m, quantity: 2, serials: ['A1', 'A1'] }).expect(409);
      expect(dup.body.code).toBe('SERIAL_DUPLICATE');
      await scan(r.id, { materialId: m, quantity: 2, serials: [`SN-A-${sfx}`, `SN-B-${sfx}`] }).expect(201);
      const r2 = (await newReceipt().expect(201)).body;
      await scan(r2.id, { materialId: m, quantity: 1, serials: [`SN-B-${sfx}`] }).expect(409); // lida em outro recebimento
      await complete(r.id).expect(200);
      await scan(r2.id, { materialId: m, quantity: 1, serials: [`SN-A-${sfx}`] }).expect(409); // já cadastrada
      const serials = await prisma.serialNumber.findMany({ where: { materialId: m } });
      expect(serials).toHaveLength(2);
      expect(serials.every((s) => s.currentLocationId === docA)).toBe(true);
      const t = ((await api().get('/api/v1/putaway-tasks').set(A(rec)).expect(200)).body as Array<{ id: string; materialId: string }>).find((x) => x.materialId === m)!;
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: locB }).expect(200);
      expect((await prisma.serialNumber.findMany({ where: { materialId: m } })).every((s) => s.currentLocationId === locB)).toBe(true);
    });

    it('armazenagem recusa categoria não aceita, capacidade excedida e mistura de classes de risco', async () => {
      const restricted = (await api().post(`/api/v1/warehouses/${w1}/locations`).set(A(gestor)).send({ code: `RESTR-${sfx}`, level: 'AREA' }).expect(201)).body.id as string;
      await prisma.location.update({ where: { id: restricted }, data: { allowedCategories: ['Outra'] } });
      const small = (await api().post(`/api/v1/warehouses/${w1}/locations`).set(A(gestor)).send({ code: `SMALL-${sfx}`, level: 'AREA' }).expect(201)).body.id as string;
      await prisma.location.update({ where: { id: small }, data: { capacityKind: 'QUANTIDADE', capacityValue: 3 } });
      const m = await mk('FIT');
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 5 }).expect(201);
      await complete(r.id).expect(200);
      const t = ((await api().get('/api/v1/putaway-tasks').set(A(rec)).expect(200)).body as Array<{ id: string; materialId: string; suggestedLocationId: string }>).find((x) => x.materialId === m)!;
      expect([restricted, small]).not.toContain(t.suggestedLocationId);
      const cat = await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: restricted }).expect(422);
      expect(cat.body.message).toMatch(/categoria/);
      const cap = await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: small }).expect(422);
      expect(cap.body.message).toMatch(/capacidade/);
      await prisma.location.update({ where: { id: locC }, data: { status: 'BLOQUEADO' } });
      await api().post(`/api/v1/putaway-tasks/${t.id}/confirm`).set(A(rec)).send({ locationId: locC }).expect(422);
      await prisma.location.update({ where: { id: locC }, data: { status: 'ATIVO' } });

      // mistura de risco: um inflamável já ocupa locA; um ácido não pode ir junto.
      const fl = await mk('FLAM', { riskClass: 'INFLAMAVEL' }); const ac = await mk('ACID', { riskClass: 'CORROSIVO' });
      for (const [mat, loc] of [[fl, locA]] as const) await prisma.stockBalance.create({ data: { materialId: mat, locationId: loc, lotKey: '', quantity: 1 } });
      const r2 = (await newReceipt().expect(201)).body;
      await scan(r2.id, { materialId: ac, quantity: 1 }).expect(201);
      await complete(r2.id).expect(200);
      await api().post(`/api/v1/receipts/${r2.id}/items/${(await getReceipt(r2.id)).items[0].id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Risco avaliado' }).expect(200);
      const t2 = ((await api().get('/api/v1/putaway-tasks').set(A(rec)).expect(200)).body as Array<{ id: string; materialId: string }>).find((x) => x.materialId === ac)!;
      const mix = await api().post(`/api/v1/putaway-tasks/${t2.id}/confirm`).set(A(rec)).send({ locationId: locA }).expect(422);
      expect(mix.body.message).toMatch(/mistura incompatível/);
    });
  });

  describe('transferências', () => {
    const stockAt = async (m: string, loc: string, qty: number) =>
      api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', `s5-${m}-${loc}-${Math.random()}`).send({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: qty, toLocationId: loc, reason: 'Carga de teste' }).expect(201);
    const trf = (m: string, qty: number, extra: Record<string, unknown> = {}, token = rec) =>
      api().post('/api/v1/transfers').set(A(token)).send({ toWarehouseId: w2, reason: 'Reposição da filial', items: [{ materialId: m, fromLocationId: locA, quantity: qty }], ...extra });
    const act = (id: string, action: string, body: Record<string, unknown> = {}, token = gestor) => api().post(`/api/v1/transfers/${id}/${action}`).set(A(token)).send(body);
    const bal = async (m: string, loc: string) => (await prisma.stockBalance.findMany({ where: { materialId: m, locationId: loc } })).map((b) => ({ c: b.condition, q: Number(b.quantity), r: Number(b.reservedQty) }));

    it('fluxo: solicitar → aprovar (reserva) → separar → expedir (trânsito) → receber → encerrar', async () => {
      const m = await mk('TRF'); await stockAt(m, locA, 10);
      const t = (await trf(m, 4).expect(201)).body;
      expect(t.code).toMatch(/^TRF-\d{8}$/);
      await act(t.id, 'approve', {}, rec).expect(403); // sem permissão de aprovar
      await act(t.id, 'dispatch', {}, rec).expect(409); // não aprovada
      await act(t.id, 'approve', {}, gestor).expect(200);
      expect(await bal(m, locA)).toEqual([{ c: 'DISPONIVEL', q: 10, r: 4 }]);
      // reservado está protegido de saídas comuns
      await api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', `s5-inv-${sfx}-${m}`).send({ type: 'SAIDA_ENTREGA', materialId: m, quantity: 7, fromLocationId: locA, reason: 'Invade reserva' }).expect(422);
      const noSep = await act(t.id, 'dispatch').expect(409);
      expect(noSep.body.message).toMatch(/separação/);
      await act(t.id, 'start-picking', {}, rec).expect(200);
      const out = await act(t.id, 'dispatch', {}, rec).expect(200);
      expect(out.body.status).toBe('EM_TRANSITO');
      expect(await bal(m, locA)).toEqual([{ c: 'DISPONIVEL', q: 6, r: 0 }]);
      const transit = await prisma.stockBalance.findMany({ where: { materialId: m, location: { isVirtual: true } } });
      expect(transit.map((b) => [b.condition, Number(b.quantity)])).toEqual([['BLOQUEADO', 4]]);
      const av = (await api().get(`/api/v1/materials/${m}/availability`).set(A(gestor)).expect(200)).body;
      expect(av.physical).toBe('10'); expect(av.available).toBe('6'); expect(av.blocked).toBe('4');

      const item = out.body.items[0];
      await act(t.id, 'receive', { items: [] }, rec).expect(400);
      await act(t.id, 'receive', { items: [{ itemId: item.id, receivedQty: 5, toLocationId: loc2 }] }, rec).expect(422); // mais que expedido
      await act(t.id, 'receive', { items: [{ itemId: item.id, receivedQty: 4, toLocationId: locB }] }, rec).expect(422); // destino em outro almoxarifado
      await act(t.id, 'receive', { items: [{ itemId: item.id, receivedQty: 4, toLocationId: loc2 }] }, outsider).expect(403);
      const rcv = await act(t.id, 'receive', { items: [{ itemId: item.id, receivedQty: 4, toLocationId: loc2 }] }, rec).expect(200);
      expect(rcv.body.status).toBe('RECEBIDA');
      expect(rcv.body.hasDivergence).toBe(false);
      expect(await bal(m, loc2)).toEqual([{ c: 'DISPONIVEL', q: 4, r: 0 }]);
      expect((await prisma.stockBalance.aggregate({ where: { materialId: m, location: { isVirtual: true } }, _sum: { quantity: true } }))._sum.quantity?.toString()).toBe('0');
      await act(t.id, 'receive', { items: [{ itemId: item.id, receivedQty: 4, toLocationId: loc2 }] }, rec).expect(409);
      expect((await act(t.id, 'close').expect(200)).body.status).toBe('ENCERRADA');
      expect(await events('transfer_id', t.id)).toEqual(expect.arrayContaining(['transfer.dispatched']));
    });

    it('reserva na origem exige saldo; transferência urgente expede direto com auditoria', async () => {
      const m = await mk('URG'); await stockAt(m, locA, 3);
      const big = (await trf(m, 5).expect(201)).body;
      const ins = await act(big.id, 'approve').expect(422);
      expect(ins.body.code).toBe('INSUFFICIENT_STOCK');
      const t = (await trf(m, 3, { urgent: true }).expect(201)).body;
      await act(t.id, 'approve').expect(200);
      await act(t.id, 'dispatch', {}, rec).expect(200);
      expect(await prisma.auditEvent.count({ where: { action: 'transfer.urgent_dispatch', aggregateId: t.id } })).toBe(1);
      expect(await bal(m, locA)).toEqual([{ c: 'DISPONIVEL', q: 0, r: 0 }]);
    });

    it('divergência no recebimento não ajusta automaticamente: permanece em trânsito e impede encerrar', async () => {
      const m = await mk('DIV'); await stockAt(m, locA, 5);
      const t = (await trf(m, 5).expect(201)).body;
      await act(t.id, 'approve').expect(200); await act(t.id, 'start-picking').expect(200);
      const out = await act(t.id, 'dispatch').expect(200);
      const rcv = await act(t.id, 'receive', { items: [{ itemId: out.body.items[0].id, receivedQty: 3, toLocationId: loc2 }] }, rec).expect(200);
      expect(rcv.body.hasDivergence).toBe(true);
      expect(await bal(m, loc2)).toEqual([{ c: 'DISPONIVEL', q: 3, r: 0 }]);
      const transit = await prisma.stockBalance.findMany({ where: { materialId: m, location: { isVirtual: true } } });
      expect(transit.map((b) => Number(b.quantity))).toEqual([2]);
      await act(t.id, 'close').expect(422);
      expect(await events('transfer_id', t.id)).toContain('transfer.divergent');
    });

    it('cancelamento libera a reserva; após expedir não cancela; validações de criação', async () => {
      const m = await mk('CNC'); await stockAt(m, locA, 4);
      const t = (await trf(m, 4).expect(201)).body;
      await act(t.id, 'approve').expect(200);
      expect((await bal(m, locA))[0].r).toBe(4);
      await act(t.id, 'cancel', { reason: 'x' }).expect(400);
      await act(t.id, 'cancel', { reason: 'Não é mais necessário' }, rec).expect(200);
      expect((await bal(m, locA))[0].r).toBe(0);
      await act(t.id, 'approve').expect(409);

      await trf(m, 1, { toWarehouseId: w1 }).expect(400); // mesmo almoxarifado
      await trf(m, 1, { toWarehouseId: '00000000-0000-4000-8000-000000000000' }).expect(422);
      await trf(m, 0).expect(400);
      await trf(m, 1, {}, outsider).expect(403);
      await trf(m, 1, {}, colab).expect(403);
      const lotMat = await mk('LOTX', { lotControlled: true });
      await api().post('/api/v1/transfers').set(A(rec)).send({ toWarehouseId: w2, reason: 'Sem lote', items: [{ materialId: lotMat, fromLocationId: locA, quantity: 1 }] }).expect(400);
    });

    it('item seriado atravessa o trânsito sem existir em dois locais', async () => {
      const m = await mk('TSER', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const sn = (await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: m, serial: `TS-${sfx}` }).expect(201)).body.id as string;
      await api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', `s5-ser-${sfx}`).send({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: 1, serialId: sn, toLocationId: locA, reason: 'Carga' }).expect(201);
      const t = (await api().post('/api/v1/transfers').set(A(rec)).send({ toWarehouseId: w2, reason: 'Equipamento para obra', urgent: true, items: [{ materialId: m, fromLocationId: locA, serialId: sn, quantity: 1 }] }).expect(201)).body;
      await act(t.id, 'approve').expect(200);
      const out = await act(t.id, 'dispatch').expect(200);
      const transit = await prisma.serialNumber.findUniqueOrThrow({ where: { id: sn }, include: { location: true } });
      expect(transit.location?.isVirtual).toBe(true);
      await act(t.id, 'receive', { items: [{ itemId: out.body.items[0].id, receivedQty: 1, toLocationId: loc2 }] }, rec).expect(200);
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: sn } })).currentLocationId).toBe(loc2);
    });
  });
});
