import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { buildProjectResult, type EntrySum } from './project-result.js';
import { ProjectResultService } from './project-result.service.js';
import { groupOfCategory } from './project-groups.js';

/** Resultado do projeto (PA-16): cotado × comprometido × realizado, só com os lançamentos do CC. Valores fictícios. */

const baseline = {
  revisionId: 'r2',
  revisionNumber: 2,
  revenue: '50000.00',
  groups: [
    { key: 'mao_de_obra', cost: '12000.00' },
    { key: 'material', cost: '8600.00' },
    { key: 'deslocamento_e_estadia', cost: '3500.00' },
    { key: 'outros', cost: '300.00' },
  ],
};

const row = (kind: EntrySum['kind'], stage: EntrySum['stage'], category: string, source: string, amount: string): EntrySum => ({ kind, stage, category, source, amount });

// Comprometido da revisão (origem projeto) + o que já aconteceu no projeto.
const rows: EntrySum[] = [
  row('receita', 'comprometido', 'faturamento', 'projeto', '50000.00'),
  row('custo', 'comprometido', 'folha', 'projeto', '12000.00'),
  row('custo', 'comprometido', 'material', 'projeto', '8600.00'),
  row('custo', 'comprometido', 'frota', 'projeto', '1500.00'),
  row('custo', 'comprometido', 'despesas_campo', 'projeto', '2000.00'),
  row('custo', 'comprometido', 'outros', 'projeto', '300.00'),
  // Material consumido da Logística e compra recebida (grupo material); compra aprovada ainda em aberto.
  row('custo', 'realizado', 'material', 'logistica', '5000.00'),
  row('custo', 'realizado', 'compras', 'compra', '1200.00'),
  row('custo', 'comprometido', 'compras', 'compra', '900.00'),
  // Reembolso de campo acima do orçado de estadia + adiantamento em aberto.
  row('custo', 'realizado', 'despesas_campo', 'reembolso', '2500.00'),
  row('custo', 'comprometido', 'despesas_campo', 'adiantamento', '400.00'),
  // Faturamento manual (receita realizada) com estorno de 1.000.
  row('receita', 'realizado', 'faturamento', 'manual', '20000.00'),
  row('receita', 'realizado', 'faturamento', 'manual', '-1000.00'),
];

describe('buildProjectResult', () => {
  const out = buildProjectResult(baseline, rows, true) as Required<ReturnType<typeof buildProjectResult>>;
  const group = (key: string) => out.costs.groups.find((g) => g.key === key)!;

  it('receita: cotado, comprometido, realizado (com estorno) e o que falta faturar', () => {
    expect(out.revenue).toEqual({ quoted: '50000.00', committed: '50000.00', realized: '19000.00', pending: '31000.00' });
  });

  it('cada grupo soma cotado, comprometido da revisão, realizado e compromissos em aberto, sem misturar origens', () => {
    expect(group('mao_de_obra')).toMatchObject({ quoted: '12000.00', committed: '12000.00', realized: '0.00', openCommitments: '0.00', committedNet: '12000.00', balance: '12000.00' });
    // Material + compras: comprometido 8.600; realizado 5.000 + 1.200; em aberto 900 (compra aprovada).
    expect(group('material')).toMatchObject({ quoted: '8600.00', committed: '8600.00', realized: '6200.00', openCommitments: '900.00', committedNet: '2400.00', balance: '1500.00' });
    // Frota 1.500 + despesas 2.000 comprometidos; reembolso 2.500 realizado; adiantamento 400 em aberto.
    expect(group('deslocamento_e_estadia')).toMatchObject({ quoted: '3500.00', committed: '3500.00', realized: '2500.00', openCommitments: '400.00', committedNet: '1000.00', balance: '600.00' });
    expect(group('outros')).toMatchObject({ committed: '300.00', realized: '0.00', committedNet: '300.00' });
  });

  it('comprometido líquido nunca fica negativo; o saldo mostra o estouro', () => {
    const over = buildProjectResult(baseline, [row('custo', 'comprometido', 'material', 'projeto', '1000.00'), row('custo', 'realizado', 'material', 'logistica', '1500.00')], true) as Required<ReturnType<typeof buildProjectResult>>;
    expect(over.costs.groups.find((g) => g.key === 'material')).toMatchObject({ committedNet: '0.00', balance: '-500.00' });
  });

  it('total e resultado direto (receita − custos diretos)', () => {
    expect(out.costs.total).toEqual({ quoted: '24400.00', committed: '24400.00', realized: '8700.00', openCommitments: '1300.00', committedNet: '15700.00', balance: '14400.00' });
    expect(out.result).toEqual({ quoted: '25600.00', committed: '25600.00', realized: '10300.00' });
  });

  it('sem revisão ganha só há o realizado; sem permissão de custo só a receita', () => {
    const none = buildProjectResult(null, [row('custo', 'realizado', 'material', 'logistica', '10.00')], true) as Required<ReturnType<typeof buildProjectResult>>;
    expect(none.revenue.quoted).toBeNull();
    expect(none.costs.total).toMatchObject({ quoted: null, realized: '10.00' });
    const noCost = buildProjectResult(baseline, rows, false);
    expect(Object.keys(noCost)).toEqual(['revenue']);
    expect(JSON.stringify(noCost)).not.toMatch(/12000|8600|24400/);
  });

  it('toda categoria de custo do CC pertence a um grupo', () => {
    for (const c of ['folha', 'material', 'compras', 'servicos', 'despesas_campo', 'frota', 'outros']) expect(groupOfCategory(c)).not.toBeNull();
    expect(groupOfCategory('faturamento')).toBeNull();
  });
});

