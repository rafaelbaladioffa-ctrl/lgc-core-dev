import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestsService } from './requests.service.js';

/** Cotação por item, envio explícito para aprovação e decisão do responsável do centro de custo,
 * com Prisma simulado e estado mutável (as transições precisam encadear). */

const REQUESTER = 'col-solicitante';
const PROCUREMENT = 'col-suprimentos';
const APPROVER = 'col-responsavel-cc';
const ROLES = ['analista_suprimentos'];

const purchaseItems = [
  { materialId: 'm1', item: 'Cabo UTP', quantity: 3, unitPrice: 1 },
  { materialId: 'm2', item: 'Conector', quantity: 2, unitPrice: 1 },
  { materialId: 'm3', item: 'Fita', quantity: 1, unitPrice: 1 },
];
const analysis = {
  items: [
    { materialId: 'm1', stockStatus: 'indisponivel', availableQuantity: 0, needsQuotation: true },
    { materialId: 'm2', stockStatus: 'indisponivel', availableQuantity: 0, needsQuotation: true },
    { materialId: 'm3', stockStatus: 'disponivel', availableQuantity: 1, needsQuotation: false },
  ],
};

function setup(overrides: { status?: string; formData?: Record<string, unknown>; responsible?: string | null; kind?: string } = {}) {
  const state: Record<string, any> = {
    id: 'req-1',
    code: 'REQ-000001',
    executionMode: 'legacy',
    status: overrides.status ?? 'em_atendimento',
    requesterId: REQUESTER,
    beneficiaryId: REQUESTER,
    sectorId: 'setor',
    costCenterId: 'cc-1',
    categoryVersionId: 'cv-1',
    estimatedValue: null,
    formData: overrides.formData ?? { purchaseItems, procurementAnalysis: analysis },
  };
  const approvals: Array<Record<string, any>> = [];
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...state, approvals: approvals.map((a) => ({ ...a })) })),
      update: vi.fn().mockImplementation(({ data }) => {
        Object.assign(state, data);
        return Promise.resolve({ ...state });
      }),
    },
    categoryVersion: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'cv-1', slaFirstResponseMinutes: 60, slaResolutionMinutes: 120, category: { kind: overrides.kind ?? 'compra_material' } }),
    },
    costCenter: { findUnique: vi.fn().mockResolvedValue({ responsibleCollaboratorId: overrides.responsible === undefined ? APPROVER : overrides.responsible }) },
    requestAttachment: { findMany: vi.fn().mockResolvedValue([]) },
    requestApproval: {
      create: vi.fn().mockImplementation(({ data }) => {
        approvals.push({ id: `ap-${approvals.length + 1}`, status: 'pendente', ...data });
        return Promise.resolve(approvals[approvals.length - 1]);
      }),
      update: vi.fn().mockImplementation(({ where, data }) => {
        Object.assign(approvals.find((a) => a.id === where.id)!, data);
        return Promise.resolve({});
      }),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        for (const a of approvals) if (a.status === where.status && (where.stepOrder === undefined || a.stepOrder === where.stepOrder)) Object.assign(a, data);
        return Promise.resolve({ count: 1 });
      }),
    },
    requestComment: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
    holiday: { findMany: vi.fn().mockResolvedValue([]) },
    slaClock: { createMany: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn() };
  const delegations = { findActiveDelegate: vi.fn().mockResolvedValue(null) };
  const service = new RequestsService(prisma, outbox as any, delegations as any, {} as any, {} as any);
  const audits = () => prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event);
  const quote = (supplier: string, items: Array<[string, string]>, extra: Record<string, unknown> = {}) =>
    service.recordPurchaseQuotation('req-1', PROCUREMENT, { supplier, items: items.map(([materialId, unitPrice]) => ({ materialId, unitPrice })), ...extra } as any, ROLES);
  return { state, approvals, prisma, outbox, service, audits, quote };
}

