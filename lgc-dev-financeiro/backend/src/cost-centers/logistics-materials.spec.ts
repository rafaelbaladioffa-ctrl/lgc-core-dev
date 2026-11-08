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

  it('busca por texto: termo curto não chama a Logística; termo válido usa search e limit, lê items e esconde o custo', async () => {
    const client = new LogisticsClient(config(env));
    const nunca = ok({ items: [], notFound: [] });
    expect(await client.searchMaterials(' a ', 20, nunca)).toEqual([]);
    expect(nunca).not.toHaveBeenCalled();

    const fetchFn = ok({
      items: [
        { id: 'u1', code: 'RED-CAB-0123', shortDescription: 'Cabo óptico 12F', unit: 'm', averageCost: '9.9000', lastCost: '9.5000', available: '10', active: true },
        { id: 'u2', code: 'RED-CON-0007', shortDescription: 'Conector LC', unit: 'un', averageCost: '4.0000', lastCost: '4.0000', available: '3', active: true },
      ],
      notFound: [],
    });
    const out = await client.searchMaterials('cabo óptico', 20, fetchFn);
    expect(out).toEqual([
      { id: 'u1', code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm' },
      { id: 'u2', code: 'RED-CON-0007', description: 'Conector LC', unit: 'un' },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/averageCost|lastCost|9\.9/);
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://log.test/api/v1/integration/materials?search=cabo%20%C3%B3ptico&limit=20');
    expect(init.headers).toMatchObject({ 'X-Api-Key': 'k' });
  });

  it('busca por texto: limite fica entre 1 e 50; resposta vazia é lista vazia', async () => {
    const client = new LogisticsClient(config(env));
    const fetchFn = ok({ items: [], notFound: [] });
    expect(await client.searchMaterials('cabo', 500, fetchFn)).toEqual([]);
    await client.searchMaterials('cabo', 0, fetchFn);
    const urls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toMatch(/limit=50$/);
    expect(urls[1]).toMatch(/limit=20$/);
  });

  it('busca por texto: Logística fora do ar (503) e sem configuração viram erro em português', async () => {
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new LogisticsClient(config(env)).searchMaterials('cabo', 20, down)).rejects.toThrow('A Logística recusou a consulta (HTTP 503)');
    await expect(new LogisticsClient(config(env)).searchMaterials('cabo', 20, down)).rejects.toBeInstanceOf(BadGatewayException);
    const unreachable = (async () => { throw new Error('rede'); }) as unknown as typeof fetch;
    await expect(new LogisticsClient(config(env)).searchMaterials('cabo', 20, unreachable)).rejects.toThrow('não respondeu');
    await expect(new LogisticsClient(config({})).searchMaterials('cabo')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('resposta que não é { items } vira erro de gateway', async () => {
    await expect(new LogisticsClient(config(env)).materialsByCodes(['A-1'], ok([{ id: 'u', code: 'A-1' }]))).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('sem configuração ou com a Logística fora do ar explica em português', async () => {
    await expect(new LogisticsClient(config({})).materialsByCodes(['A-1'])).rejects.toBeInstanceOf(ServiceUnavailableException);
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(new LogisticsClient(config(env)).materialsByCodes(['A-1'], down)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('missingCodes (F4): devolve os códigos que não voltaram como material ativo, consultando de 200 em 200', async () => {
    const client = new LogisticsClient(config(env));
    const fetchFn = ok({
      items: [
        { id: 'u1', code: 'A-1', shortDescription: 'Ativo', unit: 'un', active: true },
        { id: 'u2', code: 'A-2', shortDescription: 'Inativo', unit: 'un', active: false },
      ],
      notFound: ['A-3'],
    });
    expect(await client.missingCodes(['A-1', 'A-2', 'A-3', 'A-1'], fetchFn)).toEqual(['A-2', 'A-3']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const many = Array.from({ length: 450 }, (_, i) => `C-${i}`);
    const paged = ok({ items: [], notFound: [] });
    expect(await client.missingCodes(many, paged)).toHaveLength(450);
    expect(paged).toHaveBeenCalledTimes(3);
    const down = (async () => new Response('', { status: 503 })) as unknown as typeof fetch;
    await expect(client.missingCodes(['A-1'], down)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('linha sem id ou código é ignorada; a descrição vem de shortDescription', () => {
    expect(toLogisticsMaterial({ code: 'A' })).toBeNull();
    expect(toLogisticsMaterial({ id: 'u', code: 'A', shortDescription: 'Parafuso', unit: 'un' })).toEqual({ id: 'u', code: 'A', description: 'Parafuso', unit: 'un' });
  });
});
