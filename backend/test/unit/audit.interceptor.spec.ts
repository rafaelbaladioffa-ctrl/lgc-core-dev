import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError, lastValueFrom } from 'rxjs';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { AuditInterceptor } from '../../src/audit/audit.interceptor.js';

// Regras da trilha de auditoria por requisição (AuditInterceptor) com Prisma mockado.
// Pontos fixados: só sucesso gera request.*; nunca valores do corpo; sem ator não há registro; rotas excluídas.

const UUID = '6f1c2a3e-1111-4222-8333-444455556666';

function ctx(opts: { method: string; url: string; user?: string; body?: unknown; correlation?: string; status?: number }) {
  const req = { method: opts.method, originalUrl: opts.url, body: opts.body, query: Object.fromEntries(new URL(opts.url, 'http://x').searchParams), ip: '10.0.0.5', user: opts.user ? { userId: opts.user } : undefined };
  const res = { statusCode: opts.status ?? 200, getHeader: (n: string) => (n === 'X-Correlation-Id' ? opts.correlation : undefined) };
  return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
}

const handler = (value: unknown, fail?: Error): CallHandler => ({ handle: () => (fail ? throwError(() => fail) : of(value)) });

function setup() {
  const create = vi.fn(async () => ({}));
  const prisma = { auditEvent: { create } };
  return { interceptor: new AuditInterceptor(prisma as never), create };
}

/** Executa a requisição e espera o pipeline terminar; a gravação é assíncrona (void), então aguardamos um tick. */
async function run(interceptor: AuditInterceptor, c: ExecutionContext, h: CallHandler) {
  const out = await lastValueFrom(interceptor.intercept(c, h), { defaultValue: undefined }).catch((e) => e);
  await new Promise((r) => setImmediate(r));
  return out;
}

describe('AuditInterceptor (unit)', () => {
  it('mutação bem-sucedida grava request.<método> com ator, correlação, origem e campos do corpo (só nomes)', async () => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'POST', url: '/api/v1/materials?dry=1', user: 'ana', correlation: 'corr-abc-123', body: { code: 'M1', shortDescription: 'SEGREDO-VALOR' } }), handler({ id: UUID }));
    expect(create).toHaveBeenCalledTimes(1);
    const data = (create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ actorAxisId: 'ana', action: 'request.post', aggregateType: 'materials', aggregateId: UUID, correlationId: 'corr-abc-123', origin: 'api 10.0.0.5' });
    expect(data.diff).toMatchObject({ method: 'POST', route: '/api/v1/materials', status: 200, bodyFields: ['code', 'shortDescription'], queryFields: ['dry'] });
  });

  it('nunca grava valores do corpo nem da query no diff', async () => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'PATCH', url: '/api/v1/materials/x?token=SEGREDO-QS', user: 'ana', body: { password: 'SENHA-XYZ', note: 'TOKEN-ABC' } }), handler({}));
    const serialized = JSON.stringify(create.mock.calls);
    expect(serialized).not.toContain('SENHA-XYZ');
    expect(serialized).not.toContain('TOKEN-ABC');
    expect(serialized).not.toContain('SEGREDO-QS');
  });

  it('a rota gravada troca UUIDs por :id e não contém a query string', async () => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'DELETE', url: `/api/v1/materials/${UUID}?force=true`, user: 'ana', body: {} }), handler(undefined));
    const diff = (create.mock.calls[0] as unknown as [{ data: { diff: Record<string, unknown> } }])[0].data.diff;
    expect(diff.route).toBe('/api/v1/materials/:id');
    expect(diff.route).not.toContain('?');
    expect(diff.queryFields).toEqual(['force']);
  });

  it('falha (erro lançado) não gera request.* de sucesso', async () => {
    const { interceptor, create } = setup();
    const err = Object.assign(new Error('conflito'), { status: 409 });
    await run(interceptor, ctx({ method: 'POST', url: '/api/v1/materials', user: 'ana', body: {} }), handler(null, err));
    expect(create).not.toHaveBeenCalled();
  });

  it('sem ator autenticado (401) não grava nada', async () => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'POST', url: '/api/v1/materials', body: {} }), handler({ id: UUID }));
    expect(create).not.toHaveBeenCalled();
  });

  it('GET comum não é auditado; GET de rota sensível grava access.sensitive', async () => {
    const plain = setup();
    await run(plain.interceptor, ctx({ method: 'GET', url: '/api/v1/materials', user: 'ana' }), handler([]));
    expect(plain.create).not.toHaveBeenCalled();

    const sens = setup();
    await run(sens.interceptor, ctx({ method: 'GET', url: '/api/v1/documents/abc', user: 'ana' }), handler({}));
    expect((sens.create.mock.calls[0] as unknown as [{ data: { action: string } }])[0].data.action).toBe('access.sensitive');
  });

  it('GET em /audit (leitura da própria trilha) é sensível', async () => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'GET', url: '/api/v1/audit/events?actor=ana&pageSize=5', user: 'ana' }), handler({ total: 0, items: [] }));
    const data = (create.mock.calls[0] as unknown as [{ data: { action: string; diff: { queryFields: string[] } } }])[0].data;
    expect(data.action).toBe('access.sensitive');
    expect(data.diff.queryFields).toEqual(['actor', 'pageSize']);
  });

  it.each(['/api/v1/health', '/api/v1/webhooks/axis', '/api/v1/sync/batch'])('rota %s não é auditada pelo interceptor (tem trilha própria)', async (url) => {
    const { interceptor, create } = setup();
    await run(interceptor, ctx({ method: 'POST', url, user: 'ana', body: {} }), handler({ id: UUID }));
    expect(create).not.toHaveBeenCalled();
  });

  it('usa o id do corpo como aggregateId quando existe; senão o UUID da rota', async () => {
    const a = setup();
    await run(a.interceptor, ctx({ method: 'POST', url: '/api/v1/shipments', user: 'ana', body: {} }), handler({ id: UUID }));
    expect((a.create.mock.calls[0] as unknown as [{ data: { aggregateId: string } }])[0].data.aggregateId).toBe(UUID);

    const b = setup();
    await run(b.interceptor, ctx({ method: 'POST', url: `/api/v1/shipments/${UUID}/dispatch`, user: 'ana', body: {} }), handler({ ok: true }));
    expect((b.create.mock.calls[0] as unknown as [{ data: { aggregateId: string } }])[0].data.aggregateId).toBe(UUID);

    const c = setup();
    await run(c.interceptor, ctx({ method: 'POST', url: '/api/v1/shipments/dispatch', user: 'ana', body: {} }), handler({ ok: true }));
    expect((c.create.mock.calls[0] as unknown as [{ data: { aggregateId: string } }])[0].data.aggregateId).toBe('-');
  });

  it('falha ao gravar a auditoria não quebra a resposta ao cliente', async () => {
    const create = vi.fn(async () => { throw new Error('banco caiu'); });
    const interceptor = new AuditInterceptor({ auditEvent: { create } } as never);
    const out = await run(interceptor, ctx({ method: 'POST', url: '/api/v1/materials', user: 'ana', body: {} }), handler({ id: UUID }));
    expect(out).toEqual({ id: UUID }); // a resposta segue normalmente: a mutação já foi feita
    expect(create).toHaveBeenCalledTimes(1);
  });
});
