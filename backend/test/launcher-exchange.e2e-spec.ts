import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

const SECRET = process.env.JWT_SECRET!;

/** Entrada pelo botão "Abrir" do Axis: JWT curto (~90 s) trocado por sessão da Logística. */
describe('POST /auth/exchange — launcher do Axis', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sfx = (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
  const jwt = new JwtService({ secret: SECRET });
  const api = () => request(app.getHttpServer());
  const axisToken = (extra: Record<string, unknown> = {}, expiresIn: string | number = 90, secret = SECRET, alg: 'HS256' | 'HS512' = 'HS256') =>
    new JwtService({ secret }).sign({ sub: `launch-${sfx}`, email: `u-${sfx}@lgc.test`, roles: ['gestor'], permissions: ['coisa:inventada'], collaboratorId: null, mustChangePassword: false, ...extra }, { expiresIn: expiresIn as never, algorithm: alg, jwtid: randomUUID() });
  const exchange = (token: unknown) => api().post('/api/v1/auth/exchange').send({ token });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    app.setGlobalPrefix('api/v1');
    await app.init();
    prisma = app.get(PrismaService);
  });
  afterAll(async () => app.close());

  it('troca o token curto do Axis por uma sessão de 8 h que funciona na API; permissões do token do Axis são ignoradas', async () => {
    const r = await exchange(axisToken()).expect(200);
    expect(r.body).toMatchObject({ expiresIn: 28800, email: `u-${sfx}@lgc.test` });
    const claims = jwt.decode(r.body.accessToken) as { iss: string; exp: number; iat: number; permissions?: unknown; roles: string[] };
    expect(claims.iss).toBe('axis-logistica');
    expect(claims.exp - claims.iat).toBe(28800);
    expect(claims.permissions).toBeUndefined(); // só o mapeamento local vale
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${r.body.accessToken}`).expect(200);
    expect(me.body.logisticsRoles.map((x: { code: string }) => x.code)).toEqual(['GESTOR_ALMOXARIFADO']);
    expect(me.body.permissions).not.toContain('coisa:inventada');
  });

  it('o próprio token curto do Axis também continua valendo como acesso direto até expirar', async () => {
    await api().get('/api/v1/me').set('Authorization', `Bearer ${axisToken()}`).expect(200);
  });

  it('recusa token expirado, assinado com outro segredo, alg diferente de HS256, lixo e corpo inválido', async () => {
    const expired = new JwtService({ secret: SECRET }).sign({ sub: 'x', email: 'x@lgc.test', roles: [] }, { expiresIn: -5 });
    expect((await exchange(expired).expect(401)).body.message).toMatch(/expirou|inválido/);
    await exchange(axisToken({}, 90, 'outro-segredo-qualquer-0123456789')).expect(401);
    await exchange(axisToken({}, 90, SECRET, 'HS512')).expect(401);
    await exchange('lixo.lixo.lixo-com-mais-de-vinte-caracteres').expect(401);
    await exchange('curto').expect(400);
    await exchange(undefined).expect(400);
    await exchange('x'.repeat(5000)).expect(400);
    await api().post('/api/v1/auth/exchange').send({ token: axisToken(), extra: 1 }).expect(400);
    const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 'x', email: 'x@y.co', roles: ['admin'] })).toString('base64url') + '.';
    await exchange(none).expect(401);
  });

  it('senha temporária (mustChangePassword) não entra; sessão da Logística não se renova pela troca', async () => {
    await exchange(axisToken({ mustChangePassword: true })).expect(403);
    const session = (await exchange(axisToken()).expect(200)).body.accessToken as string;
    await exchange(session).expect(401);
    await exchange(axisToken({ sub: undefined })).expect(401);
    await exchange(axisToken({ email: undefined })).expect(401);
  });

  it('usuário desativado no Axis (user.disabled) não troca e a sessão já emitida deixa de valer', async () => {
    const sub = `disabled-${sfx}`;
    const session = (await exchange(axisToken({ sub })).expect(200)).body.accessToken as string;
    await api().get('/api/v1/me').set('Authorization', `Bearer ${session}`).expect(200);
    await prisma.axisMasterCache.upsert({ where: { kind_axisId: { kind: 'USER', axisId: sub } }, create: { kind: 'USER', axisId: sub, active: false, sourceOccurredAt: new Date() }, update: { active: false } });
    await exchange(axisToken({ sub })).expect(401);
    await api().get('/api/v1/me').set('Authorization', `Bearer ${session}`).expect(401);
    await prisma.axisMasterCache.update({ where: { kind_axisId: { kind: 'USER', axisId: sub } }, data: { active: true } }); // reativado
    await api().get('/api/v1/me').set('Authorization', `Bearer ${session}`).expect(200);
  });

  it('endpoint público tem limite de tentativas', async () => {
    const rs = await Promise.all(Array.from({ length: 30 }, () => exchange('lixo.lixo.lixo-com-mais-de-vinte-caracteres')));
    expect(rs.some((r) => r.status === 429)).toBe(true);
  });
});
