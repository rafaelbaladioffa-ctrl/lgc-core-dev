import { Prisma } from '@prisma/client';
import { yearConsumption } from './cc-budget-status.js';

/** O comprometido da revisão ganha (origem `projeto`, PT-07) não mexe no orçamento anual do CC. */

describe('consumo do orçamento do CC', () => {
  it('ignora os lançamentos de origem projeto e soma só o realizado e o comprometido operacional', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { stage: 'realizado', _sum: { amount: new Prisma.Decimal('300.00') } },
      { stage: 'comprometido', _sum: { amount: new Prisma.Decimal('100.00') } },
    ]);
    const tx = { ccBudget: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: new Prisma.Decimal('1000.00') } }) }, ccEntry: { groupBy } };
    const c = await yearConsumption(tx as never, 'cc1', 2026);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: 'custo', source: { not: 'projeto' } }) }));
    expect(c.consumed.toFixed(2)).toBe('400.00');
    expect(c.percent).toBe('0.4000');
    expect(c.status).toBe('ok');
  });
});
