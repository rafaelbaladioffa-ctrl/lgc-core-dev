import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { averageAfterEntry, averageAfterEntryReversal } from '../../src/stock/cost.js';
import { StockService } from '../../src/stock/stock.service.js';
import { unitCostOf } from '../../src/shipping/shipping.service.js';

// Custo médio móvel no recebimento (PT-04): fórmula em Prisma.Decimal e a gravação em averageCost/lastCost, sem banco.

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

describe('averageAfterEntry', () => {
  it('entrada sobre saldo zero: o custo da entrada vira o custo médio, mesmo havendo média anterior', () => {
    expect(averageAfterEntry(0, '5.0000', 10, '8.2500').toFixed(4)).toBe('8.2500');
  });

  it('entrada sobre saldo existente: média ponderada pelo saldo', () => {
    // 100 × 10,00 + 50 × 16,00 = 1.800 ÷ 150 = 12,00
    expect(averageAfterEntry(100, '10.0000', 50, '16.0000').toFixed(4)).toBe('12.0000');
  });

  it('arredonda a 4 casas, meio para cima', () => {
    // (1 × 1,0000 + 1 × 1,0001) ÷ 2 = 1,00005 → 1,0001
    expect(averageAfterEntry(1, '1.0000', 1, '1.0001').toFixed(4)).toBe('1.0001');
    // (3 × 10 + 1 × 10,0001) ÷ 4 = 10,000025 → 10,0000
    expect(averageAfterEntry(3, '10', 1, '10.0001').toFixed(4)).toBe('10.0000');
  });

  it('sem custo anterior (null) o custo da entrada vale, mesmo com saldo', () => {
    expect(averageAfterEntry(40, null, 10, '7.5000').toFixed(4)).toBe('7.5000');
  });

  it('não usa ponto flutuante: 0,1 e 0,2 ponderados dão exatamente 0,15', () => {
    expect(averageAfterEntry(1, '0.1', 1, '0.2').toFixed(4)).toBe('0.1500');
    expect(averageAfterEntry('0.3', '0.1', '0.3', '0.2').toFixed(4)).toBe('0.1500');
  });

  it('quantidades fracionadas (metros de cabo)', () => {
    // 1200,5 × 3,20 + 800,25 × 3,45 = 3841,6 + 2760,8625 = 6602,4625 ÷ 2000,75 = 3,29997… → 3,3000
    expect(averageAfterEntry('1200.5', '3.2', '800.25', '3.45').toFixed(4)).toBe('3.3000');
  });
});

describe('averageAfterEntryReversal', () => {
  it('estorno da última entrada devolve a média anterior', () => {
    const afterEntry = averageAfterEntry(100, '10', 50, '16'); // 12,00 com 150 em estoque
    expect(averageAfterEntryReversal(150, afterEntry, 50, '16')?.toFixed(4)).toBe('10.0000');
  });

  it('estorno que zera o saldo mantém a média atual', () => {
    expect(averageAfterEntryReversal(50, '16', 50, '16')?.toFixed(4)).toBe('16.0000');
  });

  it('valor a retirar maior que o valor em estoque (parte já saiu): mantém a média atual', () => {
    expect(averageAfterEntryReversal(60, '1.0000', 50, '5')?.toFixed(4)).toBe('1.0000'); // 60×1 − 50×5 < 0
  });

  it('sem custo médio atual não inventa um: devolve null', () => {
    expect(averageAfterEntryReversal(10, null, 5, '3')).toBeNull();
  });
});

describe('unitCostOf (custo gravado na baixa de entrega)', () => {
  it('usa o custo médio; sem ele, o último custo; sem nenhum, nada', () => {
    expect(unitCostOf({ averageCost: D('3.5'), lastCost: D('4') })).toBe(3.5);
    expect(unitCostOf({ averageCost: null, lastCost: D('4') })).toBe(4);
    expect(unitCostOf({ averageCost: null, lastCost: null })).toBeUndefined();
  });
});

