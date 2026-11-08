import { describe, expect, it, vi } from 'vitest';
import { RequestsService } from './requests.service.js';

/** `viewer.canDecideApproval` no detalhe e delegações em `myApprovals`, com Prisma simulado.
 * A delegação simulada aplica a mesma regra de `DelegationsService` (revogada, janela, setor). */

const REQUESTER = 'col-solicitante';
const OWNER = 'col-responsavel';
const DELEGATE = 'col-delegado';
const STRANGER = 'col-outro';
const NOW = Date.now();

interface Deleg { delegatorId: string; delegateId: string; sectorId: string | null; startsAt: number; endsAt: number; revokedAt: number | null }
const active = (over: Partial<Deleg> = {}): Deleg => ({ delegatorId: OWNER, delegateId: DELEGATE, sectorId: null, startsAt: NOW - 1000, endsAt: NOW + 86_400_000, revokedAt: null, ...over });

function setup(opts: { kind?: string; delegations?: Deleg[]; source?: string; status?: string } = {}) {
  const request = {
    id: 'req-1',
    code: 'REQ-000001',
    executionMode: 'legacy',
    status: opts.status ?? 'aguardando_aprovacao',
    requesterId: REQUESTER,
    beneficiaryId: REQUESTER,
    assigneeId: null,
    sectorId: 'setor-a',
    confidentiality: 'normal',
    anonymous: false,
    title: 'Compra',
    comments: [],
    attachments: [],
    approvals: [{ id: 'ap-1', requestId: 'req-1', stepOrder: 1, status: 'pendente', approverId: OWNER, approver: { id: OWNER, fullName: 'Maria Responsável' }, approvalSource: opts.source ?? 'centro_custo' }],
    requester: { id: REQUESTER, fullName: 'Solicitante' },
    categoryVersion: { category: { kind: opts.kind ?? 'compra_material' } },
  };
  const delegs = opts.delegations ?? [];
  const matches = (d: Deleg, sectorId?: string) =>
    d.revokedAt === null && d.startsAt <= Date.now() && d.endsAt >= Date.now() && (sectorId === undefined || d.sectorId === null || d.sectorId === sectorId);
  const delegations = {
    findActiveDelegate: vi.fn().mockImplementation((delegatorId: string, actingAs: string, sectorId: string) =>
      Promise.resolve(delegs.some((d) => d.delegatorId === delegatorId && d.delegateId === actingAs && matches(d, sectorId)))),
    findActiveDelegationsOf: vi.fn().mockImplementation((delegateId: string) =>
      Promise.resolve(delegs.filter((d) => d.delegateId === delegateId && matches(d)).map((d) => ({ delegatorId: d.delegatorId, sectorId: d.sectorId })))),
  };
  const prisma: any = {
    request: { findUnique: vi.fn().mockResolvedValue(request) },
    requestApproval: {
      findMany: vi.fn().mockImplementation(({ where }: any) => {
        if (where.requestId) return Promise.resolve(request.approvals.filter((a) => a.status === 'pendente'));
        const ids: string[] = where.approverId.in ?? [where.approverId];
        return Promise.resolve(request.approvals.filter((a) => ids.includes(a.approverId) && a.status === 'pendente').map((a) => ({ ...a, request })));
      }),
    },
  };
  const service = new RequestsService(prisma, { record: vi.fn() } as any, delegations as any, {} as any, {} as any);
  const view = (collaboratorId: string) => service.findOne('req-1', { collaboratorId, canViewWhistleblowerIdentity: false });
  return { service, view, request };
}

describe('viewer.canDecideApproval no detalhe', () => {
  it('true para o titular da aprovação pendente', async () => {
    const { view } = setup();
    expect((await view(OWNER)).viewer).toEqual({ canDecideApproval: true });
  });

  it('true para delegado ativo, com o nome do delegante', async () => {
    const { view } = setup({ delegations: [active()] });
    expect((await view(DELEGATE)).viewer).toEqual({ canDecideApproval: true, decidingAsDelegateOf: { id: OWNER, fullName: 'Maria Responsável' } });
  });

  it('true para delegado de setor igual ao da requisição', async () => {
    const { view } = setup({ delegations: [active({ sectorId: 'setor-a' })] });
    expect((await view(DELEGATE)).viewer.canDecideApproval).toBe(true);
  });

  it.each([
    ['expirada', active({ startsAt: NOW - 2000, endsAt: NOW - 1000 })],
    ['revogada', active({ revokedAt: NOW - 500 })],
    ['de outro setor', active({ sectorId: 'setor-b' })],
    ['ainda não iniciada', active({ startsAt: NOW + 3_600_000 })],
  ])('false para delegação %s', async (_label, delegation) => {
    const { view } = setup({ delegations: [delegation] });
    expect(await view(DELEGATE).then((r) => r.viewer)).toEqual({ canDecideApproval: false });
  });

  it('false para quem não é titular nem delegado', async () => {
    const { view } = setup({ delegations: [active()] });
    expect((await view(STRANGER)).viewer.canDecideApproval).toBe(false);
  });

  it('false para o solicitante, mesmo sendo o titular da linha', async () => {
    const { view, request } = setup();
    request.approvals[0].approverId = REQUESTER;
    expect((await view(REQUESTER)).viewer.canDecideApproval).toBe(false);
  });

  it('false quando a requisição não está aguardando aprovação', async () => {
    const { view } = setup({ status: 'em_atendimento' });
    expect((await view(OWNER)).viewer.canDecideApproval).toBe(false);
  });

  it('em compra só valem as linhas centro_custo e orcamento_cc; fora de compra, qualquer linha pendente', async () => {
    expect((await setup({ source: 'gestor' }).view(OWNER)).viewer.canDecideApproval).toBe(false);
    expect((await setup({ source: 'orcamento_cc' }).view(OWNER)).viewer.canDecideApproval).toBe(true);
    expect((await setup({ kind: 'outra', source: 'gestor' }).view(OWNER)).viewer.canDecideApproval).toBe(true);
  });

  it('delegado ativo consegue abrir requisição restrita', async () => {
    const { view, request } = setup({ delegations: [active()] });
    request.confidentiality = 'restrita';
    expect((await view(DELEGATE)).viewer.canDecideApproval).toBe(true);
    await expect(view(STRANGER)).rejects.toMatchObject({ status: 403 });
  });
});

describe('myApprovals com delegação', () => {
  it('inclui o item do delegado marcando asDelegateOf; o titular não tem a marca', async () => {
    const { service } = setup({ delegations: [active()] });
    const [item] = await service.myApprovals(DELEGATE, false);
    expect(item).toMatchObject({ approvalId: 'ap-1', asDelegateOf: { id: OWNER, fullName: 'Maria Responsável' } });
    const [own] = await service.myApprovals(OWNER, false);
    expect(own.asDelegateOf).toBeUndefined();
  });

  it.each([
    ['expirada', active({ startsAt: NOW - 2000, endsAt: NOW - 1000 })],
    ['revogada', active({ revokedAt: NOW - 500 })],
    ['de outro setor', active({ sectorId: 'setor-b' })],
  ])('não inclui delegação %s', async (_label, delegation) => {
    const { service } = setup({ delegations: [delegation] });
    expect(await service.myApprovals(DELEGATE, false)).toEqual([]);
  });

  it('não lista a própria requisição do delegado como solicitante', async () => {
    const { service } = setup({ delegations: [active({ delegateId: REQUESTER })] });
    expect(await service.myApprovals(REQUESTER, false)).toEqual([]);
  });
});
