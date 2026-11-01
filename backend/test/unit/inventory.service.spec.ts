import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryService, countCode } from '../../src/inventory/inventory.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

// Regras do InventoryService (abertura, recontagem, apuração, ajuste, cancelamento) com Prisma, RBAC e
// StockService mockados. Sem banco: cobre caminhos que a API só alcança com dados muito específicos.

const D = (v: number | string) => new Prisma.Decimal(v);
const WH = '00000000-0000-4000-8000-0000000000aa';
const CNT = '00000000-0000-4000-8000-0000000000cc';
const LOC = '00000000-0000-4000-8000-000000000001';
const MAT = '00000000-0000-4000-8000-000000000002';

const user = (permissions: string[] = []): AuthenticatedUser => ({
  userId: 'u-gestor', email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions,
});

const count = (over: Record<string, unknown> = {}) => ({ id: CNT, seq: 42, type: 'ENDERECO', status: 'APURADA', warehouseId: WH, tolerancePct: D(0), actionPlan: null, ...over });

const line = (over: Record<string, unknown> = {}) => ({
  id: 'ln-1', countId: CNT, materialId: MAT, locationId: LOC, lotId: null, serialId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO',
  systemQty: D(10), unitCost: D(4), status: 'PENDENTE', count1Qty: null, count1By: null, count2Qty: null, count2By: null,
  finalQty: null, varianceQty: null, reason: null, notes: null, adjustmentMovementId: null, ...over,
});

function build(opts: { count?: Record<string, unknown> | null; lines?: Array<Record<string, unknown>>; findFirst?: Record<string, unknown> | null; permissions?: string[] } = {}) {
  const c = opts.count === undefined ? count() : opts.count;
  const tx = {
    warehouse: { findUnique: vi.fn().mockResolvedValue({ id: WH, status: 'ATIVO', type: 'CENTRAL', projectAxisId: null }) },
    stockBalance: { findMany: vi.fn().mockResolvedValue([]) },
    stockCountLine: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue(opts.lines ?? []),
      findFirst: vi.fn().mockResolvedValue(opts.findFirst ?? null),
      update: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    stockCount: {
      findUnique: vi.fn().mockResolvedValue(c),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ ...c, ...data })),
      create: vi.fn().mockResolvedValue({ id: CNT, seq: 42, type: 'ENDERECO', status: 'ABERTA' }),
    },
    serialNumber: { findMany: vi.fn().mockResolvedValue([]) },
    material: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: MAT, serialControlled: false, stockUom: { code: 'UN', precision: 0 } }) },
    integrationMessage: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    stockCount: { ...tx.stockCount },
    stockCountLine: { ...tx.stockCountLine, findMany: vi.fn().mockResolvedValue(opts.lines ?? []), groupBy: vi.fn().mockResolvedValue([]) },
  };
  const rbac = { assertWarehouseAccess: vi.fn().mockResolvedValue(undefined), accessibleWarehouseIds: vi.fn().mockResolvedValue('ALL') };
  const stock = { applyInternal: vi.fn().mockResolvedValue({ id: 'mov-1' }) };
  const svc = new InventoryService(prisma as never, rbac as never, stock as never);
  return { svc, tx, prisma, rbac, stock };
}

