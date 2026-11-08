import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ServiceUnavailableException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { IntegrationApiKeyGuard, sameKey } from '../../src/integration/api-key.guard.js';
import { aggregateConsumption, aggregateCustody, competenceRange } from '../../src/integration/cost-report.js';
import { CompetenceQuery, FinanceIntegrationController, FinanceIntegrationService } from '../../src/integration/finance-integration.controller.js';
import { IS_PUBLIC_KEY } from '../../src/auth/public.decorator.js';
import { sumValueBy } from '../../src/dashboard/dashboard.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

// Leituras de custo para o Financeiro (docs/integracao-centros-de-custo.md §5), sem banco.

const CC_A = 'cc-a';
const CC_B = 'cc-b';
const out = (quantity: string, unitCost: string | null, cc: string | null, project: string | null = null, reverses: string | null = null) => ({
  quantity: new Prisma.Decimal(quantity), unitCost: unitCost === null ? null : new Prisma.Decimal(unitCost), costCenterAxisId: cc, projectAxisId: project, reversesMovementId: reverses,
});

describe('competenceRange', () => {
  it('mês em America/Sao_Paulo (UTC−3), intervalo semiaberto', () => {
    const r = competenceRange('2026-11');
    expect(r.start.toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });

  it('dezembro vira o ano', () => {
    expect(competenceRange('2026-12').end.toISOString()).toBe('2027-01-01T03:00:00.000Z');
  });

  it('rejeita formato inválido', () => {
    for (const m of ['2026-13', '2026-1', '26-11', '2026-11-01', '']) expect(() => competenceRange(m)).toThrow();
  });
});

describe('CompetenceQuery', () => {
  const errs = (q: Record<string, unknown>) => validateSync(plainToInstance(CompetenceQuery, q), { whitelist: true, forbidNonWhitelisted: true }).map((e) => e.property);
  it('exige month AAAA-MM e recusa campos extras', () => {
    expect(errs({ month: '2026-11' })).toEqual([]);
    expect(errs({})).toContain('month');
    expect(errs({ month: '2026-00' })).toContain('month');
    expect(errs({ month: '2026-11', warehouseId: 'x' })).toContain('warehouseId');
  });
});

describe('aggregateConsumption', () => {
  it('soma quantidade × custo por centro de custo e projeto, com 2 casas', () => {
    const r = aggregateConsumption([out('2', '10.5', CC_A, 'p1'), out('3', '1.333', CC_A, 'p1'), out('1', '7', CC_B, 'p1')]);
    expect(r).toEqual([
      { cost_center_id: CC_A, project_id: 'p1', value: '25.00', movements: 2 },
      { cost_center_id: CC_B, project_id: 'p1', value: '7.00', movements: 1 },
    ]);
  });

  it('estorno lançado na competência é descontado', () => {
    const r = aggregateConsumption([out('4', '10', CC_A, null), out('4', '10', CC_A, null, 'mov-1'), out('1', '10', CC_A, null)]);
    expect(r).toEqual([{ cost_center_id: CC_A, project_id: null, value: '10.00', movements: 3 }]);
  });

  it('estorno de saída de mês anterior deixa o valor negativo na competência do estorno', () => {
    expect(aggregateConsumption([out('2', '5', CC_A, null, 'mov-antigo')])[0].value).toBe('-10.00');
  });

  it('custo ausente vale zero; sem centro de custo vai numa linha com cost_center_id nulo, no fim', () => {
    const r = aggregateConsumption([out('5', null, null), out('1', '2', CC_B)]);
    expect(r).toEqual([
      { cost_center_id: CC_B, project_id: null, value: '2.00', movements: 1 },
      { cost_center_id: null, project_id: null, value: '0.00', movements: 1 },
    ]);
  });

  it('sem movimentos devolve lista vazia', () => {
    expect(aggregateConsumption([])).toEqual([]);
  });
});

describe('aggregateCustody', () => {
  const term = (custodian: string, quantity: string, returned: string, avg: string | null, last: string | null = null) => ({
    custodianAxisId: custodian, quantity: new Prisma.Decimal(quantity), returnedQty: new Prisma.Decimal(returned), material: { averageCost: avg === null ? null : new Prisma.Decimal(avg), lastCost: last === null ? null : new Prisma.Decimal(last) },
  });

  it('valoriza o saldo não devolvido pelo custo médio, por custodiante', () => {
    const r = aggregateCustody([term('col-1', '1', '0', '1500'), term('col-1', '10', '4', '12.5'), term('col-2', '1', '0', '300.10')]);
    expect(r).toEqual([
      { custodian_id: 'col-1', items: 2, value: '1575.00' },
      { custodian_id: 'col-2', items: 1, value: '300.10' },
    ]);
  });

  it('sem custo médio usa o último custo; sem nenhum custo vale zero', () => {
    expect(aggregateCustody([term('c', '2', '0', null, '8'), term('c', '1', '0', null, null)])).toEqual([{ custodian_id: 'c', items: 2, value: '16.00' }]);
  });

  it('ignora termo já devolvido por inteiro', () => {
    expect(aggregateCustody([term('c', '3', '3', '10')])).toEqual([]);
  });
});

describe('FinanceIntegrationService', () => {
  it('consumo: filtra SAIDA_ENTREGA (inclusive estornos) pela competência', async () => {
    const findMany = vi.fn().mockResolvedValue([out('1', '10', CC_A), out('1', '10', CC_A, null, 'm')]);
    const svc = new FinanceIntegrationService({ stockMovement: { findMany } } as unknown as PrismaService);
    await expect(svc.consumptionByCostCenter('2026-10')).resolves.toEqual([{ cost_center_id: CC_A, project_id: null, value: '0.00', movements: 2 }]);
    const where = findMany.mock.calls[0][0].where;
    expect(where.type).toBe('SAIDA_ENTREGA');
    expect(where.reversesMovementId).toBeUndefined();
    expect(where.effectiveAt.gte.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(where.effectiveAt.lt.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('custódia: só termos ATIVO, com o custo do material', async () => {
    const terms = vi.fn().mockResolvedValue([{ custodianAxisId: 'col', materialId: 'm1', quantity: new Prisma.Decimal(2), returnedQty: new Prisma.Decimal(0) }]);
    const mats = vi.fn().mockResolvedValue([{ id: 'm1', averageCost: new Prisma.Decimal('99.995'), lastCost: null }]);
    const svc = new FinanceIntegrationService({ custodyTerm: { findMany: terms }, material: { findMany: mats }, axisMasterCache: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as PrismaService);
    await expect(svc.custodyValue()).resolves.toEqual([{ custodian_id: 'col', items: 1, value: '199.99' }]);
    expect(terms.mock.calls[0][0].where).toEqual({ status: 'ATIVO' });
  });

  it('custódia: termo antigo com id de usuário soma na linha do colaborador ligado (cache USER)', async () => {
    const D = (v: string) => new Prisma.Decimal(v);
    const terms = vi.fn().mockResolvedValue([
      { custodianAxisId: 'col', materialId: 'm1', quantity: D('1'), returnedQty: D('0') },
      { custodianAxisId: 'user-1', materialId: 'm1', quantity: D('1'), returnedQty: D('0') },
    ]);
    const mats = vi.fn().mockResolvedValue([{ id: 'm1', averageCost: D('10'), lastCost: null }]);
    const cache = vi.fn().mockResolvedValue([{ axisId: 'user-1', data: { collaborator_id: 'col' } }]);
    const svc = new FinanceIntegrationService({ custodyTerm: { findMany: terms }, material: { findMany: mats }, axisMasterCache: { findMany: cache } } as unknown as PrismaService);
    await expect(svc.custodyValue()).resolves.toEqual([{ custodian_id: 'col', items: 2, value: '20.00' }]);
    expect(cache.mock.calls[0][0].where).toEqual({ kind: 'USER', axisId: { in: ['col', 'user-1'] } });
  });

  it('custódia vazia não consulta materiais', async () => {
    const mats = vi.fn();
    const svc = new FinanceIntegrationService({ custodyTerm: { findMany: vi.fn().mockResolvedValue([]) }, material: { findMany: mats } } as unknown as PrismaService);
    await expect(svc.custodyValue()).resolves.toEqual([]);
    expect(mats).not.toHaveBeenCalled();
  });
});

describe('IntegrationApiKeyGuard', () => {
  const guard = (key?: string) => new IntegrationApiKeyGuard({ get: () => key } as unknown as ConfigService);
  const ctx = (headers: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => ({ headers, method: 'GET', originalUrl: '/api/v1/integration/custody-value', ip: '127.0.0.1' }) }) }) as unknown as ExecutionContext;

  it('sem INTEGRATION_API_KEY configurada responde 503', () => {
    expect(() => guard(undefined).canActivate(ctx({ 'x-api-key': 'qualquer' }))).toThrow(ServiceUnavailableException);
    expect(() => guard('').canActivate(ctx({}))).toThrow(ServiceUnavailableException);
  });

  it('chave ausente ou errada responde 401', () => {
    expect(() => guard('segredo-certo').canActivate(ctx({}))).toThrow(UnauthorizedException);
    expect(() => guard('segredo-certo').canActivate(ctx({ 'x-api-key': 'segredo-errado' }))).toThrow(UnauthorizedException);
    expect(() => guard('segredo-certo').canActivate(ctx({ 'x-api-key': 'segredo-cert' }))).toThrow(UnauthorizedException);
  });

  it('chave certa libera', () => {
    expect(guard('segredo-certo').canActivate(ctx({ 'x-api-key': 'segredo-certo' }))).toBe(true);
  });

  it('sameKey compara conteúdo, inclusive com tamanhos diferentes', () => {
    expect(sameKey('abc', 'abc')).toBe(true);
    expect(sameKey('abc', 'abcd')).toBe(false);
    expect(sameKey('abc', '')).toBe(false);
  });

  it('o controller fica fora do JWT de usuário (@Public) e usa o guard da chave', () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, FinanceIntegrationController)).toBe(true);
    expect(Reflect.getMetadata('__guards__', FinanceIntegrationController)).toContain(IntegrationApiKeyGuard);
  });
});

describe('painel: sumValueBy', () => {
  it('agrupa por projeto ou centro de custo, ordena do maior valor e formata em BRL', () => {
    const rows = [
      { project: 'p1', cost_center: CC_A, value: new Prisma.Decimal('100'), movements: 2 },
      { project: 'p2', cost_center: CC_A, value: new Prisma.Decimal('50.5'), movements: 1 },
      { project: 'p1', cost_center: CC_B, value: new Prisma.Decimal('-20'), movements: 1 },
    ];
    const byCc = sumValueBy(rows, (r) => r.cost_center);
    expect(byCc.map((r) => [r.key, r.value, r.movements])).toEqual([[CC_A, '150.50', 3], [CC_B, '-20.00', 1]]);
    expect(byCc[0].valueBRL.replace(/\s/g, ' ')).toBe('R$ 150,50');
    expect(sumValueBy(rows, (r) => r.project).map((r) => [r.key, r.value])).toEqual([['p1', '80.00'], ['p2', '50.50']]);
  });
});
