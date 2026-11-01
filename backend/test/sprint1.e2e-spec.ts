import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;
const jwt = new JwtService({ secret: SECRET });
const tokenFor = (roles: string[], extra: Record<string, unknown> = {}, secret = SECRET, expiresIn = '10m') =>
  new JwtService({ secret }).sign({ sub: 'user-' + roles.join('-'), email: 'u@lgc.test', roles, collaboratorId: null, mustChangePassword: false, ...extra }, { expiresIn: expiresIn as never });

describe('Sprint 1 — SSO + RBAC + catálogo', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('health é público', async () => {
    await api().get('/api/v1/health').expect(200);
  });

  describe('JWT compartilhado (SSO)', () => {
    it('rejeita sem token, token assinado com outro segredo, expirado e alg=none', async () => {
      await api().get('/api/v1/me').expect(401);
      await api().get('/api/v1/me').set(auth(tokenFor(['admin'], {}, 'outro-segredo-qualquer-0123456789'))).expect(401);
      await api().get('/api/v1/me').set(auth(tokenFor(['admin'], {}, SECRET, '-10s'))).expect(401);
      const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from('{"sub":"x","roles":["admin"]}').toString('base64url') + '.';
      await api().get('/api/v1/me').set(auth(none)).expect(401);
    });

    it('rejeita HS512 (somente HS256)', async () => {
      const t = jwt.sign({ sub: 'x', email: 'x@x', roles: ['admin'] }, { algorithm: 'HS512' });
      await api().get('/api/v1/me').set(auth(t)).expect(401);
    });

    it('aceita token válido do Axis e resolve perfis locais; ignora permissions do token', async () => {
      const t = tokenFor(['gestor'], { permissions: ['rbac:write', 'material:write'] });
      const res = await api().get('/api/v1/me').set(auth(t)).expect(200);
      expect(res.body.logisticsRoles.map((r: { code: string }) => r.code)).toEqual(['GESTOR_ALMOXARIFADO']);
      expect(res.body.permissions).toContain('warehouse:write');
      expect(res.body.permissions).not.toContain('rbac:write');
      expect(res.body.permissions).not.toContain('material:write');
    });

    it('bloqueia mustChangePassword no servidor', async () => {
      await api().get('/api/v1/me').set(auth(tokenFor(['admin'], { mustChangePassword: true }))).expect(403);
    });

    it('role sem mapeamento não recebe permissão alguma', async () => {
      const res = await api().get('/api/v1/me').set(auth(tokenFor(['rh']))).expect(200);
      expect(res.body.permissions).toEqual([]);
      await api().get('/api/v1/materials').set(auth(tokenFor(['rh']))).expect(403);
    });
  });

  describe('RBAC', () => {
    it('solicitante lê catálogo mas não cria material', async () => {
      const t = tokenFor(['colaborador']);
      await api().get('/api/v1/materials').set(auth(t)).expect(200);
      await api().post('/api/v1/materials').set(auth(t)).send({}).expect(403);
    });

    it('almoxarife (tecnico) não administra RBAC nem almoxarifados', async () => {
      const t = tokenFor(['tecnico']);
      await api().get('/api/v1/rbac/roles').set(auth(t)).expect(403);
      await api().post('/api/v1/warehouses').set(auth(t)).send({ code: 'X', name: 'Xxx', type: 'CENTRAL' }).expect(403);
    });

    it('admin técnico altera mapeamento e o efeito é imediato; auditado', async () => {
      const admin = tokenFor(['admin']);
      const probe = tokenFor(['rh']);
      await api().put('/api/v1/rbac/axis-role-mapping/rh').set(auth(admin)).send({ logisticsRoles: ['AUDITOR'] }).expect(200);
      const me = await api().get('/api/v1/me').set(auth(probe)).expect(200);
      expect(me.body.permissions).toContain('audit:read');
      await api().put('/api/v1/rbac/axis-role-mapping/rh').set(auth(admin)).send({ logisticsRoles: [] }).expect(200);
      const after = await api().get('/api/v1/me').set(auth(probe)).expect(200);
      expect(after.body.permissions).toEqual([]);
      expect(await prisma.auditEvent.count({ where: { action: 'rbac.axis_role_mapping_changed', aggregateId: 'rh' } })).toBeGreaterThanOrEqual(2);
    });

    it('rejeita perfil inexistente no mapeamento', async () => {
      await api().put('/api/v1/rbac/axis-role-mapping/rh').set(auth(tokenFor(['admin']))).send({ logisticsRoles: ['NAO_EXISTE'] }).expect(400);
    });
  });

  describe('Catálogo, versões e custo', () => {
    let materialId: string;
    const code = `TST-MAT-${suffix}`;

    it('valida em pt-BR e cria material com versão 1', async () => {
      const admin = tokenFor(['admin']);
      const bad = await api().post('/api/v1/materials').set(auth(admin)).send({ code: 'minusculo', shortDescription: 'x' }).expect(400);
      expect(JSON.stringify(bad.body.message)).toMatch(/Código inválido/);

      const uoms = await api().get('/api/v1/units-of-measure').set(auth(admin)).expect(200);
      const un = uoms.body.find((u: { code: string }) => u.code === 'UN');
      const res = await api().post('/api/v1/materials').set(auth(admin)).send({
        code, shortDescription: 'Material de teste', category: 'Teste', type: 'CONSUMO', stockUomId: un.id, lastCost: 10,
      }).expect(400); // lastCost não é editável (vem do Axis)
      expect(res.body.message).toBeDefined();

      const ok = await api().post('/api/v1/materials').set(auth(admin)).send({
        code, shortDescription: 'Material de teste', category: 'Teste', type: 'CONSUMO', stockUomId: un.id,
      }).expect(201);
      materialId = ok.body.id;
      expect(ok.body.currentVersion).toBe(1);
      await api().post('/api/v1/materials').set(auth(admin)).send({ code, shortDescription: 'Duplicado', category: 'Teste', type: 'CONSUMO', stockUomId: un.id }).expect(409);
    });

    it('regras de negócio: validade exige lote; FEFO exige validade', async () => {
      const admin = tokenFor(['admin']);
      await api().patch(`/api/v1/materials/${materialId}`).set(auth(admin)).send({ expiryControlled: true }).expect(400);
      await api().patch(`/api/v1/materials/${materialId}`).set(auth(admin)).send({ exitMethod: 'FEFO' }).expect(400);
    });

    it('alteração gera versão 2; inativar preserva histórico', async () => {
      const admin = tokenFor(['admin']);
      const up = await api().patch(`/api/v1/materials/${materialId}`).set(auth(admin)).send({ lotControlled: true, expiryControlled: true, exitMethod: 'FEFO', changeReason: 'Passa a controlar validade' }).expect(200);
      expect(up.body.currentVersion).toBe(2);
      const versions = await api().get(`/api/v1/materials/${materialId}/versions`).set(auth(admin)).expect(200);
      expect(versions.body.map((v: { version: number }) => v.version)).toEqual([2, 1]);
      await api().delete(`/api/v1/materials/${materialId}`).set(auth(admin)).expect(200);
      const got = await api().get(`/api/v1/materials/${materialId}`).set(auth(admin)).expect(200);
      expect(got.body.status).toBe('INATIVO');
      expect(await prisma.material.count({ where: { id: materialId } })).toBe(1);
    });

    it('custo só aparece com material:read_cost', async () => {
      await prisma.material.update({ where: { id: materialId }, data: { lastCost: 12.5 } });
      const withCost = await api().get(`/api/v1/materials/${materialId}`).set(auth(tokenFor(['admin']))).expect(200);
      expect(withCost.body.lastCost).toBeDefined();
      const without = await api().get(`/api/v1/materials/${materialId}`).set(auth(tokenFor(['colaborador']))).expect(200);
      expect(without.body.lastCost).toBeUndefined();
      expect(without.body.averageCost).toBeUndefined();
    });
  });

  describe('Almoxarifados e endereços', () => {
    let wh: string;
    const gestor = () => tokenFor(['gestor']);

    it('cria almoxarifado, hierarquia válida e rejeita nível fora de ordem', async () => {
      const w = await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `ALM-${suffix}`, name: 'Almoxarifado de teste', type: 'CENTRAL' }).expect(201);
      wh = w.body.id;
      await api().post(`/api/v1/warehouses/${wh}/locations`).set(auth(gestor())).send({ code: 'A01-C01', level: 'CORREDOR' }).expect(400);
      const area = await api().post(`/api/v1/warehouses/${wh}/locations`).set(auth(gestor())).send({ code: 'A01', level: 'AREA' }).expect(201);
      await api().post(`/api/v1/warehouses/${wh}/locations`).set(auth(gestor())).send({ code: 'A01', level: 'AREA' }).expect(409);
      await api().post(`/api/v1/warehouses/${wh}/locations`).set(auth(gestor())).send({ code: 'A01-C01', level: 'CORREDOR', parentId: area.body.id }).expect(201);
      await api().post(`/api/v1/warehouses/${wh}/locations`).set(auth(gestor())).send({ code: 'A01-E01', level: 'ESTANTE', parentId: area.body.id }).expect(400);
    });

    it('escopo por almoxarifado: quem não tem access_all e não foi liberado recebe 403', async () => {
      // 'tecnico' (Almoxarife) tem warehouse:read mas não warehouse:access_all
      const t = tokenFor(['tecnico'], {}, SECRET);
      await api().get(`/api/v1/warehouses/${wh}/locations`).set(auth(t)).expect(403);
      const list = await api().get('/api/v1/warehouses').set(auth(t)).expect(200);
      expect(list.body.find((w: { id: string }) => w.id === wh)).toBeUndefined();

      await api().put('/api/v1/rbac/users/user-tecnico/warehouses').set(auth(tokenFor(['admin']))).send({ warehouseIds: [wh] }).expect(200);
      await api().get(`/api/v1/warehouses/${wh}/locations`).set(auth(t)).expect(200);
    });
  });
});
