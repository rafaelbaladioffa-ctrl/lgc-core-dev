import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { BudgetsService, emptyInputs, presentResult } from './budgets.service.js';
import { CoreSyncService } from './core-sync.service.js';
import { BudgetInputsDto } from './budget-inputs.dto.js';
import type { BudgetResult } from './budget-engine.js';

const user = (permissions: string[]): AuthenticatedUser => ({ userId: 'u1', email: 'a@b.c', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions });
const ORCAMENTISTA = user(['budget:read', 'budget:write']);
const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;

const result = {
  workDays: 5,
  fieldHours: '120.00',
  vehicleDays: 5,
  kmTotal: '500.00',
  labor: [{ roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 2, hours: '80.00', billingRate: '60.00', billed: '4800.00', costPerHour: '40.0000', cost: '3200.00' }],
  materials: [{ materialId: 'm1', description: 'Item', unit: 'un', quantity: '1', billedUnitPrice: '8', billed: '8.80', realUnitCost: '2', cost: '2.00', estimatedCost: false }],
  revenue: { labor: '4800.00', material: '8.80', travel: '0.00', platform: '0.00', lodgingMeals: '0.00', total: '4808.80' },
  result: { profit: '100.00' },
  warnings: ['Técnico: custo hora não calculado', 'Nenhuma pessoa de campo na equipe.'],
} as unknown as BudgetResult;

describe('presentResult', () => {
  it('sem permissão de custo mostra só o que é cobrado', () => {
    const out = presentResult(result, false) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(['fieldHours', 'kmTotal', 'labor', 'materials', 'revenue', 'vehicleDays', 'warnings', 'workDays']);
    expect((out.labor as object[])[0]).not.toHaveProperty('cost');
    expect((out.labor as object[])[0]).not.toHaveProperty('costPerHour');
    expect((out.materials as object[])[0]).not.toHaveProperty('realUnitCost');
    expect(out.warnings).toEqual(['Nenhuma pessoa de campo na equipe.']);
  });

  it('com permissão de custo devolve tudo', () => {
    expect(presentResult(result, true)).toBe(result);
  });
});

const set = {
  id: 's1',
  code: 'PAR-0001',
  status: 'vigente',
  platformDailyBilled: null,
  roles: [
    { roleKey: 'encarregado', label: 'Encarregado', fieldRole: true, sortOrder: 2 },
    { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, sortOrder: 1 },
    { roleKey: 'gerente_projeto', label: 'Gerente', fieldRole: false, sortOrder: 3 },
  ],
};

describe('emptyInputs', () => {
  it('começa com as funções do conjunto, na ordem, sem pessoas', () => {
    expect(emptyInputs(set as never).team).toEqual([
      { roleKey: 'tecnico', people: 0 },
      { roleKey: 'encarregado', people: 0 },
      { roleKey: 'gerente_projeto', hours: '0' },
    ]);
  });
});

