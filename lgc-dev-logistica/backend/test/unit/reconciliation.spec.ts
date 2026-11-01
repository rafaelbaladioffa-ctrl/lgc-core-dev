import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service.js';

// Lógica de reconciliação com Prisma mockado: criação, atualização (dedupe), fechamento automático e resolução.
// Os SQLs de detecção (saldo × ledger, reservado × reservas) são exercitados de verdade no e2e (sprint10-edge).

const dec = (v: string) => ({ toString: () => v });

function build(opts: { raw?: unknown[][]; open?: Array<Record<string, unknown>>; orphans?: unknown[]; orders?: unknown[]; moves?: unknown[]; dlq?: unknown[]; issue?: Record<string, unknown> | null } = {}) {
  const raw = [...(opts.raw ?? [[], []])];
  const prisma = {
    $queryRaw: vi.fn(async () => raw.shift() ?? []),
    reservation: { findMany: vi.fn(async () => opts.orphans ?? []) },
    fulfillmentOrder: { findMany: vi.fn(async () => opts.orders ?? []) },
    stockMovement: { findMany: vi.fn(async () => opts.moves ?? []) },
    integrationMessage: { findMany: vi.fn(async () => opts.dlq ?? []) },
    reconciliationIssue: {
      findMany: vi.fn(async () => opts.open ?? []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'new', ...data })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...data })),
      findUnique: vi.fn(async () => opts.issue ?? null),
    },
  };
  // run() serializa a gravação numa transação com lock advisory: o mock reaproveita o próprio objeto como `tx`.
  Object.assign(prisma, { $executeRaw: vi.fn(async () => 1), $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(prisma)) });
  const audit = { record: vi.fn(async () => ({})) };
  return { svc: new ReconciliationService(prisma as never, audit as never), prisma, audit };
}

const ledgerRow = { ref: 'bal-1', material_id: 'mat-1', location_id: 'loc-1', condition: 'BOM', balance: dec('5'), ledger: dec('3') };
const driftRow = { id: 'bal-2', material_id: 'mat-2', reserved: dec('4'), expected: dec('1') };
const orphanRes = { id: 'res-1', quantity: dec('2'), item: { order: { status: 'CANCELADA' } } };

