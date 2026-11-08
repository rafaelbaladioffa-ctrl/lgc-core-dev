import { Prisma } from '@prisma/client';
import { createHmac, randomUUID } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import { AxisWebhookService } from '../integration/axis-webhook.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { BudgetsService } from './budgets.service.js';
import { buildCommitmentLines } from './won-commitments.js';

/**
 * PT-07: `project.approved` do Core e a ação manual "Cliente aceitou" passam a revisão a `ganha` e lançam o
 * comprometido no CC pelo mesmo código. Banco em memória com o pedaço do Prisma que o fluxo usa; valores fictícios.
 */

const SECRET = 'segredo-de-teste';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const CC = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const OTHER_REV = '44444444-4444-4444-8444-444444444444';

const RESULT = {
  workDays: 6,
  directCosts: { labor: '12000.00', material: '8600.00', materialDetail: { items: '8000.00', freight: '500.00', losses: '100.00' }, travel: '1500.00', platform: '0.00', lodgingMeals: '2000.00', other: '300.00', total: '24400.00' },
  groups: [
    { key: 'mao_de_obra', cost: '12000.00' },
    { key: 'material', cost: '8600.00' },
    { key: 'deslocamento_e_estadia', cost: '3500.00' },
    { key: 'outros', cost: '300.00' },
  ],
};

type Row = Record<string, any>;

