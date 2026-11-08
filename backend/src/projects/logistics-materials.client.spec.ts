import { describe, expect, it, vi } from 'vitest';
import { LogisticsMaterialsClient } from './logistics-materials.client.js';

/** Consulta de materiais da Logística pelo servidor do Core: nunca lança, devolve `ok: false` com o motivo. */

const ENV = { LOGISTICA_API_URL: 'http://log.test/api/v1/', LOGISTICA_API_KEY: 'segredo' };
const client = (env: Record<string, string | undefined> = ENV) => new LogisticsMaterialsClient({ get: (key: string) => env[key] } as any);
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('LogisticsMaterialsClient.lookup', () => {
  it('chama GET /integration/materials?codes= com X-Api-Key e lê id e custo médio', async () => {
    const fetchFn = vi.fn().mockImplementation(() =>
      json({ items: [{ id: 'm1', code: 'RED-CAB-0123', averageCost: '3.3000', lastCost: '3.4500' }, { id: 'm2', code: 'SEM-CUSTO', averageCost: null }], notFound: ['X-1'] }),
    );
    const result = await client().lookup(['RED-CAB-0123', 'X-1', 'RED-CAB-0123', 'SEM-CUSTO'], fetchFn as any);
    expect(fetchFn.mock.calls[0][0]).toBe('http://log.test/api/v1/integration/materials?codes=RED-CAB-0123%2CX-1%2CSEM-CUSTO');
    expect(fetchFn.mock.calls[0][1].headers['X-Api-Key']).toBe('segredo');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.materials.get('RED-CAB-0123')).toEqual({ id: 'm1', code: 'RED-CAB-0123', averageCost: '3.3000' });
      expect(result.materials.get('SEM-CUSTO')?.averageCost).toBeNull();
      expect(result.notFound).toEqual(['X-1']);
    }
  });

  it('divide em chamadas de até 200 códigos', async () => {
    const codes = Array.from({ length: 450 }, (_, i) => `C-${i}`);
    const fetchFn = vi.fn().mockImplementation(() => json({ items: [], notFound: [] }));
    await client().lookup(codes, fetchFn as any);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('sem URL ou chave configuradas: ok false, sem chamar a rede', async () => {
    const fetchFn = vi.fn();
    const result = await client({ LOGISTICA_API_URL: 'http://log.test/api/v1' }).lookup(['A'], fetchFn as any);
    expect(result).toEqual({ ok: false, reason: 'Integração com a Logística não configurada (LOGISTICA_API_URL e LOGISTICA_API_KEY).' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('HTTP de erro, resposta inesperada e falha de rede viram ok false', async () => {
    expect(await client().lookup(['A'], (() => json({}, 401)) as any)).toEqual({ ok: false, reason: 'A Logística recusou a consulta de materiais (HTTP 401).' });
    expect(await client().lookup(['A'], (() => json({ itens: [] })) as any)).toMatchObject({ ok: false, reason: expect.stringContaining('Resposta inesperada') });
    expect(await client().lookup(['A'], (() => Promise.reject(new Error('ECONNREFUSED'))) as any)).toEqual({ ok: false, reason: 'A Logística não respondeu à consulta de materiais.' });
  });
});
