import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { AvailabilityService, todayBR } from '../../src/stock/availability.service.js';

// Conceitos de estoque (seção 4) sem banco: físico, reservado, bloqueado, disponível e projeção até a data necessária.

const M = 'mat-1';
const D = (n: number) => new Prisma.Decimal(n);

function build(balances: unknown[] = [], items: unknown[] = [], materials = [{ id: M, code: 'SKU-1', stockUom: { code: 'UN' } }]) {
  const prisma = {
    material: { findMany: vi.fn().mockResolvedValue(materials) },
    stockBalance: { findMany: vi.fn().mockResolvedValue(balances) },
    fulfillmentItem: { findMany: vi.fn().mockResolvedValue(items) },
  };
  return { svc: new AvailabilityService(prisma as never), prisma };
}

const bal = (over: Record<string, unknown> = {}) => ({
  materialId: M, condition: 'DISPONIVEL', quantity: D(0), reservedQty: D(0), lot: null, ...over,
});
const lot = (over: Record<string, unknown> = {}) => ({ status: 'LIBERADO', expiresAt: null, ...over });
const item = (quantity: number, reservations: number[] = [], materialId = M) => ({
  materialId, quantity: D(quantity), reservations: reservations.map((q) => ({ quantity: D(q) })),
});
const yesterday = () => new Date(todayBR().getTime() - 86_400_000);

describe('todayBR', () => {
  it('é meia-noite UTC do dia civil de São Paulo (comparável a colunas DATE)', () => {
    const t = todayBR();
    expect(t.getUTCHours()).toBe(0);
    expect(t.getUTCMinutes()).toBe(0);
    const brDay = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    expect(t.toISOString().slice(0, 10)).toBe(brDay);
  });
});

describe('AvailabilityService.compute — físico, reservado, bloqueado e disponível', () => {
  it('soma condições: DISPONIVEL sem lote e com lote liberado compõem disponível (menos reservado)', async () => {
    const { svc } = build([
      bal({ quantity: D(10), reservedQty: D(3) }),
      bal({ quantity: D(5), lot: lot({ expiresAt: new Date(todayBR().getTime() + 30 * 86_400_000) }) }),
    ]);
    const [a] = await svc.compute([M]);
    expect(a).toMatchObject({ material_id: M, sku: 'SKU-1', stock_unit: 'UN', physical: '15', reserved: '3', blocked: '0', available: '12', projected_on_needed_by: '12' });
    expect(new Date(a.as_of).toString()).not.toBe('Invalid Date');
  });

  it('QUARENTENA/BLOQUEADO/AVARIADO e lote bloqueado ou vencido vão para "bloqueado" pela quantidade total', async () => {
    const { svc } = build([
      bal({ condition: 'QUARENTENA', quantity: D(4) }),
      bal({ condition: 'BLOQUEADO', quantity: D(1) }),
      bal({ condition: 'AVARIADO', quantity: D(2) }),
      bal({ quantity: D(6), reservedQty: D(2), lot: lot({ status: 'QUARENTENA' }) }),
      bal({ quantity: D(3), lot: lot({ expiresAt: yesterday() }) }),
    ]);
    const [a] = await svc.compute([M]);
    expect(a).toMatchObject({ physical: '16', blocked: '16', available: '0' });
  });

  it('lote que vence hoje ainda é utilizável; vencido ontem não', async () => {
    const { svc } = build([
      bal({ quantity: D(2), lot: lot({ expiresAt: todayBR() }) }),
      bal({ quantity: D(7), lot: lot({ expiresAt: yesterday() }), locationId: 'x' }),
    ]);
    const [a] = await svc.compute([M]);
    expect(a).toMatchObject({ available: '2', blocked: '7' });
  });

  it('aritmética decimal exata em unidades fracionárias', async () => {
    const { svc } = build([bal({ quantity: new Prisma.Decimal('2.345'), reservedQty: new Prisma.Decimal('0.345') })]);
    const [a] = await svc.compute([M]);
    expect(a).toMatchObject({ physical: '2.345', reserved: '0.345', available: '2' });
  });

  it('material sem saldo retorna zeros, sem ordem de demanda', async () => {
    const { svc } = build([], [], [{ id: M, code: 'SKU-1', stockUom: { code: 'UN' } }]);
    const [a] = await svc.compute([M]);
    expect(a).toMatchObject({ physical: '0', reserved: '0', blocked: '0', available: '0', projected_on_needed_by: '0' });
  });

  it('consulta só saldo PROPRIO com quantidade positiva; filtra almoxarifado quando informado', async () => {
    const { svc, prisma } = build();
    await svc.compute([M], { warehouseId: 'w-1' });
    const where = prisma.stockBalance.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ materialId: { in: [M] }, ownership: 'PROPRIO', quantity: { gt: 0 }, location: { warehouseId: 'w-1' } });
  });

  it('sem almoxarifado informado, o filtro de local não é aplicado', async () => {
    const { svc, prisma } = build();
    await svc.compute([M]);
    expect(prisma.stockBalance.findMany.mock.calls[0][0].where).not.toHaveProperty('location');
  });

  it('propriedade de terceiros não entra no físico nem no disponível (ex.: consignado não é do LGC)', async () => {
    // A consulta filtra PROPRIO: saldo de terceiro nunca chega ao cálculo.
    const { svc, prisma } = build([bal({ quantity: D(9) })]);
    await svc.compute([M]);
    expect(prisma.stockBalance.findMany.mock.calls[0][0].where.ownership).toBe('PROPRIO');
  });
});