function world(revisions: Row[], { projectData = { cost_center_id: CC } as Row | null } = {}) {
  const revs = new Map(revisions.map((r) => [r.id, { ...r }]));
  const entries: Row[] = [];
  const alerts: Row[] = [];
  const events: Row[] = [];
  const audits: Row[] = [];
  const messages = new Map<string, Row>();
  let master: Row | null = projectData ? { kind: 'PROJECT', axisId: PROJECT, data: projectData } : null;
  const budgetOf = (r: Row) => ({ id: r.budgetId, projectCode: 'PROP-100.001', axisProjectId: PROJECT, model: 'aws_sow' });
  const startsWith = (v: string | null | undefined, w: any) => (w === undefined ? true : typeof v === 'string' && v.startsWith(w.startsWith));
  const tx = {
    budgetRevision: {
      findUnique: async ({ where }: Row) => {
        const r = revs.get(where.id);
        return r ? { ...r, budget: budgetOf(r), parameterSet: { id: 's1', code: 'PAR-0001', roles: [] } } : null;
      },
      findFirst: async ({ where }: Row) => [...revs.values()].find((r) => r.budgetId === where.budgetId && r.status === where.status && r.id !== where.id?.not) ?? null,
      update: async ({ where, data }: Row) => Object.assign(revs.get(where.id)!, data),
    },
    budgetRevisionEvent: { create: async ({ data }: Row) => events.push(data), findFirst: async () => null },
    auditEvent: { create: async ({ data }: Row) => audits.push(data) },
    axisMasterCache: {
      findUnique: async () => master,
      upsert: async ({ create }: Row) => {
        master = { ...master, ...create, data: { ...master?.data, ...create.data } };
      },
    },
    ccEntry: {
      findFirst: async ({ where }: Row) =>
        entries.find(
          (e) =>
            startsWith(e.sourceRef, where.sourceRef) &&
            (where.projectAxisId === undefined || e.projectAxisId === where.projectAxisId) &&
            (where.source === undefined || e.source === where.source) &&
            (where.NOT === undefined || !startsWith(e.sourceRef, where.NOT.sourceRef)),
        ) ?? null,
      create: async ({ data }: Row) => entries.push({ id: randomUUID(), ...data, amount: new Prisma.Decimal(data.amount) }),
    },
    budgetAlert: {
      findFirst: async ({ where }: Row) => alerts.find((a) => a.budgetId === where.budgetId && a.revisionId === where.revisionId && a.kind === where.kind && !a.resolvedAt) ?? null,
      create: async ({ data }: Row) => alerts.push({ ...data }),
    },
    integrationMessage: {
      findUnique: async ({ where }: Row) => messages.get(where.direction_eventId.eventId) ?? null,
      create: async ({ data }: Row) => {
        const m = { id: randomUUID(), attempts: 0, ...data };
        messages.set(data.eventId, m);
        return m;
      },
      update: async ({ where, data }: Row) => {
        const m = [...messages.values()].find((x) => x.id === where.id)!;
        const { attempts, ...rest } = data;
        Object.assign(m, rest, attempts ? { attempts: m.attempts + 1 } : {});
        return m;
      },
    },
  };
  const prisma = { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaService;
  const config = { get: (k: string) => (k === 'AXIS_WEBHOOK_SECRET' ? SECRET : undefined) } as unknown as ConfigService;
  const webhook = new AxisWebhookService(prisma, config);
  const audit = { record: async (...a: unknown[]) => void audits.push({ via: 'manual', actor: a[0], action: a[1] }) } as unknown as AuditService;
  const budgets = new BudgetsService(prisma, audit);
  vi.spyOn(budgets, 'getRevision').mockResolvedValue({ id: REV } as never);
  return { prisma, webhook, budgets, revs, entries, alerts, events, audits, messages, master: () => master };
}

const sent = (over: Row = {}) => ({ id: REV, number: 2, status: 'enviada', budgetId: 'b1', revenue: '50000.00', result: RESULT, ...over });

function approvedEvent(over: { event_id?: string; revisionId?: string | null; cost_center_id?: string | null } = {}) {
  const accepted = over.revisionId === null ? {} : { project_quote_id: 'q1', external_revision_id: over.revisionId ?? REV, revision_number: 2 };
  const body = {
    event_id: over.event_id ?? randomUUID(),
    event_type: 'project.approved',
    occurred_at: new Date().toISOString(),
    payload: {
      project_id: PROJECT,
      code: 'PROP-100.001',
      name: 'Projeto Exemplo',
      status: 'aprovado',
      client_id: 'k1',
      cost_center_id: over.cost_center_id === undefined ? CC : over.cost_center_id,
      accepted_quote: accepted,
      client_po_number: 'PO-77',
      approved_by_user_id: 'u1',
      approved_at: '2026-11-10T14:30:00-03:00',
    },
  };
  const raw = Buffer.from(JSON.stringify(body));
  return { body, raw, signature: `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}` };
}
const deliver = (w: ReturnType<typeof world>, e: ReturnType<typeof approvedEvent>) => w.webhook.receive(e.raw, e.signature);

const sum = (rows: Row[], pick: (e: Row) => boolean) => rows.filter(pick).reduce((s, e) => s.plus(e.amount), new Prisma.Decimal(0)).toFixed(2);
const GESTOR: AuthenticatedUser = { userId: 'ges', email: 'ges@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget:read', 'budget:read_cost', 'budget:approve'] };

describe('buildCommitmentLines', () => {
  it('receita contratada e custos diretos por categoria do CC; linha zerada não lança', () => {
    const lines = buildCommitmentLines('50000.00', RESULT);
    expect(lines.map((l) => [l.key, l.kind, l.category, l.amount.toFixed(2)])).toEqual([
      ['receita', 'receita', 'faturamento', '50000.00'],
      ['mao_de_obra', 'custo', 'folha', '12000.00'],
      ['material', 'custo', 'material', '8100.00'],
      ['frete', 'custo', 'material', '500.00'],
      ['deslocamento', 'custo', 'frota', '1500.00'],
      ['hospedagem_alimentacao', 'custo', 'despesas_campo', '2000.00'],
      ['outros', 'custo', 'outros', '300.00'],
    ]);
  });

  it('resultado antigo sem detalhe de material usa o total de material; sem resultado só há receita', () => {
    expect(buildCommitmentLines('10.00', { directCosts: { material: '700.00' } }).map((l) => [l.key, l.amount.toFixed(2)])).toEqual([['receita', '10.00'], ['material', '700.00']]);
    expect(buildCommitmentLines('10.00', null)).toHaveLength(1);
  });
});

