import { describe, expect, it, vi } from 'vitest';
import { RequestsService } from './requests.service.js';

/** `finance_request.approved` (reembolso e adiantamento) na aprovação final, com Prisma simulado
 * (docs/integracao-centros-de-custo.md §3). */

const REQUESTER = 'col-solicitante';
const BENEFICIARY = 'col-favorecido';
const APPROVER = 'col-gestor';

function setup(opts: { code?: string; formData?: Record<string, unknown>; estimatedValue?: string | null; steps?: number } = {}) {
  const approvals = Array.from({ length: opts.steps ?? 1 }, (_, i) => ({ id: `ap-${i + 1}`, stepOrder: i + 1, status: 'pendente', approverId: APPROVER, completionRule: 'todos', requiredCount: null, approvalSource: 'hierarquia' }));
  const state: Record<string, any> = {
    id: 'req-1',
    code: 'REQ-000010',
    executionMode: 'legacy',
    status: 'aguardando_aprovacao',
    requesterId: REQUESTER,
    beneficiaryId: BENEFICIARY,
    sectorId: 'setor-fin',
    costCenterId: 'cc-1',
    projectId: 'proj-1',
    categoryVersionId: 'cv-1',
    estimatedValue: opts.estimatedValue ?? null,
    formData: opts.formData ?? { tipo_despesa: 'Viagem', valor: 350.5 },
  };
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...state, approvals: approvals.map((a) => ({ ...a })) })),
      findUniqueOrThrow: vi.fn().mockImplementation(() => Promise.resolve({ ...state })),
      update: vi.fn().mockImplementation(({ data }) => {
        Object.assign(state, data);
        return Promise.resolve({ ...state });
      }),
    },
    categoryVersion: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'cv-1',
        slaFirstResponseMinutes: 60,
        slaResolutionMinutes: 120,
        category: { kind: 'padrao', code: opts.code ?? 'FIN-REEMBOLSO' },
      }),
    },
    requestApproval: {
      update: vi.fn().mockImplementation(({ where, data }) => {
        Object.assign(approvals.find((a) => a.id === where.id)!, data);
        return Promise.resolve({});
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    auditEvent: { create: vi.fn() },
    holiday: { findMany: vi.fn().mockResolvedValue([]) },
    slaClock: { createMany: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn() };
  const delegations = { findActiveDelegate: vi.fn().mockResolvedValue(null) };
  const service = new RequestsService(prisma, outbox as any, delegations as any, {} as any, {} as any);
  const financeEvents = () => outbox.record.mock.calls.filter((c: any[]) => c[1] === 'finance_request.approved').map((c: any[]) => c[2]);
  return { state, prisma, outbox, service, financeEvents };
}

describe('finance_request.approved', () => {
  it('reembolso aprovado emite o evento com favorecido, CC, projeto e valor com 2 casas', async () => {
    const { service, state, financeEvents, outbox, prisma } = setup();
    await service.approve('req-1', APPROVER, {});
    expect(state.status).toBe('aprovada');
    expect(financeEvents()).toEqual([
      {
        request_id: 'req-1',
        code: 'REQ-000010',
        kind: 'reembolso',
        collaborator_id: BENEFICIARY,
        cost_center_id: 'cc-1',
        project_id: 'proj-1',
        amount: '350.50',
        approved_at: expect.any(String),
      },
    ]);
    expect(outbox.record.mock.calls.find((c: any[]) => c[1] === 'finance_request.approved')![0]).toBe(prisma);
  });

  it('adiantamento com valor digitado em formato brasileiro', async () => {
    const { service, financeEvents } = setup({ code: 'FIN-ADIANTAMENTO', formData: { finalidade: 'Viagem a campo', valor: '1.234,56' } });
    await service.approve('req-1', APPROVER, {});
    expect(financeEvents()).toEqual([expect.objectContaining({ kind: 'adiantamento', amount: '1234.56' })]);
  });

  it('sem valor no formulário usa o valor estimado; sem nenhum, não emite', async () => {
    const withEstimate = setup({ formData: {}, estimatedValue: '99.9' });
    await withEstimate.service.approve('req-1', APPROVER, {});
    expect(withEstimate.financeEvents()).toEqual([expect.objectContaining({ amount: '99.90' })]);

    const without = setup({ formData: {} });
    await without.service.approve('req-1', APPROVER, {});
    expect(without.state.status).toBe('aprovada');
    expect(without.financeEvents()).toEqual([]);
  });

  it('só na aprovação final: etapa intermediária não emite', async () => {
    const { service, state, financeEvents } = setup({ steps: 2 });
    await service.approve('req-1', APPROVER, {});
    expect(state.status).toBe('aguardando_aprovacao');
    expect(financeEvents()).toEqual([]);
  });

  it('outras categorias não emitem', async () => {
    const { service, financeEvents } = setup({ code: 'TI-EQUIPAMENTO' });
    await service.approve('req-1', APPROVER, {});
    expect(financeEvents()).toEqual([]);
  });
});