function prismaWith(tx: Record<string, unknown>) {
  return { ...tx, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
}

describe('BudgetsService — regras', () => {
  it('sem parâmetros vigentes não cria orçamento', async () => {
    const tx = {
      axisMasterCache: { findUnique: vi.fn().mockResolvedValue({ axisId: 'p1', code: 'PROP-1', active: true, data: {} }) },
      projectBudget: { findUnique: vi.fn().mockResolvedValue(null) },
      parameterSet: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(new BudgetsService(prismaWith(tx), audit).createBudget({ axisProjectId: 'p1' }, ORCAMENTISTA)).rejects.toThrow(
      'Não há parâmetros de orçamento vigentes. Publique um conjunto em Parâmetros antes de orçar.',
    );
  });

  it('revisão fora de rascunho não é alterada', async () => {
    const tx = { budgetRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', number: 1, status: 'enviada', inputs: {}, budget: {}, parameterSet: set }) } };
    await expect(new BudgetsService(prismaWith(tx), audit).updateRevision('r1', { notes: 'x' }, ORCAMENTISTA)).rejects.toThrow(ConflictException);
  });

  it('não abre nova revisão com rascunho pendente', async () => {
    const tx = { projectBudget: { findUnique: vi.fn().mockResolvedValue({ id: 'b1', revisions: [{ number: 2, status: 'rascunho' }] }) } };
    await expect(new BudgetsService(prismaWith(tx), audit).newRevision('b1', ORCAMENTISTA)).rejects.toThrow('A revisão R2 ainda está em rascunho. Continue nela ou descarte-a.');
  });

  it('sem permissão de custo, o custo real do material vem da revisão anterior ou do catálogo', async () => {
    const revision = {
      id: 'r1',
      status: 'rascunho',
      inputs: { workDays: 0, team: [], materials: [{ materialId: 'm1', description: 'A', quantity: '1', billedUnitPrice: '5', realUnitCost: '3' }] },
      budget: {},
      parameterSet: { ...set, roles: [] },
    };
    const tx = {
      budgetRevision: { findUnique: vi.fn().mockResolvedValue(revision) },
      budgetMaterial: { findMany: vi.fn().mockResolvedValue([{ id: 'm2', realCost: { toString: () => '7' } }]) },
    };
    const service = new BudgetsService(prismaWith(tx), audit);
    const out = (await service.simulate(
      'r1',
      {
        workDays: 0,
        team: [],
        materials: [
          { materialId: 'm1', description: 'A', quantity: '1', billedUnitPrice: '5', realUnitCost: '999' },
          { materialId: 'm2', description: 'B', quantity: '1', billedUnitPrice: '9' },
          { description: 'Avulso', quantity: '1', billedUnitPrice: '4', realUnitCost: '1' },
        ],
      } as BudgetInputsDto,
      ORCAMENTISTA,
    )) as { materials: Array<Record<string, unknown>> };
    // O resultado não mostra custo; a conferência é pelo que o motor recebeu: valor cobrado igual, custo escondido.
    expect(out.materials.map((m) => m.billed)).toEqual(['5.00', '9.00', '4.00']);
    expect(tx.budgetMaterial.findMany).toHaveBeenCalledWith({ where: { id: { in: ['m2'] } }, select: { id: true, realCost: true } });
  });
});

describe('BudgetInputsDto', () => {
  it('aceita entradas válidas e recusa negativos e textos', async () => {
    const ok = plainToInstance(BudgetInputsDto, { workDays: 5, team: [{ roleKey: 'tecnico', people: 2 }], materials: [], travel: { cars: 1, kmRoundTrip: '64' } });
    expect(await validate(ok)).toEqual([]);
    const bad = plainToInstance(BudgetInputsDto, { workDays: -1, team: [{ roleKey: 'Técnico', people: 1.5 }], materials: [{ description: 'x', quantity: 'dez', billedUnitPrice: '1' }] });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual(['materials', 'team', 'workDays']);
  });
});

describe('CoreSyncService', () => {
  const config = { get: () => 'http://core/api/v1/' } as unknown as ConfigService;
  const reply = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);

  it('busca clientes e projetos com o token de quem pediu e não sobrescreve registro mais novo', async () => {
    const tx = {
      axisMasterCache: {
        findUnique: vi.fn(({ where }: { where: { kind_axisId: { axisId: string } } }) =>
          Promise.resolve(where.kind_axisId.axisId === 'p-novo' ? { sourceOccurredAt: new Date('2030-01-01'), name: null } : null),
        ),
        upsert: vi.fn().mockResolvedValue({}),
      },
    };
    const fetchFn = vi.fn((url: string) =>
      url.endsWith('/clients')
        ? reply([{ id: 'c1', code: 100, legalName: 'Cliente', updatedAt: '2026-11-01T00:00:00Z' }])
        : reply([
            { id: 'p1', code: 'PROP-100.001-1126', clientId: 'c1', status: 'proposta', updatedAt: '2026-11-02T00:00:00Z' },
            { id: 'p-novo', code: 'PROP-100.002-1126', clientId: 'c1', status: 'encerrado', updatedAt: '2026-11-02T00:00:00Z' },
          ]),
    );
    const out = await new CoreSyncService(prismaWith(tx), audit, config).syncProjectsAndClients(ORCAMENTISTA, 'Bearer t', fetchFn as unknown as typeof fetch);
    expect(out).toEqual({ clients: 1, projects: 2, updated: 2 });
    expect(fetchFn).toHaveBeenCalledWith('http://core/api/v1/projects', expect.objectContaining({ headers: { Authorization: 'Bearer t' } }));
    expect(tx.axisMasterCache.upsert).toHaveBeenCalledTimes(2);
    expect(tx.axisMasterCache.upsert.mock.calls[1][0].create).toMatchObject({ kind: 'PROJECT', axisId: 'p1', code: 'PROP-100.001-1126', active: true });
  });

  it('Core recusando a consulta vira 403 em pt-BR', async () => {
    const service = new CoreSyncService(prismaWith({}), audit, config);
    await expect(service.syncProjectsAndClients(ORCAMENTISTA, 'Bearer t', vi.fn(() => reply({}, 403)) as unknown as typeof fetch)).rejects.toThrow(ForbiddenException);
  });
});
