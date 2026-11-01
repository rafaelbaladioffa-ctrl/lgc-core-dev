import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const WH_SECRET = process.env.AXIS_WEBHOOK_SECRET!;
const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: SECRET }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });
const sign = (body: string, secret = WH_SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

describe('Sprint 2 — ledger, saldos, lotes, séries e webhook', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor']); // stock:post, stock:adjust, stock:reverse, lot:write, serial:write, access_all
  const admin = tokenFor(['admin']); // material:write
  const colab = tokenFor(['colaborador']);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  let uomUN: string, uomKG: string, whId: string, locA: string, locB: string, locBlocked: string;
  let plain: string, lotMat: string, serialMat: string, kgMat: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);

    uomUN = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    uomKG = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'KG' } })).id;
    const wh = await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `S2-${sfx}`, name: 'Almox Sprint 2', type: 'CENTRAL' }).expect(201);
    whId = wh.body.id;
    const area = async (code: string) => (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code, level: 'AREA' }).expect(201)).body.id as string;
    locA = await area('ZA'); locB = await area('ZB'); locBlocked = await area('ZX');
    await prisma.location.update({ where: { id: locBlocked }, data: { status: 'BLOQUEADO' } });

    const mk = async (suffix: string, extra: Record<string, unknown>, uom = uomUN) =>
      (await api().post('/api/v1/materials').set(A(admin)).send({ code: `S2-${suffix}-${sfx}`, shortDescription: `Material ${suffix}`, category: 'Teste', type: 'CONSUMO', stockUomId: uom, ...extra }).expect(201)).body.id as string;
    plain = await mk('PLAIN', {});
    lotMat = await mk('LOT', { lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', minShelfLifeDays: 30 });
    serialMat = await mk('SER', { serialControlled: true, assetTagged: true, exitMethod: 'SERIE_ESPECIFICA' });
    kgMat = await mk('KG', {}, uomKG);
  });
  afterAll(async () => app.close());

  const move = (body: Record<string, unknown>, key = randomUUID(), token = gestor) => api().post('/api/v1/stock/movements').set(A(token)).set('Idempotency-Key', key).send(body);
  const entry = (materialId: string, qty: number, to = locA, extra: Record<string, unknown> = {}) => move({ type: 'ENTRADA_RECEBIMENTO', materialId, quantity: qty, toLocationId: to, reason: 'Recebimento de teste', ...extra });
  const balance = async (materialId: string, locationId: string) => {
    const r = await api().get('/api/v1/stock/balances').query({ materialId, locationId }).set(A(gestor)).expect(200);
    return r.body.items as Array<{ quantity: string; available: string; condition: string; lotId: string | null }>;
  };

  describe('ledger e saldos', () => {
    it('entrada atualiza saldo; saída parcial; saldo insuficiente bloqueia', async () => {
      const e = await entry(plain, 10).expect(201);
      expect(e.body.code).toMatch(/^MOV-\d{8}$/);
      expect((await balance(plain, locA))[0].quantity).toBe('10');
      await move({ type: 'SAIDA_ENTREGA', materialId: plain, quantity: 4, fromLocationId: locA, reason: 'Entrega teste' }).expect(201);
      expect((await balance(plain, locA))[0].available).toBe('6');
      const bad = await move({ type: 'SAIDA_ENTREGA', materialId: plain, quantity: 7, fromLocationId: locA, reason: 'Entrega teste' }).expect(422);
      expect(bad.body.message).toMatch(/Saldo insuficiente/);
      expect((await balance(plain, locA))[0].quantity).toBe('6');
    });

    it('exige Idempotency-Key e repete o resultado original sem duplicar', async () => {
      await api().post('/api/v1/stock/movements').set(A(gestor)).send({ type: 'ENTRADA_RECEBIMENTO', materialId: plain, quantity: 1, toLocationId: locA, reason: 'Sem chave' }).expect(400);
      const key = randomUUID();
      const first = await entry(plain, 5, locB, {}).set('Idempotency-Key', key).expect(201);
      const again = await entry(plain, 5, locB, {}).set('Idempotency-Key', key).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.replayed).toBe(true);
      expect((await balance(plain, locB))[0].quantity).toBe('5');
    });

    it('concorrência: saídas simultâneas nunca deixam o saldo negativo', async () => {
      await entry(plain, 3, locB).expect(201); // locB = 8
      const results = await Promise.all(Array.from({ length: 6 }, () => move({ type: 'SAIDA_ENTREGA', materialId: plain, quantity: 3, fromLocationId: locB, reason: 'Corrida' })));
      const ok = results.filter((r) => r.status === 201).length;
      expect(ok).toBe(2); // 8 / 3 = 2 saídas possíveis
      expect(results.filter((r) => r.status === 422).length).toBe(4);
      expect((await balance(plain, locB))[0].quantity).toBe('2');
    });

    it('transferência move entre endereços; valida formato por tipo', async () => {
      await entry(plain, 2, locA).expect(201);
      const before = Number((await balance(plain, locA))[0].quantity);
      await move({ type: 'TRANSFERENCIA', materialId: plain, quantity: 2, fromLocationId: locA, toLocationId: locB, reason: 'Reorganização' }).expect(201);
      expect(Number((await balance(plain, locA))[0].quantity)).toBe(before - 2);
      await move({ type: 'TRANSFERENCIA', materialId: plain, quantity: 1, fromLocationId: locA, toLocationId: locA, reason: 'Igual' }).expect(400);
      await move({ type: 'ENTRADA_RECEBIMENTO', materialId: plain, quantity: 1, fromLocationId: locA, toLocationId: locB, reason: 'Entrada com origem' }).expect(400);
    });

    it('precisão da unidade e quantidade positiva', async () => {
      await entry(plain, 1.5).expect(400); // UN = inteiro
      await entry(plain, 0).expect(400);
      await entry(plain, -2).expect(400);
      await entry(kgMat, 2.345).expect(201);
      await entry(kgMat, 1.2345).expect(400); // KG = 3 casas
    });

    it('endereço bloqueado recusa movimento comum', async () => {
      const r = await entry(plain, 1, locBlocked).expect(422);
      expect(r.body.message).toMatch(/bloqueado/);
    });

    it('permissões: solicitante não lança; almoxarife não ajusta; ajuste exige aprovação Axis', async () => {
      await entry(plain, 1, locA, {}).set('Authorization', `Bearer ${colab}`).expect(403);
      const tecnico = tokenFor(['tecnico']);
      await api().put('/api/v1/rbac/users/u-tecnico/warehouses').set(A(admin)).send({ warehouseIds: [whId] }).expect(200);
      await move({ type: 'ENTRADA_RECEBIMENTO', materialId: plain, quantity: 1, toLocationId: locA, reason: 'Almoxarife' }, randomUUID(), tecnico).expect(201);
      await move({ type: 'AJUSTE_NEGATIVO', materialId: plain, quantity: 1, fromLocationId: locA, reason: 'Ajuste', axisApprovalRef: 'APR-1' }, randomUUID(), tecnico).expect(403);
      await move({ type: 'AJUSTE_NEGATIVO', materialId: plain, quantity: 1, fromLocationId: locA, reason: 'Ajuste sem aprovação' }).expect(400);
      await move({ type: 'AJUSTE_NEGATIVO', materialId: plain, quantity: 1, fromLocationId: locA, reason: 'Ajuste aprovado', axisApprovalRef: 'APR-1' }).expect(201);
    });

    it('escopo por almoxarifado: sem acesso ao almoxarifado, 403', async () => {
      const outsider = tokenFor(['tecnico'], 'u-outsider');
      await move({ type: 'ENTRADA_RECEBIMENTO', materialId: plain, quantity: 1, toLocationId: locA, reason: 'Fora do escopo' }, randomUUID(), outsider).expect(403);
    });

    it('estorno cria movimento reverso vinculado, restaura saldo e não duplica', async () => {
      const m = await entry(plain, 7, locB).expect(201);
      const before = Number((await balance(plain, locB))[0].quantity);
      const rev = await api().post(`/api/v1/stock/movements/${m.body.id}/reverse`).set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ reason: 'Lançado por engano' }).expect(201);
      expect(rev.body.reversesMovementId).toBe(m.body.id);
      expect(Number((await balance(plain, locB))[0].quantity)).toBe(before - 7);
      await api().post(`/api/v1/stock/movements/${m.body.id}/reverse`).set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ reason: 'De novo' }).expect(409);
      await api().post(`/api/v1/stock/movements/${rev.body.id}/reverse`).set(A(gestor)).set('Idempotency-Key', randomUUID()).send({ reason: 'Estorno do estorno' }).expect(400);
      await api().post(`/api/v1/stock/movements/${m.body.id}/reverse`).set(A(tokenFor(['tecnico'])) ).set('Idempotency-Key', randomUUID()).send({ reason: 'Sem permissão' }).expect(403);
    });

    it('ledger é imutável no banco (UPDATE/DELETE/TRUNCATE bloqueados)', async () => {
      const any = await prisma.stockMovement.findFirstOrThrow();
      await expect(prisma.stockMovement.update({ where: { id: any.id }, data: { reason: 'adulterado' } })).rejects.toThrow(/imutavel/);
      await expect(prisma.stockMovement.delete({ where: { id: any.id } })).rejects.toThrow(/imutavel/);
      await expect(prisma.$executeRawUnsafe('TRUNCATE stock_movements')).rejects.toThrow(/imutavel/);
      await expect(prisma.$executeRawUnsafe('UPDATE audit_events SET action = \'x\'')).rejects.toThrow();
    });

    it('CHECK do banco impede saldo negativo mesmo por escrita direta', async () => {
      const bal = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: plain, locationId: locA } });
      await expect(prisma.stockBalance.update({ where: { id: bal.id }, data: { quantity: -1 } })).rejects.toThrow(/stock_balances_quantity_nonneg/);
    });

    it('movimento posta evento no outbox na mesma transação', async () => {
      const m = await entry(plain, 1).expect(201);
      const msg = await prisma.integrationMessage.findFirst({ where: { direction: 'OUTBOUND', eventType: 'stock.movement.posted', payload: { path: ['movement_id'], equals: m.body.id } } });
      expect(msg?.status).toBe('PENDING');
    });

    it('consulta de movimentos pagina e oculta custo sem material:read_cost', async () => {
      await entry(plain, 1, locA, { unitCost: 9.9 }).expect(201);
      const full = await api().get('/api/v1/stock/movements').query({ materialId: plain, pageSize: 5 }).set(A(gestor)).expect(200);
      expect(full.body.items.length).toBeGreaterThan(0);
      expect(full.body.items.some((i: { unitCost?: string }) => i.unitCost !== undefined)).toBe(true);
      const tecnico = tokenFor(['tecnico']);
      const lim = await api().get('/api/v1/stock/movements').query({ materialId: plain }).set(A(tecnico)).expect(200);
      expect(lim.body.items.every((i: { unitCost?: string }) => i.unitCost === undefined)).toBe(true);
    });
  });

  describe('lotes e validade', () => {
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    let okLot: string, shortLot: string, expiredLot: string;

    it('cadastra lotes com validação e unicidade', async () => {
      await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lotMat, lotNumber: 'L-SEM-VAL' }).expect(400); // validade obrigatória
      await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: plain, lotNumber: 'X', expiresAt: day(100) }).expect(400); // não controla lote
      const mk = async (n: string, d: number) => (await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lotMat, lotNumber: n, expiresAt: day(d) }).expect(201)).body.id as string;
      okLot = await mk('L-OK', 200); shortLot = await mk('L-CURTO', 10); expiredLot = await mk('L-VENC', -1);
      await api().post('/api/v1/lots').set(A(gestor)).send({ materialId: lotMat, lotNumber: 'L-OK', expiresAt: day(200) }).expect(409);
      await api().post('/api/v1/lots').set(A(colab)).send({ materialId: lotMat, lotNumber: 'Z', expiresAt: day(200) }).expect(403);
    });

    it('material com lote exige lote; vida útil mínima e lote vencido são recusados na entrada', async () => {
      await entry(lotMat, 5).expect(400);
      const r = await entry(lotMat, 5, locA, { lotId: shortLot }).expect(422);
      expect(r.body.message).toMatch(/Vida útil/);
      await entry(lotMat, 5, locA, { lotId: expiredLot }).expect(422);
      await entry(lotMat, 8, locA, { lotId: okLot }).expect(201);
    });

    it('lote bloqueado não compõe disponível nem pode ser expedido; liberação restaura', async () => {
      await api().patch(`/api/v1/lots/${okLot}/status`).set(A(gestor)).send({ status: 'BLOQUEADO', reason: 'Inspeção' }).expect(403); // só HSE/Qualidade
      const hse = tokenFor(['admin']); // admin não tem lot:block
      await api().patch(`/api/v1/lots/${okLot}/status`).set(A(hse)).send({ status: 'BLOQUEADO', reason: 'x' }).expect(403);
      await prisma.lot.update({ where: { id: okLot }, data: { status: 'BLOQUEADO' } });
      expect((await balance(lotMat, locA))[0].available).toBe('0');
      await move({ type: 'SAIDA_ENTREGA', materialId: lotMat, quantity: 1, fromLocationId: locA, lotId: okLot, reason: 'Tentativa' }).expect(422);
      await prisma.lot.update({ where: { id: okLot }, data: { status: 'LIBERADO' } });
      expect((await balance(lotMat, locA))[0].available).toBe('8');
      await move({ type: 'SAIDA_ENTREGA', materialId: lotMat, quantity: 1, fromLocationId: locA, lotId: okLot, reason: 'Entrega liberada' }).expect((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); });
    });

    it('lote vencido em estoque não compõe disponível e não sai', async () => {
      await prisma.lot.update({ where: { id: okLot }, data: { expiresAt: new Date(day(-2)) } });
      expect((await balance(lotMat, locA))[0].available).toBe('0');
      await move({ type: 'SAIDA_ENTREGA', materialId: lotMat, quantity: 1, fromLocationId: locA, lotId: okLot, reason: 'Vencido' }).expect(422);
      // descarte é permitido (com aprovação)
      await move({ type: 'DESCARTE', materialId: lotMat, quantity: 7, fromLocationId: locA, lotId: okLot, reason: 'Descarte por vencimento', axisApprovalRef: 'DSP-1' }).expect(201);
    });
  });

  describe('números de série', () => {
    let s1: string, s2: string;
    it('cadastra série única por material e patrimônio único', async () => {
      const mk = (serial: string, assetTag?: string) => api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: serialMat, serial, assetTag });
      s1 = (await mk(`SN1-${sfx}`, `PAT-${sfx}-1`).expect(201)).body.id;
      s2 = (await mk(`SN2-${sfx}`).expect(201)).body.id;
      await mk(`SN1-${sfx}`).expect(409);
      await mk(`SN3-${sfx}`, `PAT-${sfx}-1`).expect(409);
      await api().post('/api/v1/serial-numbers').set(A(gestor)).send({ materialId: plain, serial: 'Q' }).expect(400);
    });

    it('item seriado: série obrigatória, quantidade 1, nunca em dois locais', async () => {
      await entry(serialMat, 1).expect(400);
      await entry(serialMat, 2, locA, { serialId: s1 }).expect(400);
      await entry(serialMat, 1, locA, { serialId: s1 }).expect(201);
      await entry(serialMat, 1, locB, { serialId: s1 }).expect(422); // já em estoque
      await move({ type: 'SAIDA_ENTREGA', materialId: serialMat, quantity: 1, fromLocationId: locB, serialId: s1, reason: 'Origem errada' }).expect(422);
      await move({ type: 'TRANSFERENCIA', materialId: serialMat, quantity: 1, fromLocationId: locA, toLocationId: locB, serialId: s1, reason: 'Mover' }).expect(201);
      expect((await prisma.serialNumber.findUniqueOrThrow({ where: { id: s1 } })).currentLocationId).toBe(locB);
      await entry(plain, 1, locA, { serialId: s2 }).expect(400); // material sem série
    });

    it('baixa por perda marca a série como BAIXADA e libera o local', async () => {
      await entry(serialMat, 1, locA, { serialId: s2 }).expect(201);
      await move({ type: 'BAIXA_PERDA', materialId: serialMat, quantity: 1, fromLocationId: locA, serialId: s2, reason: 'Extravio', axisApprovalRef: 'BXA-1' }).expect(201);
      const s = await prisma.serialNumber.findUniqueOrThrow({ where: { id: s2 } });
      expect(s.condition).toBe('BAIXADO');
      expect(s.currentLocationId).toBeNull();
    });
  });

  describe('webhook do Axis (HMAC + idempotência)', () => {
    const envelope = (type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ event_id: randomUUID(), event_type: type, occurred_at: new Date().toISOString(), payload, ...extra });
    const post = (body: unknown, sig?: string) => {
      const raw = typeof body === 'string' ? body : JSON.stringify(body);
      return api().post('/api/v1/webhooks/axis').set('Content-Type', 'application/json').set('X-Axis-Signature', sig ?? sign(raw)).send(raw);
    };

    it('rejeita assinatura ausente, errada, de outro segredo e corpo adulterado', async () => {
      const ev = envelope('ping', {});
      await api().post('/api/v1/webhooks/axis').send(ev).expect(401);
      await post(ev, 'sha256=deadbeef').expect(401);
      await post(ev, sign(JSON.stringify(ev), 'outro-segredo')).expect(401);
      await post(JSON.stringify({ ...ev, payload: { x: 1 } }), sign(JSON.stringify(ev))).expect(401);
      await post(ev, 'md5=abc').expect(401);
    });

    it('valida o envelope e a janela de replay', async () => {
      await post('{nao json').expect(400);
      await post({ event_type: 'ping' }).expect(400);
      await post(envelope('ping', {}, { event_id: 'nao-uuid' })).expect(400);
      await post(envelope('ping', {}, { occurred_at: new Date(Date.now() - 100 * 3_600_000).toISOString() })).expect(400);
      await post(envelope('ping', {}, { occurred_at: new Date(Date.now() + 3_600_000).toISOString() })).expect(400);
    });

    it('é idempotente por event_id: segunda entrega não reprocessa', async () => {
      const id = randomUUID();
      const ev = envelope('project.created', { project_id: `p-${id}`, code: 'PRJ-1', status: 'proposta', client_id: 'c1' }, { event_id: id });
      const first = await post(ev).expect(200);
      expect(first.body.status).toBe('processed');
      const second = await post(ev).expect(200);
      expect(second.body.status).toBe('duplicate');
      expect(await prisma.integrationMessage.count({ where: { direction: 'INBOUND', eventId: id } })).toBe(1);
    });

    it('entregas simultâneas do mesmo evento resultam em um único processamento', async () => {
      const id = randomUUID();
      const ev = envelope('client.created', { client_id: `cl-${id}`, code: 77 }, { event_id: id });
      const rs = await Promise.all(Array.from({ length: 5 }, () => post(ev)));
      expect(rs.every((r) => r.status === 200)).toBe(true);
      expect(rs.filter((r) => r.body.status === 'processed').length).toBe(1);
      expect(await prisma.integrationMessage.count({ where: { eventId: id } })).toBe(1);
    });

    it('atualiza cache de mestres, mescla campos e respeita ordem dos eventos', async () => {
      const uid = `usr-${randomUUID()}`;
      const t0 = Date.now() - 60_000;
      const at = (ms: number) => new Date(ms).toISOString();
      await post(envelope('user.created', { user_id: uid, email: 'a@lgc.test', roles: ['gestor'] }, { occurred_at: at(t0) })).expect(200);
      await post(envelope('user.updated', { user_id: uid, changed_fields: ['roles'], roles: ['tecnico'] }, { occurred_at: at(t0 + 20_000) })).expect(200);
      // evento antigo chegando atrasado não sobrescreve
      const late = await post(envelope('user.updated', { user_id: uid, roles: ['colaborador'] }, { occurred_at: at(t0 + 10_000) })).expect(200);
      expect(late.body.status).toBe('processed');
      let row = await prisma.axisMasterCache.findUniqueOrThrow({ where: { kind_axisId: { kind: 'USER', axisId: uid } } });
      expect((row.data as { roles: string[] }).roles).toEqual(['tecnico']);
      expect(row.name).toBe('a@lgc.test');
      expect(row.active).toBe(true);
      await post(envelope('user.disabled', { user_id: uid, disabled_at: at(t0 + 30_000) }, { occurred_at: at(t0 + 30_000) })).expect(200);
      row = await prisma.axisMasterCache.findUniqueOrThrow({ where: { kind_axisId: { kind: 'USER', axisId: uid } } });
      expect(row.active).toBe(false);
    });

    it('desligamento de colaborador inativa o cache; evento desconhecido é ignorado com 200', async () => {
      const cid = `col-${randomUUID()}`;
      await post(envelope('collaborator.created', { collaborator_id: cid, name: 'Fulano', sector_id: 's1' })).expect(200);
      await post(envelope('collaborator.offboarded', { collaborator_id: cid, offboarded_at: new Date().toISOString() })).expect(200);
      expect((await prisma.axisMasterCache.findUniqueOrThrow({ where: { kind_axisId: { kind: 'COLLABORATOR', axisId: cid } } })).active).toBe(false);
      const unknown = await post(envelope('algo.novo', { a: 1 })).expect(200);
      expect(unknown.body.status).toBe('ignored');
    });

    it('payload sem identificador falha (500/4xx), fica FAILED e é reprocessável na reentrega', async () => {
      const id = randomUUID();
      const bad = envelope('project.created', { code: 'SEM-ID' }, { event_id: id });
      const r = await post(bad);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect((await prisma.integrationMessage.findFirstOrThrow({ where: { eventId: id } })).status).toBe('FAILED');
      const r2 = await post(bad); // reentrega: reprocessa (continua inválido), sem criar segunda linha
      expect(r2.status).toBeGreaterThanOrEqual(400);
      const row = await prisma.integrationMessage.findFirstOrThrow({ where: { eventId: id } });
      expect(row.attempts).toBe(2);
      expect(await prisma.integrationMessage.count({ where: { eventId: id } })).toBe(1);
    });
  });
});
