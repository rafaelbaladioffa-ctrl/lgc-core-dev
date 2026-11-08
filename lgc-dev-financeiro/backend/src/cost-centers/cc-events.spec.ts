import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { handleCcEvent } from './cc-events.js';

/** Banco em memória com o pedaço do Prisma que os eventos usam. */
function fakeTx() {
  const entries: Array<Record<string, any>> = [];
  const purchases = new Map<string, Record<string, any>>();
  const allocations: Array<Record<string, any>> = [];
  const advances = new Map<string, Record<string, any>>();
  const matches = (e: Record<string, any>, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'reversedBy') return !entries.some((x) => x.reversesId === e.id);
      if (v === null) return e[k] === null || e[k] === undefined;
      return e[k] === v;
    });
  const tx = {
    ccEntry: {
      findFirst: async ({ where }: any) => entries.find((e) => matches(e, where)) ?? null,
      findMany: async ({ where }: any) => entries.filter((e) => matches(e, where)),
      create: async ({ data }: any) => {
        const row = { id: randomUUID(), reversesId: null, sourceRef: null, ...data, amount: new Prisma.Decimal(data.amount) };
        entries.push(row);
        return row;
      },
    },
    ccPurchase: {
      findUnique: async ({ where }: any) => purchases.get(where.requestAxisId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const cur = purchases.get(where.requestAxisId);
        const row = cur ? { ...cur, ...update } : { ...create };
        purchases.set(where.requestAxisId, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = { ...purchases.get(where.requestAxisId), ...data };
        purchases.set(where.requestAxisId, row);
        return row;
      },
      create: async ({ data }: any) => {
        purchases.set(data.requestAxisId, data);
        return data;
      },
    },
    ccAllocation: {
      findMany: async ({ where }: any) => allocations.filter((a) => a.collaboratorAxisId === where.collaboratorAxisId && a.validTo === null),
      delete: async ({ where }: any) => allocations.splice(allocations.findIndex((a) => a.id === where.id), 1),
      update: async ({ where, data }: any) => Object.assign(allocations.find((a) => a.id === where.id)!, data),
      create: async ({ data }: any) => allocations.push({ id: randomUUID(), validTo: null, ...data }),
    },
    ccAdvance: {
      upsert: async ({ where, create }: any) => {
        if (!advances.has(where.requestAxisId)) advances.set(where.requestAxisId, create);
        return advances.get(where.requestAxisId);
      },
    },
  };
  const net = (stage: string) => entries.filter((e) => e.stage === stage).reduce((s, e) => s.plus(e.amount), new Prisma.Decimal(0)).toFixed(2);
  return { tx: tx as unknown as Prisma.TransactionClient, entries, purchases, allocations, advances, net };
}

const CC = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const approved = {
  request_id: REQ,
  code: 'REQ-0001',
  cost_center_id: CC,
  project_id: 'p-1',
  approved_at: '2026-03-10T15:00:00.000Z',
  total: '1500.00',
  groups: [
    { group_id: 'g1', supplier: 'Fornecedor A', total: '1000.00', items: [] },
    { group_id: 'g2', supplier: 'Fornecedor B', total: '400.00', items: [] },
    { group_id: 'g3', supplier: 'Estoque', total: '100.00', items: [] },
  ],
};
const at = '2026-03-10T15:00:00.000Z';

