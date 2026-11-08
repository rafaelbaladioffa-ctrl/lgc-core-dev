import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OutboxService } from '../../integration/outbox.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import type { BudgetsService } from '../budgets.service.js';
import { BidService } from './bid.service.js';
import { CORE_QUOTE_EVENT } from './core-quote.js';

vi.mock('./bid-fill.js', () => ({
  fillBid: vi.fn(async () => ({ content: Buffer.from('PK bid fictícia'), filename: '2030-01-15_BID_X_v2.xlsm', writes: [{ sheet: 'Summary', ref: 'B12', value: 'LGC' }] })),
}));

/** Aprovar o envio no aws_sow (PJ7). Serviços vizinhos simulados. */

const GESTOR: AuthenticatedUser = { userId: 'g', email: 'gestor@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget:approve'] };

function fixture({ model = 'aws_sow', blockers = [] as string[] } = {}) {
  const rev = {
    id: 'r2',
    number: 2,
    budget: { model, axisProjectId: 'p1', projectCode: 'PROP-1', title: null, plannedStartDate: null, plannedEndDate: null },
    parameterSet: { hoursPerDay: '8' },
    inputs: {},
    result: { workDays: 6, vehicleDays: 0, revenue: { travel: '0', platform: '0' }, materials: [], labor: [{ roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 3, hours: '144', billingRate: '80' }] },
    sow: { source: 'core_pdf', sowDocumentId: 'doc-sow' },
  };
  const tx = { revisionBidOutput: { create: vi.fn().mockResolvedValue({}) } };
  const prisma = {
    budgetRevision: { findUnique: vi.fn().mockResolvedValue({ status: 'em_aprovacao', budget: { model } }) },
    revisionBidTemplate: { findUnique: vi.fn().mockResolvedValue({ content: Buffer.from('PK modelo') }) },
    budgetMaterial: { findMany: vi.fn().mockResolvedValue([]) },
    bidProfileEntry: {
      findMany: vi.fn().mockResolvedValue([{ kind: 'header', key: 'vendor', value: { vendorName: 'LGC', pocName: 'Contato', pocEmail: 'c@lgc.test', leadTimeDays: 0 } }, { kind: 'cable', key: '2F LC-LC', value: { code: 'CAB-1' } }]),
    },
  } as unknown as PrismaService;
  const outbox = { record: vi.fn().mockResolvedValue({}) } as unknown as OutboxService & { record: ReturnType<typeof vi.fn> };
  const quote = {
    perType: [{ type: '2F LC-LC', quantity: 10, meters: 300, hoursT: 144 }],
    kpis: [],
    bidValues: { start: '2030-02-01', end: '2030-02-08' },
  };
  const budgets = {
    loadRevisionFull: vi.fn().mockResolvedValue(rev),
    projectInfoOrNull: vi.fn().mockResolvedValue(null),
    awsInfo: vi.fn().mockReturnValue({ quote: blockers.length ? null : quote, blockers }),
    header: vi.fn().mockReturnValue({ schedule: { start: { value: '2030-02-01' }, end: { value: '2030-02-08' } } }),
    transition: vi.fn(async (_id: string, _a: string, _u: unknown, _r: unknown, hook?: (t: unknown, at: Date) => Promise<unknown>) => {
      if (hook) await hook(tx, new Date('2030-01-15T13:00:00Z'));
      return { id: 'r2' };
    }),
  } as unknown as BudgetsService & { transition: ReturnType<typeof vi.fn> };
  return { service: new BidService(prisma, { record: vi.fn() } as unknown as AuditService, outbox, budgets), tx, outbox, budgets };
}

describe('BidService.approveSend', () => {
  it('gera a Bid antes e, na transação da aprovação, grava a Bid e a cotação no outbox', async () => {
    const { service, tx, outbox, budgets } = fixture();
    await service.approveSend('r2', GESTOR);
    expect(budgets.transition).toHaveBeenCalledWith('r2', 'approve_send', GESTOR, null, expect.any(Function));
    expect(tx.revisionBidOutput.create.mock.calls[0][0].data).toMatchObject({ revisionId: 'r2', filename: '2030-01-15_BID_X_v2.xlsm', generatedBy: 'g' });
    expect(tx.revisionBidOutput.create.mock.calls[0][0].data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outbox.record).toHaveBeenCalledWith(tx, CORE_QUOTE_EVENT, {
      axis_project_id: 'p1',
      revision_id: 'r2',
      quote: expect.objectContaining({ external_revision_id: 'r2', revision_number: 2, sow_document_id: 'doc-sow', work_days: 6, approved_by_email: 'gestor@lgc.test', approved_at: '2030-01-15T13:00:00.000Z' }),
    });
  });

  it('com pendência, não aprova e explica', async () => {
    const { service, budgets } = fixture({ blockers: ['Importe o Bid Template do cliente.'] });
    await expect(service.approveSend('r2', GESTOR)).rejects.toThrow(BadRequestException);
    expect(budgets.transition).not.toHaveBeenCalled();
  });

  it('modelo genérico segue a aprovação normal, sem Bid', async () => {
    const { service, budgets, outbox } = fixture({ model: 'generico' });
    await service.approveSend('r2', GESTOR);
    expect(budgets.transition).toHaveBeenCalledWith('r2', 'approve_send', GESTOR);
    expect(outbox.record).not.toHaveBeenCalled();
  });
});