describe('StockService.updateAverageCost', () => {
  const MAT = 'mat-1';
  function build(opts: { onHand?: number | null; averageCost?: string | null; lastCost?: string | null; previousReceipt?: string | null } = {}) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: MAT }]),
      material: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ averageCost: opts.averageCost == null ? null : D(opts.averageCost), lastCost: opts.lastCost == null ? null : D(opts.lastCost) }),
        update: vi.fn().mockResolvedValue({}),
      },
      stockBalance: { aggregate: vi.fn().mockResolvedValue({ _sum: { quantity: opts.onHand == null ? null : D(opts.onHand) } }) },
      stockMovement: { findFirst: vi.fn().mockResolvedValue(opts.previousReceipt == null ? null : { unitCost: D(opts.previousReceipt) }) },
    };
    const service = new StockService({} as never, {} as never);
    const run = (qty: number | string, cost: number | string, reversal = false, reverses?: string) => service.updateAverageCost(tx as never, MAT, D(qty), D(cost), reversal, reverses);
    return { tx, run };
  }
  const written = (tx: ReturnType<typeof build>['tx']) => tx.material.update.mock.calls[0][0].data as { averageCost?: Prisma.Decimal; lastCost?: Prisma.Decimal | null };

  it('entrada sobre saldo zero: média e último custo passam a ser o custo da entrada', async () => {
    const { tx, run } = build({ onHand: null, averageCost: '5', lastCost: '5' });
    await run(10, '8.25');
    expect(written(tx).averageCost?.toFixed(4)).toBe('8.2500');
    expect(written(tx).lastCost?.toFixed(4)).toBe('8.2500');
  });

  it('entrada sobre saldo existente: média ponderada pelo saldo próprio e último custo atualizado', async () => {
    const { tx, run } = build({ onHand: 100, averageCost: '10', lastCost: '9.5' });
    await run(50, '16');
    expect(written(tx).averageCost?.toFixed(4)).toBe('12.0000');
    expect(written(tx).lastCost?.toFixed(4)).toBe('16.0000');
    expect(tx.stockBalance.aggregate).toHaveBeenCalledWith({ where: { materialId: MAT, ownership: 'PROPRIO' }, _sum: { quantity: true } });
  });

  it('trava a linha do material antes de ler o saldo (entradas simultâneas não pesam sobre o mesmo saldo)', async () => {
    const { tx, run } = build({ onHand: 1, averageCost: '1' });
    await run(1, '1');
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.stockBalance.aggregate.mock.invocationCallOrder[0]);
  });

  it('material só com último custo (carga do catálogo): usa o último custo como base da média', async () => {
    const { tx, run } = build({ onHand: 10, averageCost: null, lastCost: '4' });
    await run(10, '6');
    expect(written(tx).averageCost?.toFixed(4)).toBe('5.0000');
  });

  it('estorno da entrada: volta a média anterior e o último custo do recebimento anterior', async () => {
    // depois da entrada de 50 a 16 sobre 100 a 10: saldo 150, média 12
    const { tx, run } = build({ onHand: 150, averageCost: '12', lastCost: '16', previousReceipt: '9.5' });
    await run(50, '16', true, 'mov-entrada');
    expect(written(tx).averageCost?.toFixed(4)).toBe('10.0000');
    expect(written(tx).lastCost?.toFixed(4)).toBe('9.5000');
    // o recebimento anterior é procurado entre os não estornados, sem contar o próprio estornado
    expect(tx.stockMovement.findFirst.mock.calls[0][0].where).toMatchObject({ materialId: MAT, type: 'ENTRADA_RECEBIMENTO', reversesMovementId: null, reversedBy: { is: null }, id: { not: 'mov-entrada' } });
  });

  it('estorno sem recebimento anterior: o último custo fica como estava', async () => {
    const { tx, run } = build({ onHand: 60, averageCost: '5', lastCost: '5', previousReceipt: null });
    await run(10, '5', true, 'mov-1');
    expect(written(tx).lastCost?.toFixed(4)).toBe('5.0000');
    expect(written(tx).averageCost?.toFixed(4)).toBe('5.0000');
  });

  it('estorno que zera o saldo mantém a média e não a recalcula', async () => {
    const { tx, run } = build({ onHand: 10, averageCost: '7', lastCost: '7', previousReceipt: '6' });
    await run(10, '7', true, 'mov-1');
    expect(written(tx).averageCost?.toFixed(4)).toBe('7.0000');
    expect(written(tx).lastCost?.toFixed(4)).toBe('6.0000');
  });
});
