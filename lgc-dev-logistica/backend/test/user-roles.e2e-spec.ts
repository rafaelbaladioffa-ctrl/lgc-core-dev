import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: string[], sub: string) => new JwtService({ secret: SECRET }).sign({ sub, email: `${sub}@lgc.test`, roles, mustChangePassword: false }, { expiresIn: '10m' });

/** Perfil de Logística concedido a um usuário específico do Axis, somado ao mapeamento por role. */
describe('Perfis por usuário (user_logistics_roles)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const admin = tokenFor(['admin'], 'admin-ur');
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  it('concede um perfil a UM usuário sem mudar o mapeamento da role; o outro usuário da mesma role não ganha nada', async () => {
    const eu = `ur-eu-${sfx}`, outro = `ur-outro-${sfx}`;
    const meu = tokenFor(['colaborador'], eu), dele = tokenFor(['colaborador'], outro);
    await api().get('/api/v1/warehouses').set(A(meu)).expect(403); // solicitante não lê almoxarifados
    await api().put(`/api/v1/rbac/users/${eu}/roles`).set(A(admin)).send({ logisticsRoles: ['ALMOXARIFE'] }).expect(200);
    const me = (await api().get('/api/v1/me').set(A(meu)).expect(200)).body;
    expect(me.logisticsRoles.map((r: { code: string }) => r.code)).toEqual(['ALMOXARIFE', 'SOLICITANTE']); // soma com o que a role já dava
    expect(me.permissions).toEqual(expect.arrayContaining(['picking:execute', 'receipt:execute', 'material:read']));
    await api().get('/api/v1/warehouses').set(A(meu)).expect(200);
    await api().get('/api/v1/warehouses').set(A(dele)).expect(403);
    expect((await api().get(`/api/v1/rbac/users/${eu}/roles`).set(A(admin)).expect(200)).body).toEqual({ axisUserId: eu, logisticsRoles: ['ALMOXARIFE'] });
  });

  it('troca e remoção valem na hora (cache invalidado) e ficam auditadas', async () => {
    const eu = `ur-troca-${sfx}`;
    const meu = tokenFor(['rh'], eu); // rh não tem perfil por role
    expect((await api().get('/api/v1/me').set(A(meu)).expect(200)).body.permissions).toEqual([]);
    await api().put(`/api/v1/rbac/users/${eu}/roles`).set(A(admin)).send({ logisticsRoles: ['AUDITOR'] }).expect(200);
    expect((await api().get('/api/v1/me').set(A(meu)).expect(200)).body.permissions).toContain('audit:read');
    await api().put(`/api/v1/rbac/users/${eu}/roles`).set(A(admin)).send({ logisticsRoles: [] }).expect(200);
    expect((await api().get('/api/v1/me').set(A(meu)).expect(200)).body.permissions).toEqual([]);
    await new Promise((r) => setTimeout(r, 200));
    expect(await prisma.auditEvent.count({ where: { action: 'rbac.user_roles_changed', aggregateId: eu } })).toBe(2);
  });

  it('valida a entrada e exige permissão', async () => {
    const u = `ur-val-${sfx}`;
    await api().put(`/api/v1/rbac/users/${u}/roles`).set(A(admin)).send({ logisticsRoles: ['NAO_EXISTE'] }).expect(400);
    await api().put(`/api/v1/rbac/users/${u}/roles`).set(A(admin)).send({ logisticsRoles: ['AUDITOR', 'AUDITOR'] }).expect(400);
    await api().put(`/api/v1/rbac/users/${u}/roles`).set(A(admin)).send({}).expect(400);
    await api().put(`/api/v1/rbac/users/${u}/roles`).set(A(tokenFor(['tecnico'], 'x'))).send({ logisticsRoles: ['AUDITOR'] }).expect(403);
    await api().get(`/api/v1/rbac/users/${u}/roles`).set(A(tokenFor(['colaborador'], 'y'))).expect(403);
  });
});
