import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: process.env.JWT_SECRET! }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

/** Exclusão: física só sem histórico; com histórico, inativar; "excluir do estoque" é um ajuste (o ledger é imutável). */
describe('Excluir / inativar material e zerar saldo por ajuste', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let uom: string, whId: string, loc: string;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase();
  const admin = tokenFor(['admin']);
  const gestor = tokenFor(['gestor']);
  const colab = tokenFor(['colaborador']);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const newMat = async (tag: string) => (await api().post('/api/v1/materials').set(A(admin)).send({ code: `DEL-${sfx}-${tag}`, shortDescription: `Material ${tag}`, category: 'Teste', type: 'CONSUMO', stockUomId: uom }).expect(201)).body.id as string;
  const post = (body: object) => api().post('/api/v1/stock/movements').set(A(gestor)).set('Idempotency-Key', randomUUID()).send(body);

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    uom = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    whId = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `DL-${sfx}`, name: 'Almox exclusão', type: 'CENTRAL' }).expect(201)).body.id;
    loc = (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code: 'ZA', level: 'AREA' }).expect(201)).body.id;
  });
  afterAll(async () => app.close());

  it('sem histórico: exclui de verdade (material, versões e código somem) e audita', async () => {
    const id = await newMat('LIVRE');
    await api().patch(`/api/v1/materials/${id}`).set(A(admin)).send({ category: 'Outra', changeReason: 'teste' }).expect(200);
    expect((await api().get(`/api/v1/materials/${id}/deletable`).set(A(admin)).expect(200)).body).toEqual({ deletable: true });
    const r = await api().delete(`/api/v1/materials/${id}`).set(A(admin)).expect(200);
    expect(r.body).toMatchObject({ id, deleted: true });
    expect(await prisma.material.count({ where: { id } })).toBe(0);
    expect(await prisma.materialVersion.count({ where: { materialId: id } })).toBe(0);
    await api().get(`/api/v1/materials/${id}`).set(A(admin)).expect(404);
    await new Promise((r2) => setTimeout(r2, 200));
    expect(await prisma.auditEvent.count({ where: { action: 'material.deleted', aggregateId: id } })).toBe(1);
  });

  it('com movimentação: DELETE responde 409; inativar funciona e preserva o cadastro', async () => {
    const id = await newMat('HIST');
    await post({ type: 'ENTRADA_RECEBIMENTO', materialId: id, quantity: 5, toLocationId: loc, reason: 'Saldo inicial de teste' }).expect(201);
    const d = await api().get(`/api/v1/materials/${id}/deletable`).set(A(admin)).expect(200);
    expect(d.body.deletable).toBe(false);
    const del = await api().delete(`/api/v1/materials/${id}`).set(A(admin)).expect(409);
    expect(JSON.stringify(del.body)).toMatch(/Inativar/);
    expect(await prisma.material.count({ where: { id } })).toBe(1);
    const off = await api().post(`/api/v1/materials/${id}/deactivate`).set(A(admin)).expect(200);
    expect(off.body.status).toBe('INATIVO');
  });

  it('"excluir do estoque" é um ajuste negativo com motivo; o histórico fica e o material continua não excluível', async () => {
    const id = await newMat('ZERA');
    await post({ type: 'ENTRADA_RECEBIMENTO', materialId: id, quantity: 7, toLocationId: loc, reason: 'Saldo inicial de teste' }).expect(201);
    await post({ type: 'AJUSTE_NEGATIVO', materialId: id, quantity: 7, fromLocationId: loc, reason: 'x', axisApprovalRef: 'APR-1' }).expect(400); // motivo curto
    await post({ type: 'AJUSTE_NEGATIVO', materialId: id, quantity: 7, fromLocationId: loc, reason: 'Contagem: item inexistente', axisApprovalRef: 'APR-1' }).expect(201);
    const bal = await prisma.stockBalance.findFirstOrThrow({ where: { materialId: id } });
    expect(Number(bal.quantity)).toBe(0);
    expect(await prisma.stockMovement.count({ where: { materialId: id } })).toBe(2);
    await api().delete(`/api/v1/materials/${id}`).set(A(admin)).expect(409);
    // zerar acima do saldo é recusado, não vira saldo negativo
    await post({ type: 'AJUSTE_NEGATIVO', materialId: id, quantity: 1, fromLocationId: loc, reason: 'Tentativa além do saldo', axisApprovalRef: 'APR-1' }).expect(422);
  });

  it('exige material:write; id inexistente → 404', async () => {
    const id = await newMat('PERM');
    await api().delete(`/api/v1/materials/${id}`).set(A(colab)).expect(403);
    await api().post(`/api/v1/materials/${id}/deactivate`).set(A(colab)).expect(403);
    await api().delete('/api/v1/materials/00000000-0000-4000-8000-000000000000').set(A(admin)).expect(404);
  });
});
