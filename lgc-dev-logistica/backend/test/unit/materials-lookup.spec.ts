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
      ['sem codes', ''],
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
      expect(findMany.mock.calls.at(-1)![0].where).toEqual({ code: { in: ['EPI-CAP-0001', 'NAO-TEM', 'RED-CAB-0123'] } });
    });

    it('tira espaços e repetidos e aceita codes repetido na query; material inativo vem com active=false', async () => {
      findMany.mockResolvedValueOnce([mat('A', { status: 'INATIVO' }), mat('B')]);
      compute.mockResolvedValueOnce([{ material_id: 'id-A', available: '3' }]);
      const res = await get('?codes=A,%20B%20,A&codes=B');
      expect(res.status).toBe(200);
      expect(findMany.mock.calls.at(-1)![0].where).toEqual({ code: { in: ['A', 'B'] } });
      expect(res.body.items.map((i: { code: string; active: boolean; available: string }) => [i.code, i.active, i.available])).toEqual([['A', false, '3'], ['B', true, '0']]);
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
