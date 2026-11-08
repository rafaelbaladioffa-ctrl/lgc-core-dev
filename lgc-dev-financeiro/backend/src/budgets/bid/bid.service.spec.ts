import { BadGatewayException, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { OutboxService } from '../../integration/outbox.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import type { BudgetsService } from '../budgets.service.js';
import type { LogisticsClient } from '../../cost-centers/logistics.client.js';
import { BidService, resolveClientRef, uniqueByCode } from './bid.service.js';
import { CORE_QUOTE_EVENT } from './core-quote.js';

vi.mock('./bid-fill.js', () => ({
  fillBid: vi.fn(async () => ({ content: Buffer.from('PK bid fictícia'), filename: '2030-01-15_BID_X_v2.xlsm', writes: [{ sheet: 'Summary', ref: 'B12', value: 'LGC' }] })),
}));

/** Aprovar o envio no aws_sow (PJ7). Serviços vizinhos simulados. */

const GESTOR: AuthenticatedUser = { userId: 'g', email: 'gestor@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget:approve'] };

const LINKED = [{ description: 'Cabo óptico 12F', unit: 'm', quantity: '1200', logisticsMaterialCode: 'RED-CAB-0123' }];

function fixture({ model = 'aws_sow', blockers = [] as string[], materials = LINKED as unknown[], missing = [] as string[] | Error } = {}) {
  const rev = {
    id: 'r2',
    number: 2,
    budget: { model, axisProjectId: 'p1', projectCode: 'PROP-1', title: null, plannedStartDate: null, plannedEndDate: null },
    parameterSet: { hoursPerDay: '8' },
    inputs: {},
    result: { workDays: 6, vehicleDays: 0, revenue: { travel: '0', platform: '0' }, materials, labor: [{ roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 3, hours: '144', billingRate: '80' }] },
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
    holidays: vi.fn().mockResolvedValue(null),
    header: vi.fn().mockReturnValue({ schedule: { start: { value: '2030-02-01' }, end: { value: '2030-02-08' } } }),
    transition: vi.fn(async (_id: string, _a: string, _u: unknown, _r: unknown, hook?: (t: unknown, at: Date) => Promise<unknown>) => {
      if (hook) await hook(tx, new Date('2030-01-15T13:00:00Z'));
      return { id: 'r2' };
    }),
  } as unknown as BudgetsService & { transition: ReturnType<typeof vi.fn> };
  // F4: a Logística reconfere os códigos na aprovação; `missing` simula os que não voltaram (ou a Logística fora do ar).
  const logistics = { missingCodes: vi.fn(async () => (missing instanceof Error ? Promise.reject(missing) : missing)) } as unknown as LogisticsClient & { missingCodes: ReturnType<typeof vi.fn> };
  const service = new BidService(prisma, { record: vi.fn() } as unknown as AuditService, outbox, budgets, logistics);
  // O modelo do teste é fictício: as linhas do Bid Template (para sugestões e referências) vêm simuladas.
  vi.spyOn(service as unknown as { allTemplateLines: () => Promise<unknown[]> }, 'allTemplateLines').mockResolvedValue([]);
  return { service, tx, outbox, budgets, logistics };
}

