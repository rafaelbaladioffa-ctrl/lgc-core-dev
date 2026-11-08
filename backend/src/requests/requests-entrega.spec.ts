import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { RequestsService } from './requests.service.js';

/** Pós-aprovação da compra: pedido ao fornecedor com previsão (Suprimentos) e confirmação de
 * recebimento (solicitante), com Prisma simulado e estado mutável. */

const REQUESTER = 'col-solicitante';
const PROCUREMENT = 'col-suprimentos';
const ROLES = ['analista_suprimentos'];

const purchaseItems = [
  { materialId: 'm1', item: 'Cabo UTP', quantity: 3, unitPrice: 1 },
  { materialId: 'm2', item: 'Conector', quantity: 2, unitPrice: 1 },
  { materialId: 'm3', item: 'Fita', quantity: 1, unitPrice: 1 },
  { materialId: 'm4', item: 'Patch panel', quantity: 1, unitPrice: 1 },
];
const procurementSelection = [
  { materialId: 'm1', quotationId: 'q-a', supplier: 'Forn A', unitPrice: '2.0000', quantity: 3, total: '6.00' },
  { materialId: 'm2', quotationId: 'q-a', supplier: 'Forn A', unitPrice: '1.0000', quantity: 2, total: '2.00' },
  { materialId: 'm3', quotationId: 'q-b', supplier: 'Forn B', unitPrice: '1.0000', quantity: 1, total: '1.00' },
];
// m4 não está na seleção: atendido pelo estoque.

const dates = (groupId: string, extra: Record<string, unknown> = {}) => ({ groupId, orderDate: '2026-11-10', expectedDeliveryDate: '2026-11-20', ...extra });
const fullOrder = () => ({ deliveries: [dates('q-a', { orderNumber: 'PC-1' }), dates('q-b'), dates('estoque')] });

function setup(overrides: { status?: string; kind?: string; formData?: Record<string, unknown>; clocks?: Array<Record<string, any>> } = {}) {
  const state: Record<string, any> = {
    id: 'req-1',
    code: 'REQ-000001',
    executionMode: 'legacy',
    status: overrides.status ?? 'aprovada',
    requesterId: REQUESTER,
    beneficiaryId: REQUESTER,
    assigneeId: PROCUREMENT,
    categoryVersionId: 'cv-1',
    closedAt: null,
    completedAt: null,
    requesterAcceptedAt: null,
    formData: overrides.formData ?? { purchaseItems, procurementSelection },
  };
  const clocks = overrides.clocks ?? [
    { id: 'c1', metric: 'primeira_resposta', stoppedAt: null, targetAt: new Date(Date.now() + 3_600_000) },
    { id: 'c2', metric: 'solucao', stoppedAt: null, targetAt: new Date(Date.now() - 3_600_000) },
  ];
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...state })),
      update: vi.fn().mockImplementation(({ data }) => {
        Object.assign(state, data);
        return Promise.resolve({ ...state });
      }),
    },
    categoryVersion: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'cv-1', category: { kind: overrides.kind ?? 'compra_material' } }) },
    collaborator: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Fulano' }) },
    slaClock: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockImplementation(() => Promise.resolve(clocks.filter((c) => c.stoppedAt === null))),
      update: vi.fn().mockImplementation(({ where, data }) => {
        Object.assign(clocks.find((c) => c.id === where.id)!, data);
        return Promise.resolve({});
      }),
    },
    requestComment: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn() };
  const service = new RequestsService(prisma, outbox as any, {} as any, {} as any, {} as any);
  const audits = () => prisma.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event);
  const comments = () => prisma.requestComment.create.mock.calls.map((c: any[]) => c[0].data.body);
  const order = (dto: any = fullOrder(), actor = PROCUREMENT, roles = ROLES) => service.registerPurchaseOrder('req-1', actor, dto, roles);
  return { state, clocks, prisma, outbox, service, audits, comments, order };
}

