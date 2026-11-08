import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxService } from '../integration/outbox.service.js';
import type { CcContext } from './cc-context.js';
import { buildProjectResult } from '../budgets/project-result.js';
import { FieldClient, parseLaborHours, type LaborHourRow } from './field.client.js';
import { FieldLaborScheduler, scheduledWindow } from './field-labor.scheduler.js';
import { FieldLaborService } from './field-labor.service.js';

/** Mão de obra realizada por projeto (PT-10): horas do Field × custo hora da função, par de lançamentos, idempotência. */

type Row = Record<string, any>;
const CC_PROJECT = '11111111-1111-4111-8111-111111111111';
const CC_TEAM = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const TECH = '44444444-4444-4444-8444-444444444444';
const JOB_OK = '55555555-5555-4555-8555-555555555555';
const JOB_UNMAPPED = '66666666-6666-4666-8666-666666666666';
const TECH2 = '77777777-7777-4777-8777-777777777777';
const RATE = '50.0000'; // valor fictício de teste

const row = (over: Partial<LaborHourRow> = {}): LaborHourRow => ({ axisProjectId: PROJECT, axisCollaboratorId: TECH, date: '2026-11-04', hours: '8.00', adjusted: false, ...over });

interface Setup {
  rows?: LaborHourRow[];
  projectCc?: string | null;
  projectKnown?: boolean;
  allocationCc?: string | null;
  rate?: string | null;
}

