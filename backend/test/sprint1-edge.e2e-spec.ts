import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

// Casos de borda do Sprint 1. Não altera mapeamentos de perfis globais (outros arquivos rodam em paralelo):
// usa perfis e usuários com sufixo único.

const SECRET = process.env.JWT_SECRET!;
const tokenFor = (roles: unknown, extra: Record<string, unknown> = {}, secret = SECRET, expiresIn = '10m') =>
  new JwtService({ secret }).sign(
    { sub: 'edge-' + (Array.isArray(roles) ? roles.join('-') : 'x'), email: 'edge@lgc.test', roles, collaboratorId: null, mustChangePassword: false, ...extra },
    { expiresIn: expiresIn as never },
  );

describe('Sprint 1 — casos de borda', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Date.now().toString(36).toUpperCase();
  const admin = () => tokenFor(['admin']);
  const gestor = () => tokenFor(['gestor']);
  const colaborador = () => tokenFor(['colaborador']);
  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  let unId: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    unId = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
  });
  afterAll(async () => app.close());

  /** Cria material válido; `over` sobrescreve campos. */
  const createMaterial = (code: string, over: Record<string, unknown> = {}) =>
    api()
      .post('/api/v1/materials')
      .set(auth(admin()))
      .send({ code, shortDescription: 'Material de borda', category: `EDGE-${suffix}`, type: 'CONSUMO', stockUomId: unId, ...over });

  describe('GET /materials — paginação, filtros e busca', () => {
    const cat = `EDGE-${suffix}`;
    let parafusoId: string;
    const codeA = `EDGE-${suffix}-A`;
    const codeB = `EDGE-${suffix}-B`;
    const codeC = `EDGE-${suffix}-C`;
    const barcode = `7891${Date.now()}`;

    beforeAll(async () => {
      await createMaterial(codeA, { shortDescription: 'Parafuso sextavado' }).expect(201);
      const b = await createMaterial(codeB, { shortDescription: 'Porca travante' }).expect(201);
      parafusoId = b.body.id;
      await createMaterial(codeC, { shortDescription: 'Luva nitrílica', type: 'FERRAMENTA' }).expect(201);
      await prisma.materialBarcode.create({ data: { materialId: parafusoId, code: barcode } });
    });

    it('ordena por código e pagina com total correto', async () => {
      const p1 = await api().get(`/api/v1/materials?category=${cat}&pageSize=2&page=1`).set(auth(admin())).expect(200);
      expect(p1.body.total).toBe(3);
      expect(p1.body.items.map((m: { code: string }) => m.code)).toEqual([codeA, codeB]);
      const p2 = await api().get(`/api/v1/materials?category=${cat}&pageSize=2&page=2`).set(auth(admin())).expect(200);
      expect(p2.body.items.map((m: { code: string }) => m.code)).toEqual([codeC]);
      const p3 = await api().get(`/api/v1/materials?category=${cat}&pageSize=2&page=3`).set(auth(admin())).expect(200);
      expect(p3.body.total).toBe(3);
      expect(p3.body.items).toEqual([]);
    });

    it('pageSize padrão é 20 e page padrão é 1', async () => {
      const res = await api().get(`/api/v1/materials?category=${cat}`).set(auth(admin())).expect(200);
      expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    });

    it('rejeita paginação inválida (0, acima de 100, não numérica)', async () => {
      await api().get('/api/v1/materials?pageSize=101').set(auth(admin())).expect(400);
      await api().get('/api/v1/materials?pageSize=0').set(auth(admin())).expect(400);
      await api().get('/api/v1/materials?page=0').set(auth(admin())).expect(400);
      await api().get('/api/v1/materials?page=abc').set(auth(admin())).expect(400);
    });

    it('filtra por tipo e categoria', async () => {
      const res = await api().get(`/api/v1/materials?category=${cat}&type=FERRAMENTA`).set(auth(admin())).expect(200);
      expect(res.body.items.map((m: { code: string }) => m.code)).toEqual([codeC]);
      await api().get('/api/v1/materials?type=NAO_EXISTE').set(auth(admin())).expect(400);
    });

    it('busca por descrição sem diferenciar maiúsculas e por código parcial', async () => {
      const byDesc = await api().get(`/api/v1/materials?category=${cat}&q=PARAFUSO`).set(auth(admin())).expect(200);
      expect(byDesc.body.items.map((m: { code: string }) => m.code)).toEqual([codeA]);
      const byCode = await api().get(`/api/v1/materials?category=${cat}&q=${codeB}`).set(auth(admin())).expect(200);
      expect(byCode.body.items.map((m: { code: string }) => m.code)).toEqual([codeB]);
    });

    it('busca por código de barras é exata', async () => {
      const exact = await api().get(`/api/v1/materials?q=${barcode}`).set(auth(admin())).expect(200);
      expect(exact.body.items.map((m: { id: string }) => m.id)).toEqual([parafusoId]);
      const partial = await api().get(`/api/v1/materials?q=${barcode.slice(0, 8)}`).set(auth(admin())).expect(200);
      expect(partial.body.items.find((m: { id: string }) => m.id === parafusoId)).toBeUndefined();
    });

    it('por padrão lista só ATIVO; status=INATIVO e status inválido', async () => {
      const del = await api().delete(`/api/v1/materials/${parafusoId}`).set(auth(admin())).expect(200);
      expect(del.body.status).toBe('INATIVO');
      const ativos = await api().get(`/api/v1/materials?category=${cat}`).set(auth(admin())).expect(200);
      expect(ativos.body.total).toBe(2);
      const inativos = await api().get(`/api/v1/materials?category=${cat}&status=INATIVO`).set(auth(admin())).expect(200);
      expect(inativos.body.items.map((m: { id: string }) => m.id)).toEqual([parafusoId]);
      await api().get('/api/v1/materials?status=APAGADO').set(auth(admin())).expect(400);
    });

    it('lista omite custo para quem não tem material:read_cost', async () => {
      await prisma.material.update({ where: { code: codeA }, data: { lastCost: 9.99, averageCost: 8.5 } });
      const res = await api().get(`/api/v1/materials?category=${cat}`).set(auth(colaborador())).expect(200);
      for (const m of res.body.items) {
        expect(m).not.toHaveProperty('lastCost');
        expect(m).not.toHaveProperty('averageCost');
      }
      const withCost = await api().get(`/api/v1/materials?category=${cat}`).set(auth(admin())).expect(200);
      expect(withCost.body.items.find((m: { code: string }) => m.code === codeA).lastCost).toBeDefined();
    });

    it('rejeita parâmetro de query não previsto (forbidNonWhitelisted)', async () => {
      await api().get('/api/v1/materials?foo=1').set(auth(admin())).expect(400);
    });

    it('GET por id inválido e inexistente', async () => {
      await api().get('/api/v1/materials/nao-e-uuid').set(auth(admin())).expect(400);
      await api().get('/api/v1/materials/00000000-0000-4000-8000-000000000000').set(auth(admin())).expect(404);
    });
  });

  describe('Validação de campos (DTO)', () => {
    it('NCM deve ter 8 dígitos; aceita 8 dígitos', async () => {
      await createMaterial(`EDGE-${suffix}-NCM1`, { ncm: '1234567' }).expect(400);
      await createMaterial(`EDGE-${suffix}-NCM2`, { ncm: '12345abc' }).expect(400);
      const ok = await createMaterial(`EDGE-${suffix}-NCM3`, { ncm: '84713012' }).expect(201);
      expect(ok.body.ncm).toBe('84713012');
    });

    it('CEST deve ter 7 dígitos (criação e alteração)', async () => {
      await createMaterial(`EDGE-${suffix}-CEST1`, { cest: '12345678' }).expect(400);
      const m = await createMaterial(`EDGE-${suffix}-CEST2`).expect(201);
      await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ cest: '123' }).expect(400);
    });

    it('valores negativos são recusados em peso, dimensões, múltiplo, lead time e vida útil', async () => {
      await createMaterial(`EDGE-${suffix}-NEG1`, { weightKg: -1 }).expect(400);
      await createMaterial(`EDGE-${suffix}-NEG2`, { lengthCm: -0.5 }).expect(400);
      await createMaterial(`EDGE-${suffix}-NEG3`, { purchaseMultiple: -2 }).expect(400);
      await createMaterial(`EDGE-${suffix}-NEG4`, { leadTimeDays: -1 }).expect(400);
      await createMaterial(`EDGE-${suffix}-NEG5`, { minShelfLifeDays: -10, expiryControlled: true, lotControlled: true }).expect(400);
      const m = await createMaterial(`EDGE-${suffix}-NEG6`).expect(201);
      await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ widthCm: -3 }).expect(400);
    });

    it('limites de tamanho e de casas decimais', async () => {
      await createMaterial(`EDGE-${suffix}-LEN1`, { shortDescription: 'ab' }).expect(400);
      await createMaterial(`EDGE-${suffix}-LEN2`, { shortDescription: 'x'.repeat(161) }).expect(400);
      await createMaterial(`EDGE-${suffix}-LEN3`, { weightKg: 1.23456 }).expect(400); // máx. 4 casas
      await createMaterial(`EDGE-${suffix}-LEN4`, { leadTimeDays: 3651 }).expect(400);
    });

    it('enums inválidos: criticidade, classe de demanda, método de saída, tipo', async () => {
      await createMaterial(`EDGE-${suffix}-ENUM1`, { criticality: 'D' }).expect(400);
      await createMaterial(`EDGE-${suffix}-ENUM2`, { demandClass: 'W' }).expect(400);
      await createMaterial(`EDGE-${suffix}-ENUM3`, { exitMethod: 'LIFO' }).expect(400);
      await createMaterial(`EDGE-${suffix}-ENUM4`, { type: 'INEXISTENTE' }).expect(400);
    });

    it('UUID inválido na unidade de estoque e corpo vazio na criação', async () => {
      await createMaterial(`EDGE-${suffix}-UUID1`, { stockUomId: 'abc' }).expect(400);
      await api().post('/api/v1/materials').set(auth(admin())).send({}).expect(400);
    });

    it('forbidNonWhitelisted: campos fora do DTO são recusados na criação e na alteração', async () => {
      await createMaterial(`EDGE-${suffix}-WL1`, { foo: 'bar' }).expect(400);
      await createMaterial(`EDGE-${suffix}-WL2`, { status: 'INATIVO' }).expect(400);
      await createMaterial(`EDGE-${suffix}-WL3`, { createdBy: 'outro' }).expect(400);
      const m = await createMaterial(`EDGE-${suffix}-WL4`).expect(201);
      await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ currentVersion: 99 }).expect(400);
      await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ lastCost: 1 }).expect(400);
    });

    it('defaults de flags booleanas e criticidade C quando não informados', async () => {
      const m = await createMaterial(`EDGE-${suffix}-DEF1`).expect(201);
      expect(m.body).toMatchObject({ lotControlled: false, expiryControlled: false, serialControlled: false, exitMethod: 'FIFO', criticality: 'C', status: 'ATIVO' });
    });

    it('material serial criado sem exitMethod assume SERIE_ESPECIFICA e aceita PATCH depois', async () => {
      const serial = await createMaterial(`EDGE-${suffix}-SER1`, { serialControlled: true }).expect(201);
      expect(serial.body.exitMethod).toBe('SERIE_ESPECIFICA');
      await request(app.getHttpServer()).patch(`/api/v1/materials/${serial.body.id}`).set('Authorization', `Bearer ${tokenFor(['admin'])}`).send({ technicalDescription: 'ok' }).expect(200);
      await createMaterial(`EDGE-${suffix}-SER2`, { serialControlled: true, exitMethod: 'FIFO' }).expect(400);
    });
  });

  describe('Unidade de medida', () => {
    let inactiveUomId: string;
    const uomCode = `EDGE${suffix}`;

    beforeAll(async () => {
      const uom = await prisma.unitOfMeasure.create({ data: { code: uomCode, name: 'Inativa de teste', dimension: 'UNIDADE', active: false } });
      inactiveUomId = uom.id;
    });

    it('GET /units-of-measure não lista unidades inativas', async () => {
      const res = await api().get('/api/v1/units-of-measure').set(auth(admin())).expect(200);
      expect(res.body.find((u: { code: string }) => u.code === uomCode)).toBeUndefined();
    });

    it('criar material com UOM inativa ou inexistente é recusado', async () => {
      await createMaterial(`EDGE-${suffix}-UOM1`, { stockUomId: inactiveUomId }).expect(400);
      await createMaterial(`EDGE-${suffix}-UOM2`, { stockUomId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    });

    it('trocar a UOM de um material para inativa é recusado na alteração', async () => {
      const m = await createMaterial(`EDGE-${suffix}-UOM3`).expect(201);
      const res = await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ stockUomId: inactiveUomId }).expect(400);
      expect(res.body.message).toMatch(/inexistente ou inativa/);
      expect(await prisma.material.findUniqueOrThrow({ where: { id: m.body.id } })).toMatchObject({ stockUomId: unId, currentVersion: 1 });
    });
  });

  describe('Ciclo de vida: inativação e alterações', () => {
    let id: string;

    beforeAll(async () => {
      const m = await createMaterial(`EDGE-${suffix}-LIFE`).expect(201);
      id = m.body.id;
    });

    it('inativar gera versão 2 com motivo "Inativação"', async () => {
      await api().delete(`/api/v1/materials/${id}`).set(auth(admin())).expect(200);
      const versions = await api().get(`/api/v1/materials/${id}/versions`).set(auth(admin())).expect(200);
      expect(versions.body).toHaveLength(2);
      expect(versions.body[0]).toMatchObject({ version: 2, changeReason: 'Inativação' });
      expect(versions.body[0].snapshot.status).toBe('INATIVO');
      expect(versions.body[1].snapshot.status).toBe('ATIVO');
    });

    it('inativar material já inativo é idempotente (sem nova versão)', async () => {
      const res = await api().delete(`/api/v1/materials/${id}`).set(auth(admin())).expect(200);
      expect(res.body.currentVersion).toBe(2);
      const versions = await api().get(`/api/v1/materials/${id}/versions`).set(auth(admin())).expect(200);
      expect(versions.body).toHaveLength(2);
    });

    it('PATCH em material inativo é recusado e não gera versão', async () => {
      const res = await api().patch(`/api/v1/materials/${id}`).set(auth(admin())).send({ category: 'Outra' }).expect(400);
      expect(res.body.message).toMatch(/Material inativo ou substituído/);
      const versions = await api().get(`/api/v1/materials/${id}/versions`).set(auth(admin())).expect(200);
      expect(versions.body).toHaveLength(2);
    });

    it('motivo de alteração limitado a 300 caracteres', async () => {
      const m = await createMaterial(`EDGE-${suffix}-REASON`).expect(201);
      await api().patch(`/api/v1/materials/${m.body.id}`).set(auth(admin())).send({ changeReason: 'x'.repeat(301) }).expect(400);
    });

    it('colaborador (sem material:write) não altera nem inativa', async () => {
      await api().patch(`/api/v1/materials/${id}`).set(auth(colaborador())).send({}).expect(403);
      await api().delete(`/api/v1/materials/${id}`).set(auth(colaborador())).expect(403);
    });

    it('ids inexistentes em PATCH, DELETE e versions retornam 404', async () => {
      const ghost = '00000000-0000-4000-8000-000000000000';
      await api().patch(`/api/v1/materials/${ghost}`).set(auth(admin())).send({ category: 'Outra' }).expect(404);
      await api().delete(`/api/v1/materials/${ghost}`).set(auth(admin())).expect(404);
      await api().get(`/api/v1/materials/${ghost}/versions`).set(auth(admin())).expect(404);
    });
  });

  describe('Almoxarifados e hierarquia de endereços', () => {
    let wh: string;
    let otherWh: string;
    const ghost = '00000000-0000-4000-8000-000000000000';

    const loc = (warehouseId: string, body: Record<string, unknown>) =>
      api().post(`/api/v1/warehouses/${warehouseId}/locations`).set(auth(gestor())).send(body);

    beforeAll(async () => {
      wh = (await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}`, name: 'Almox borda', type: 'CENTRAL' }).expect(201)).body.id;
      otherWh = (await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}-2`, name: 'Almox borda 2', type: 'UNIDADE' }).expect(201)).body.id;
    });

    it('validação de almoxarifado: código duplicado, código inválido, nome curto e tipo inválido', async () => {
      await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}`, name: 'Duplicado', type: 'CENTRAL' }).expect(409);
      await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: 'minusculo', name: 'Almox', type: 'CENTRAL' }).expect(400);
      await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}-3`, name: 'ab', type: 'CENTRAL' }).expect(400);
      await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}-4`, name: 'Almox', type: 'MARTE' }).expect(400);
    });

    it('AREA é raiz: não aceita pai', async () => {
      const area = await loc(wh, { code: 'R-AREA', level: 'AREA' }).expect(201);
      const res = await loc(wh, { code: 'R-AREA-2', level: 'AREA', parentId: area.body.id }).expect(400);
      expect(res.body.message).toMatch(/raiz/);
    });

    it('níveis abaixo de AREA exigem pai', async () => {
      const res = await loc(wh, { code: 'SEM-PAI', level: 'CORREDOR' }).expect(400);
      expect(res.body.message).toMatch(/exige um endereço pai/);
    });

    it('cadeia completa AREA → CORREDOR → ESTANTE → NIVEL → POSICAO é aceita', async () => {
      const a = await loc(wh, { code: 'CHAIN-A', level: 'AREA' }).expect(201);
      const c = await loc(wh, { code: 'CHAIN-C', level: 'CORREDOR', parentId: a.body.id }).expect(201);
      const e = await loc(wh, { code: 'CHAIN-E', level: 'ESTANTE', parentId: c.body.id }).expect(201);
      const n = await loc(wh, { code: 'CHAIN-N', level: 'NIVEL', parentId: e.body.id }).expect(201);
      await loc(wh, { code: 'CHAIN-P', level: 'POSICAO', parentId: n.body.id }).expect(201);
    });

    it('pulo de nível é recusado (NIVEL sob CORREDOR)', async () => {
      const a = await loc(wh, { code: 'SKIP-A', level: 'AREA' }).expect(201);
      const c = await loc(wh, { code: 'SKIP-C', level: 'CORREDOR', parentId: a.body.id }).expect(201);
      const res = await loc(wh, { code: 'SKIP-N', level: 'NIVEL', parentId: c.body.id }).expect(400);
      expect(res.body.message).toMatch(/deve ser do nível ESTANTE/);
    });

    it('pai de outro almoxarifado e pai inexistente são recusados', async () => {
      const foreign = await loc(otherWh, { code: 'FOREIGN-A', level: 'AREA' }).expect(201);
      const res = await loc(wh, { code: 'FOREIGN-C', level: 'CORREDOR', parentId: foreign.body.id }).expect(400);
      expect(res.body.message).toMatch(/neste almoxarifado/);
      await loc(wh, { code: 'GHOST-C', level: 'CORREDOR', parentId: ghost }).expect(400);
      await loc(wh, { code: 'BAD-C', level: 'CORREDOR', parentId: 'nao-uuid' }).expect(400);
    });

    it('código de endereço é único por almoxarifado, mas pode repetir entre almoxarifados', async () => {
      await loc(wh, { code: 'DUP-A', level: 'AREA' }).expect(201);
      await loc(wh, { code: 'DUP-A', level: 'AREA' }).expect(409);
      await loc(otherWh, { code: 'DUP-A', level: 'AREA' }).expect(201);
    });

    it('código de endereço inválido (minúsculas) é recusado', async () => {
      await loc(wh, { code: 'a01', level: 'AREA' }).expect(400);
    });

    it('almoxarifado inativo não aceita novos endereços', async () => {
      const inact = await prisma.warehouse.create({ data: { code: `EDGE-${suffix}-OFF`, name: 'Inativo', type: 'VIRTUAL', status: 'INATIVO', createdBy: 'test' } });
      const res = await loc(inact.id, { code: 'X-A', level: 'AREA' }).expect(400);
      expect(res.body.message).toMatch(/inativo/);
    });

    it('endereço em almoxarifado inexistente retorna 404 para quem tem acesso total', async () => {
      await loc(ghost, { code: 'NOWH-A', level: 'AREA' }).expect(404);
    });
  });

  describe('RBAC e JWT — bordas', () => {
    const roleA = `edge-a-${suffix.toLowerCase()}`;
    const roleB = `edge-b-${suffix.toLowerCase()}`;
    const mapping = () => api().put(`/api/v1/rbac/axis-role-mapping/${roleA}`);

    it('múltiplos perfis do Axis somam permissões (união)', async () => {
      const g = await api().get('/api/v1/me').set(auth(gestor())).expect(200);
      const t = await api().get('/api/v1/me').set(auth(tokenFor(['tecnico']))).expect(200);
      const both = await api().get('/api/v1/me').set(auth(tokenFor(['gestor', 'tecnico']))).expect(200);
      for (const p of [...g.body.permissions, ...t.body.permissions]) expect(both.body.permissions).toContain(p);
    });

    it('roles como string (não-array) não concedem nada', async () => {
      const res = await api().get('/api/v1/me').set(auth(tokenFor('admin'))).expect(200);
      expect(res.body.permissions).toEqual([]);
      expect(res.body.axisRoles).toEqual([]);
    });

    it('token sem claim roles não acessa catálogo', async () => {
      await api().get('/api/v1/materials').set(auth(new JwtService({ secret: SECRET }).sign({ sub: 'sem-roles', email: 'x@x' }, { expiresIn: '5m' }))).expect(403);
    });

    it('mustChangePassword bloqueia rotas protegidas, mas não /health (público)', async () => {
      const t = tokenFor(['admin'], { mustChangePassword: true });
      await api().get('/api/v1/materials').set(auth(t)).expect(403);
      await api().get('/api/v1/health').set(auth(t)).expect(200);
    });

    it('token com segredo correto mas expirado no passado é recusado', async () => {
      await api().get('/api/v1/me').set(auth(tokenFor(['admin'], {}, SECRET, '-1m'))).expect(401);
    });

    it('mapeamento: GET lista o mapa; PUT exige rbac:write; corpo inválido é recusado', async () => {
      const map = await api().get('/api/v1/rbac/axis-role-mapping').set(auth(admin())).expect(200);
      expect(map.body.gestor).toContain('GESTOR_ALMOXARIFADO');
      await api().put(`/api/v1/rbac/axis-role-mapping/${roleA}`).set(auth(colaborador())).send({ logisticsRoles: [] }).expect(403);
      await mapping().set(auth(admin())).send({ logisticsRoles: 'AUDITOR' }).expect(400);
      await mapping().set(auth(admin())).send({ logisticsRoles: ['AUDITOR', 'AUDITOR'] }).expect(400);
      await mapping().set(auth(admin())).send({ logisticsRoles: ['AUDITOR'], extra: 1 }).expect(400);
    });

    it('mapeamento: perfil inexistente lista os códigos desconhecidos na mensagem', async () => {
      const res = await mapping().set(auth(admin())).send({ logisticsRoles: ['AUDITOR', 'FANTASMA'] }).expect(400);
      expect(res.body.message).toMatch(/FANTASMA/);
    });

    it('mapeamento: efeito imediato para um perfil exclusivo deste teste, sem mexer em perfis globais', async () => {
      await mapping().set(auth(admin())).send({ logisticsRoles: ['AUDITOR'] }).expect(200);
      const on = await api().get('/api/v1/me').set(auth(tokenFor([roleA]))).expect(200);
      expect(on.body.permissions).toContain('audit:read');
      await mapping().set(auth(admin())).send({ logisticsRoles: [] }).expect(200);
      const off = await api().get('/api/v1/me').set(auth(tokenFor([roleA]))).expect(200);
      expect(off.body.permissions).toEqual([]);
    });

    it('mapeamento de um perfil do Axis para vários perfis locais soma e troca conforme o PUT', async () => {
      await api().put(`/api/v1/rbac/axis-role-mapping/${roleB}`).set(auth(admin())).send({ logisticsRoles: ['AUDITOR', 'GESTOR_ALMOXARIFADO'] }).expect(200);
      const res = await api().get('/api/v1/me').set(auth(tokenFor([roleB]))).expect(200);
      expect(res.body.logisticsRoles.map((r: { code: string }) => r.code).sort()).toEqual(['AUDITOR', 'GESTOR_ALMOXARIFADO']);
      expect(res.body.permissions).toContain('audit:read');
      expect(res.body.permissions).toContain('warehouse:write');
      await api().put(`/api/v1/rbac/axis-role-mapping/${roleB}`).set(auth(admin())).send({ logisticsRoles: ['AUDITOR'] }).expect(200);
      const after = await api().get('/api/v1/me').set(auth(tokenFor([roleB]))).expect(200);
      expect(after.body.permissions).not.toContain('warehouse:write');
    });

    it('escopo por almoxarifado: lista vazia, duplicados, id inexistente e remoção de acesso', async () => {
      const user = `edge-user-${suffix.toLowerCase()}`;
      const w = (await api().post('/api/v1/warehouses').set(auth(gestor())).send({ code: `EDGE-${suffix}-SC`, name: 'Escopo', type: 'CENTRAL' }).expect(201)).body.id;
      const put = (body: unknown) => api().put(`/api/v1/rbac/users/${user}/warehouses`).set(auth(admin())).send(body as object);
      await put({ warehouseIds: [w, w] }).expect(400);
      await put({ warehouseIds: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
      await put({ warehouseIds: [w] }).expect(200);
      const reader = tokenFor(['tecnico'], { sub: user });
      expect((await api().get('/api/v1/warehouses').set(auth(reader)).expect(200)).body.map((x: { id: string }) => x.id)).toEqual([w]);
      await put({ warehouseIds: [] }).expect(200);
      expect((await api().get('/api/v1/warehouses').set(auth(reader)).expect(200)).body).toEqual([]);
      const got = await api().get(`/api/v1/rbac/users/${user}/warehouses`).set(auth(admin())).expect(200);
      expect(got.body.warehouseIds).toEqual([]);
    });
  });
});