describe('BidService.approveSend', () => {
  it('gera a Bid antes e, na transação da aprovação, grava a Bid e a cotação no outbox', async () => {
    // Sem material: o vínculo do material com a linha do Bid Template tem testes próprios (bid-plan.spec.ts).
    const { service, tx, outbox, budgets } = fixture({ materials: [] });
    await service.approveSend('r2', GESTOR);
    expect(budgets.transition).toHaveBeenCalledWith('r2', 'approve_send', GESTOR, null, expect.any(Function));
    expect(tx.revisionBidOutput.create.mock.calls[0][0].data).toMatchObject({ revisionId: 'r2', filename: '2030-01-15_BID_X_v2.xlsm', generatedBy: 'g' });
    expect(tx.revisionBidOutput.create.mock.calls[0][0].data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outbox.record).toHaveBeenCalledWith(tx, CORE_QUOTE_EVENT, {
      axis_project_id: 'p1',
      revision_id: 'r2',
      has_bid: true,
      quote: expect.objectContaining({
        external_revision_id: 'r2',
        revision_number: 2,
        sow_document_id: 'doc-sow',
        work_days: 6,
        approved_by_email: 'gestor@lgc.test',
        approved_at: '2030-01-15T13:00:00.000Z',
        materials: [],
      }),
    });
  });

  it('material sem código da Logística: recusa antes de gerar a Bid, com o item na mensagem', async () => {
    const { service, budgets, tx } = fixture({ materials: [{ description: 'Conector LC', unit: 'un', quantity: '40', logisticsMaterialCode: null }] });
    await expect(service.approveSend('r2', GESTOR)).rejects.toThrow(/Conector LC/);
    expect(budgets.transition).not.toHaveBeenCalled();
    expect(tx.revisionBidOutput.create).not.toHaveBeenCalled();
  });

  it('com pendência, não aprova e explica', async () => {
    const { service, budgets } = fixture({ blockers: ['Importe o Bid Template do cliente.'] });
    await expect(service.approveSend('r2', GESTOR)).rejects.toThrow(BadRequestException);
    expect(budgets.transition).not.toHaveBeenCalled();
  });

  it('modelo genérico devolve a cotação ao Core como o aws_sow, sem Bid', async () => {
    const { service, budgets, outbox, tx } = fixture({ model: 'generico' });
    await service.approveSend('r2', GESTOR);
    expect(budgets.transition).toHaveBeenCalledWith('r2', 'approve_send', GESTOR, null, expect.any(Function));
    expect(tx.revisionBidOutput.create).not.toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledWith(tx, CORE_QUOTE_EVENT, {
      axis_project_id: 'p1',
      revision_id: 'r2',
      has_bid: false,
      quote: expect.objectContaining({ external_revision_id: 'r2', work_days: 6, materials: [expect.objectContaining({ material_code: 'RED-CAB-0123', quantity: '1200.000' })] }),
    });
    expect(JSON.stringify(outbox.record.mock.calls[0][2])).not.toMatch(/sow_document_id/);
  });

  it('reconfere os códigos na Logística: código inexistente ou inativo bloqueia com a lista (F4)', async () => {
    const materials = [...LINKED, { description: 'Conector LC', unit: 'un', quantity: '40', logisticsMaterialCode: 'RED-CON-0001' }];
    const { service, budgets, logistics, outbox } = fixture({ model: 'generico', materials, missing: ['RED-CON-0001'] });
    await expect(service.approveSend('r2', GESTOR)).rejects.toThrow(/o código RED-CON-0001 não existe ou está inativo no catálogo da Logística/);
    expect(logistics.missingCodes).toHaveBeenCalledWith(['RED-CAB-0123', 'RED-CON-0001']);
    expect(budgets.transition).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
    // aws_sow passa pela mesma conferência depois do plano da Bid (o plano tem testes próprios).
    const aws = fixture({ materials: LINKED, missing: ['RED-CAB-0123'] });
    await expect(aws.service.assertMaterialsInLogistics({ materials: LINKED } as never)).rejects.toThrow(BadRequestException);
    const dois = fixture({ model: 'generico', materials, missing: ['RED-CAB-0123', 'RED-CON-0001'] });
    await expect(dois.service.approveSend('r2', GESTOR)).rejects.toThrow('os códigos RED-CAB-0123, RED-CON-0001 não existem ou estão inativos');
  });

  it('Logística fora do ar ou sem configuração: não envia material sem conferir (F4)', async () => {
    const fora = fixture({ model: 'generico', missing: new BadGatewayException('A Logística não respondeu. Tente de novo em instantes.') });
    await expect(fora.service.approveSend('r2', GESTOR)).rejects.toThrow(ServiceUnavailableException);
    await expect(fora.service.approveSend('r2', GESTOR)).rejects.toThrow('Não dá para aprovar o envio sem conferir os materiais na Logística. A Logística não respondeu.');
    expect(fora.budgets.transition).not.toHaveBeenCalled();
    const semMaterial = fixture({ model: 'generico', materials: [], missing: new Error('não deveria consultar') });
    await semMaterial.service.approveSend('r2', GESTOR);
    expect(semMaterial.logistics.missingCodes).not.toHaveBeenCalled();
  });

  it('modelo genérico também recusa material sem código e revisão sem equipe', async () => {
    const semCodigo = fixture({ model: 'generico', materials: [{ description: 'Eletroduto', unit: 'm', quantity: '10', logisticsMaterialCode: null }] });
    await expect(semCodigo.service.approveSend('r2', GESTOR)).rejects.toThrow(/Eletroduto/);
    expect(semCodigo.budgets.transition).not.toHaveBeenCalled();
    const semEquipe = fixture({ model: 'generico' });
    (semEquipe.budgets.loadRevisionFull as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'r2',
      number: 2,
      budget: { model: 'generico', axisProjectId: 'p1' },
      result: { workDays: 6, materials: [], labor: [] },
    });
    await expect(semEquipe.service.approveSend('r2', GESTOR)).rejects.toThrow(BadRequestException);
    expect(semEquipe.budgets.transition).not.toHaveBeenCalled();
  });
});

describe('uniqueByCode', () => {
  it('código repetido fica uma vez, na linha que já tem fornecedor (a mesma que o preenchimento usa)', () => {
    const line = (row: number, code: string, supplier: string | null) => ({ row, code, supplier, description: '', category: 'Fiber', subcategory: '', free: false });
    expect(uniqueByCode([line(112, 'A', 'CommScope'), line(113, 'B', 'Select'), line(114, 'B', 'AFL'), line(115, 'C', null)]).map((l) => l.row)).toEqual([112, 114, 115]);
  });
});

describe('resolveClientRef', () => {
  const rows = new Map([[348, 'free_cable_management'], [379, 'free_cleaners'], [508, 'T-H-S']]);

  it('aceita o código da coluna C ou o número da linha, como a LGC anota no catálogo', () => {
    expect(resolveClientRef('free_cleaners', rows)).toEqual({ code: 'free_cleaners', error: null });
    expect(resolveClientRef('Bid linha 379', rows)).toEqual({ code: 'free_cleaners', error: null });
    expect(resolveClientRef('linha 348', rows).code).toBe('free_cable_management');
    expect(resolveClientRef('379', rows).code).toBe('free_cleaners');
    expect(resolveClientRef('  ', rows)).toEqual({ code: null, error: null });
  });

  it('linha sem item ou texto que não é referência explicam o problema', () => {
    expect(resolveClientRef('Bid linha 999', rows).error).toContain('linha 999 do Bid Template deste RFQ, que não tem item');
    expect(resolveClientRef('ver planilha', rows).error).toContain('não é um código nem um número de linha');
  });
});
