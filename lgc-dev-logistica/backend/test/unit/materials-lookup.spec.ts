import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator.js';
import { IntegrationApiKeyGuard } from '../../src/integration/api-key.guard.js';
import { MATERIALS_LOOKUP_MAX, MaterialsLookupController, MaterialsLookupService, splitCodes } from '../../src/integration/materials-lookup.controller.js';
import { AvailabilityService } from '../../src/stock/availability.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

// GET /api/v1/integration/materials?codes=A,B por X-Api-Key (consulta do Core: custo e disponibilidade), sem banco.

const KEY = 'chave-de-integracao-0123456789';
const D = (v: string) => new Prisma.Decimal(v);
const mat = (code: string, over: Record<string, unknown> = {}) => ({
  id: `id-${code}`, code, shortDescription: `Descrição ${code}`, status: 'ATIVO', averageCost: D('12.3'), lastCost: D('13'), stockUom: { code: 'M' }, ...over,
});

describe('GET /integration/materials', () => {
  let app: INestApplication;
  const findMany = vi.fn();
  const findWarehouse = vi.fn();
  const compute = vi.fn();
  const config: Record<string, string | undefined> = { INTEGRATION_API_KEY: KEY };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MaterialsLookupController],
      providers: [
        MaterialsLookupService,
        IntegrationApiKeyGuard,
        { provide: PrismaService, useValue: { material: { findMany }, warehouse: { findFirst: findWarehouse } } },
        { provide: AvailabilityService, useValue: { compute } },
        { provide: ConfigService, useValue: { get: (k: string) => config[k] } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })); // igual ao main.ts
    app.setGlobalPrefix('api/v1');
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  const get = (qs: string, key: string | null = KEY) => {
    const r = request(app.getHttpServer()).get(`/api/v1/integration/materials${qs}`);
    return key === null ? r : r.set('X-Api-Key', key);
  };

  it('fica fora do JWT de usuário (@Public) e usa o guard da chave', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, MaterialsLookupController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', MaterialsLookupController)).toContain(IntegrationApiKeyGuard);
  });

  describe('401 / 503', () => {
    it('sem chave ou com chave errada é 401 e não consulta o banco', async () => {
      findMany.mockClear();
      expect((await get('?codes=A', null)).status).toBe(401);
      expect((await get('?codes=A', 'errada')).status).toBe(401);
      expect((await get('?codes=A', '')).status).toBe(401);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('chave certa, mas parâmetro inválido: autentica antes de validar (sem chave nunca chega a 400)', async () => {
      expect((await get('', null)).status).toBe(401);
    });

    it('sem INTEGRATION_API_KEY configurada a integração fica desligada (503)', async () => {
      const saved = config.INTEGRATION_API_KEY;
      config.INTEGRATION_API_KEY = undefined;
      try { expect((await get('?codes=A')).status).toBe(503); } finally { config.INTEGRATION_API_KEY = saved; }
    });
  });

  describe('400', () => {
    it.each([
      ['sem codes nem search', ''],
      ['codes vazio', '?codes='],
      ['só vírgulas e espaços', '?codes=,%20,'],
      ['campo extra', '?codes=A&foo=1'],
      ['código com mais de 40 caracteres', `?codes=${'X'.repeat(41)}`],
    ])('%s', async (_nome, qs) => {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it(`mais de ${MATERIALS_LOOKUP_MAX} códigos`, async () => {
      const codes = Array.from({ length: MATERIALS_LOOKUP_MAX + 1 }, (_, i) => `C${i}`).join(',');
      const res = await get(`?codes=${codes}`);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toContain('No máximo 200');
    });

    it('almoxarifado informado que não existe', async () => {
      findWarehouse.mockResolvedValueOnce(null);
      const res = await get('?codes=A&warehouse_code=NAO-EXISTE');
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Almoxarifado NAO-EXISTE não encontrado');
    });

    it('exatamente 200 códigos distintos passa', async () => {
      findMany.mockResolvedValueOnce([]);
      const codes = Array.from({ length: MATERIALS_LOOKUP_MAX }, (_, i) => `C${i}`).join(',');
      const res = await get(`?codes=${codes}`);
      expect(res.status).toBe(200);
      expect(res.body.notFound).toHaveLength(MATERIALS_LOOKUP_MAX);
    });
  });

  describe('200', () => {
    it('devolve id, código, descrição, unidade, custos (4 casas), disponível e, à parte, os códigos desconhecidos', async () => {
      findMany.mockResolvedValueOnce([mat('RED-CAB-0123'), mat('EPI-CAP-0001', { averageCost: null, lastCost: D('7.5'), stockUom: { code: 'UN' } })]);
      compute.mockResolvedValueOnce([
        { material_id: 'id-RED-CAB-0123', available: '1500' },
        { material_id: 'id-EPI-CAP-0001', available: '0' },
      ]);
      const res = await get('?codes=EPI-CAP-0001,NAO-TEM,RED-CAB-0123');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          { id: 'id-EPI-CAP-0001', code: 'EPI-CAP-0001', shortDescription: 'Descrição EPI-CAP-0001', unit: 'UN', averageCost: null, lastCost: '7.5000', available: '0', active: true },
          { id: 'id-RED-CAB-0123', code: 'RED-CAB-0123', shortDescription: 'Descrição RED-CAB-0123', unit: 'M', averageCost: '12.3000', lastCost: '13.0000', available: '1500', active: true },
        ],
        notFound: ['NAO-TEM'],
      });
      expect(findMany.mock.calls.at(-1)![0].where).toEqual({ code: { in: ['EPI-CAP-0001', 'NAO-TEM', 'RED-CAB-0123'] }, status: 'ATIVO' });
    });

    it('tira espaços e repetidos e aceita codes repetido na query; só materiais ATIVO (inativo cai em notFound)', async () => {
      findMany.mockResolvedValueOnce([mat('B')]); // o banco já filtra status ATIVO: A (inativo) não volta
      compute.mockResolvedValueOnce([{ material_id: 'id-B', available: '3' }]);
      const res = await get('?codes=A,%20B%20,A&codes=B');
      expect(res.status).toBe(200);
      expect(findMany.mock.calls.at(-1)![0].where).toEqual({ code: { in: ['A', 'B'] }, status: 'ATIVO' });
      expect(res.body.items.map((i: { code: string; active: boolean; available: string }) => [i.code, i.active, i.available])).toEqual([['B', true, '3']]);
      expect(res.body.notFound).toEqual(['A']);
    });

    it('todos desconhecidos: itens vazios e notFound com todos, sem consultar disponibilidade de ninguém', async () => {
      findMany.mockResolvedValueOnce([]);
      compute.mockClear();
      const res = await get('?codes=X,Y');
      expect(res.body).toEqual({ items: [], notFound: ['X', 'Y'] });
      expect(compute).not.toHaveBeenCalled();
    });

    it('disponibilidade usa o almoxarifado informado; sem ele, o padrão; padrão inexistente vale todos', async () => {
      findMany.mockResolvedValue([mat('A')]);
      compute.mockResolvedValue([{ material_id: 'id-A', available: '1' }]);

      findWarehouse.mockResolvedValueOnce({ id: 'wh-pedido' });
      await get('?codes=A&warehouse_code=ALM-X');
      expect(compute.mock.calls.at(-1)![1]).toEqual({ warehouseId: 'wh-pedido' });
      expect(findWarehouse.mock.calls.at(-1)![0].where).toEqual({ code: 'ALM-X' });

      config.DEFAULT_WAREHOUSE_CODE = 'ALM-CENTRAL';
      try {
        findWarehouse.mockResolvedValueOnce({ id: 'wh-padrao' });
        await get('?codes=A');
        expect(compute.mock.calls.at(-1)![1]).toEqual({ warehouseId: 'wh-padrao' });

        findWarehouse.mockResolvedValueOnce(null);
        expect((await get('?codes=A')).status).toBe(200);
        expect(compute.mock.calls.at(-1)![1]).toEqual({ warehouseId: undefined });
      } finally { delete config.DEFAULT_WAREHOUSE_CODE; }

      await get('?codes=A');
      expect(compute.mock.calls.at(-1)![1]).toEqual({ warehouseId: undefined });
    });
  });

  describe('search', () => {
    type Str = { equals?: string; startsWith?: string; contains?: string; mode?: string };
    type Where = { status?: string; id?: { notIn: string[] }; code?: Str; shortDescription?: Str; OR?: Where[] };
    const catalog = [
      mat('CAB-001', { shortDescription: 'Cabo óptico 12F' }),
      mat('CAB', { shortDescription: 'Cabo genérico' }),
      mat('ABC-9', { shortDescription: 'Peça do cabo preto' }),
      mat('EPI-001', { shortDescription: 'Capacete' }),
      mat('CAB-002', { shortDescription: 'Cabo inativo', status: 'INATIVO' }),
      ...Array.from({ length: 60 }, (_, i) => mat(`CBL-${String(i).padStart(3, '0')}`, { shortDescription: `Conector cabo ${i}` })),
    ];
    const hit = (v: string, f: Str) => {
      const a = v.toLowerCase();
      return (f.equals === undefined || a === f.equals.toLowerCase()) && (f.startsWith === undefined || a.startsWith(f.startsWith.toLowerCase())) && (f.contains === undefined || a.includes(f.contains.toLowerCase()));
    };
    const matches = (m: ReturnType<typeof mat>, w: Where): boolean =>
      (w.status === undefined || m.status === w.status) && (!w.id || !w.id.notIn.includes(m.id)) && (!w.code || hit(m.code, w.code)) &&
      (!w.shortDescription || hit(m.shortDescription, w.shortDescription)) && (!w.OR || w.OR.some((o) => matches(m, o)));

    beforeAll(() => {
      findMany.mockReset();
      findMany.mockImplementation(async ({ where, take, orderBy }: { where: Where; take: number; orderBy: { code: string } }) => {
        expect(orderBy).toEqual({ code: 'asc' });
        return catalog.filter((m) => matches(m, where)).sort((a, b) => a.code.localeCompare(b.code)).slice(0, take);
      });
      compute.mockReset();
      compute.mockResolvedValue([]);
    });
    afterAll(() => { findMany.mockReset(); compute.mockReset(); });

    const codes = (res: { body: { items: Array<{ code: string }> } }) => res.body.items.map((i) => i.code);

    it.each([
      ['search de 1 caractere', '?search=c'],
      ['search só de espaços', '?search=%20%20%20'],
      ['search vazio', '?search='],
      ['search de 1 caractere depois do trim', '?search=%20c%20'],
      ['search e codes juntos', '?search=cabo&codes=A'],
      ['limit zero', '?search=cabo&limit=0'],
      ['limit negativo', '?search=cabo&limit=-1'],
      ['limit que não é número', '?search=cabo&limit=muitos'],
      ['limit decimal', '?search=cabo&limit=2.5'],
    ])('400: %s', async (_nome, qs) => {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('400 em pt-BR: search curto, search com codes e nenhum dos dois', async () => {
      expect(JSON.stringify((await get('?search=a')).body.message)).toContain('ao menos 2 caracteres');
      expect((await get('?search=cabo&codes=A')).body.message).toBe('Informe codes ou search, não os dois.');
      expect((await get('')).body.message).toContain('Informe codes');
    });

    it('sem a chave continua 401', async () => {
      expect((await get('?search=cabo', null)).status).toBe(401);
    });

    it('casa por descrição e por código, sem diferenciar maiúsculas, e traz notFound vazio', async () => {
      const res = await get('?search=CABO');
      expect(res.status).toBe(200);
      expect(res.body.notFound).toEqual([]);
      expect(codes(res)).toContain('ABC-9'); // casou só pela descrição ("Peça do cabo preto")
      expect(codes(await get('?search=epi-0'))).toEqual(['EPI-001']);
    });

    it('mesmo formato de hoje: id, code, shortDescription, unit, custos, available, active', async () => {
      compute.mockResolvedValueOnce([{ material_id: 'id-EPI-001', available: '7' }]);
      const res = await get('?search=capacete');
      expect(res.body.items).toEqual([{ id: 'id-EPI-001', code: 'EPI-001', shortDescription: 'Capacete', unit: 'M', averageCost: '12.3000', lastCost: '13.0000', available: '7', active: true }]);
    });

    it('material inativo não aparece', async () => {
      const res = await get('?search=inativo');
      expect(res.status).toBe(200);
      expect(codes(res)).toEqual([]);
      expect(codes(await get('?search=cab-00'))).toEqual(['CAB-001']); // CAB-002 é inativo
    });

    it('ordem: código igual ao termo, depois os que começam com o termo, depois o resto, por código', async () => {
      const list = codes(await get('?search=cab&limit=50'));
      expect(list.slice(0, 2)).toEqual(['CAB', 'CAB-001']); // igual (sem diferenciar maiúsculas), depois começa com "cab"
      // ABC-9 só contém "cab" no código e na descrição ("do cabo"): fica no resto, por código, antes de CBL-nnn (que só contêm na descrição)
      expect(list.indexOf('ABC-9')).toBe(2);
      expect(list[3]).toBe('CBL-000');
    });

    it('descrição que começa com o termo vem antes de quem só contém o termo', async () => {
      // "Cabo genérico" e "Cabo óptico 12F" começam com "cabo"; "Peça do cabo preto" e "Conector cabo n" só contêm
      const list = codes(await get('?search=cabo&limit=50'));
      expect(list.slice(0, 2)).toEqual(['CAB', 'CAB-001']);
      expect(list.indexOf('ABC-9')).toBe(2);
    });

    it('limit: padrão 20, respeitado e limitado a 50', async () => {
      expect(codes(await get('?search=cab'))).toHaveLength(20);
      expect(codes(await get('?search=cab&limit=3'))).toHaveLength(3);
      expect(codes(await get('?search=cab&limit=1'))).toEqual(['CAB']);
      expect(codes(await get('?search=cab&limit=50'))).toHaveLength(50);
      expect(codes(await get('?search=cab&limit=500'))).toHaveLength(50);
    });

    it('limit é ignorado com codes', async () => {
      findMany.mockResolvedValueOnce([mat('A')]);
      const res = await get('?codes=A&limit=1');
      expect(res.status).toBe(200);
      expect(codes(res)).toEqual(['A']);
    });

    it('consulta o banco sempre com status ATIVO e trim no termo', async () => {
      findMany.mockClear();
      expect(codes(await get('?search=%20capacete%20'))).toEqual(['EPI-001']);
      expect(findMany.mock.calls.length).toBeGreaterThan(0);
      for (const [arg] of findMany.mock.calls) expect(arg.where.status).toBe('ATIVO');
    });
  });
});

describe('splitCodes', () => {
  it('separa por vírgula, tira espaços e vazios, remove repetidos e mantém a ordem', () => {
    expect(splitCodes('B, A ,,B,C')).toEqual(['B', 'A', 'C']);
    expect(splitCodes(['A,B', 'B,C'])).toEqual(['A', 'B', 'C']);
    expect(splitCodes('')).toEqual([]);
  });
  it('valor que não é texto passa adiante para a validação recusar', () => {
    expect(splitCodes(undefined)).toBeUndefined();
    expect(splitCodes(5)).toBe(5);
  });
});