describe('compras no centro de custo', () => {
  it('aprovação compromete por fornecedor e ignora o grupo do estoque', async () => {
    const db = fakeTx();
    await handleCcEvent(db.tx, 'purchase.approved', randomUUID(), at, approved);
    expect(db.entries).toHaveLength(2);
    expect(db.net('comprometido')).toBe('1400.00');
    expect(db.purchases.get(REQ)!.status).toBe('aprovada');
    // Reentrega do mesmo evento não duplica.
    await handleCcEvent(db.tx, 'purchase.approved', randomUUID(), at, approved);
    expect(db.entries).toHaveLength(2);
  });

  it('pedido avança o funil; recebimento baixa o comprometido na competência original e realiza', async () => {
    const db = fakeTx();
    await handleCcEvent(db.tx, 'purchase.approved', randomUUID(), at, approved);
    // Pedido sem código e sem projeto não apaga o que veio na aprovação.
    await handleCcEvent(db.tx, 'purchase.order_registered', randomUUID(), at, { request_id: REQ, cost_center_id: CC, ordered_at: '2026-03-12T10:00:00Z', groups: approved.groups });
    expect(db.purchases.get(REQ)!).toMatchObject({ status: 'pedido', code: 'REQ-0001', projectAxisId: 'p-1' });

    await handleCcEvent(db.tx, 'purchase.delivery_received', randomUUID(), at, {
      request_id: REQ,
      cost_center_id: CC,
      received_at: '2026-04-02T13:00:00Z',
      all_received: false,
      groups: [{ group_id: 'g1', supplier: 'Fornecedor A', total: '1000.00' }],
    });
    expect(db.net('comprometido')).toBe('400.00');
    expect(db.net('realizado')).toBe('1000.00');
    const release = db.entries.find((e) => e.reversesId);
    expect(release!.competence.toISOString().slice(0, 10)).toBe('2026-03-10');
    expect(db.entries.find((e) => e.stage === 'realizado')!.competence.toISOString().slice(0, 10)).toBe('2026-04-02');
    expect(db.purchases.get(REQ)!.status).toBe('recebida_parcial');
    expect(db.entries.find((e) => e.stage === 'realizado')).toMatchObject({ projectAxisId: 'p-1', description: 'Compra REQ-0001 — Fornecedor A (recebida)' });

    // Mesmo recebimento reentregue: nada muda.
    await handleCcEvent(db.tx, 'purchase.delivery_received', randomUUID(), at, { request_id: REQ, cost_center_id: CC, received_at: '2026-04-02T13:00:00Z', groups: [{ group_id: 'g1', total: '1000.00' }] });
    expect(db.net('realizado')).toBe('1000.00');
  });

  it('cancelamento baixa o que ainda está comprometido', async () => {
    const db = fakeTx();
    await handleCcEvent(db.tx, 'purchase.approved', randomUUID(), at, approved);
    await handleCcEvent(db.tx, 'purchase.cancelled', randomUUID(), at, { request_id: REQ, cost_center_id: CC, cancelled_at: '2026-03-20T10:00:00Z' });
    expect(db.net('comprometido')).toBe('0.00');
    expect(db.purchases.get(REQ)!.status).toBe('cancelada');
  });
});

describe('reembolso, adiantamento e alocação', () => {
  it('reembolso realiza despesa de campo; adiantamento fica comprometido e em aberto', async () => {
    const db = fakeTx();
    const base = { cost_center_id: CC, collaborator_id: '33333333-3333-4333-8333-333333333333', project_id: null, approved_at: at };
    await handleCcEvent(db.tx, 'finance_request.approved', randomUUID(), at, { ...base, request_id: REQ, code: 'R-1', kind: 'reembolso', amount: '80.50' });
    await handleCcEvent(db.tx, 'finance_request.approved', randomUUID(), at, { ...base, request_id: '44444444-4444-4444-8444-444444444444', code: 'A-1', kind: 'adiantamento', amount: '500' });
    expect(db.net('realizado')).toBe('80.50');
    expect(db.net('comprometido')).toBe('500.00');
    expect(db.entries.every((e) => e.category === 'despesas_campo')).toBe(true);
    expect(db.advances.size).toBe(1);
    expect(await handleCcEvent(db.tx, 'finance_request.approved', randomUUID(), at, { ...base, request_id: REQ, kind: 'outro', amount: '1' })).toBe('ignored');
  });

  it('troca de CC fecha a vigência e abre outra; desligamento só fecha', async () => {
    const db = fakeTx();
    const c = '55555555-5555-4555-8555-555555555555';
    await handleCcEvent(db.tx, 'collaborator.cost_center_changed', randomUUID(), at, { collaborator_id: c, cost_center_id: 'cc-a', valid_from: '2026-01-05' });
    await handleCcEvent(db.tx, 'collaborator.cost_center_changed', randomUUID(), at, { collaborator_id: c, cost_center_id: 'cc-b', valid_from: '2026-03-01' });
    await handleCcEvent(db.tx, 'collaborator.cost_center_changed', randomUUID(), at, { collaborator_id: c, cost_center_id: null, valid_from: '2026-06-01' });
    expect(db.allocations.map((a) => [a.costCenterAxisId, a.validFrom.toISOString().slice(0, 10), a.validTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      ['cc-a', '2026-01-05', '2026-03-01'],
      ['cc-b', '2026-03-01', '2026-06-01'],
    ]);
  });

  it('evento sem CC é recusado', async () => {
    const db = fakeTx();
    await expect(handleCcEvent(db.tx, 'purchase.approved', randomUUID(), at, { ...approved, cost_center_id: undefined })).rejects.toThrow('cost_center_id');
  });
});