describe('InventoryService.create — escopo e linhas', () => {
  it('AMOSTRAGEM com tamanho maior que o universo traz o universo inteiro, sem duplicar', async () => {
    const { svc, tx } = build();
    const balances = [{ materialId: MAT, locationId: LOC, lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: D(3), material: { averageCost: D(1), serialControlled: false } }, { materialId: 'm-2', locationId: LOC, lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: D(4), material: { averageCost: null, serialControlled: false } }];
    tx.stockBalance.findMany.mockResolvedValue(balances);
    tx.stockCount.create.mockResolvedValue({ id: CNT, seq: 1 });
    const r = await svc.create({ type: 'AMOSTRAGEM', warehouseId: WH, scope: { sampleSize: 5000 } } as never, user(['stockcount:manage']));
    expect(r.lines).toBe(2);
    expect(tx.stockCountLine.createMany.mock.calls[0][0].data).toHaveLength(2);
  });

  it('linha seriada gera uma linha por série, com systemQty 1; sem série, linha por saldo', async () => {
    const { svc, tx } = build();
    tx.stockBalance.findMany.mockResolvedValue([{ materialId: MAT, locationId: LOC, lotId: null, condition: 'BOM', ownership: 'PROPRIO', quantity: D(2), material: { averageCost: D(9), serialControlled: true } }]);
    tx.serialNumber.findMany.mockResolvedValue([{ id: 'sn-1' }, { id: 'sn-2' }]);
    tx.stockCount.create.mockResolvedValue({ id: CNT, seq: 1 });
    await svc.create({ type: 'ITEM', warehouseId: WH, scope: { materialIds: [MAT] } } as never, user());
    const data = tx.stockCountLine.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data.map((d) => [d.serialId, d.systemQty])).toEqual([['sn-1', 1], ['sn-2', 1]]);
  });

  it('valores padrão: tolerância 0 e congelado; tolerância e congelamento explícitos são repassados', async () => {
    const { svc, tx } = build();
    tx.stockBalance.findMany.mockResolvedValue([{ materialId: MAT, locationId: LOC, lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: D(1), material: { averageCost: null, serialControlled: false } }]);
    tx.stockCount.create.mockResolvedValue({ id: CNT, seq: 1 });
    await svc.create({ type: 'ENDERECO', warehouseId: WH, scope: { locationIds: [LOC] } } as never, user());
    expect(tx.stockCount.create.mock.calls[0][0].data).toMatchObject({ tolerancePct: 0, frozen: true });
    await svc.create({ type: 'ENDERECO', warehouseId: WH, scope: { locationIds: [LOC] }, tolerancePct: 7.5, frozen: false } as never, user());
    expect(tx.stockCount.create.mock.calls[1][0].data).toMatchObject({ tolerancePct: 7.5, frozen: false });
  });

  it('almoxarifado virtual ou inativo não recebe inventário', async () => {
    const { svc, tx } = build();
    tx.warehouse.findUnique.mockResolvedValueOnce({ id: WH, status: 'ATIVO', type: 'VIRTUAL' });
    await expect(svc.create({ type: 'ENDERECO', warehouseId: WH, scope: { locationIds: [LOC] } } as never, user())).rejects.toBeInstanceOf(UnprocessableEntityException);
    tx.warehouse.findUnique.mockResolvedValueOnce({ id: WH, status: 'INATIVO', type: 'CENTRAL' });
    await expect(svc.create({ type: 'ENDERECO', warehouseId: WH, scope: { locationIds: [LOC] } } as never, user())).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('ROTATIVO_ABC sem criticidade e AMOSTRAGEM sem tamanho são recusados antes de consultar saldo', async () => {
    const { svc, tx } = build();
    await expect(svc.create({ type: 'ROTATIVO_ABC', warehouseId: WH, scope: {} } as never, user())).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.create({ type: 'AMOSTRAGEM', warehouseId: WH, scope: {} } as never, user())).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.stockBalance.findMany).not.toHaveBeenCalled();
  });

  it('endereço já em outro inventário ativo gera conflito e nada é criado', async () => {
    const { svc, tx } = build();
    tx.stockBalance.findMany.mockResolvedValue([{ materialId: MAT, locationId: LOC, lotId: null, condition: 'DISPONIVEL', ownership: 'PROPRIO', quantity: D(1), material: { averageCost: null, serialControlled: false } }]);
    tx.stockCountLine.count.mockResolvedValue(3);
    await expect(svc.create({ type: 'ENDERECO', warehouseId: WH, scope: { locationIds: [LOC] } } as never, user())).rejects.toBeInstanceOf(ConflictException);
    expect(tx.stockCount.create).not.toHaveBeenCalled();
  });
});

describe('InventoryService.sheet — contagem cega', () => {
  it('a consulta da folha nunca seleciona saldo do sistema nem custo', async () => {
    const { svc, prisma } = build({ count: count({ status: 'EM_CONTAGEM' }), lines: [] });
    await svc.sheet(CNT, user());
    const sel = Object.keys(prisma.stockCountLine.findMany.mock.calls[0][0].select);
    expect(sel).not.toEqual(expect.arrayContaining(['systemQty', 'unitCost', 'varianceQty', 'finalQty', 'count1Qty', 'count2Qty']));
  });

  it('folha da 2ª rodada filtra pelo usuário da 1ª contagem', async () => {
    const { svc, prisma } = build({ count: count({ status: 'EM_RECONTAGEM' }), lines: [] });
    await svc.sheet(CNT, user());
    expect(prisma.stockCountLine.findMany.mock.calls[0][0].where).toMatchObject({ status: 'RECONTAR', count1By: { not: 'u-gestor' } });
  });

  it('inventário concluído ou cancelado não tem folha', async () => {
    for (const status of ['ABERTA', 'APURADA', 'CONCLUIDA', 'CANCELADA']) {
      const { svc } = build({ count: count({ status }) });
      await expect(svc.sheet(CNT, user())).rejects.toBeInstanceOf(ConflictException);
    }
  });
});