describe('AvailabilityService.compute — projeção até a data necessária', () => {
  const neededBy = new Date('2026-12-15T00:00:00Z');

  it('sem neededBy não consulta demanda e projeção = disponível', async () => {
    const { svc, prisma } = build([bal({ quantity: D(5) })]);
    const [a] = await svc.compute([M]);
    expect(prisma.fulfillmentItem.findMany).not.toHaveBeenCalled();
    expect(a.projected_on_needed_by).toBe('5');
  });

  it('desconta a demanda aberta (quantidade − reservado da ordem) de ordens com data até a consulta', async () => {
    const { svc } = build(
      [bal({ quantity: D(12), reservedQty: D(2) })],
      [item(6, [2]), item(3, [])], // aberto: 4 + 3 = 7
    );
    const [a] = await svc.compute([M], { neededBy });
    expect(a).toMatchObject({ available: '10', projected_on_needed_by: '3' });
  });

  it('item já coberto além da quantidade não gera demanda negativa', async () => {
    const { svc } = build([bal({ quantity: D(5) })], [item(2, [5])]);
    const [a] = await svc.compute([M], { neededBy });
    expect(a.projected_on_needed_by).toBe('5');
  });

  it('projeção pode ficar negativa quando a demanda excede o disponível', async () => {
    const { svc } = build([bal({ quantity: D(4) })], [item(10, [])]);
    const [a] = await svc.compute([M], { neededBy });
    expect(a.projected_on_needed_by).toBe('-6');
  });

  it('demandas de vários itens do mesmo material se somam', async () => {
    const { svc } = build([bal({ quantity: D(10) })], [item(2, []), item(3, []), item(4, [1])]);
    const [a] = await svc.compute([M], { neededBy });
    expect(a.projected_on_needed_by).toBe('2'); // 10 − (2 + 3 + (4 − 1))
  });

  it('busca só ordens em status que ainda pedem estoque e com data nula ou até a consulta', async () => {
    const { svc, prisma } = build([], []);
    await svc.compute([M], { neededBy, warehouseId: 'w-1' });
    const where = prisma.fulfillmentItem.findMany.mock.calls[0][0].where;
    expect(where.materialId).toEqual({ in: [M] });
    expect(where.order.status.in).toEqual(['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE']);
    expect(where.order.OR).toEqual([{ neededBy: null }, { neededBy: { lte: neededBy } }]);
    expect(where.order.warehouseId).toBe('w-1');
  });

  it('ordens já RESERVADA, separação em andamento ou canceladas não entram na demanda', async () => {
    const { svc, prisma } = build([], []);
    await svc.compute([M], { neededBy });
    const statuses: string[] = prisma.fulfillmentItem.findMany.mock.calls[0][0].where.order.status.in;
    for (const s of ['RESERVADA', 'EM_SEPARACAO', 'CANCELADA', 'ENTREGUE', 'BLOQUEADA', 'AGUARDANDO_INFORMACAO']) {
      expect(statuses).not.toContain(s);
    }
  });

  it('a cobertura considera reservas ATIVA e CONSUMIDA', async () => {
    const { svc, prisma } = build([], []);
    await svc.compute([M], { neededBy });
    expect(prisma.fulfillmentItem.findMany.mock.calls[0][0].include.reservations.where.status.in).toEqual(['ATIVA', 'CONSUMIDA']);
  });
});
