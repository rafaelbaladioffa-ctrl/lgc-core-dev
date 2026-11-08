import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { LogisticsClient, toLogisticsMaterial } from './logistics.client.js';

/** Catálogo da Logística por X-Api-Key (vínculo do material da cotação, P-06 / PA-08). Formato da rota do PT-04. */

const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe('LogisticsClient — materiais', () => {
  const env = { LOGISTICA_API_URL: 'http://log.test/api/v1/', LOGISTICA_API_KEY: 'k' };

  it('consulta por código na rota de integração, com a chave, lê items e devolve só id, código, descrição e unidade de material ativo', async () => {
    const fetchFn = ok({
      items: [
        { id: 'u1', code: 'RED-CAB-0123', shortDescription: 'Cabo óptico 12F', unit: 'm', averageCost: '9.9000', lastCost: '9.5000', available: '10', active: true },
        { id: 'u2', code: 'RED-CAB-0124', shortDescription: 'Cabo inativo', unit: 'm', averageCost: '1.0000', lastCost: '1.0000', available: '0', active: false },
      ],
      notFound: [],
    });
    const out = await new LogisticsClient(config(env)).materialsByCodes(['RED-CAB-0123', 'RED-CAB-0124'], fetchFn);
    expect(out).toEqual([{ id: 'u1', code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm' }]);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://log.test/api/v1/integration/materials?codes=RED-CAB-0123%2CRED-CAB-0124');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'k' });
  });

  it('código que não existe volta em notFound e a lista fica vazia; lista vazia de códigos não consulta', async () => {
    const client = new LogisticsClient(config(env));
    expect(await client.materialsByCodes(['XXX'], ok({ items: [], notFound: ['XXX'] }))).toEqual([]);
    const fetchFn = ok({ items: [], notFound: [] });
    expect(await client.materialsByCodes([], fetchFn)).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('resposta que não é { items } vira erro de gateway', async () => {
    await expect(new LogisticsClient(config(env)).materialsByCodes(['A-1'], ok([{ id: 'u', code: 'A-1' }]))).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('sem configuração ou com a Logística fora do ar explica em português', async () => {
    await expect(new LogisticsClient(config({})).materialsByCodes(['A-1'])).rejects.toBeInstanceOf(ServiceUnavailableException);
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new LogisticsClient(config(env)).materialsByCodes(['A-1'], down)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('linha sem id ou código é ignorada; a descrição vem de shortDescription', () => {
    expect(toLogisticsMaterial({ code: 'A' })).toBeNull();
    expect(toLogisticsMaterial({ id: 'u', code: 'A', shortDescription: 'Parafuso', unit: 'un' })).toEqual({ id: 'u', code: 'A', description: 'Parafuso', unit: 'un' });
  });
});