describe('InventoryService.submit — regras da contagem', () => {
  const sub = (over: Record<string, unknown> = {}) => ({ lineId: 'ln-1', quantity: 5, ...over });

  it('quantidade com mais casas que a unidade aceita é recusada com código de conversão', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_CONTAGEM' }), findFirst: line({ status: 'PENDENTE' }) });
    tx.material.findUniqueOrThrow.mockResolvedValue({ id: MAT, serialControlled: false, stockUom: { code: 'UN', precision: 0 } });
    await expect(svc.submit(CNT, sub({ quantity: 1.5 }) as never, user())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('item seriado aceita só 0 ou 1', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_CONTAGEM' }), findFirst: line({ status: 'PENDENTE', serialId: 'sn-1' }) });
    tx.material.findUniqueOrThrow.mockResolvedValue({ id: MAT, serialControlled: true, stockUom: { code: 'UN', precision: 0 } });
    await expect(svc.submit(CNT, sub({ quantity: 2 }) as never, user())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('linha de outro inventário não é encontrada', async () => {
    const { svc } = build({ count: count({ status: 'EM_CONTAGEM' }), findFirst: null });
    await expect(svc.submit(CNT, sub() as never, user())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('segunda contagem da 2ª rodada pelo mesmo operador é recusada (segregação)', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_RECONTAGEM' }), findFirst: line({ status: 'RECONTAR', count1By: 'u-gestor', count1Qty: D(3) }) });
    await expect(svc.submit(CNT, sub() as never, user())).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.stockCountLine.update).not.toHaveBeenCalled();
  });

  it('linha que não está em RECONTAR não aceita contagem na 2ª rodada', async () => {
    const { svc } = build({ count: count({ status: 'EM_RECONTAGEM' }), findFirst: line({ status: 'CONFERIDO', count1By: 'outro' }) });
    await expect(svc.submit(CNT, sub() as never, user())).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('InventoryService.closeRound — apuração', () => {
  // Diferença percentual sobre o saldo do sistema; tolerância é inclusiva (≤).
  const round1 = async (systemQty: string, count1: string, tolerancePct: number) => {
    const { svc, tx } = build({ count: count({ status: 'EM_CONTAGEM', tolerancePct: D(tolerancePct) }), lines: [line({ status: 'CONTADO', systemQty: D(systemQty), count1Qty: D(count1), count1By: 'a' })] });
    tx.stockCountLine.count.mockResolvedValue(D(systemQty).equals(count1) ? 0 : 1); // divergências da apuração final
    const r = await svc.closeRound(CNT, user());
    return { r, updates: tx.stockCountLine.update.mock.calls.map((c) => c[0].data.status) };
  };

  it('diferença exatamente igual à tolerância é aceita (DIVERGENTE, sem recontagem)', async () => {
    const { r, updates } = await round1('10', '9', 10);
    expect(r).toEqual({ status: 'APURADA', variances: 1 });
    expect(updates).toEqual(['DIVERGENTE']);
  });

  it('diferença acima da tolerância por um centavo vai para recontagem', async () => {
    const { r, updates } = await round1('10', '8.99', 10);
    expect(r).toEqual({ status: 'EM_RECONTAGEM', recount: 1 });
    expect(updates).toEqual(['RECONTAR']);
  });

  it('tolerância 0 manda qualquer diferença para recontagem; igualdade confere', async () => {
    expect((await round1('10', '9.999999', 0)).r).toMatchObject({ status: 'EM_RECONTAGEM' });
    expect((await round1('10', '10', 0)).r).toEqual({ status: 'CONCLUIDA', variances: 0 });
  });

  it('tolerância 100 aceita queda de 100% e recontará acima disso', async () => {
    expect((await round1('10', '0', 100)).r).toEqual({ status: 'APURADA', variances: 1 });
    expect((await round1('10', '21', 100)).r).toMatchObject({ status: 'EM_RECONTAGEM' });
  });

  it('saldo do sistema zero não divide por zero: a diferença vira percentual sobre 1 (3 → 300%, recontagem)', async () => {
    expect((await round1('0', '3', 100)).r).toMatchObject({ status: 'EM_RECONTAGEM' });
    expect((await round1('0', '0', 0)).r).toEqual({ status: 'CONCLUIDA', variances: 0 });
  });

  it('closeRound com linha pendente recusa e não altera nada', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_CONTAGEM' }), lines: [line({ status: 'PENDENTE' })] });
    await expect(svc.closeRound(CNT, user())).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.stockCountLine.update).not.toHaveBeenCalled();
  });

  it('closeRound em ABERTA ou CANCELADA não tem rodada aberta', async () => {
    for (const status of ['ABERTA', 'CANCELADA']) {
      const { svc } = build({ count: count({ status }), lines: [] });
      await expect(svc.closeRound(CNT, user())).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('2ª rodada: linha sem recontagem bloqueia o fechamento', async () => {
    const { svc } = build({ count: count({ status: 'EM_RECONTAGEM' }), lines: [line({ status: 'RECONTAR', count1Qty: D(5), count2Qty: null })] });
    await expect(svc.closeRound(CNT, user())).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('2ª rodada: recontagem que confere com o sistema vira CONFERIDO e o inventário conclui', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_RECONTAGEM' }), lines: [line({ status: 'RECONTAR', systemQty: D(10), count1Qty: D(4), count2Qty: D(10) })] });
    expect(await svc.closeRound(CNT, user())).toEqual({ status: 'CONCLUIDA', variances: 0 });
    const data = tx.stockCountLine.update.mock.calls[0][0].data;
    expect(data.status).toBe('CONFERIDO');
    expect(data.varianceQty.toString()).toBe('0');
  });

  it('apuração com divergências emite evento de variância no outbox', async () => {
    const { svc, tx } = build({ count: count({ status: 'EM_RECONTAGEM' }), lines: [line({ status: 'RECONTAR', systemQty: D(10), count1Qty: D(4), count2Qty: D(7) })] });
    tx.stockCountLine.count.mockResolvedValue(1);
    expect(await svc.closeRound(CNT, user())).toEqual({ status: 'APURADA', variances: 1 });
    expect(tx.integrationMessage.create.mock.calls[0][0].data).toMatchObject({ eventType: 'inventory.variance_detected', direction: 'OUTBOUND', status: 'PENDING' });
  });
});

describe('InventoryService.report — custo oculto', () => {
  const divergent = line({ status: 'DIVERGENTE', systemQty: D(10), finalQty: D(8), varianceQty: D(-2), unitCost: D(4) });

  it('sem material:read_cost não expõe valor em R$ nem total', async () => {
    const { svc } = build({ lines: [divergent], permissions: [] });
    const r = await svc.report(CNT, user([]));
    expect(r).not.toHaveProperty('totalVarianceValue');
    expect(r.items[0]).not.toHaveProperty('variance_value');
    expect(JSON.stringify(r)).not.toMatch(/variance_value|totalVarianceValue|unitCost/);
    expect(r.items[0]).toMatchObject({ before: '10', after: '8', variance: '-2' }); // quantidades continuam
  });

  it('com material:read_cost expõe valor da divergência e total', async () => {
    const { svc } = build({ lines: [divergent] });
    const r = await svc.report(CNT, user(['material:read_cost']));
    expect(r.items[0]).toMatchObject({ variance_value: '-8' });
    expect(r).toMatchObject({ totalVarianceValue: '-8' });
  });

  it('divergência sem custo médio informado não gera valor (null, não zero nem erro)', async () => {
    const { svc } = build({ lines: [line({ ...divergent, unitCost: null })] });
    const r = await svc.report(CNT, user(['material:read_cost']));
    expect(r.items[0].variance_value).toBeNull();
    expect(r).toMatchObject({ totalVarianceValue: '0' });
  });

  it('report com todas as linhas conferidas mostra resumo e nenhum item', async () => {
    const { svc, prisma } = build({ lines: [] });
    prisma.stockCountLine.groupBy.mockResolvedValue([{ status: 'CONFERIDO', _count: { _all: 3 } }]);
    const r = await svc.report(CNT, user([]));
    expect(r.items).toEqual([]);
    expect(r.summary).toEqual({ CONFERIDO: 3 });
    expect(r.recurrentCount).toBe(0);
  });
});

describe('InventoryService.applyAdjustments — ajuste', () => {
  it('linhas repetidas no pedido de ajuste são recusadas', async () => {
    const { svc, stock } = build({ count: count({ status: 'APURADA' }), lines: [line({ status: 'DIVERGENTE', finalQty: D(8) })] });
    const dto = { approvalRef: 'APR-1', lines: [{ lineId: 'ln-1', reason: 'PERDA' }, { lineId: 'ln-1', reason: 'PERDA' }] };
    await expect(svc.applyAdjustments(CNT, dto as never, user())).rejects.toMatchObject({ message: 'Linhas repetidas.' });
    expect(stock.applyInternal).not.toHaveBeenCalled();
  });

  it('linha que não é divergência deste inventário é recusada', async () => {
    const { svc } = build({ count: count({ status: 'APURADA' }), lines: [line({ id: 'ln-1', status: 'DIVERGENTE', finalQty: D(8) })] });
    const dto = { approvalRef: 'APR-1', lines: [{ lineId: 'ln-1', reason: 'PERDA' }, { lineId: 'ln-outra', reason: 'PERDA' }] };
    await expect(svc.applyAdjustments(CNT, dto as never, user())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ajuste fora de APURADA é recusado (inclusive já CONCLUIDA)', async () => {
    const { svc, stock } = build({ count: count({ status: 'CONCLUIDA' }), lines: [] });
    await expect(svc.applyAdjustments(CNT, { approvalRef: 'APR-1', lines: [{ lineId: 'ln-1', reason: 'PERDA' }] } as never, user())).rejects.toBeInstanceOf(ConflictException);
    expect(stock.applyInternal).not.toHaveBeenCalled();
  });

  it('ajuste positivo usa AJUSTE_POSITIVO com bypass de congelamento e referência de aprovação', async () => {
    const { svc, stock } = build({ count: count({ status: 'APURADA' }), lines: [line({ id: 'ln-1', status: 'DIVERGENTE', systemQty: D(10), finalQty: D(12), varianceQty: D(2) })] });
    await svc.applyAdjustments(CNT, { approvalRef: 'APR-9', lines: [{ lineId: 'ln-1', reason: 'ERRO_LANCAMENTO' }] } as never, user());
    const [, input, key] = stock.applyInternal.mock.calls[0]; // (tx, input, idempotencyKey, user)
    expect(input).toMatchObject({ type: 'AJUSTE_POSITIVO', toLocationId: LOC, axisApprovalRef: 'APR-9', bypassFreeze: true });
    expect(input.quantity.toString()).toBe('2');
    expect(key).toBe('inv:ln-1');
  });

  it('ajuste negativo usa AJUSTE_NEGATIVO na origem e o motivo do inventário no texto', async () => {
    const { svc, stock } = build({ count: count({ status: 'APURADA', seq: 42 }), lines: [line({ id: 'ln-1', status: 'DIVERGENTE', systemQty: D(10), finalQty: D(7), varianceQty: D(-3) })] });
    await svc.applyAdjustments(CNT, { approvalRef: 'APR-9', lines: [{ lineId: 'ln-1', reason: 'PERDA', notes: 'quebra' }] } as never, user());
    const input = stock.applyInternal.mock.calls[0][1];
    expect(input).toMatchObject({ type: 'AJUSTE_NEGATIVO', fromLocationId: LOC, logisticsDocumentRef: countCode(42) });
    expect(input.quantity.toString()).toBe('3');
    expect(input.reason).toBe(`Inventário ${countCode(42)}: PERDA — quebra`);
  });

  it('falha de um ajuste propaga erro (a transação do chamador desfaz os anteriores)', async () => {
    const { svc, stock } = build({ count: count({ status: 'APURADA' }), lines: [line({ id: 'ln-1', status: 'DIVERGENTE', finalQty: D(8) })] });
    stock.applyInternal.mockRejectedValueOnce(new UnprocessableEntityException('Saldo insuficiente'));
    await expect(svc.applyAdjustments(CNT, { approvalRef: 'APR-1', lines: [{ lineId: 'ln-1', reason: 'PERDA' }] } as never, user())).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('InventoryService.cancel', () => {
  it.each(['ABERTA', 'EM_CONTAGEM', 'EM_RECONTAGEM', 'APURADA'])('cancela inventário em %s', async (status) => {
    const { svc, prisma } = build({ count: count({ status, actionPlan: null }) });
    await svc.cancel(CNT, 'Teste', user());
    expect(prisma.stockCount.update.mock.calls[0][0].data).toMatchObject({ status: 'CANCELADA', actionPlan: 'Cancelado: Teste' });
  });

  it.each(['CONCLUIDA', 'CANCELADA'])('não cancela inventário já %s', async (status) => {
    const { svc, prisma } = build({ count: count({ status }) });
    await expect(svc.cancel(CNT, 'Teste', user())).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.stockCount.update).not.toHaveBeenCalled();
  });

  it('preserva plano de ação já existente ao cancelar', async () => {
    const { svc, prisma } = build({ count: count({ status: 'EM_CONTAGEM', actionPlan: 'Plano anterior' }) });
    await svc.cancel(CNT, 'Teste', user());
    expect(prisma.stockCount.update.mock.calls[0][0].data.actionPlan).toBe('Plano anterior');
  });
});
