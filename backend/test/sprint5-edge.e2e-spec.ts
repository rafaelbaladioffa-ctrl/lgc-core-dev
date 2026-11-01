import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda extras do Sprint 5 (recebimento, inspeção, armazenagem, transferências).
// Não altera src/. Bugs confirmados ficam em it.fails com comentário.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

describe('Sprint 5 — casos de borda', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = Date.now().toString(36).toUpperCase();
  const gestor = tokenFor(['gestor'], `gestor-s5e-${sfx}`);
  const admin = tokenFor(['admin'], `admin-s5e-${sfx}`);
  const rec = tokenFor(['tecnico'], `rec-s5e-${sfx}`);
  const hse = tokenFor([`qualidade-s5e-${sfx}`], `hse-s5e-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let w1: string, w2: string, docA: string, locA: string, locB: string, loc2: string, un: string;

  const mk = async (s: string, extra: Record<string, unknown> = {}) =>
    (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S5E-${s}-${sfx}`, shortDescription: `Borda ${s}`, category: `CatE${sfx}`, type: 'CONSUMO', stockUomId: un, ...extra }).expect(201)).body.id as string;
  const newReceipt = (extra: Record<string, unknown> = {}, token = rec) =>
    api().post('/api/v1/receipts').set(A(token)).send({ warehouseId: w1, receivingLocationId: docA, axisPurchaseOrderId: `PO-E-${sfx}`, ...extra });
  const scan = (rid: string, body: Record<string, unknown>, token = rec) => api().post(`/api/v1/receipts/${rid}/items:scan`).set(A(token)).send(body);
  const complete = (rid: string, token = rec) => api().post(`/api/v1/receipts/${rid}/complete`).set(A(token));
  const getReceipt = async (id: string) => (await api().get(`/api/v1/receipts/${id}`).set(A(gestor)).expect(200)).body;
  const sums = async (materialId: string, locationId: string, condition?: string) =>
    Number((await prisma.stockBalance.aggregate({ where: { materialId, locationId, ...(condition && { condition: condition as never }) }, _sum: { quantity: true } }))._sum.quantity ?? 0);
  // Lista de armazenagem é limitada a 200 tarefas (mais antigas primeiro): busca direta no banco evita falsos negativos.
  const putawayFor = async (materialId: string) => prisma.putawayTask.findFirst({ where: { materialId, status: 'ABERTA' }, orderBy: { seq: 'desc' } });

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
    w1 = await wh(`S5EA-${sfx}`); w2 = await wh(`S5EB-${sfx}`);
    docA = await loc(w1, 'DOCA'); locA = await loc(w1, 'ARM-A'); locB = await loc(w1, 'ARM-B'); loc2 = await loc(w2, 'ARM-2');
    for (const u of [`rec-s5e-${sfx}`, `hse-s5e-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [w1, w2] }).expect(200);
    await api().put(`/api/v1/rbac/axis-role-mapping/qualidade-s5e-${sfx}`).set(A(admin)).send({ logisticsRoles: ['HSE_QUALIDADE'] }).expect(200);
  });
  afterAll(async () => {
    await api().put(`/api/v1/rbac/axis-role-mapping/qualidade-s5e-${sfx}`).set(A(admin)).send({ logisticsRoles: [] });
    await app.close();
  });

  describe('validação de DTOs', () => {
    it('datas inválidas e quantidade não numérica são recusadas no escaneamento', async () => {
      const m = await mk('DTO', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 1, lotNumber: 'D1', expiresAt: '2026-02-30' }).expect(400); // dia inexistente
      await scan(r.id, { materialId: m, quantity: 1, lotNumber: 'D1', expiresAt: '31/12/2030' }).expect(400); // formato BR
      await scan(r.id, { materialId: m, quantity: 'abc', lotNumber: 'D1', expiresAt: day(90) }).expect(400);
      await scan(r.id, { materialId: m, quantity: 1, lotNumber: 'D1', expiresAt: day(90), serials: Array.from({ length: 1001 }, (_, i) => `X${i}`) }).expect(400); // array enorme
    });

    it('recebimento aceita no máximo 500 itens previstos e volumes limitados', async () => {
      const big = Array.from({ length: 501 }, (_, i) => ({ materialCode: `NAO-EXISTE-${i}`, quantity: 1 }));
      await newReceipt({ expectedItems: big }).expect(400);
      await newReceipt({ volumes: 100001 }).expect(400);
      await newReceipt({ volumes: -1 }).expect(400);
    });
  });

  describe('recebimento e lotes', () => {
    it('mesmo lote em dois itens do mesmo recebimento é consolidado no mesmo lote', async () => {
      const m = await mk('LOTDUP', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 2, lotNumber: 'LD', expiresAt: day(200) }).expect(201);
      await scan(r.id, { materialId: m, quantity: 3, lotNumber: 'LD', expiresAt: day(200) }).expect(201);
      await complete(r.id).expect(200);
      expect(await prisma.lot.count({ where: { materialId: m, lotNumber: 'LD' } })).toBe(1);
      expect(await sums(m, docA, 'DISPONIVEL')).toBe(5);
    });

    it('lote existente com outra validade em novo recebimento é recusado (422) sem gravar entrada', async () => {
      const m = await mk('LOTVAL', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const r1 = (await newReceipt().expect(201)).body;
      await scan(r1.id, { materialId: m, quantity: 2, lotNumber: 'LV', expiresAt: day(200) }).expect(201);
      await complete(r1.id).expect(200);
      const r2 = (await newReceipt().expect(201)).body;
      await scan(r2.id, { materialId: m, quantity: 4, lotNumber: 'LV', expiresAt: day(300) }).expect(201);
      await complete(r2.id).expect(422);
      expect(await sums(m, docA)).toBe(2); // nada da segunda entrada foi gravado
      expect((await getReceipt(r2.id)).status).toBe('EM_CONFERENCIA');
    });

    it('avaria no recebimento grava condição AVARIADO e não sugere endereço', async () => {
      const m = await mk('AVAR');
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 2, damaged: true }).expect(201);
      await complete(r.id).expect(200);
      expect(await sums(m, docA, 'AVARIADO')).toBe(2);
      expect(await sums(m, docA, 'DISPONIVEL')).toBe(0);
      const t = await putawayFor(m);
      expect(t?.suggestedLocationId ?? null).toBeNull();
      expect((await getReceipt(r.id)).hasDivergence).toBe(true);
    });

    it('custo unitário não aparece para quem não tem material:read_cost', async () => {
      const m = await mk('COST');
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 1, unitCost: 99.9 }).expect(201);
      await complete(r.id).expect(200);
      // Controle positivo: quem tem material:read_cost vê o custo; quem não tem, não.
      const seen = (await api().get('/api/v1/stock/movements').query({ materialId: m }).set(A(gestor)).expect(200)).body.items as Array<Record<string, unknown>>;
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.some((row) => row.unitCost !== undefined)).toBe(true);
      const hidden = (await api().get('/api/v1/stock/movements').query({ materialId: m }).set(A(rec)).expect(200)).body.items as Array<Record<string, unknown>>;
      expect(hidden.length).toBe(seen.length);
      for (const row of hidden) expect(row).not.toHaveProperty('unitCost');
    });

    it('aprovação parcial: um item liberado e outro em inspeção deixa o recibo como RECEBIDO_PENDENTE_INSPECAO', async () => {
      const ok = await mk('PARC-OK');
      const q = await mk('PARC-Q', { requiresCertificate: true });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: ok, quantity: 1 }).expect(201);
      const qi = (await scan(r.id, { materialId: q, quantity: 1 }).expect(201)).body;
      await complete(r.id).expect(200);
      expect((await getReceipt(r.id)).status).toBe('RECEBIDO_PENDENTE_INSPECAO');
      await api().post(`/api/v1/receipts/${r.id}/items/${qi.id}/inspect`).set(A(hse)).send({ decision: 'APROVADO', notes: 'Visual ok', certificateRef: 'C-1' }).expect((res) => {
        if (res.status !== 200) throw new Error(`inspect ${res.status}: ${JSON.stringify(res.body)}`);
      });
      expect((await getReceipt(r.id)).status).toBe('LIBERADO');
    });

    it('receber 0 de um item de transferência mantém o item em trânsito e marca divergência', async () => {
      const m = await mk('ZERO');
      await api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', `s5e-zero-${sfx}`).send({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: 2, toLocationId: locA, reason: 'Carga' }).expect(201);
      const t = (await api().post('/api/v1/transfers').set(A(rec)).send({ toWarehouseId: w2, reason: 'Teste de zero', items: [{ materialId: m, fromLocationId: locA, quantity: 2 }] }).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(gestor)).send({}).expect(200);
      const out = (await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(rec)).send({}).expect(409)).body; // não urgente: exige separação
      expect(out.message).toMatch(/separação/);
      await api().post(`/api/v1/transfers/${t.id}/start-picking`).set(A(rec)).send({}).expect(200);
      const sent = (await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(rec)).send({}).expect(200)).body;
      const rcv = (await api().post(`/api/v1/transfers/${t.id}/receive`).set(A(rec)).send({ items: [{ itemId: sent.items[0].id, receivedQty: 0, toLocationId: loc2 }] }).expect(200)).body;
      expect(rcv.hasDivergence).toBe(true);
      expect(await sums(m, loc2)).toBe(0);
      expect(await prisma.stockBalance.aggregate({ where: { materialId: m, location: { isVirtual: true } }, _sum: { quantity: true } }).then((x) => Number(x._sum.quantity ?? 0))).toBe(2);
    });
  });

  describe('armazenagem', () => {
    it('sem nenhum endereço compatível a sugestão fica nula (restrição temporária de categoria em w1)', async () => {
      const locs = await prisma.location.findMany({ where: { warehouseId: w1, isVirtual: false } });
      const saved = locs.map((l) => ({ id: l.id, allowedCategories: l.allowedCategories }));
      await prisma.location.updateMany({ where: { warehouseId: w1, id: { not: docA } }, data: { allowedCategories: ['OUTRA_CATEGORIA'] } });
      try {
        const m = await mk('NOCAND2');
        const r = (await newReceipt().expect(201)).body;
        await scan(r.id, { materialId: m, quantity: 1 }).expect(201);
        await complete(r.id).expect(200);
        const t = await putawayFor(m);
        expect(t?.suggestedLocationId ?? null).toBeNull();
        await api().post(`/api/v1/putaway-tasks/${t!.id}/confirm`).set(A(rec)).send({ locationId: locB }).expect(422);
      } finally {
        for (const s of saved) await prisma.location.update({ where: { id: s.id }, data: { allowedCategories: s.allowedCategories } });
      }
    });

    it('capacidade por PESO bloqueia excesso e aceita o que cabe', async () => {
      const pesoLoc = (await api().post(`/api/v1/warehouses/${w1}/locations`).set(A(gestor)).send({ code: `PESO-${sfx}`, level: 'AREA' }).expect(201)).body.id as string;
      await prisma.location.update({ where: { id: pesoLoc }, data: { capacityKind: 'PESO', capacityValue: 10 } });
      const m = await mk('PESO', { weightKg: 4 });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 3 }).expect(201);
      await complete(r.id).expect(200);
      const t = await putawayFor(m);
      await api().post(`/api/v1/putaway-tasks/${t!.id}/confirm`).set(A(rec)).send({ locationId: pesoLoc }).expect(422); // 12 kg > 10 kg
    });

    it('rollback: falha no meio do putaway seriado não move nenhuma série', async () => {
      const m = await mk('SERRB', { serialControlled: true, assetTagged: true, type: 'EQUIPAMENTO', exitMethod: 'SERIE_ESPECIFICA' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 2, serials: [`RB-1-${sfx}`, `RB-2-${sfx}`] }).expect(201);
      await complete(r.id).expect(200);
      const t = await putawayFor(m);
      // Simula falha na segunda série: tira o saldo de uma delas antes da confirmação.
      const second = await prisma.serialNumber.findFirstOrThrow({ where: { materialId: m, serial: `RB-2-${sfx}` } });
      await prisma.serialNumber.update({ where: { id: second.id }, data: { currentLocationId: null } });
      const first = await prisma.serialNumber.findFirstOrThrow({ where: { materialId: m, serial: `RB-1-${sfx}` } });
      const before = await prisma.serialNumber.findMany({ where: { materialId: m }, select: { id: true, currentLocationId: true } });
      await api().post(`/api/v1/putaway-tasks/${t!.id}/confirm`).set(A(rec)).send({ locationId: locB }).expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));
      const after = await prisma.serialNumber.findMany({ where: { materialId: m }, select: { id: true, currentLocationId: true } });
      expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: first.id } })).currentLocationId).toBe(docA);
      expect(await sums(m, locB)).toBe(0);
      expect((await prisma.putawayTask.findUniqueOrThrow({ where: { id: t!.id } })).status).toBe('ABERTA');
    });
  });

  describe('transferências', () => {
    const trf = (m: string, qty: number, token = rec) =>
      api().post('/api/v1/transfers').set(A(token)).send({ toWarehouseId: w2, reason: 'Concorrência de teste', items: [{ materialId: m, fromLocationId: locA, quantity: qty }] });
    const stockAt = (m: string, qty: number) =>
      api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', `s5e-${m}-${Math.random()}`).send({ type: 'ENTRADA_RECEBIMENTO', materialId: m, quantity: qty, toLocationId: locA, reason: 'Carga' }).expect(201);

    it('duas aprovações simultâneas sobre o mesmo saldo nunca reservam acima do disponível', async () => {
      const m = await mk('CONC'); await stockAt(m, 10);
      const t1 = (await trf(m, 7).expect(201)).body;
      const t2 = (await trf(m, 7).expect(201)).body;
      const [a, b] = await Promise.all([
        api().post(`/api/v1/transfers/${t1.id}/approve`).set(A(gestor)).send({}),
        api().post(`/api/v1/transfers/${t2.id}/approve`).set(A(gestor)).send({}),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 422]);
      const bal = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: m, locationId: locA, condition: 'DISPONIVEL' } });
      expect(Number(bal.reservedQty)).toBeLessThanOrEqual(Number(bal.quantity));
      expect(Number(bal.reservedQty)).toBe(7);
    });

    it('transferência em trânsito não aparece como disponível no almoxarifado de origem', async () => {
      const m = await mk('TRAN'); await stockAt(m, 5);
      const t = (await trf(m, 5).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(gestor)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/start-picking`).set(A(rec)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(rec)).send({}).expect(200);
      const av = (await api().get(`/api/v1/materials/${m}/availability`).set(A(gestor)).expect(200)).body;
      expect(Number(av.available)).toBe(0);
    });

    it('cancelar após expedir é recusado (409) e não altera saldos', async () => {
      const m = await mk('CANC-EXP'); await stockAt(m, 3);
      const t = (await trf(m, 3).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(gestor)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/start-picking`).set(A(rec)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(rec)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/cancel`).set(A(gestor)).send({ reason: 'Tarde demais' }).expect(409);
      expect(await sums(m, locA, 'DISPONIVEL')).toBe(0);
    });

    it('escopo: usuário só com acesso ao destino não aprova nem expede; só com acesso à origem não recebe', async () => {
      const destOnly = tokenFor(['tecnico'], `dest-s5e-${sfx}`);
      await api().put(`/api/v1/rbac/users/dest-s5e-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [w2] }).expect(200);
      const m = await mk('SCOPE2'); await stockAt(m, 2);
      const t = (await trf(m, 2).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(destOnly)).send({}).expect(403);
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(gestor)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/start-picking`).set(A(rec)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(destOnly)).send({}).expect(403);
    });

    it('escopo: quem só tem acesso à origem não recebe', async () => {
      const m = await mk('SCOPE'); await stockAt(m, 2);
      const t = (await trf(m, 2).expect(201)).body;
      await api().post(`/api/v1/transfers/${t.id}/approve`).set(A(gestor)).send({}).expect(200);
      await api().post(`/api/v1/transfers/${t.id}/start-picking`).set(A(rec)).send({}).expect(200);
      const sent = (await api().post(`/api/v1/transfers/${t.id}/dispatch`).set(A(rec)).send({}).expect(200)).body;
      // rec tem acesso a w1 e w2; hse não tem acesso a nenhum almoxarifado de transferência
      await api().post(`/api/v1/transfers/${t.id}/receive`).set(A(hse)).send({ items: [{ itemId: sent.items[0].id, receivedQty: 2, toLocationId: loc2 }] }).expect(403);
    });
  });

  describe('validade x fabricação', () => {
    it('validade anterior à fabricação é recusada na conferência', async () => {
      const m = await mk('FABVAL', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO' });
      const r = (await newReceipt().expect(201)).body;
      await scan(r.id, { materialId: m, quantity: 1, lotNumber: 'FD', manufacturedAt: day(10), expiresAt: day(5) }).expect(400);
    });
  });
});