describe('start e complete em compra', () => {
  it('start responde 400', async () => {
    const { service, prisma } = setup();
    await expect(service.start('req-1', PROCUREMENT, ROLES)).rejects.toThrow('Na compra, registre o pedido ao fornecedor.');
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('complete responde 400', async () => {
    const { service, prisma } = setup({ status: 'em_atendimento' });
    await expect(service.complete('req-1', PROCUREMENT, { resolution: 'x' } as any, ROLES)).rejects.toThrow('Na compra, a conclusão é a confirmação de recebimento pelo solicitante.');
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('categoria que não é compra continua com start (regressão)', async () => {
    const { service } = setup({ kind: 'padrao' });
    expect((await service.start('req-1', PROCUREMENT, ROLES)).status).toBe('em_atendimento');
  });

  it('categoria que não é compra continua com complete (regressão)', async () => {
    const { service, prisma } = setup({ kind: 'padrao', status: 'em_atendimento' });
    prisma.requestRelation = { findMany: vi.fn().mockResolvedValue([]) };
    expect((await service.complete('req-1', PROCUREMENT, { resolution: 'ok' } as any, ROLES)).status).toBe('concluida');
  });
});

describe('purchase-order — primeira vez', () => {
  it('cria um grupo por fornecedor e o grupo Estoque, muda o status, para os relógios e emite outbox', async () => {
    const { state, clocks, outbox, order, audits, comments } = setup();
    await order();
    expect(state.status).toBe('aguardando_entrega');
    const deliveries = state.formData.procurementDeliveries;
    expect(deliveries.map((d: any) => [d.groupId, d.supplier])).toEqual([['q-a', 'Forn A'], ['q-b', 'Forn B'], ['estoque', 'Estoque']]);
    expect(deliveries[0].items).toEqual([
      { materialId: 'm1', item: 'Cabo UTP', quantity: 3 },
      { materialId: 'm2', item: 'Conector', quantity: 2 },
    ]);
    expect(deliveries[2].items).toEqual([{ materialId: 'm4', item: 'Patch panel', quantity: 1 }]);
    expect(deliveries[0]).toMatchObject({ orderNumber: 'PC-1', orderDate: '2026-11-10', expectedDeliveryDate: '2026-11-20', receivedAt: null, receivedBy: null });
    expect(deliveries[0].history).toHaveLength(1);
    expect(clocks.every((c) => c.stoppedAt instanceof Date)).toBe(true);
    expect(clocks.find((c) => c.id === 'c2')!.breached).toBe(true);
    expect(clocks.find((c) => c.id === 'c1')!.breached).toBe(false);
    expect(comments()).toEqual([
      'Pedido registrado: Forn A — previsão de entrega 20/11/2026',
      'Pedido registrado: Forn B — previsão de entrega 20/11/2026',
      'Pedido registrado: Estoque — previsão de entrega 20/11/2026',
    ]);
    expect(audits()).toEqual(['request.purchase_order_registered']);
    expect(outbox.record).toHaveBeenCalledWith(expect.anything(), 'request.status_changed', expect.objectContaining({ status: 'aguardando_entrega' }));
  });

  it('agrupa cotações distintas do mesmo fornecedor em um único grupo', async () => {
    const selection = [
      { materialId: 'm1', quotationId: 'q-a', supplier: 'Forn A', unitPrice: '2.0000', quantity: 3, total: '6.00' },
      { materialId: 'm2', quotationId: 'q-a2', supplier: ' forn a ', unitPrice: '1.0000', quantity: 2, total: '2.00' },
    ];
    const { state, order } = setup({ formData: { purchaseItems: purchaseItems.slice(0, 2), procurementSelection: selection } });
    await order({ deliveries: [dates('q-a')] });
    expect(state.formData.procurementDeliveries).toHaveLength(1);
    expect(state.formData.procurementDeliveries[0].items).toHaveLength(2);
  });

  it('cobertura incompleta responde 400 e não grava', async () => {
    const { prisma, order } = setup();
    await expect(order({ deliveries: [dates('q-a'), dates('q-b')] })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('grupo desconhecido ou repetido responde 400', async () => {
    const a = setup();
    await expect(a.order({ deliveries: [...fullOrder().deliveries, dates('outro')] })).rejects.toBeInstanceOf(BadRequestException);
    const b = setup();
    await expect(b.order({ deliveries: [...fullOrder().deliveries, dates('q-a')] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('previsão anterior à data do pedido responde 400', async () => {
    const { prisma, order } = setup();
    const dto = fullOrder();
    dto.deliveries[1] = dates('q-b', { expectedDeliveryDate: '2026-11-09' });
    await expect(order(dto)).rejects.toThrow('A previsão de entrega não pode ser anterior à data do pedido.');
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('data inválida responde 400', async () => {
    const { order } = setup();
    const dto = fullOrder();
    dto.deliveries[0] = dates('q-a', { orderDate: '2026-02-31' });
    await expect(order(dto)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('quem não é do Suprimentos recebe 403', async () => {
    const { prisma, order } = setup();
    await expect(order(fullOrder(), 'col-gestor', ['gestor'])).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('o solicitante nunca registra o pedido, mesmo com papel de Suprimentos', async () => {
    const { order } = setup();
    await expect(order(fullOrder(), REQUESTER, ROLES)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('compra aprovada que já está em_atendimento (com procurementSelection) aceita o pedido', async () => {
    const { state, order } = setup({ status: 'em_atendimento' });
    await order();
    expect(state.status).toBe('aguardando_entrega');
    expect(state.formData.procurementDeliveries).toHaveLength(3);
  });

  it('em_atendimento sem procurementSelection responde 400; categoria sem compra também', async () => {
    const a = setup({ status: 'em_atendimento', formData: { purchaseItems } });
    await expect(a.order()).rejects.toBeInstanceOf(BadRequestException);
    const b = setup({ kind: 'padrao' });
    await expect(b.order()).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('purchase-order — atualizar previsão', () => {
  async function registered() {
    const f = setup();
    await f.order();
    f.prisma.request.update.mockClear();
    f.prisma.requestComment.create.mockClear();
    f.prisma.auditEvent.create.mockClear();
    f.outbox.record.mockClear();
    return f;
  }

  it('registra histórico, comenta a nova previsão e não repete outbox', async () => {
    const { state, order, audits, comments, outbox } = await registered();
    await order({ deliveries: [dates('q-a', { expectedDeliveryDate: '2026-11-25', orderNumber: 'PC-1' })] });
    const a = state.formData.procurementDeliveries.find((d: any) => d.groupId === 'q-a');
    expect(a.expectedDeliveryDate).toBe('2026-11-25');
    expect(a.history.map((h: any) => h.expectedDeliveryDate)).toEqual(['2026-11-20', '2026-11-25']);
    expect(state.formData.procurementDeliveries.find((d: any) => d.groupId === 'q-b').history).toHaveLength(1);
    expect(state.status).toBe('aguardando_entrega');
    expect(comments()).toEqual(['Nova previsão de entrega: Forn A — 25/11/2026']);
    expect(audits()).toEqual(['request.delivery_forecast_updated']);
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('não altera grupo já recebido', async () => {
    const f = await registered();
    await f.service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a'] } as any);
    await expect(f.order({ deliveries: [dates('q-a', { expectedDeliveryDate: '2026-12-01' })] })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('confirm-receipt', () => {
  async function waiting() {
    const f = setup();
    await f.order();
    f.prisma.request.update.mockClear();
    f.prisma.requestComment.create.mockClear();
    f.prisma.auditEvent.create.mockClear();
    f.outbox.record.mockClear();
    return f;
  }

  it('terceiro (inclusive Suprimentos) recebe 403', async () => {
    const { service, prisma } = await waiting();
    await expect(service.confirmReceipt('req-1', 'col-outro', { groupIds: ['q-a'] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.confirmReceipt('req-1', PROCUREMENT, { groupIds: ['q-a'] } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.request.update).not.toHaveBeenCalled();
  });

  it('beneficiário também confirma', async () => {
    const { service, state } = await waiting();
    state.beneficiaryId = 'col-benef';
    await service.confirmReceipt('req-1', 'col-benef', { groupIds: ['q-a'] } as any);
    expect(state.formData.procurementDeliveries[0].receivedBy).toBe('col-benef');
  });

  it('recebimento parcial mantém aguardando_entrega e guarda quem/quando', async () => {
    const { service, state, outbox, audits } = await waiting();
    await service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a'] } as any);
    expect(state.status).toBe('aguardando_entrega');
    expect(state.closedAt).toBeNull();
    const a = state.formData.procurementDeliveries[0];
    expect(a.receivedBy).toBe(REQUESTER);
    expect(a.receivedByName).toBe('Fulano');
    expect(typeof a.receivedAt).toBe('string');
    expect(state.formData.procurementDeliveries[1].receivedAt).toBeNull();
    expect(audits()).toEqual(['request.partial_receipt_confirmed']);
    // Só o evento do recebimento parcial (sem request.completed/status_changed).
    expect(outbox.record.mock.calls.map((c: any[]) => c[1])).toEqual(['purchase.delivery_received']);
    expect(outbox.record.mock.calls[0][2]).toMatchObject({ all_received: false, groups: [expect.objectContaining({ group_id: 'q-a' })] });
    expect(outbox.record.mock.calls[0][2].groups).toHaveLength(1);
  });

  it('último grupo encerra a requisição e emite os eventos', async () => {
    const { service, state, outbox, audits, comments } = await waiting();
    await service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a', 'q-b'] } as any);
    expect(state.status).toBe('aguardando_entrega');
    await service.confirmReceipt('req-1', REQUESTER, { groupIds: ['estoque'], notes: ' Tudo certo ' } as any);
    expect(state.status).toBe('encerrada');
    expect(state.closedAt).toBeInstanceOf(Date);
    expect(state.completedAt).toBeInstanceOf(Date);
    expect(state.requesterAcceptedAt).toBeInstanceOf(Date);
    expect(audits()).toEqual(['request.partial_receipt_confirmed', 'request.received']);
    expect(outbox.record.mock.calls.map((c: any[]) => c[1])).toEqual(['purchase.delivery_received', 'request.completed', 'request.status_changed', 'purchase.delivery_received']);
    expect(comments()).toEqual(['Recebimento confirmado (Estoque): Tudo certo']);
  });

  it('grupo já recebido ou desconhecido responde 400', async () => {
    const { service } = await waiting();
    await service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a'] } as any);
    await expect(service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a'] } as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.confirmReceipt('req-1', REQUESTER, { groupIds: ['zzz'] } as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('em outro status responde 400', async () => {
    const { service } = setup({ status: 'aprovada' });
    await expect(service.confirmReceipt('req-1', REQUESTER, { groupIds: ['q-a'] } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('eventos purchase.* para o Financeiro', () => {
  it('primeiro pedido emite purchase.order_registered com grupos, preços e dados do pedido', async () => {
    const { state, outbox, order } = setup();
    state.costCenterId = 'cc-1';
    state.projectId = 'proj-1';
    await order();
    const call = outbox.record.mock.calls.find((c: any[]) => c[1] === 'purchase.order_registered')!;
    const payload = call[2];
    expect(payload).toMatchObject({ request_id: 'req-1', code: 'REQ-000001', cost_center_id: 'cc-1', project_id: 'proj-1', requester_id: REQUESTER, total: '9.00' });
    expect(typeof payload.ordered_at).toBe('string');
    expect(payload.approved_at).toBeUndefined();
    expect(payload.groups).toEqual([
      {
        group_id: 'q-a', supplier: 'Forn A', total: '8.00', order_number: 'PC-1', order_date: '2026-11-10', expected_delivery_date: '2026-11-20',
        items: [
          { material_id: 'm1', description: 'Cabo UTP', quantity: 3, unit_price: '2.00', total: '6.00' },
          { material_id: 'm2', description: 'Conector', quantity: 2, unit_price: '1.00', total: '2.00' },
        ],
      },
      {
        group_id: 'q-b', supplier: 'Forn B', total: '1.00', order_number: null, order_date: '2026-11-10', expected_delivery_date: '2026-11-20',
        items: [{ material_id: 'm3', description: 'Fita', quantity: 1, unit_price: '1.00', total: '1.00' }],
      },
      {
        // Estoque: consumo de material, fora do total da compra; valor unitário da requisição.
        group_id: 'estoque', supplier: 'Estoque', total: '1.00', order_number: null, order_date: '2026-11-10', expected_delivery_date: '2026-11-20',
        items: [{ material_id: 'm4', description: 'Patch panel', quantity: 1, unit_price: '1.00', total: '1.00' }],
      },
    ]);
  });

  it('atualizar a previsão não repete purchase.order_registered', async () => {
    const { outbox, order } = setup();
    await order();
    outbox.record.mockClear();
    await order({ deliveries: [dates('q-a', { expectedDeliveryDate: '2026-11-25' })] });
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('cancelar compra aprovada emite purchase.cancelled', async () => {
    const { state, outbox, service } = setup({ status: 'aguardando_entrega' });
    state.costCenterId = 'cc-1';
    await service.cancel('req-1', PROCUREMENT, true, { reason: 'Projeto suspenso' } as any, ROLES);
    expect(state.status).toBe('cancelada');
    expect(outbox.record).toHaveBeenCalledWith(expect.anything(), 'purchase.cancelled', expect.objectContaining({ request_id: 'req-1', code: 'REQ-000001', cost_center_id: 'cc-1', project_id: null }));
  });

  it('cancelar compra ainda não aprovada não emite purchase.cancelled', async () => {
    const { outbox, service } = setup({ status: 'em_atendimento', formData: { purchaseItems } });
    await service.cancel('req-1', PROCUREMENT, true, { reason: 'Desistiu' } as any, ROLES);
    expect(outbox.record.mock.calls.map((c: any[]) => c[1])).toEqual(['request.status_changed']);
  });

  it('cancelar requisição aprovada que não é compra não emite purchase.cancelled', async () => {
    const { outbox, service } = setup({ status: 'aprovada', kind: 'padrao' });
    await service.cancel('req-1', PROCUREMENT, true, { reason: 'Desistiu' } as any, []);
    expect(outbox.record.mock.calls.map((c: any[]) => c[1])).toEqual(['request.status_changed']);
  });
});

describe('reenvio após devolução', () => {
  it('descarta procurementDeliveries junto com o restante do ciclo anterior', async () => {
    const { service, state, prisma } = setup({
      status: 'devolvida_ajuste',
      formData: { purchaseItems, procurementSelection, procurementDeliveries: [{ groupId: 'q-a' }] },
    });
    prisma.categoryVersion.findUniqueOrThrow.mockResolvedValue({ id: 'cv-1', formSchema: [], category: { kind: 'compra_material' } });
    await service.submit('req-1', REQUESTER);
    expect(state.formData.procurementDeliveries).toBeUndefined();
    expect(state.formData.procurementSelection).toBeUndefined();
    expect(state.formData.purchaseItems).toHaveLength(4);
  });
});
