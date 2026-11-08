import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { BudgetsService } from './budgets.service.js';
import { allowedActions, coreDivergence, submitBlockers } from './revision-workflow.js';

/** Fluxo da revisão (PJ3, projetos-especificacao §3). Prisma simulado; valores fictícios. */

const user = (id: string, permissions: string[]): AuthenticatedUser => ({
  userId: id,
  email: `${id}@lgc.test`,
  axisRoles: [],
  collaboratorId: null,
  mustChangePassword: false,
  permissions,
});
const ORCAMENTISTA = user('orc', ['budget:read', 'budget:write']);
const GESTOR = user('ges', ['budget:read', 'budget:read_cost', 'budget:approve']);

const OK_RESULT = { workDays: 5, fieldHours: '80.00', revenue: { total: '9000.00' } };

describe('regras do fluxo', () => {
  it('ações por situação e permissão', () => {
    expect(allowedActions('rascunho', ORCAMENTISTA)).toEqual(['submit', 'discard']);
    expect(allowedActions('rascunho', GESTOR)).toEqual([]);
    expect(allowedActions('em_aprovacao', GESTOR)).toEqual(['return', 'approve_send']);
    expect(allowedActions('enviada', GESTOR)).toEqual(['won', 'lost']);
    expect(allowedActions('ganha', GESTOR)).toEqual([]);
  });

  it('bloqueios para submeter', () => {
    expect(submitBlockers(OK_RESULT)).toEqual([]);
    expect(submitBlockers(null)).toEqual(['A revisão ainda não foi calculada.']);
    expect(submitBlockers({ workDays: 0, fieldHours: '0.00', revenue: { total: '0.00' } })).toHaveLength(3);
  });

  it('avisos de divergência com o Core', () => {
    expect(coreDivergence('aprovado', ['enviada'])).toEqual(['Projeto aprovado sem orçamento ganho']);
    expect(coreDivergence('em_execucao', [])).toEqual(['Projeto aprovado sem orçamento ganho']);
    expect(coreDivergence('proposta', ['ganha'])).toEqual(['Atualize o status do projeto no Core']);
    expect(coreDivergence('aprovado', ['substituida', 'ganha'])).toEqual([]);
    expect(coreDivergence('proposta', ['enviada'])).toEqual([]);
  });
});

