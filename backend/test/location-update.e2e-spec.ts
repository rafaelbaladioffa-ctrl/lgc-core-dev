import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: process.env.JWT_SECRET! }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

describe('PATCH /warehouses/:id/locations/:locationId', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const gestor = tokenFor(['gestor']);
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  let whId: string, areaId: string, corrId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    whId = (await api().post('/api/v1/warehouses').set(A(gestor)).send({ code: `LU-${sfx}`, name: 'Almox edição', type: 'CENTRAL' }).expect(201)).body.id;
    areaId = (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code: 'ZA', level: 'AREA' }).expect(201)).body.id;
    corrId = (await api().post(`/api/v1/warehouses/${whId}/locations`).set(A(gestor)).send({ code: 'ZA-C1', level: 'CORREDOR', parentId: areaId }).expect(201)).body.id;
  });
  afterAll(async () => app.close());
  const patch = (id: string, body: object, t = gestor) => api().patch(`/api/v1/warehouses/${whId}/locations/${id}`).set(A(t)).send(body);

  it('edita nome e capacidade; código e nível não mudam', async () => {
    const r = await patch(areaId, { name: 'Zona A', capacityKind: 'QUANTIDADE', capacityValue: 500 }).expect(200);
    expect(r.body).toMatchObject({ name: 'Zona A', capacityKind: 'QUANTIDADE', code: 'ZA', level: 'AREA' });
    await patch(areaId, { code: 'OUTRO' }).expect(400);
  });

  it('bloqueio exige motivo e o desbloqueio limpa o motivo', async () => {
    await patch(corrId, { status: 'BLOQUEADO' }).expect(400);
    const b = await patch(corrId, { status: 'BLOQUEADO', blockedReason: 'Obra no corredor' }).expect(200);
    expect(b.body.blockedReason).toBe('Obra no corredor');
    const u = await patch(corrId, { status: 'ATIVO' }).expect(200);
    expect(u.body.blockedReason).toBeNull();
  });

  it('capacidade exige tipo e valor juntos', async () => {
    await patch(corrId, { capacityValue: 10 }).expect(400);
  });

  it('não inativa endereço com endereços inferiores ativos nem com saldo', async () => {
    await patch(areaId, { status: 'INATIVO' }).expect(409);
    const mat = await prisma.material.findFirstOrThrow({ where: { status: 'ATIVO' } });
    await prisma.stockBalance.create({ data: { materialId: mat.id, locationId: corrId, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: 3 } });
    await patch(corrId, { status: 'INATIVO' }).expect(409);
  });

  it('exige permissão, endereço do próprio almoxarifado e audita', async () => {
    await patch(areaId, { name: 'x' }, tokenFor(['colaborador'])).expect(403);
    await api().patch(`/api/v1/warehouses/${whId}/locations/00000000-0000-4000-8000-000000000000`).set(A(gestor)).send({ name: 'x' }).expect(404);
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.auditEvent.count({ where: { action: 'location.updated', aggregateId: areaId } })).toBeGreaterThan(0);
  });
});