describe('project.approved no Financeiro', () => {
  it('passa a revisão enviada a ganha (histórico e auditoria do Core) e lança o comprometido no CC do projeto', async () => {
    const w = world([sent()]);
    const out = await deliver(w, approvedEvent());
    expect(out).toMatchObject({ status: 'processed' });

    expect(w.revs.get(REV)).toMatchObject({ status: 'ganha', updatedBy: 'sistema:core' });
    expect(w.revs.get(REV)!.decidedAt.toISOString()).toBe('2026-11-10T17:30:00.000Z');
    expect(w.events).toEqual([expect.objectContaining({ revisionId: REV, action: 'won', fromStatus: 'enviada', toStatus: 'ganha', actorAxisId: 'sistema:core', reason: expect.stringContaining('Core') })]);
    expect(w.audits).toEqual([expect.objectContaining({ action: 'budget_revision.won', diff: expect.objectContaining({ via: 'core', clientPoNumber: 'PO-77', commitments: 'posted' }) })]);

    expect(w.entries).toHaveLength(7);
    for (const e of w.entries) expect(e).toMatchObject({ costCenterAxisId: CC, projectAxisId: PROJECT, stage: 'comprometido', source: 'projeto' });
    expect(w.entries.every((e) => e.sourceRef.startsWith(`ganho:${REV}:`))).toBe(true);
    expect(sum(w.entries, (e) => e.kind === 'receita')).toBe('50000.00');
    expect(sum(w.entries, (e) => e.kind === 'custo')).toBe('24400.00');
    expect(w.entries[0].competence.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(w.alerts).toEqual([]);
  });

  it('evento repetido não duplica: mesmo event_id é descartado e outro event_id da mesma revisão não relança', async () => {
    const w = world([sent()]);
    const first = approvedEvent();
    await deliver(w, first);
    expect(await deliver(w, first)).toMatchObject({ status: 'duplicate' });
    expect(w.entries).toHaveLength(7);

    expect(await deliver(w, approvedEvent())).toMatchObject({ status: 'processed' });
    expect(w.entries).toHaveLength(7);
    expect(w.events).toHaveLength(1);
    expect(w.audits).toHaveLength(1);
  });

  it('marcação manual e depois o evento: o comprometido não duplica', async () => {
    const w = world([sent()]);
    await w.budgets.transition(REV, 'won', GESTOR);
    expect(w.revs.get(REV)!.status).toBe('ganha');
    expect(w.entries).toHaveLength(7);
    expect(w.entries[0].createdBy).toBe('ges');

    await deliver(w, approvedEvent());
    expect(w.entries).toHaveLength(7);
    expect(w.events).toHaveLength(1); // o evento só confirma: a revisão já estava ganha
    expect(w.alerts).toEqual([]);
  });

  it('evento e depois a marcação manual: a manual é recusada (já ganha) e nada duplica', async () => {
    const w = world([sent()]);
    await deliver(w, approvedEvent());
    await expect(w.budgets.transition(REV, 'won', GESTOR)).rejects.toThrow('só vale para "Enviada"');
    expect(w.entries).toHaveLength(7);
  });

  it('outra revisão já ganha no mesmo orçamento: não sobrescreve e grava alerta visível', async () => {
    const w = world([sent({ id: OTHER_REV, number: 1, status: 'ganha' }), sent()]);
    const out = await deliver(w, approvedEvent());
    expect(out).toMatchObject({ status: 'processed' });
    expect(w.revs.get(REV)!.status).toBe('enviada');
    expect(w.revs.get(OTHER_REV)!.status).toBe('ganha');
    expect(w.entries).toEqual([]);
    expect(w.alerts).toEqual([expect.objectContaining({ budgetId: 'b1', revisionId: REV, kind: 'ganha_conflito', message: expect.stringContaining('R1 já está ganha') })]);

    // Reentrega com outro event_id não repete o alerta aberto.
    await deliver(w, approvedEvent());
    expect(w.alerts).toHaveLength(1);
  });

  it('revisão que não está enviada vira alerta e nada muda', async () => {
    const w = world([sent({ status: 'substituida' })]);
    await deliver(w, approvedEvent());
    expect(w.revs.get(REV)!.status).toBe('substituida');
    expect(w.alerts).toEqual([expect.objectContaining({ kind: 'revisao_fora_de_enviada', message: expect.stringContaining('substituída') })]);
    expect(w.entries).toEqual([]);
  });

  it('revisão inexistente: o evento fica FAILED com erro legível e o receptor responde sem lançar', async () => {
    const w = world([sent()]);
    const e = approvedEvent({ revisionId: OTHER_REV });
    const out = await deliver(w, e);
    expect(out).toMatchObject({ status: 'failed', event_id: e.body.event_id, error: expect.stringContaining(`Revisão ${OTHER_REV} não encontrada no Financeiro`) });
    expect(w.messages.get(e.body.event_id)).toMatchObject({ status: 'FAILED', lastError: expect.stringContaining('não encontrada no Financeiro') });
    expect(w.revs.get(REV)!.status).toBe('enviada');
    expect(w.entries).toEqual([]);

    // Se o Core reenviar o mesmo evento, ele é reprocessado (FAILED não vale como duplicado).
    const again = await deliver(w, e);
    expect(again).toMatchObject({ status: 'failed' });
    expect(w.messages.get(e.body.event_id)!.attempts).toBe(2);
  });

  it('evento sem a revisão aceita, ou com revisão de outro projeto, também volta como erro legível', async () => {
    const w = world([sent()]);
    expect(await deliver(w, approvedEvent({ revisionId: null }))).toMatchObject({ status: 'failed', error: expect.stringContaining('accepted_quote.external_revision_id') });
    const foreign = world([{ ...sent(), budgetId: 'b9' }]);
    // Revisão de um orçamento de outro projeto.
    vi.spyOn(foreign.prisma.budgetRevision, 'findUnique').mockResolvedValue({ ...sent(), budget: { id: 'b9', projectCode: 'PROP-999', axisProjectId: 'outro', model: 'aws_sow' } } as never);
    expect(await deliver(foreign, approvedEvent())).toMatchObject({ status: 'failed', error: expect.stringContaining('pertence a outro projeto') });
  });

  it('projeto sem CC: a revisão ganha com alerta e o comprometido sai quando o Core reenviar com o CC', async () => {
    const w = world([sent()], { projectData: null });
    await deliver(w, approvedEvent({ cost_center_id: null }));
    expect(w.revs.get(REV)!.status).toBe('ganha');
    expect(w.entries).toEqual([]);
    expect(w.alerts).toEqual([expect.objectContaining({ kind: 'sem_centro_custo' })]);

    await deliver(w, approvedEvent({ cost_center_id: CC }));
    expect(w.entries).toHaveLength(7);
    expect(w.revs.get(REV)!.status).toBe('ganha');
  });

  it('outro orçamento do mesmo projeto já é a linha de base no CC: não duplica e avisa', async () => {
    const w = world([sent({ id: OTHER_REV, number: 1, status: 'ganha', budgetId: 'b2' }), sent()]);
    await w.prisma.ccEntry.create({ data: { projectAxisId: PROJECT, source: 'projeto', sourceRef: `ganho:${OTHER_REV}:receita`, amount: '1.00' } } as never);
    await deliver(w, approvedEvent());
    expect(w.revs.get(REV)!.status).toBe('ganha');
    expect(w.entries).toHaveLength(1);
    expect(w.alerts).toEqual([expect.objectContaining({ kind: 'comprometido_duplicado' })]);
  });
});