function fixture(setup: Setup = {}) {
  const state = { rows: setup.rows ?? [row()], projectCc: setup.projectCc === undefined ? CC_TEAM : setup.projectCc, allocationCc: setup.allocationCc === undefined ? CC_TEAM : setup.allocationCc, rate: setup.rate === undefined ? RATE : setup.rate };
  const entries: Row[] = [];
  const days: Row[] = [];
  const reversed = () => new Set(entries.filter((e) => e.reversesId).map((e) => e.reversesId));
  const live = () => {
    const done = reversed();
    return entries.filter((e) => !e.reversesId && !done.has(e.id));
  };
  const tx = {
    ccEntry: {
      findMany: async ({ where }: Row) => live().filter((e) => e.source === where.source && e.sourceRef >= where.sourceRef.gte && e.sourceRef < where.sourceRef.lt),
      create: async ({ data }: Row) => entries.push({ id: randomUUID(), reversesId: null, sourceRef: null, ...data, amount: new Prisma.Decimal(data.amount) }),
      groupBy: async () => [],
    },
    ccBudget: { aggregate: async () => ({ _sum: { amount: null } }) },
    ccSetting: { findUnique: async () => null, upsert: async () => ({}) },
    fieldLaborDay: {
      deleteMany: async ({ where }: Row) => {
        for (let i = days.length - 1; i >= 0; i--) if (days[i].date >= where.date.gte && days[i].date <= where.date.lte) days.splice(i, 1);
      },
      createMany: async ({ data }: Row) => void days.push(...data),
      findMany: async () => days.filter((d) => d.status === 'pendente'),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaService;

  const params = { roles: [{ roleKey: 'tecnico', label: 'Técnico', billingRate: null, costPerHourOverride: state.rate }] };
  const ctx = {
    names: vi.fn(async (kind: string, ids: Iterable<string>) => {
      const out = new Map<string, { code: string | null; name: string | null; data: Record<string, unknown> }>();
      for (const id of ids) {
        if (kind === 'PROJECT' && id === PROJECT && setup.projectKnown !== false) out.set(id, { code: 'PRJ-001', name: 'Obra', data: state.projectCc ? { cost_center_id: state.projectCc } : {} });
        if (kind === 'COLLABORATOR' && id === TECH) out.set(id, { code: null, name: 'Técnico Um', data: { job_title_id: JOB_OK } });
        if (kind === 'COLLABORATOR' && id === TECH2) out.set(id, { code: null, name: 'Técnico Dois', data: { job_title_id: JOB_UNMAPPED, job_title_name: 'Cargo sem função' } });
      }
      return out;
    }),
    allocations: vi.fn(async () =>
      [TECH, TECH2].flatMap((id) => (state.allocationCc ? [{ collaboratorId: id, costCenterId: state.allocationCc, validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null }] : [])),
    ),
    roleMap: vi.fn(async () => new Map([[JOB_OK, 'tecnico']])),
    paramsAt: vi.fn(async () => (state.rate === null ? { roles: [] } : params)),
  } as unknown as CcContext;
  const field = { laborHours: vi.fn(async () => ({ rows: state.rows, invalid: 0 })) } as unknown as FieldClient & { laborHours: ReturnType<typeof vi.fn> };
  const outbox = { record: vi.fn().mockResolvedValue({}) } as unknown as OutboxService;
  const service = new FieldLaborService(prisma, ctx, outbox, field);
  const sum = (list: Row[]) => list.reduce((acc, e) => acc.plus(e.amount), new Prisma.Decimal(0)).toFixed(2);
  return { service, field, state, entries, days, live, sum };
}

describe('par de lançamentos da mão de obra (PA-14)', () => {
  it('custo no CC do projeto (com o projeto) e crédito negativo no CC de origem do técnico, ambos realizados/folha', async () => {
    const f = fixture({ projectCc: CC_PROJECT, allocationCc: CC_TEAM });
    const out = await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    expect(out).toMatchObject({ hours: '8.00', launchedHours: '8.00', created: 2, replaced: 0, unchanged: 0, pending: [] });
    const custo = f.live().find((e) => e.sourceRef.endsWith(':custo'))!;
    const credito = f.live().find((e) => e.sourceRef.endsWith(':credito'))!;
    expect(custo).toMatchObject({ costCenterAxisId: CC_PROJECT, projectAxisId: PROJECT, kind: 'custo', category: 'folha', stage: 'realizado', source: 'mao_de_obra', createdBy: 'sistema:field' });
    expect(custo.amount.toFixed(2)).toBe('400.00'); // 8 h × custo hora da função
    expect(credito).toMatchObject({ costCenterAxisId: CC_TEAM, projectAxisId: null, kind: 'custo', category: 'folha', stage: 'realizado', source: 'mao_de_obra' });
    expect(credito.amount.toFixed(2)).toBe('-400.00');
    expect(custo.competence.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(custo.sourceRef).toBe(`mao_obra:2026-11-04:${PROJECT}:${TECH}:custo`);
    expect(f.days).toHaveLength(1);
    expect(f.days[0]).toMatchObject({ status: 'lancado', hours: expect.anything(), originCostCenterAxisId: CC_TEAM, projectCostCenterAxisId: CC_PROJECT });
    expect(f.field.laborHours).toHaveBeenCalledWith('2026-11-01', '2026-11-08');
  });

  it('mesmo CC nos dois lados: o total do CC não muda, mas o projeto mostra a mão de obra', async () => {
    const f = fixture({ projectCc: CC_TEAM, allocationCc: CC_TEAM });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    const inCc = f.live().filter((e) => e.costCenterAxisId === CC_TEAM);
    expect(inCc).toHaveLength(2);
    expect(f.sum(inCc)).toBe('0.00');
    const ofProject = f.live().filter((e) => e.projectAxisId === PROJECT);
    expect(f.sum(ofProject)).toBe('400.00');
  });

  it('usa o custo hora da função, nunca o salário individual; horas fracionadas arredondam em centavos', async () => {
    const f = fixture({ rows: [row({ hours: '2.35' })], rate: '33.3333' });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    expect(f.live().find((e) => e.sourceRef.endsWith(':custo'))!.amount.toFixed(2)).toBe('78.33');
  });
});

describe('idempotência e reimportação (append-only)', () => {
  it('importar de novo o mesmo período não lança nada', async () => {
    const f = fixture({ projectCc: CC_PROJECT });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    const before = f.entries.length;
    const again = await f.service.import('2026-11-01', '2026-11-08', 'usuario');
    expect(again).toMatchObject({ created: 0, replaced: 0, unchanged: 2 });
    expect(f.entries).toHaveLength(before);
    expect(f.days).toHaveLength(1);
  });

  it('dia reimportado com horas diferentes (ajuste no Field) estorna o par anterior e lança o novo; nada é apagado', async () => {
    const f = fixture({ projectCc: CC_PROJECT });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    f.state.rows = [row({ hours: '6.50', adjusted: true })];
    const out = await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    expect(out).toMatchObject({ created: 0, replaced: 2, unchanged: 0 });
    expect(f.entries).toHaveLength(6); // 2 originais + 2 estornos + 2 novos
    expect(f.entries.filter((e) => e.reversesId)).toHaveLength(2);
    const original = f.entries.find((e) => e.sourceRef?.endsWith(':custo'))!;
    expect(f.entries.find((e) => e.reversesId === original.id)!.amount.toFixed(2)).toBe('-400.00');
    expect(f.live().map((e) => [e.sourceRef.split(':').pop(), e.amount.toFixed(2)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([['credito', '-325.00'], ['custo', '325.00']]);
    expect(f.days[0].adjusted).toBe(true);
    // Terceira rodada, igual: nada muda.
    expect(await f.service.import('2026-11-01', '2026-11-08', 'sistema:field')).toMatchObject({ created: 0, replaced: 0, unchanged: 2 });
  });

  it('dia que sumiu do Field é estornado, só dentro do período importado', async () => {
    const f = fixture({ projectCc: CC_PROJECT, rows: [row({ date: '2026-11-04' }), row({ date: '2026-11-20' })] });
    await f.service.import('2026-11-01', '2026-11-30', 'sistema:field');
    expect(f.live()).toHaveLength(4);
    f.state.rows = []; // o Field não devolve mais nada
    await f.service.import('2026-11-01', '2026-11-10', 'sistema:field');
    expect(f.live().map((e) => e.sourceRef.split(':')[1])).toEqual(['2026-11-20', '2026-11-20']); // dia 20 estava fora do período
  });

  it('mudou o CC de origem (alocação retroativa): o par é refeito', async () => {
    const f = fixture({ projectCc: CC_PROJECT, allocationCc: CC_TEAM });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    f.state.allocationCc = CC_PROJECT;
    const out = await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    expect(out).toMatchObject({ replaced: 1, unchanged: 1 }); // só o crédito muda de CC
    expect(f.live().find((e) => e.sourceRef.endsWith(':credito'))!.costCenterAxisId).toBe(CC_PROJECT);
  });
});

describe('pendências: o que não pode ser lançado aparece, não some', () => {
  it('colaborador com cargo sem função mapeada: não lança e mostra a pendência', async () => {
    const f = fixture({ rows: [row({ axisCollaboratorId: TECH2, hours: '4.00' }), row({ hours: '2.00' })] });
    const out = await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    expect(out).toMatchObject({ hours: '6.00', launchedHours: '2.00', created: 2 });
    expect(out.pending).toEqual([
      { collaboratorId: TECH2, collaboratorName: 'Técnico Dois', projectId: PROJECT, projectCode: 'PRJ-001', reason: 'sem_funcao', reasonLabel: expect.stringContaining('sem função mapeada'), days: 1, hours: '4.00' },
    ]);
    expect(f.live().every((e) => e.sourceRef.includes(TECH))).toBe(true);
    expect(f.days.find((d) => d.collaboratorAxisId === TECH2)).toMatchObject({ status: 'pendente', pendingReason: 'sem_funcao' });
    expect(await f.service.pending('2026-11-01', '2026-11-30')).toHaveLength(1);
  });

  it('função sem custo hora, projeto sem CC, projeto desconhecido e colaborador sem CC de origem', async () => {
    const reasons = async (setup: Setup) => (await fixture(setup).service.import('2026-11-01', '2026-11-08', 's')).pending.map((p) => p.reason);
    expect(await reasons({ rate: null })).toEqual(['sem_custo_funcao']);
    expect(await reasons({ projectCc: null })).toEqual(['projeto_sem_cc']);
    expect(await reasons({ projectKnown: false })).toEqual(['projeto_desconhecido']);
    expect(await reasons({ allocationCc: null })).toEqual(['sem_cc_origem']);
  });

  it('a função passou a ser mapeada: a reimportação lança o dia que estava pendente', async () => {
    const f = fixture({ rate: null });
    await f.service.import('2026-11-01', '2026-11-08', 's');
    expect(f.entries).toHaveLength(0);
    f.state.rate = RATE;
    const ctx = (f.service as unknown as { ctx: CcContext }).ctx as unknown as { paramsAt: ReturnType<typeof vi.fn> };
    ctx.paramsAt.mockResolvedValue({ roles: [{ roleKey: 'tecnico', label: 'Técnico', billingRate: null, costPerHourOverride: RATE }] });
    const out = await f.service.import('2026-11-01', '2026-11-08', 's');
    expect(out).toMatchObject({ created: 2, pending: [] });
    expect(f.days[0].status).toBe('lancado');
  });
});

describe('validação do período e do contrato', () => {
  it('período invertido ou acima de 62 dias é recusado antes de chamar o Field', async () => {
    const f = fixture();
    await expect(f.service.import('2026-11-08', '2026-11-01', 's')).rejects.toThrow(/depois do fim/);
    await expect(f.service.import('2026-09-01', '2026-11-02', 's')).rejects.toThrow(/62 dias/);
    await expect(f.service.import('2026-11-31', '2026-11-30', 's')).rejects.toThrow();
    expect(f.field.laborHours).not.toHaveBeenCalled();
    await expect(f.service.import('2026-09-01', '2026-11-01', 's')).resolves.toBeDefined(); // 62 dias exatos
  });

  it('linhas fora do contrato do Field são descartadas e contadas', () => {
    const ok = { axis_project_id: PROJECT, axis_collaborator_id: TECH, date: '2026-11-04', hours: '1.50', adjusted: true };
    const out = parseLaborHours([ok, { ...ok, hours: 'abc' }, { ...ok, date: '04/11/2026' }, { ...ok, axis_project_id: 'x' }, null, { ...ok, hours: 2 }]);
    expect(out.invalid).toBe(4);
    expect(out.rows.map((r) => [r.hours, r.adjusted])).toEqual([['1.50', true], ['2', true]]);
  });

  it('cliente: sem FIELD_API_URL/FIELD_API_KEY responde 503; resposta do Field é lida do contrato', async () => {
    const config = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as unknown as ConfigService;
    await expect(new FieldClient(config({})).laborHours('2026-11-01', '2026-11-02')).rejects.toThrow(/não configurada/);
    const fetchFn = vi.fn(async () => new Response(JSON.stringify([{ axis_project_id: PROJECT, axis_collaborator_id: TECH, date: '2026-11-04', hours: '3.00', adjusted: false }]), { status: 200 }));
    const out = await new FieldClient(config({ FIELD_API_URL: 'http://field/api/', FIELD_API_KEY: 'k' })).laborHours('2026-11-01', '2026-11-02', fetchFn as never);
    expect(out.rows).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledWith('http://field/api/integration/labor-hours?from=2026-11-01&to=2026-11-02', expect.objectContaining({ headers: expect.objectContaining({ 'X-Api-Key': 'k' }) }));
    const refused = vi.fn(async () => new Response('', { status: 401 }));
    await expect(new FieldClient(config({ FIELD_API_URL: 'http://field/api', FIELD_API_KEY: 'k' })).laborHours('2026-11-01', '2026-11-02', refused as never)).rejects.toThrow(/HTTP 401/);
  });
});

describe('rotina diária', () => {
  it('janela: do início do mês até ontem; na virada do mês, só ontem', () => {
    expect(scheduledWindow('2026-11-08')).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(scheduledWindow('2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(scheduledWindow('2027-01-01')).toEqual({ from: '2026-12-31', to: '2026-12-31' });
  });

  it('só roda agendada com SCHEDULER_ENABLED=true e uma falha do Field não derruba a rotina', async () => {
    const f = fixture({ projectCc: CC_PROJECT });
    const on = new FieldLaborScheduler(f.service, { get: () => 'true' } as unknown as ConfigService);
    const off = new FieldLaborScheduler(f.service, { get: () => 'false' } as unknown as ConfigService);
    await off.scheduled();
    expect(f.field.laborHours).not.toHaveBeenCalled();
    await on.scheduled();
    expect(f.field.laborHours).toHaveBeenCalledTimes(1);
    f.field.laborHours.mockRejectedValueOnce(new Error('O Field não respondeu. Tente de novo em instantes.'));
    expect(await on.runOnce('2026-11-08')).toEqual({ from: '2026-11-01', to: '2026-11-07', error: 'O Field não respondeu. Tente de novo em instantes.' });
  });
});

describe('resultado do projeto (PT-07) lendo a mão de obra do Field', () => {
  it('o custo do par aparece como mão de obra realizada do projeto; o crédito (sem projeto) não entra', async () => {
    const f = fixture({ projectCc: CC_PROJECT });
    await f.service.import('2026-11-01', '2026-11-08', 'sistema:field');
    // Mesma leitura do ProjectResultService: lançamentos do projeto agrupados por tipo, etapa, categoria e origem.
    const ofProject = f.live().filter((e) => e.projectAxisId === PROJECT);
    const rows = ofProject.map((e) => ({ kind: e.kind, stage: e.stage, category: e.category, source: e.source, amount: e.amount }));
    const result = buildProjectResult(null, rows, true) as { costs: { groups: Array<{ key: string; realized: string }> } };
    expect(result.costs.groups.find((g) => g.key === 'mao_de_obra')!.realized).toBe('400.00');
  });
});
