import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Bordas da sincronização offline (Sprint 9): payloads inválidos por tipo, lotes mistos, reenvios após conflito,
// dependência entre operações, limite de 200, corrida entre dois dispositivos e escopo por almoxarifado.
// Usa almoxarifado e usuários com sufixo próprio: o banco de teste é compartilhado.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('Sprint 9 (bordas) — sincronização offline', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor'], 'gestor-s9e');
  const admin = tokenFor(['admin'], 'admin-s9e');
  const picker = tokenFor(['tecnico'], `pe9a-${sfx}`);
  const other = tokenFor(['tecnico'], `pe9b-${sfx}`);
  const outsider = tokenFor(['tecnico'], `pe9o-${sfx}`);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const dev1 = `E9A-${sfx}`;
  const dev2 = `E9B-${sfx}`;

  let wh: string, whCode: string, un: string, shelf: string, doca: string;
  const mk = async (s: string) => (await api().post('/api/v1/materials').set(A(admin)).send({ code: `E9-${s}-${sfx}`, shortDescription: `Material ${s}`, category: 'Teste', type: 'CONSUMO', stockUomId: un }).expect(201)).body.id as string;
  const stockIn = (materialId: string, quantity: number, to: string) => api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity, toLocationId: to, reason: 'Carga de teste' }).expect(201);
  const op = (type: string, payload: Record<string, unknown>, opId = randomUUID()) => ({ opId, type, payload, clientAt: new Date().toISOString() });
  const sync = (operations: unknown[], token = picker, deviceId = dev1) => api().post('/api/v1/sync/batch').set(A(token)).send({ deviceId, operations });
  const readyTask = async (qty = 4) => {
    const m = await mk(`T${Math.random().toString(36).slice(2, 6).toUpperCase()}`);
    await stockIn(m, 10, shelf);
    const code = (await prisma.material.findUniqueOrThrow({ where: { id: m } })).code;
    const order = (await api().post('/api/v1/fulfillment-orders').set(A(admin)).send({ axisRequestId: `E9-${randomUUID()}`, warehouseCode: whCode, items: [{ materialCode: code, quantity: qty }] }).expect(201)).body;
    const task = (await api().post(`/api/v1/fulfillment-orders/${order.id}/release-picking`).set(A(gestor)).send({}).expect(201)).body;
    return { m, task, item: task.items[0] };
  };
  const pickedOf = async (itemId: string) => Number((await prisma.pickingItem.findUniqueOrThrow({ where: { id: itemId } })).quantityPicked);
  const scanOp = (task: string, item: string, m: string, qty: number, loc = shelf, opId?: string) => op('picking.scan', { id: task, pickingItemId: item, locationId: loc, materialId: m, quantity: qty }, opId);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    un = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whCode = `E9-${sfx}`;
    wh = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: whCode, name: 'Almox Sprint 9 bordas', type: 'CENTRAL' }).expect(201)).body.id;
    const loc = async (code: string) => (await api().post(`/api/v1/warehouses/${wh}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    shelf = await loc('PRAT'); doca = await loc('DOCA');
    for (const u of [`pe9a-${sfx}`, `pe9b-${sfx}`]) await api().put(`/api/v1/rbac/users/${u}/warehouses`).set(A(admin)).send({ warehouseIds: [wh] }).expect(200);
  });
  afterAll(async () => app.close());

  it('payload com campo extra ou tipo errado é rejeitado por operação, sem alterar o banco', async () => {
    const { m, task, item } = await readyTask(3);
    await sync([op('picking.start', { id: task.id })]).expect(200);
    const r = (await sync([
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 1, sistema: 'x' }), // campo extra
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: 'dez' }), // número inválido como texto
      op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: shelf, materialId: m, quantity: -1 }), // negativo
      op('picking.complete', { id: task.id, forcar: true }), // campo extra em operação sem scan
      op('putaway.confirm', { id: task.id, locationId: shelf }), // tarefa de armazenagem inexistente
      op('count.submit', { id: task.id, lineId: item.id, quantity: 'vazio', notes: 5 }), // tipos errados
    ]).expect(200)).body.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(['REJEITADA', 'REJEITADA', 'REJEITADA', 'REJEITADA', 'REJEITADA', 'REJEITADA']);
    expect(await pickedOf(item.id)).toBe(0);
  });

  it('clientAt no futuro ou muito antigo não derruba o lote nem muda o resultado', async () => {
    const futureTask = await readyTask(1);
    const oldTask = await readyTask(1);
    const future = { ...op('picking.start', { id: futureTask.task.id }), clientAt: '2100-01-01T00:00:00.000Z' };
    const old = { ...op('picking.start', { id: oldTask.task.id }), clientAt: '1970-01-01T00:00:00.000Z' };
    const r = (await sync([future, old]).expect(200)).body.results;
    expect(r.map((x: { status: string }) => x.status)).toEqual(['APLICADA', 'APLICADA']);
    // Observação: o servidor não valida clientAt (grava como veio). Não há limite de tolerância para relógio do aparelho.
    const stored = await prisma.offlineOperation.findFirstOrThrow({ where: { deviceId: dev1, opId: future.opId } });
    expect(stored.clientAt.toISOString()).toBe('2100-01-01T00:00:00.000Z');
  });

  it('lote misto: válidas, rejeitadas e duplicadas na mesma chamada, com ordem preservada', async () => {
    const { m, task, item } = await readyTask(4);
    const start = op('picking.start', { id: task.id });
    const scan = scanOp(task.id, item.id, m, 2);
    const bad = op('picking.scan', { id: task.id, pickingItemId: item.id, locationId: doca, materialId: m, quantity: 1 });
    const r = (await sync([start, bad, scan, start, scan]).expect(200)).body.results;
    expect(r.map((x: { opId: string }) => x.opId)).toEqual([start.opId, bad.opId, scan.opId, start.opId, scan.opId]);
    expect(r.map((x: { status: string }) => x.status)).toEqual(['APLICADA', 'REJEITADA', 'APLICADA', 'DUPLICADA', 'DUPLICADA']);
    expect(await pickedOf(item.id)).toBe(2);
  });

  it('mesmo opId de dois dispositivos: cada dispositivo tem seu próprio espaço de idempotência', async () => {
    // Documenta o desenho atual: a chave é (deviceId, opId). Opid colidindo entre aparelhos (cópia de fila) aplica de novo.
    const { m, task, item } = await readyTask(4);
    await sync([op('picking.start', { id: task.id })]).expect(200);
    const shared = scanOp(task.id, item.id, m, 1);
    expect((await sync([shared], picker, dev1)).body.results[0].status).toBe('APLICADA');
    expect((await sync([shared], picker, dev2)).body.results[0].status).toBe('APLICADA');
    expect(await pickedOf(item.id)).toBe(2);
  });

  it('opId de operação que deu CONFLITO não é reexecutado quando a tarefa fica livre', async () => {
    const { task } = await readyTask(1);
    const start = op('picking.start', { id: task.id });
    await sync([op('picking.start', { id: task.id })]).expect(200); // picker assume
    expect((await sync([start], other).expect(200)).body.results[0].status).toBe('CONFLITO');
    // o picker libera (conclui) a tarefa: o reenvio do conflito continua DUPLICADA, não vira APLICADA
    const again = (await sync([start], other).expect(200)).body.results[0];
    expect(again.status).toBe('DUPLICADA');
    expect(again.code).toBeDefined();
  });

  it('ordem das dependências: scan antes do start e complete sem nenhum scan não fazem a tarefa avançar', async () => {
    const { m, task, item } = await readyTask(2);
    const r = (await sync([scanOp(task.id, item.id, m, 1), op('picking.complete', { id: task.id })]).expect(200)).body.results;
    expect(r.every((x: { status: string }) => x.status !== 'APLICADA')).toBe(true);
    expect(await pickedOf(item.id)).toBe(0);
    expect((await prisma.pickingTask.findUniqueOrThrow({ where: { id: task.id } })).status).not.toBe('SEPARADA');
  });

  // Bug de concorrência: scanPicking lê quantityPicked sem lock (sem SELECT ... FOR UPDATE) e grava o total calculado.
  // Passos: 1) planejado 4; 2) dois dispositivos do mesmo usuário enviam scan de 3 ao mesmo tempo.
  // Esperado: só um scan aplicado (o segundo excede o restante de 1). Obtido: as duas APLICADA, com quantityPicked = 3
  // (uma das contagens se perde), ou seja, 6 separados fisicamente para 4 planejados e o registro mostra 3.
  it.fails('dois dispositivos do mesmo usuário na mesma tarefa nunca passam do planejado (sem lost update)', async () => {
    const { m, task, item } = await readyTask(4);
    await sync([op('picking.start', { id: task.id })]).expect(200);
    const rs = await Promise.all([
      sync([scanOp(task.id, item.id, m, 3)], picker, dev1),
      sync([scanOp(task.id, item.id, m, 3)], picker, dev2),
    ]);
    const applied = rs.flatMap((x) => x.body.results.map((y: { status: string }) => y.status)).filter((s: string) => s === 'APLICADA');
    expect(applied.length).toBeLessThanOrEqual(1);
  });

  it('lote no limite de 200 operações é aceito e devolve 200 resultados na ordem enviada', async () => {
    const ops = Array.from({ length: 200 }, () => op('picking.start', { id: randomUUID() }));
    const r = (await sync(ops).expect(200)).body.results;
    expect(r).toHaveLength(200);
    expect(r.map((x: { opId: string }) => x.opId)).toEqual(ops.map((o) => o.opId));
  });

  it('escopo: usuário sem acesso ao almoxarifado é recusado em cada tipo de operação', async () => {
    const { m, task, item } = await readyTask(1);
    const r = (await sync([
      op('picking.start', { id: task.id }),
      scanOp(task.id, item.id, m, 1),
      op('picking.complete', { id: task.id }),
      op('putaway.confirm', { id: task.id, locationId: shelf }),
      op('count.submit', { id: task.id, lineId: item.id, quantity: 1 }),
    ], outsider).expect(200)).body.results;
    expect(r.some((x: { status: string }) => x.status === 'APLICADA')).toBe(false);
    expect(await pickedOf(item.id)).toBe(0);
  });

  it('bootstrap não vaza saldo do sistema nem custos, mesmo com folha de contagem', async () => {
    const cnt = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ENDERECO', warehouseId: wh, scope: { locationIds: [shelf] }, tolerancePct: 0 }).expect(201)).body;
    await api().post(`/api/v1/stock-counts/${cnt.id}/start`).set(A(gestor)).expect(200);
    const b = (await api().get('/api/v1/sync/bootstrap').query({ warehouseId: wh }).set(A(other)).expect(200)).body;
    expect(b.countSheets.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(b)).not.toMatch(/systemQty|averageCost|lastCost|unitCost|finalQty|varianceQty/);
    await api().post(`/api/v1/stock-counts/${cnt.id}/cancel`).set(A(gestor)).send({ reason: 'Fim do teste de borda' }).expect(200);
  });

  it('bootstrap na 2ª rodada: o operador vê as linhas da rodada, sem o valor contado pelo outro operador', async () => {
    const cnt = (await api().post('/api/v1/stock-counts').set(A(gestor)).send({ type: 'ENDERECO', warehouseId: wh, scope: { locationIds: [shelf] }, tolerancePct: 0 }).expect(201)).body;
    await api().post(`/api/v1/stock-counts/${cnt.id}/start`).set(A(gestor)).expect(200);
    const sheet = (await api().get(`/api/v1/stock-counts/${cnt.id}/sheet`).set(A(picker)).expect(200)).body;
    const line = sheet.lines[0];
    expect((await sync([op('count.submit', { id: cnt.id, lineId: line.id, quantity: 7 })]).expect(200)).body.results[0].status).toBe('APLICADA');
    const b = (await api().get('/api/v1/sync/bootstrap').query({ warehouseId: wh }).set(A(other)).expect(200)).body;
    const mine = b.countSheets.find((s: { id: string }) => s.id === cnt.id);
    expect(mine).toBeDefined();
    expect(JSON.stringify(mine)).not.toMatch(/"count1Qty":"?7/);
    await api().post(`/api/v1/stock-counts/${cnt.id}/cancel`).set(A(gestor)).send({ reason: 'Fim do teste de borda' }).expect(200);
  });

  it('GET /sync/bootstrap de almoxarifado sem tarefas responde 200 com listas vazias', async () => {
    const vazio = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `E9V-${sfx}`, name: 'Vazio', type: 'CENTRAL' }).expect(201)).body.id;
    await api().put(`/api/v1/rbac/users/pe9a-${sfx}/warehouses`).set(A(admin)).send({ warehouseIds: [wh, vazio] }).expect(200);
    const b = (await api().get('/api/v1/sync/bootstrap').query({ warehouseId: vazio }).set(A(picker)).expect(200)).body;
    expect(b.pickingTasks).toEqual([]);
    expect(b.putawayTasks).toEqual([]);
    expect(b.countSheets).toEqual([]);
    expect(b.materials).toEqual([]);
  });
});