describe('registrar cotação por item', () => {
  it('registra duas cotações sem mudar o status nem criar aprovação', async () => {
    const { state, approvals, prisma, quote, audits } = setup();
    await quote('Forn A', [['m1', '2.50'], ['m2', '1.00']]);
    await quote('Forn B', [['m1', '2.40']]);
    expect(state.formData.procurementQuotations).toHaveLength(2);
    expect(state.status).toBe('em_atendimento');
    expect(approvals).toHaveLength(0);
    expect(prisma.requestApproval.create).not.toHaveBeenCalled();
    expect(audits()).toEqual(['request.purchase_quotation_recorded', 'request.purchase_quotation_recorded']);
  });

  it('calcula o total em Decimal (3 x 0,10 = 0,30 exato) e normaliza o preço', async () => {
    const { state, quote } = setup();
    await quote('Forn A', [['m1', '0.10']]);
    const [q] = state.formData.procurementQuotations;
    expect(q.totalValue).toBe('0.30');
    expect(q.items).toEqual([{ materialId: 'm1', unitPrice: '0.1000' }]);
    expect(q.quotationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(q.selected).toBeUndefined();
  });

  it('editar mantém recordedAt, grava updatedAt e recalcula', async () => {
    const { state, quote } = setup();
    await quote('Forn A', [['m1', '1.00']]);
    const first = state.formData.procurementQuotations[0];
    await quote('Forn A2', [['m1', '2.00'], ['m2', '1.00']], { quotationId: first.quotationId });
    expect(state.formData.procurementQuotations).toHaveLength(1);
    const edited = state.formData.procurementQuotations[0];
    expect(edited.recordedAt).toBe(first.recordedAt);
    expect(edited.updatedAt).toBeDefined();
    expect(edited.supplier).toBe('Forn A2');
    expect(edited.totalValue).toBe('8.00');
  });

  it.each([
    ['item fora da requisição', [['x9', '1.00']]],
    ['item duplicado', [['m1', '1.00'], ['m1', '2.00']]],
    ['item que não precisa de cotação', [['m3', '1.00']]],
    ['preço zero', [['m1', '0']]],
    ['mais de 4 casas', [['m1', '1.23456']]],
  ])('recusa %s', async (_name, items) => {
    const { prisma, quote } = setup();
    await expect(quote('Forn A', items as Array<[string, string]>)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('recusa anexo de outra requisição', async () => {
    const { quote } = setup();
    await expect(quote('Forn A', [['m1', '1.00']], { attachmentIds: ['a1'] })).rejects.toThrow('anexo');
  });

  it('fora de em_atendimento não registra', async () => {
    const { quote } = setup({ status: 'aguardando_aprovacao' });
    await expect(quote('Forn A', [['m1', '1.00']])).rejects.toBeInstanceOf(BadRequestException);
  });

  it('só o Suprimentos e nunca o solicitante', async () => {
    const { service } = setup();
    const dto = { supplier: 'F', items: [{ materialId: 'm1', unitPrice: '1' }] } as any;
    await expect(service.recordPurchaseQuotation('req-1', PROCUREMENT, dto, ['gestor'])).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.recordPurchaseQuotation('req-1', REQUESTER, dto, ROLES)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cotação no formato antigo (sem items) continua listada e não pode ser editada', async () => {
    const legacy = [{ quotationId: 'legacy-1', supplier: 'Velho', totalValue: '10.00', selected: true }];
    const { state, quote } = setup({ formData: { purchaseItems, procurementAnalysis: analysis, procurementQuotations: legacy } });
    await expect(quote('Velho', [['m1', '1.00']], { quotationId: 'legacy-1' })).rejects.toThrow('formato antigo');
    await quote('Novo', [['m1', '1.00']]);
    expect(state.formData.procurementQuotations).toHaveLength(2);
  });
});

describe('excluir cotação', () => {
  it('exclui em em_atendimento e audita', async () => {
    const { state, quote, service, audits } = setup();
    await quote('Forn A', [['m1', '1.00']]);
    const id = state.formData.procurementQuotations[0].quotationId;
    await service.deletePurchaseQuotation('req-1', PROCUREMENT, id, ROLES);
    expect(state.formData.procurementQuotations).toEqual([]);
    expect(audits()).toContain('request.purchase_quotation_deleted');
  });

  it('fora de em_atendimento responde 400', async () => {
    const { prisma, service } = setup({ status: 'aguardando_aprovacao', formData: { purchaseItems, procurementAnalysis: analysis, procurementQuotations: [{ quotationId: 'q1', items: [] }] } });
    await expect(service.deletePurchaseQuotation('req-1', PROCUREMENT, 'q1', ROLES)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });
});

describe('enviar para aprovação', () => {
  it('sem cobertura de todos os itens que precisam de cotação responde 400', async () => {
    const { state, approvals, quote, service } = setup();
    await quote('Forn A', [['m1', '1.00']]);
    await expect(service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES)).rejects.toThrow('Conector');
    expect(state.status).toBe('em_atendimento');
    expect(approvals).toHaveLength(0);
  });

  it('cotação sem items (antiga) não conta para a cobertura', async () => {
    const legacy = [{ quotationId: 'legacy-1', supplier: 'Velho', totalValue: '10.00' }];
    const { service } = setup({ formData: { purchaseItems, procurementAnalysis: analysis, procurementQuotations: legacy } });
    await expect(service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('centro de custo sem responsável responde 400', async () => {
    const { quote, service } = setup({ responsible: null });
    await quote('Forn A', [['m1', '1.00'], ['m2', '1.00']]);
    await expect(service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES)).rejects.toThrow('responsável');
  });

  it('responsável igual ao solicitante responde 400', async () => {
    const { quote, service } = setup({ responsible: REQUESTER });
    await quote('Forn A', [['m1', '1.00'], ['m2', '1.00']]);
    await expect(service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES)).rejects.toThrow('próprio solicitante');
  });

  it('com cobertura cria a aprovação, muda o status e emite outbox', async () => {
    const { state, approvals, outbox, prisma, quote, service, audits } = setup();
    await quote('Forn A', [['m1', '1.00'], ['m2', '1.00']]);
    const updated = await service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES);
    expect(updated.status).toBe('aguardando_aprovacao');
    expect(state.status).toBe('aguardando_aprovacao');
    expect(approvals).toEqual([expect.objectContaining({ approverId: APPROVER, approvalSource: 'centro_custo', status: 'pendente' })]);
    expect(audits()).toContain('request.purchase_submitted_for_approval');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'request.status_changed', expect.objectContaining({ status: 'aguardando_aprovacao' }));
  });
});

describe('decisão de compra', () => {
  async function awaitingApproval() {
    const f = setup();
    await f.quote('Forn A', [['m1', '2.50'], ['m2', '10.00']]);
    await f.quote('Forn B', [['m1', '2.00']]);
    await f.quote('Forn C', [['m2', '9.00']]);
    await f.service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES);
    const [qa, qb, qc] = f.state.formData.procurementQuotations.map((q: any) => q.quotationId);
    return { ...f, qa, qb, qc };
  }

  it('aprovar com seleção mista grava procurementSelection, valor estimado e finaliza', async () => {
    const { state, approvals, outbox, prisma, service, qb, qc } = await awaitingApproval();
    const updated = await service.decidePurchase('req-1', APPROVER, {
      decision: 'aprovar',
      selections: [{ materialId: 'm1', quotationId: qb }, { materialId: 'm2', quotationId: qc }],
    });
    expect(updated.status).toBe('aprovada');
    expect(state.estimatedValue).toBe('24.00'); // 3 x 2,00 + 2 x 9,00
    expect(state.formData.procurementSelection).toEqual([
      { materialId: 'm1', quotationId: qb, supplier: 'Forn B', unitPrice: '2.0000', quantity: 3, total: '6.00' },
      { materialId: 'm2', quotationId: qc, supplier: 'Forn C', unitPrice: '9.0000', quantity: 2, total: '18.00' },
    ]);
    expect(approvals[0].status).toBe('aprovado');
    expect(prisma.slaClock.createMany).toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'request.status_changed', { request_id: 'req-1', status: 'aprovada' });
  });

  it('seleção incompleta responde 400 e não grava', async () => {
    const { state, service, qb } = await awaitingApproval();
    await expect(service.decidePurchase('req-1', APPROVER, { decision: 'aprovar', selections: [{ materialId: 'm1', quotationId: qb }] })).rejects.toBeInstanceOf(BadRequestException);
    expect(state.status).toBe('aguardando_aprovacao');
    expect(state.formData.procurementSelection).toBeUndefined();
  });

  it('cotação que não cobre o item responde 400', async () => {
    const { service, qb } = await awaitingApproval();
    await expect(
      service.decidePurchase('req-1', APPROVER, { decision: 'aprovar', selections: [{ materialId: 'm1', quotationId: qb }, { materialId: 'm2', quotationId: qb }] }),
    ).rejects.toThrow('não cobre');
  });

  it('reprovar exige motivo e reprova a requisição', async () => {
    const { state, approvals, outbox, service, prisma } = await awaitingApproval();
    await expect(service.decidePurchase('req-1', APPROVER, { decision: 'reprovar', reason: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    const updated = await service.decidePurchase('req-1', APPROVER, { decision: 'reprovar', reason: 'Preço acima do orçamento' });
    expect(updated.status).toBe('reprovada');
    expect(state.status).toBe('reprovada');
    expect(approvals[0].status).toBe('reprovado');
    expect(prisma.requestComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ visibility: 'publico', body: expect.stringContaining('Preço acima do orçamento') }) });
    expect(outbox.record).toHaveBeenCalled();
  });

  it('devolver ao Suprimentos volta a em_atendimento e o novo envio cria nova aprovação', async () => {
    const { state, approvals, service, prisma, quote, audits } = await awaitingApproval();
    await expect(service.decidePurchase('req-1', APPROVER, { decision: 'devolver_suprimentos' })).rejects.toBeInstanceOf(BadRequestException);
    const updated = await service.decidePurchase('req-1', APPROVER, { decision: 'devolver_suprimentos', reason: 'Cotar mais um fornecedor' });
    expect(updated.status).toBe('em_atendimento');
    expect(approvals[0].status).toBe('devolvido');
    expect(prisma.requestComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ body: 'Devolvida ao Suprimentos: Cotar mais um fornecedor' }) });
    expect(audits()).toContain('request.purchase_returned_to_procurement');
    await quote('Forn D', [['m1', '1.00']]);
    await service.submitPurchaseForApproval('req-1', PROCUREMENT, ROLES);
    expect(state.status).toBe('aguardando_aprovacao');
    expect(approvals).toHaveLength(2);
    expect(approvals[1].status).toBe('pendente');
  });

  it('quem não é aprovador recebe 403', async () => {
    const { service, qb, qc } = await awaitingApproval();
    await expect(
      service.decidePurchase('req-1', 'col-intruso', { decision: 'aprovar', selections: [{ materialId: 'm1', quotationId: qb }, { materialId: 'm2', quotationId: qc }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegado ativo decide em nome do responsável', async () => {
    const f = await awaitingApproval();
    f.service['delegations'].findActiveDelegate = vi.fn().mockResolvedValue({ id: 'd1' });
    const updated = await f.service.decidePurchase('req-1', 'col-delegado', { decision: 'devolver_suprimentos', reason: 'Mais cotações' });
    expect(updated.status).toBe('em_atendimento');
  });

  it('só decide em aguardando_aprovacao', async () => {
    const { service } = setup();
    await expect(service.decidePurchase('req-1', APPROVER, { decision: 'reprovar', reason: 'Qualquer motivo' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('approve e reject genéricos em compra respondem 400', async () => {
    const { service } = await awaitingApproval();
    await expect(service.approve('req-1', APPROVER, {})).rejects.toThrow('Use a decisão de compra.');
    await expect(service.reject('req-1', APPROVER, { comment: 'não' })).rejects.toThrow('Use a decisão de compra.');
  });
});