function fixture(status: string, { previousSent = null as { id: string; number: number } | null, submitter = 'orc', result = OK_RESULT as unknown } = {}) {
  const revision = {
    id: 'r2',
    number: 2,
    status,
    budgetId: 'b1',
    result,
    inputs: { workDays: 5, team: [], materials: [] },
    budget: { id: 'b1', projectCode: 'PROP-100.001-1126', axisProjectId: 'p1', title: null, plannedStartDate: null, plannedEndDate: null, model: 'generico' },
    parameterSet: { id: 's1', code: 'PAR-0001', status: 'vigente', roles: [] },
  };
  const tx = {
    budgetRevision: {
      findUnique: vi.fn().mockResolvedValue(revision),
      findFirst: vi.fn().mockResolvedValue(previousSent),
      update: vi.fn().mockResolvedValue({}),
    },
    budgetRevisionEvent: {
      create: vi.fn().mockResolvedValue({}),
      findFirst: vi.fn().mockResolvedValue({ actorAxisId: submitter }),
    },
  };
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService & { record: ReturnType<typeof vi.fn> };
  const prisma = { ...tx, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
  const service = new BudgetsService(prisma, audit);
  // A leitura final da revisão é testada nos testes do serviço; aqui só o fluxo.
  vi.spyOn(service, 'getRevision').mockResolvedValue({ id: 'r2' } as never);
  return { service, tx, audit };
}

describe('BudgetsService.transition', () => {
  it('submeter: rascunho → em aprovação, com histórico e auditoria', async () => {
    const { service, tx, audit } = fixture('rascunho');
    await service.transition('r2', 'submit', ORCAMENTISTA);
    expect(tx.budgetRevision.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: expect.objectContaining({ status: 'em_aprovacao', submittedAt: expect.any(Date) }) });
    expect(tx.budgetRevisionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'submitted', fromStatus: 'rascunho', toStatus: 'em_aprovacao', actorEmail: 'orc@lgc.test' }) });
    expect(audit.record).toHaveBeenCalledWith('orc', 'budget_revision.submitted', 'budget_revision', 'r2', expect.objectContaining({ before: 'rascunho', after: 'em_aprovacao' }), tx);
  });

  it('não submete revisão sem equipe ou valor', async () => {
    const { service, tx } = fixture('rascunho', { result: { workDays: 0, fieldHours: '0', revenue: { total: '0' } } });
    await expect(service.transition('r2', 'submit', ORCAMENTISTA)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.budgetRevision.update).not.toHaveBeenCalled();
  });

  it('devolver exige motivo e volta para rascunho', async () => {
    const { service, tx } = fixture('em_aprovacao');
    await expect(service.transition('r2', 'return', GESTOR, ' ')).rejects.toThrow('Informe o motivo.');
    await service.transition('r2', 'return', GESTOR, 'Faltou a plataforma');
    expect(tx.budgetRevision.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: expect.objectContaining({ status: 'rascunho', submittedAt: null }) });
    expect(tx.budgetRevisionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'returned', reason: 'Faltou a plataforma' }) });
  });

  it('aprovar envio grava quem aprovou e substitui a enviada anterior', async () => {
    const { service, tx, audit } = fixture('em_aprovacao', { previousSent: { id: 'r1', number: 1 } });
    await service.transition('r2', 'approve_send', GESTOR);
    expect(tx.budgetRevision.update).toHaveBeenNthCalledWith(1, { where: { id: 'r1' }, data: expect.objectContaining({ status: 'substituida' }) });
    expect(tx.budgetRevision.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'r2' },
      data: expect.objectContaining({ status: 'enviada', approvedBy: 'ges', approvedByEmail: 'ges@lgc.test', approvedAt: expect.any(Date) }),
    });
    expect(tx.budgetRevisionEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ revisionId: 'r1', action: 'superseded', reason: 'Substituída pela R2.' }) });
    expect(audit.record).toHaveBeenCalledWith('ges', 'budget_revision.send_approved', 'budget_revision', 'r2', expect.objectContaining({ superseded: 1, selfApproved: false }), tx);
  });

  it('quem orçou pode aprovar a própria revisão, registrado na auditoria (P-03)', async () => {
    const both = user('orc', ['budget:read', 'budget:write', 'budget:approve']);
    const { service, audit, tx } = fixture('em_aprovacao');
    await service.transition('r2', 'approve_send', both);
    expect(audit.record).toHaveBeenCalledWith('orc', 'budget_revision.send_approved', 'budget_revision', 'r2', expect.objectContaining({ selfApproved: true }), tx);
  });

  it('ganha e perdida só a partir de enviada; perdida exige motivo', async () => {
    const won = fixture('enviada');
    await won.service.transition('r2', 'won', GESTOR);
    expect(won.tx.budgetRevision.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: expect.objectContaining({ status: 'ganha', decidedAt: expect.any(Date) }) });

    const lost = fixture('enviada');
    await expect(lost.service.transition('r2', 'lost', GESTOR)).rejects.toThrow('Informe o motivo.');
    await lost.service.transition('r2', 'lost', GESTOR, 'Preço acima do concorrente');
    expect(lost.tx.budgetRevision.update).toHaveBeenCalledWith({ where: { id: 'r2' }, data: expect.objectContaining({ status: 'perdida' }) });

    const draft = fixture('rascunho');
    await expect(draft.service.transition('r2', 'won', GESTOR)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sem a permissão da ação → 403', async () => {
    const { service } = fixture('em_aprovacao');
    await expect(service.transition('r2', 'approve_send', ORCAMENTISTA)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('BudgetsService.newRevision com o fluxo', () => {
  function serviceWith(revisions: Array<{ number: number; status: string }>) {
    const tx = { projectBudget: { findUnique: vi.fn().mockResolvedValue({ id: 'b1', revisions }) } };
    const prisma = { ...tx, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
    return new BudgetsService(prisma, { record: vi.fn() } as unknown as AuditService);
  }

  it('bloqueia enquanto há revisão em aprovação', async () => {
    await expect(serviceWith([{ number: 2, status: 'em_aprovacao' }]).newRevision('b1', ORCAMENTISTA)).rejects.toThrow('está em aprovação');
  });

  it('bloqueia depois de ganha (linha de base)', async () => {
    await expect(serviceWith([{ number: 2, status: 'ganha' }]).newRevision('b1', ORCAMENTISTA)).rejects.toThrow('foi ganha');
  });
});

describe('BudgetsService.awsInfo (modelo aws_sow)', () => {
  const service = new BudgetsService({} as PrismaService, { record: vi.fn() } as unknown as AuditService);
  const base = {
    number: 1,
    inputs: { workDays: 5, team: [], materials: [], platform: { days: 0 } },
    result: { workDays: 5, fieldHours: '80.00', vehicleDays: 0, labor: [{ roleKey: 't', label: 'T', fieldRole: true, people: 2, hours: '80.00', billingRate: '50', billed: '4000' }], revenue: { total: '4000', labor: '4000', travel: '0', platform: '0' } },
    budget: { model: 'aws_sow', projectCode: 'PROP-1', title: null, plannedStartDate: null, plannedEndDate: null },
    parameterSet: { hoursPerDay: '8' },
  };

  it('nos outros modelos não existe', () => {
    expect(service.awsInfo({ ...base, budget: { ...base.budget, model: 'generico' } } as never, null)).toBeNull();
  });

  it('sem SOW e sem Bid Template, pede os dois para submeter', () => {
    expect(service.awsInfo({ ...base, sow: null, bidTemplate: null } as never, null)).toMatchObject({
      missing: ['sow', 'bid_template'],
      quote: null,
      blockers: ['Importe a SOW do cliente.', 'Importe o Bid Template do cliente.'],
    });
  });

  it('com os dois, calcula a cotação e repassa os bloqueios dela', () => {
    const info = service.awsInfo(
      {
        ...base,
        sow: { header: { startDate: '2030-02-01', endDate: '2030-02-08' }, cables: [{ type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 30, quantity: 10 }], fieldHoursOverrides: {}, kpiJustifications: {} },
        bidTemplate: {
          documentId: 'd',
          version: 1,
          filename: 'b.xlsm',
          importedAt: new Date(),
          quoteRequestId: null,
          targets: {
            targets: { hoursPerMeter: 0.03, hoursPerPort: 0.3 },
            converted: { costPerPort: null, laborCostPerPort: null },
            weights: { meters: 0.4, ports: 0.6, devices: 1 },
            thresholds: { efficiency: -0.15, costPerPort: 0.1, laborCostPerPort: 0.15, hoursPerPort: 0.25, hoursPerMeter: 0.25 },
          },
        },
      } as never,
      null,
    );
    expect(info?.missing).toEqual([]);
    expect(info?.quote?.totals).toMatchObject({ targetHours: 5.4, ports: 10, meters: 300 });
    expect(info?.quote?.bidValues.proposalName).toBe('PROP-1 R1');
    expect(info?.blockers.some((b) => b.startsWith('Justifique o indicador'))).toBe(true);
  });
});
