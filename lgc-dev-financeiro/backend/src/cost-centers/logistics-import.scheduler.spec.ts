import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxService } from '../integration/outbox.service.js';
import type { CcContext } from './cc-context.js';
import { CostCentersService } from './cost-centers.service.js';
import type { LogisticsClient } from './logistics.client.js';
import { LogisticsImportScheduler, scheduledMonths } from './logistics-import.scheduler.js';

/** Importação diária do consumo da Logística (PT-07): mês corrente e anterior, idempotente por competência e por (CC, projeto). */

type Row = Record<string, any>;
type Consumption = Record<string, Array<{ cost_center_id: string | null; project_id: string | null; value: string; movements: number }>>;
const CC1 = '11111111-1111-4111-8111-111111111111';
const CC2 = '22222222-2222-4222-8222-222222222222';
const P1 = '33333333-3333-4333-8333-333333333333';

function fixture(consumption: Consumption) {
  const entries: Row[] = [];
  const reversed = () => new Set(entries.filter((e) => e.reversesId).map((e) => e.reversesId));
  const tx = {
    ccEntry: {
      findMany: async ({ where }: Row) => {
        const done = reversed();
        return entries.filter((e) => (e.sourceRef ?? '').startsWith(where.sourceRef.startsWith) && !e.reversesId && !done.has(e.id));
      },
      create: async ({ data }: Row) => entries.push({ id: randomUUID(), reversesId: null, sourceRef: null, ...data, amount: new Prisma.Decimal(data.amount) }),
      groupBy: async () => [],
    },
    ccBudget: { aggregate: async () => ({ _sum: { amount: null } }) },
    ccSetting: { findUnique: async () => null, upsert: async () => ({}) },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaService;
  const logistics = { consumption: vi.fn(async (month: string) => consumption[month] ?? []) } as unknown as LogisticsClient & { consumption: ReturnType<typeof vi.fn> };
  const outbox = { record: vi.fn().mockResolvedValue({}) } as unknown as OutboxService;
  const service = new CostCentersService(prisma, {} as CcContext, outbox, logistics);
  const config = { get: (k: string) => (k === 'SCHEDULER_ENABLED' ? 'true' : undefined) } as unknown as ConfigService;
  const scheduler = new LogisticsImportScheduler(service, config);
  const live = () => {
    const done = reversed();
    return entries.filter((e) => !e.reversesId && !done.has(e.id));
  };
  return { scheduler, service, logistics, entries, live, tx };
}

describe('competências da rotina diária', () => {
  it('mês anterior e corrente, inclusive na virada do ano', () => {
    expect(scheduledMonths('2026-11-08')).toEqual(['2026-10', '2026-11']);
    expect(scheduledMonths('2027-01-02')).toEqual(['2026-12', '2027-01']);
  });
});

describe('importação diária do consumo da Logística', () => {
  const novemberOf = (): Consumption['x'] => [
    { cost_center_id: CC1, project_id: P1, value: '1000.00', movements: 4 },
    { cost_center_id: CC1, project_id: P1, value: '250.50', movements: 1 }, // mesma chave: soma
    { cost_center_id: CC2, project_id: null, value: '80.00', movements: 1 },
    { cost_center_id: null, project_id: null, value: '999.00', movements: 9 }, // sem CC: contado e ignorado
  ];
  const consumptionOf = (): Consumption => ({ '2026-10': [{ cost_center_id: CC1, project_id: P1, value: '300.00', movements: 2 }], '2026-11': novemberOf() });

  it('importa o mês anterior e o corrente por (CC, projeto), realizado/material, ator do sistema', async () => {
    const f = fixture(consumptionOf());
    const out = await f.scheduler.runOnce('2026-11-08');
    expect(out).toEqual([
      { month: '2026-10', created: 1, replaced: 0, unchanged: 0, withoutCostCenter: 0 },
      { month: '2026-11', created: 2, replaced: 0, unchanged: 0, withoutCostCenter: 1 },
    ]);
    expect(f.live().map((e) => [e.sourceRef, e.amount.toFixed(2)]).sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      [`logistica:2026-10:${CC1}:${P1}`, '300.00'],
      [`logistica:2026-11:${CC1}:${P1}`, '1250.50'],
      [`logistica:2026-11:${CC2}:-`, '80.00'],
    ]);
    for (const e of f.entries) expect(e).toMatchObject({ kind: 'custo', category: 'material', stage: 'realizado', source: 'logistica', createdBy: 'sistema:logistica' });
    expect(f.entries.find((e) => e.sourceRef === `logistica:2026-11:${CC1}:${P1}`)!.competence.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(f.tx.$executeRaw).toHaveBeenCalledTimes(2); // trava por competência
  });

  it('rodar de novo sem mudança não lança nada; valor que mudou é estornado e lançado de novo', async () => {
    const consumption = consumptionOf();
    const f = fixture(consumption);
    await f.scheduler.runOnce('2026-11-08');
    const before = f.entries.length;

    const again = await f.scheduler.runOnce('2026-11-09');
    expect(again).toEqual([
      { month: '2026-10', created: 0, replaced: 0, unchanged: 1, withoutCostCenter: 0 },
      { month: '2026-11', created: 0, replaced: 0, unchanged: 2, withoutCostCenter: 1 },
    ]);
    expect(f.entries).toHaveLength(before);

    consumption['2026-11'][2] = { cost_center_id: CC2, project_id: null, value: '95.00', movements: 2 };
    const changed = await f.scheduler.runOnce('2026-11-10');
    expect(changed[1]).toMatchObject({ created: 0, replaced: 1, unchanged: 1 });
    expect(f.live().find((e) => e.sourceRef === `logistica:2026-11:${CC2}:-`)!.amount.toFixed(2)).toBe('95.00');
    expect(f.entries).toHaveLength(before + 2); // estorno + novo; nada é apagado
  });

  it('o botão manual e a rotina compartilham a regra: depois da rotina, importar o mesmo mês não muda nada', async () => {
    const f = fixture({ '2026-11': novemberOf() });
    await f.scheduler.runOnce('2026-11-08');
    const manual = await f.service.importLogistics({ userId: 'u1' } as never, '2026-11');
    expect(manual).toMatchObject({ created: 0, replaced: 0, unchanged: 2 });
  });

  it('Logística fora do ar não derruba a rotina: o mês com falha vira erro no resultado e o outro segue', async () => {
    const f = fixture({ '2026-11': novemberOf() });
    f.logistics.consumption.mockImplementation(async (month: string) => {
      if (month === '2026-10') throw new Error('A Logística não respondeu. Tente de novo em instantes.');
      return novemberOf();
    });
    const out = await f.scheduler.runOnce('2026-11-08');
    expect(out[0]).toEqual({ month: '2026-10', error: 'A Logística não respondeu. Tente de novo em instantes.' });
    expect(out[1]).toMatchObject({ month: '2026-11', created: 2 });
  });

  it('só roda agendada com SCHEDULER_ENABLED=true', async () => {
    const f = fixture(consumptionOf());
    const off = new LogisticsImportScheduler(f.service, { get: () => 'false' } as unknown as ConfigService);
    await off.scheduled();
    expect(f.logistics.consumption).not.toHaveBeenCalled();
    await f.scheduler.scheduled();
    expect(f.logistics.consumption).toHaveBeenCalledTimes(2);
  });
});
