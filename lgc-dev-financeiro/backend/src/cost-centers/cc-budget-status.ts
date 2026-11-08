import type { Prisma } from '@prisma/client';
import { OutboxService } from '../integration/outbox.service.js';
import { D, ZERO, budgetStatus, money, type Dec } from './cc-engine.js';

/** Evento Financeiro → Core com a situação do orçamento (docs/integracao-centros-de-custo.md §4). */
export const CC_BUDGET_STATUS_EVENT = 'cost_center.budget_status';

/** Orçamento, realizado e comprometido em aberto de um CC no ano. */
export async function yearConsumption(tx: Prisma.TransactionClient, costCenterAxisId: string, year: number) {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));
  const [budget, rows] = await Promise.all([
    tx.ccBudget.aggregate({ where: { costCenterAxisId, year }, _sum: { amount: true } }),
    tx.ccEntry.groupBy({ by: ['stage'], where: { costCenterAxisId, kind: 'custo', competence: { gte: start, lt: end } }, _sum: { amount: true } }),
  ]);
  const of = (stage: string): Dec => new D(rows.find((r) => r.stage === stage)?._sum.amount ?? ZERO);
  const realized = of('realizado');
  const committed = D.max(ZERO, of('comprometido'));
  const amount = new D(budget._sum.amount ?? ZERO);
  return { budget: amount, realized, committed, consumed: realized.plus(committed), ...budgetStatus(amount, realized.plus(committed)) };
}

/**
 * Recalcula a faixa do orçamento do CC no ano e, se mudou desde o último aviso, grava o evento para o Core
 * no outbox (na mesma transação da escrita que mudou o consumo).
 */
export async function refreshBudgetStatus(tx: Prisma.TransactionClient, outbox: OutboxService, costCenterAxisId: string, year: number, force = false) {
  const c = await yearConsumption(tx, costCenterAxisId, year);
  // Para o Core, sem orçamento não restringe compra: vai como `ok`.
  const status = c.status === 'sem_orcamento' ? 'ok' : c.status;
  const percent = c.percent === null ? 0 : Math.min(999, Number(new D(c.percent).mul(100).toFixed(2)));
  const setting = await tx.ccSetting.findUnique({ where: { costCenterAxisId } });
  const changed = force || setting?.lastBudgetStatus !== status || setting?.lastBudgetYear !== year;
  if (!changed) return { ...c, notified: false };
  await tx.ccSetting.upsert({
    where: { costCenterAxisId },
    create: { costCenterAxisId, lastBudgetStatus: status, lastBudgetYear: year, lastBudgetPercent: percent },
    update: { lastBudgetStatus: status, lastBudgetYear: year, lastBudgetPercent: percent },
  });
  await outbox.record(tx, CC_BUDGET_STATUS_EVENT, {
    cost_center_id: costCenterAxisId,
    year,
    budget: money(c.budget),
    committed: money(c.committed),
    realized: money(c.realized),
    percent,
    status,
    computed_at: new Date().toISOString(),
  });
  return { ...c, notified: true };
}
