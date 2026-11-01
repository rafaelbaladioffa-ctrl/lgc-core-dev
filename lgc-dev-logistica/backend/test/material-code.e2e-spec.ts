import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const tokenFor = (roles: string[], sub = 'u-' + roles.join('-')) => new JwtService({ secret: process.env.JWT_SECRET! }).sign({ sub, email: 'u@lgc.test', roles, mustChangePassword: false }, { expiresIn: '10m' });

/** Código do material gerado pelo servidor: FAMÍLIA-SUBCÓDIGO-0001, sequencial por combinação, sem colisão concorrente. */
describe('Código do material gerado automaticamente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let uom: string;
  // subcódigo de 3 letras único por execução (evita herdar sequência de execuções anteriores)
  const rnd = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const sub = () => rnd() + rnd() + rnd();
  const admin = tokenFor(['admin']);
  const catalogo = tokenFor(['gestor']); // tem material:write? ver abaixo — usamos token só com ADMIN_CATALOGO
  const A = (t: string) => ({ Authorization: `Bearer ${t}` });
  const api = () => request(app.getHttpServer());
  const base = (extra: object = {}) => ({ shortDescription: 'Capacete teste', category: 'Teste', type: 'EPI', stockUomId: uom, ...extra });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
    uom = (await prisma.unitOfMeasure.findUniqueOrThrow({ where: { code: 'UN' } })).id;
    void catalogo;
  });
  afterAll(async () => app.close());

  it('lista as famílias do catálogo', async () => {
    const r = await api().get('/api/v1/materials/families').set(A(admin)).expect(200);
    expect(r.body.map((f: { prefix: string }) => f.prefix)).toEqual(expect.arrayContaining(['EPI', 'FER', 'CON', 'TI']));
  });

  it('gera EPI-XXX-0001 e depois 0002 (sequencial por família+subcódigo)', async () => {
    const s = sub();
    const a = await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'EPI', subcode: s })).expect(201);
    const b = await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'EPI', subcode: s })).expect(201);
    const other = await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'FER', subcode: s, type: 'FERRAMENTA' })).expect(201);
    expect(a.body.code).toBe(`EPI-${s}-0001`);
    expect(b.body.code).toBe(`EPI-${s}-0002`);
    expect(other.body.code).toBe(`FER-${s}-0001`);
  });

  it('criação concorrente com a mesma família+subcódigo não colide', async () => {
    const s = sub();
    const rs = await Promise.all(Array.from({ length: 8 }, () => api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'CON', subcode: s, type: 'CONSUMO' }))));
    expect(rs.map((r) => r.status)).toEqual(Array(8).fill(201));
    const codes = rs.map((r) => r.body.code as string).sort();
    expect(codes).toEqual(Array.from({ length: 8 }, (_, i) => `CON-${s}-${String(i + 1).padStart(4, '0')}`));
  });

  it('valida família e subcódigo, e exige os dois quando não há código', async () => {
    await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'XXX', subcode: 'ABC' })).expect(400);
    await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'EPI', subcode: 'ab' })).expect(400);
    await api().post('/api/v1/materials').set(A(admin)).send(base({ family: 'EPI' })).expect(400);
    await api().post('/api/v1/materials').set(A(admin)).send(base()).expect(400);
  });

  it('o código informado à mão só vale com material:set_code; edição nunca muda o código', async () => {
    // usuário que escreve no catálogo mas sem set_code: perfil ADMIN_CATALOGO via grant por usuário
    const uid = `mc-${Date.now().toString(36)}`;
    await api().put(`/api/v1/rbac/users/${uid}/roles`).set(A(admin)).send({ logisticsRoles: ['ADMIN_CATALOGO'] }).expect(200);
    const cat = tokenFor(['colaborador'], uid);
    const r = await api().post('/api/v1/materials').set(A(cat)).send(base({ code: 'EPI-ZZZ-9999' })).expect(400);
    expect(JSON.stringify(r.body)).toMatch(/gerado automaticamente/);
    const ok = await api().post('/api/v1/materials').set(A(cat)).send(base({ family: 'EPI', subcode: sub() })).expect(201);
    await api().patch(`/api/v1/materials/${ok.body.id}`).set(A(cat)).send({ code: 'EPI-NOV-0001' }).expect(400);
    // importação (admin técnico) pode informar o código
    const imp = await api().post('/api/v1/materials').set(A(admin)).send(base({ code: `IMP-${sub()}-0001` })).expect(201);
    expect(imp.body.code).toMatch(/^IMP-/);
  });
});
