import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LogisticsClient, toLogisticsMaterial } from './logistics.client.js';

/** Catálogo da Logística por X-Api-Key (busca do material da cotação, P-06 / PA-08). */

const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
const ok = (rows: unknown) => vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('LogisticsClient — materiais', () => {
  const env = { LOGISTICA_API_URL: 'http://log.test/api/v1/', LOGISTICA_API_KEY: 'k' };

  it('busca por texto na rota de integração, com a chave, e devolve só id, código, descrição e unidade', async () => {
    const fetchFn = ok([{ id: 'u1', code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm', averageCost: '9.90', available: '10' }]);
    const out = await new LogisticsClient(config(env)).searchMaterials('cabo óptico', fetchFn);
    expect(out).toEqual([{ id: 'u1', code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm' }]);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://log.test/api/v1/integration/materials?search=cabo%20%C3%B3ptico&limit=20');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'k' });
  });

  it('por códigos: lista separada por vírgula; lista vazia não consulta', async () => {
    const fetchFn = ok([]);
    const client = new LogisticsClient(config(env));
    expect(await client.materialsByCodes([], fetchFn)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
    await client.materialsByCodes(['A-1', 'B-2'], fetchFn);
    expect(((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string])[0]).toBe('http://log.test/api/v1/integration/materials?codes=A-1%2CB-2');
  });

  it('sem configuração ou com a Logística fora do ar explica em português', async () => {
    await expect(new LogisticsClient(config({})).searchMaterials('cabo')).rejects.toBeInstanceOf(ServiceUnavailableException);
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new LogisticsClient(config(env)).searchMaterials('cabo', down)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('linha sem id ou código é ignorada; aceita os nomes shortDescription e uom', () => {
    expect(toLogisticsMaterial({ code: 'A' })).toBeNull();
    expect(toLogisticsMaterial({ id: 'u', code: 'A', shortDescription: 'Parafuso', uom: 'un' })).toEqual({ id: 'u', code: 'A', description: 'Parafuso', unit: 'un' });
  });
});
