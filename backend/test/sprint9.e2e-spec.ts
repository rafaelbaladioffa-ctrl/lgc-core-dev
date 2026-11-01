import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 9 — sincronização offline idempotente e bootstrap do PWA', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s9');
  const admin = tokenFor(['admin'], 'admin-s9');
  const picker = tokenFor(['tecnico'], `pick9-${sfx}`);
  const other = tokenFor(['tecnico'], `other9-${sfx}`);
  const outsider = tokenFor(['tecnico'], `out9-${sfx}`);
  const colab = tokenFor(['colaborador'], 'colab-s9');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const device = `DEV-${sfx}`;

  let wh: string, whCode: string, un: string, shelf: string, doca: string;
  const mk = async (s: string) => (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S9-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to: string) => api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de teste' }).expect(201);
  const op = (type: string, payload: Record<string, unknown>, opId = randomUUID()) => ({ opId, type, payload, clientAt: new Date().toISOString() });
  const sync = (operations: unknown[], token = picker, deviceId = device) => api().post('/api/v1/sync/batch').set(A(token)).send({ deviceId, operations });
  const readyTask = async (qty = 4) => {
    const m = await mk(`T${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
    await stockIn(m, 10, shelf);
    const code = (await prisma.material.findUniqueOrThrow({ where: { id: m } })).code;
    const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `S9-${randomUUID()}`, warehouseCode: whCode, items: [{ materialCode: code, quantity: qty }] }).expect(201)).body;
    const task = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    return { m, task, item: task.items[0] };
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `S9-${sfx}`;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 9', type: 'CENTRAL' }).expect(201)).body.id;
    const loc = async (code: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    shelf = await loc('PRAT'); doca = await loc('DOCA');
    for (const u of [`pick9-${sfx}`, `other9-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => app.close());

  it('valida o lote de operações', async () => {
    await sync([]).expect(400);
    await sync([op('picking.start', { id: randomUUID() }, 'nao-uuid')]).expect(400);
    await sync([op('inventar.coisa', { id: randomUUID() })]).expect(400);
    await sync([{ opId: randomUUID(), type: 'picking.start', payload: { id: randomUUID() }, clientAt: '31/12/2026' }]).expect(400);
    await sync(Array.from({ length: 201 }, () => op('picking.start', { id: randomUUID() }))).expect(400);
    await api().post('/api/v1/sync/batch').set(A(picker)).send({ deviceId: 'x', operations: [op('picking.start', { id: randomUUID() })] }).expect(400); // dispositivo curto
    await api().post('/api/v1/sync/batch').send({}).expect(401);
  });

  it('fila offline aplicada em ordem (iniciar → ler → concluir) e reenvio é idempotente', async () => {
    const { m, task, item } = await readyTask(4);
    const o1 = op('picking.start', { id: task.id });
    const o2 = op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 3 });
    const o3 = op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 1 });
    const o4 = op('picking.complete', { id: task.id });
    const first = (await sync([o1, o2, o3, o4]).expect(200)).body.results;
    expect(first.map((r: { status: string }) => r.status)).toEqual(['APLICADA', 'APLICADA', 'APLICADA', 'APLICADA']);
    expect((await prisma.pickingTask.findUniqueOrThrow({ where: { id: task.id } })).status).toBe('SEPARADA');
    expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: item.id } })).quantityPicked)).toBe(4);

    // dispositivo reenvia tudo (resposta perdida): nada é aplicado de novo e o resultado original volta
    const again = (await sync([o1, o2, o3, o4]).expect(200)).body.results;
    expect(again.map((r: { status: string }) => r.status)).toEqual(['DUPLICADA', 'DUPLICADA', 'DUPLICADA', 'DUPLICADA']);
    expect(again[1].result.quantityPicked).toBe(first[1].result.quantityPicked);
    expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: item.id } })).quantityPicked)).toBe(4);
    expect(await prisma.offlineOperation.count({ where: { deviceId: device, opId: { in: [o1.opId, o2.opId, o3.opId, o4.opId] } } })).toBe(4);
  });

  it('envio simultâneo da mesma operação aplica uma única vez', async () => {
    const { m, task, item } = await readyTask(2);
    await sync([op('picking.start', { id: task.id })]).expect(200);
    const scan = op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 2 });
    const rs = await Promise.all([sync([scan]), sync([scan]), sync([scan])]);
    const statuses = rs.map((r) => r.body.results[0].status).sort();
    expect(statuses.filter((s: string) => s === 'APLICADA')).toHaveLength(1);
    expect(statuses.every((s: string) => ['APLICADA', 'DUPLICADA', 'CONFLITO', 'ERRO'].includes(s))).toBe(true);
    expect(Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: item.id } })).quantityPicked)).toBe(2);
  });

  it('conflitos e rejeições são registrados e informados por operação, sem derrubar o lote', async () => {
    const { m, task, item } = await readyTask(4);
    await sync([op('picking.start', { id: task.id })]).expect(200); // picker assume a tarefa
    const results = (await sync([
      op('picking.start', { id: task.id }), // outro operador tenta assumir → conflito
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: doca, materialId: m, quantity: 1 }), // endereço errado
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 99 }), // acima do planejado
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 1 }), // ok
      op('picking.scan', { id: task.id, quantidade: 'muitas' }), // payload inválido
    ], other).expect(200)).body.results;
    expect(results[0]).toMatchObject({ status: 'CONFLITO' });
    expect(results[1].status).toBe('REJEITADA'); // outro usuário não é o separador
    expect(results.map((r: { status: string }) => r.status)).toEqual(['CONFLITO', 'REJEITADA', 'REJEITADA', 'REJEITADA', 'REJEITADA']);

    const mine = (await sync([
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: doca, materialId: m, quantity: 1 }),
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 99 }),
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 1 }),
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 'muitas' }),
    ]).expect(200)).body.results;
    expect(mine[0]).toMatchObject({ status: 'REJEITADA', code: 'INVALID_LOCATION' });
    expect(mine[1].status).toBe('REJEITADA');
    expect(mine[2].status).toBe('APLICADA');
    expect(mine[3].status).toBe('REJEITADA');
    // rejeição é gravada: reenviar não tenta de novo
    const stored = await prisma.offlineOperation.findFirstOrThrow({ where: { deviceId: device, status: 'REJEITADA', code: 'INVALID_LOCATION' } });
    expect(stored.message).toMatch(/Endereço lido/);
  });

  it('opId reutilizado com outro conteúdo ou por outro usuário é rejeitado; permissões valem por tipo', async () => {
    const { task } = await readyTask(1);
    const o = op('picking.start', { id: task.id });
    expect((await sync([o]).expect(200)).body.results[0].status).toBe('APLICADA');
    const changed = { ...o, payload: { id: randomUUID() } };
    expect((await sync([changed]).expect(200)).body.results[0]).toMatchObject({ status: 'REJEITADA', code: 'OP_ID_REUTILIZADO' });
    expect((await sync([o], other).expect(200)).body.results[0]).toMatchObject({ status: 'REJEITADA', code: 'OP_ID_REUTILIZADO' });
    expect((await sync([o], picker, `OUTRO-${sfx}`).expect(200)).body.results[0].status).not.toBe('DUPLICADA'); // idempotência é por dispositivo

    // solicitante sem permissão operacional; contador sem picking
    const forbidden = (await sync([op('picking.start', { id: task.id })], colab).expect(403)); // sem warehouse:read nem operação
    void forbidden;
    const gestorOnly = (await sync([op('count.submit', { id: randomUUID(), lineId: randomUUID(), quantity: 1 })], picker).expect(200)).body.results[0]; // almoxarife tem stockcount:count; linha inexistente
    expect(gestorOnly.status).toBe('REJEITADA');
  });

  it('armazenagem e contagem de inventário pela fila offline', async () => {
    // armazenagem
    const m = await mk('PUT');
    const r = (await api().post('/api/v1/receipts').set(A(gestor)).send({ warehouseId: wh, receivingLocationId: doca, axisPurchaseOrderId: `PO-${sfx}` }).expect(201)).body;
    await api().post(`/api/v1/receipts/${r.id}/items:scan`).set(A(gestor)).send({ materialId: m, quantity: 5 }).expect(201);
    await api().post(`/api/v1/receipts/${r.id}/complete`).set(A(gestor)).expect(200);
    const put = await prisma.putawayTask.findFirstOrThrow({ where: { materialId: m } });
    const res = (await sync([op('putaway.confirm', { id: put.id, locationId: shelf })]).expect(200)).body.results[0];
    expect(res.status).toBe('APLICADA');
    expect(Number((await prisma.stockBalance.aggregate({ where: { materialId: m, locationId: shelf }, _sum: { quantity: true } }))._sum.quantity)).toBe(5);

    // inventário
    const cnt = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ENDERECO', warehouseId: wh, scope: { locationIds: [shelf] }, tolerancePct: 0 }).expect(201)).body;
    await api().post(`/api/v1/stock-counts/${cnt.id}/start`).set(A(gestor)).expect(200);
    const sheet = (await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(picker)).expect(200)).body;
    const ops = sheet.lines.map((l: { id: string }) => op('count.submit', { id: cnt.id, lineId: l.id, quantity: 0 }));
    const out = (await sync(ops).expect(200)).body.results;
    expect(out.every((x: { status: string }) => x.status === 'APLICADA')).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/systemQty/); // contagem cega também offline
    await api().post(`/api/v1/stock-counts/${cnt.id}/cancel`).set(A(gestor)).send({ reason: 'Fim do teste' }).expect(200);
  });

  it('bootstrap: tarefas, códigos de barras e endereços para uso sem rede; seções seguem a permissão', async () => {
    const { m, task } = await readyTask(2);
    await prisma.materialBarcode.create({ data: { materialId: m, code: `789${sfx}`, kind: 'GTIN', factor: 1 } });
    const b = (await api().get('/api/v1/sync/bootstrap').query({ warehouseId: wh }).set(A(picker)).expect(200)).body;
    expect(b.warehouseId).toBe(wh);
    expect(b.generatedAt).toBeDefined();
    expect(b.locations.map((l: { code: string }) => l.code)).toEqual(expect.arrayContaining(['PRAT', 'DOCA']));
    const t = b.pickingTasks.find((x: { id: string }) => x.id === task.id);
    expect(t.code).toMatch(/^SEP-\d{8}$/);
    expect(t.items[0]).toMatchObject({ locationCode: 'PRAT', planned: '2' });
    const mat = b.materials.find((x: { id: string }) => x.id === m);
    expect(mat.barcodes.map((x: { code: string }) => x.code)).toContain(`789${sfx}`);
    expect(JSON.stringify(b)).not.toMatch(/systemQty|averageCost|lastCost|unitCost/);
    await api().get('/api/v1/sync/bootstrap').query({ warehouseId: wh }).set(A(outsider)).expect(403);
    await api().get('/api/v1/sync/bootstrap').query({ warehouseId: 'x' }).set(A(picker)).expect(400);
    await api().get('/api/v1/sync/bootstrap').query({ warehouseId: wh }).set(A(colab)).expect(403);
  });
});