describe('ProjectResultService', () => {
  const user = (permissions: string[]): AuthenticatedUser => ({ userId: 'u', email: 'u@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions });

  function service(opts: { won: boolean; committedEntry?: boolean }) {
    const prisma = {
      axisMasterCache: { findUnique: vi.fn().mockResolvedValue({ axisId: 'p1', code: 'PROP-1', name: 'Projeto', active: true, data: { cost_center_id: 'cc1', cost_center_code: '110' } }) },
      budgetRevision: {
        findMany: vi.fn().mockResolvedValue(
          opts.won
            ? [
                { id: 'r1', number: 1, revenue: new Prisma.Decimal('9999.00'), result: { groups: [{ key: 'material', cost: '1.00' }] }, decidedAt: null, budget: { model: 'generico' } },
                { id: 'r2', number: 2, revenue: new Prisma.Decimal('50000.00'), result: { groups: baseline.groups }, decidedAt: null, budget: { model: 'aws_sow' } },
              ]
            : [],
        ),
      },
      ccEntry: {
        groupBy: vi.fn().mockResolvedValue(rows.map((r) => ({ kind: r.kind, stage: r.stage, category: r.category, source: r.source, _sum: { amount: new Prisma.Decimal(r.amount as string) } }))),
        findFirst: vi.fn().mockResolvedValue(opts.committedEntry === false ? null : { costCenterAxisId: 'cc1', competence: new Date('2026-11-10T00:00:00Z') }),
      },
      budgetAlert: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return { service: new ProjectResultService(prisma as unknown as PrismaService), prisma };
  }

  it('lê só os lançamentos do projeto no CC e usa a revisão ganha da cotação AWS como cotado', async () => {
    const { service: s, prisma } = service({ won: true });
    const out = (await s.get('p1', user(['budget:read', 'budget:read_cost']))) as any;
    expect(prisma.ccEntry.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { projectAxisId: 'p1' } }));
    expect(out.revision).toMatchObject({ id: 'r2', number: 2, committedOn: '2026-11-10' });
    expect(out.revenue.quoted).toBe('50000.00');
    expect(out.costs.total.quoted).toBe('24400.00');
    expect(out.costCenterId).toBe('cc1');
    expect(out.commitmentsPending).toBe(false);
  });

  it('sem budget:read_cost não devolve custo; revisão ganha sem comprometido lançado fica sinalizada', async () => {
    const { service: s } = service({ won: true, committedEntry: false });
    const out = (await s.get('p1', user(['budget:read']))) as any;
    expect(out.costs).toBeUndefined();
    expect(out.result).toBeUndefined();
    expect(out.commitmentsPending).toBe(true);
  });
});