describe('ReconciliationService (unit)', () => {
  it('cria um item ABERTA para cada tipo de divergência encontrada, com dedupeKey "tipo:ref"', async () => {
    const b = build({
      raw: [[ledgerRow], [driftRow]],
      orphans: [orphanRes],
      orders: [{ id: 'ord-1', seq: 7 }],
      moves: [],
      dlq: [{ id: 'msg-1', eventType: 'stock.moved', attempts: 5, lastError: 'HTTP 500' }],
    });
    const r = await b.svc.run('tester');
    expect(r).toEqual({ found: 5, created: 5, refreshed: 0, closed: 0, truncated: [] });
    const kinds = b.prisma.reconciliationIssue.create.mock.calls.map((c) => (c[0] as { data: { kind: string; dedupeKey: string; severity: string } }).data);
    expect(kinds.map((k) => [k.kind, k.dedupeKey, k.severity])).toEqual([
      ['BALANCE_VS_LEDGER', 'BALANCE_VS_LEDGER:bal-1', 'CRITICO'],
      ['RESERVED_DRIFT', 'RESERVED_DRIFT:bal-2', 'ATENCAO'],
      ['ORPHAN_RESERVATION', 'ORPHAN_RESERVATION:res-1', 'ATENCAO'],
      ['DELIVERED_WITHOUT_LEDGER', 'DELIVERED_WITHOUT_LEDGER:ord-1', 'CRITICO'],
      ['OUTBOX_DEAD_LETTER', 'OUTBOX_DEAD_LETTER:msg-1', 'CRITICO'],
    ]);
  });

  it('guarda os valores da divergência em details (como texto, sem perder precisão)', async () => {
    const b = build({ raw: [[ledgerRow], []] });
    await b.svc.run('tester');
    const data = (b.prisma.reconciliationIssue.create.mock.calls[0][0] as { data: { details: Record<string, string> } }).data;
    expect(data.details).toEqual({ materialId: 'mat-1', locationId: 'loc-1', condition: 'BOM', balance: '5', ledger: '3' });
  });

  it('DELIVERED_WITHOUT_LEDGER não é criado quando a entrega já tem saída no ledger', async () => {
    const b = build({ orders: [{ id: 'ord-1', seq: 1 }], moves: [{ correlationId: 'ord-1' }] });
    const r = await b.svc.run('tester');
    expect(r.found).toBe(0);
    expect(b.prisma.stockMovement.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ type: 'SAIDA_ENTREGA' }) }));
  });

  it('sem entregas no período não consulta o ledger de saídas', async () => {
    const b = build({ orders: [] });
    await b.svc.run('tester');
    expect(b.prisma.stockMovement.findMany).not.toHaveBeenCalled();
  });

  it('segunda execução com a mesma divergência atualiza (refreshed), não duplica (created = 0)', async () => {
    const existing = { id: 'iss-1', dedupeKey: 'BALANCE_VS_LEDGER:bal-1', status: 'ABERTA' };
    const b = build({ raw: [[ledgerRow], []], open: [existing] });
    const r = await b.svc.run('sistema');
    expect(r).toEqual({ found: 1, created: 0, refreshed: 1, closed: 0, truncated: [] });
    expect(b.prisma.reconciliationIssue.create).not.toHaveBeenCalled();
    expect(b.prisma.reconciliationIssue.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'iss-1' } }));
  });

  it('quando a divergência some, o item aberto é encerrado pelo sistema, sem tocar nos dados', async () => {
    const stale = { id: 'iss-9', dedupeKey: 'RESERVED_DRIFT:bal-2', status: 'ABERTA' };
    const b = build({ open: [stale] });
    const r = await b.svc.run('sistema');
    expect(r).toEqual({ found: 0, created: 0, refreshed: 0, closed: 1, truncated: [] });
    expect(b.prisma.reconciliationIssue.update).toHaveBeenCalledWith({
      where: { id: 'iss-9' },
      data: expect.objectContaining({ status: 'RESOLVIDA', resolvedBy: 'sistema', resolution: expect.stringContaining('não detectada') }),
    });
    expect(b.prisma.$queryRaw).toHaveBeenCalledTimes(2); // só leitura: nenhuma alteração em saldo ou ledger
  });

  it('cada execução registra "reconciliation.run" na auditoria com os totais', async () => {
    const b = build({ raw: [[ledgerRow], []] });
    await b.svc.run('maria');
    expect(b.audit.record).toHaveBeenCalledWith('maria', 'reconciliation.run', 'reconciliation', 'run', { found: 1, created: 1, refreshed: 0, closed: 0, truncated: [] });
  });

  describe('resolução manual', () => {
    it('resolve item ABERTA, registra quem e como, e audita', async () => {
      const b = build({ issue: { id: 'iss-1', kind: 'RESERVED_DRIFT', status: 'ABERTA' } });
      const out = await b.svc.resolve('iss-1', 'Ajustado após conferência', 'joao');
      expect(out).toMatchObject({ status: 'RESOLVIDA', resolvedBy: 'joao', resolution: 'Ajustado após conferência' });
      expect(b.audit.record).toHaveBeenCalledWith('joao', 'reconciliation.resolved', 'reconciliation_issue', 'iss-1', { kind: 'RESERVED_DRIFT', resolution: 'Ajustado após conferência' });
    });

    it('item inexistente é 404 e não audita', async () => {
      const b = build({ issue: null });
      await expect(b.svc.resolve('x', 'motivo', 'joao')).rejects.toBeInstanceOf(NotFoundException);
      expect(b.audit.record).not.toHaveBeenCalled();
    });

    it('item já resolvido é 409 e não altera nem audita de novo', async () => {
      const b = build({ issue: { id: 'iss-1', kind: 'X', status: 'RESOLVIDA' } });
      await expect(b.svc.resolve('iss-1', 'motivo', 'joao')).rejects.toBeInstanceOf(ConflictException);
      expect(b.prisma.reconciliationIssue.update).not.toHaveBeenCalled();
      expect(b.audit.record).not.toHaveBeenCalled();
    });
  });
});
