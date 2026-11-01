import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, UnauthorizedException, BadRequestException, HttpException, type ArgumentsHost } from '@nestjs/common';
import { AuditExceptionFilter } from '../../src/audit/audit.filter.js';
import { CorrelationMiddleware } from '../../src/audit/correlation.middleware.js';

// Negações (403) viram access.denied, venham do guard ou de um serviço; a resposta ao cliente mantém o formato do Nest.
// Também cobre o CorrelationMiddleware (validação do X-Correlation-Id).

function host(opts: { user?: string; url?: string; method?: string; correlation?: string }) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const req = { method: opts.method ?? 'GET', originalUrl: opts.url ?? '/api/v1/audit/events?x=1', ip: '10.0.0.9', user: opts.user ? { userId: opts.user } : undefined };
  const res = { status, getHeader: (n: string) => (n === 'X-Correlation-Id' ? opts.correlation : undefined) };
  const h = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ArgumentsHost;
  return { h, json, status };
}

describe('AuditExceptionFilter (unit)', () => {
  it('403 de um usuário autenticado grava access.denied (guard ou serviço, o efeito é o mesmo)', async () => {
    const create = vi.fn(async () => ({}));
    const f = new AuditExceptionFilter({ auditEvent: { create } } as never);
    const { h, status, json } = host({ user: 'ana', url: '/api/v1/stock/movements?x=1', method: 'POST', correlation: 'corr-1234' });
    f.catch(new ForbiddenException('Permissão insuficiente. Necessário: stock:adjust.'), h);
    await new Promise((r) => setImmediate(r));
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ actorAxisId: 'ana', action: 'access.denied', aggregateType: 'stock', aggregateId: '-', correlationId: 'corr-1234', origin: 'api 10.0.0.9' });
    expect(data.diff).toEqual({ method: 'POST', route: '/api/v1/stock/movements', status: 403 });
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ message: 'Permissão insuficiente. Necessário: stock:adjust.', error: 'Forbidden', statusCode: 403 });
  });

  it('403 sem usuário (ex.: rota pública) não grava auditoria', async () => {
    const create = vi.fn(async () => ({}));
    const f = new AuditExceptionFilter({ auditEvent: { create } } as never);
    f.catch(new ForbiddenException('x'), host({}).h);
    await new Promise((r) => setImmediate(r));
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['401', new UnauthorizedException('Token inválido.')],
    ['400', new BadRequestException('Dados inválidos.')],
  ])('%s com usuário não é access.denied', async (_label, exc) => {
    const create = vi.fn(async () => ({}));
    const f = new AuditExceptionFilter({ auditEvent: { create } } as never);
    f.catch(exc, host({ user: 'ana' }).h);
    await new Promise((r) => setImmediate(r));
    expect(create).not.toHaveBeenCalled();
  });

  it('exceção com corpo string vira { statusCode, message }', () => {
    const f = new AuditExceptionFilter({ auditEvent: { create: vi.fn(async () => ({})) } } as never);
    const { h, status, json } = host({});
    f.catch(new HttpException('Texto simples', 418), h);
    expect(status).toHaveBeenCalledWith(418);
    expect(json).toHaveBeenCalledWith({ statusCode: 418, message: 'Texto simples' });
  });

  it('falha ao gravar o evento de negação não altera a resposta 403', async () => {
    const f = new AuditExceptionFilter({ auditEvent: { create: vi.fn(async () => { throw new Error('banco caiu'); }) } } as never);
    const { h, status } = host({ user: 'ana' });
    expect(() => f.catch(new ForbiddenException('x'), h)).not.toThrow();
    expect(status).toHaveBeenCalledWith(403);
  });
});

describe('CorrelationMiddleware (unit)', () => {
  const run = (incoming?: string) => {
    const setHeader = vi.fn();
    const req = { header: (n: string) => (n === 'x-correlation-id' ? incoming : undefined) };
    const next = vi.fn();
    new CorrelationMiddleware().use(req as never, { setHeader } as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    return setHeader.mock.calls[0][1] as string;
  };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  it('propaga um identificador válido', () => {
    expect(run('abc-DEF_123.x')).toBe('abc-DEF_123.x');
  });

  it.each([
    ['ausente', undefined],
    ['curto (7 caracteres)', 'abcdefg'],
    ['longo (81 caracteres)', 'a'.repeat(81)],
    ['com espaço', 'bad id here'],
    ['com caracteres de injeção', 'abc\r\nX-Injected: 1'],
    ['com barra', 'abc/def/ghi'],
    ['com acento', 'corrêlação-01'],
  ])('identificador %s é substituído por um UUID novo', (_label, value) => {
    const out = run(value);
    expect(out).toMatch(UUID);
    expect(out).not.toContain('\r');
    expect(out).not.toContain('X-Injected');
  });

  it('aceita exatamente 80 caracteres (limite superior)', () => {
    const v = 'a'.repeat(80);
    expect(run(v)).toBe(v);
  });
});
