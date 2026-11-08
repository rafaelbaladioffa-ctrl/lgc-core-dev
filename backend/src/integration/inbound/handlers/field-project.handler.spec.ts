import { describe, expect, it, vi } from 'vitest';
import { FieldProjectHandler } from './field-project.handler.js';
import type { InboundEvent } from '../inbound-handler.js';

/** Handlers do Field (PT-09, PA-18) com Prisma simulado em memória; payloads de docs/integracao-core-field.md §5.2. */

const FIELD = { id: 'sat-field', name: 'field' };
const COST_CENTER = { id: 'cc-1', code: '100.1', name: 'Obras SP' };

function fixture(projectOverrides: Record<string, unknown> | null = {}, work: Record<string, any> | null = null) {
  const project: Record<string, any> | null =
    projectOverrides === null
      ? null
      : {
          id: 'p-1', code: 'PROP-7.012-1126', name: 'Cabeamento DC', status: 'aprovado', clientId: 'cl-1', costCenterId: 'cc-1', costCenter: COST_CENTER,
          siteId: 'site-1', site: { id: 'site-1', code: 'GRU53', name: 'Aeroporto GRU' }, responsibleCollaboratorId: 'col-resp',
          plannedStartDate: null, plannedEndDate: null, ...projectOverrides,
        };
  let row: Record<string, any> | null = work ? { id: 'fw-1', projectId: 'p-1', ...work } : null;
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    project: {
      findUnique: vi.fn(async () => (project ? { ...project } : null)),
      update: vi.fn(async ({ data }) => Object.assign(project!, data)),
    },
    projectFieldWork: {
      findUnique: vi.fn(async () => (row ? { ...row } : null)),
      create: vi.fn(async ({ data }) => {
        row = { id: 'fw-1', ...data };
        return row;
      }),
      update: vi.fn(async ({ data }) => {
        row = { ...row!, ...data };
        return row;
      }),
    },
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-sistema' }) },
    auditEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const handler = new FieldProjectHandler(outbox as any);
  let seq = 0;
  const send = (eventType: string, payload: Record<string, unknown>, extra: Partial<InboundEvent> = {}) => {
    seq += 1;
    return handler.handle(tx, {
      satellite: FIELD,
      eventId: `ev-${seq}`,
      eventType,
      occurredAt: new Date(`2026-11-1${seq % 10}T12:00:00Z`),
      correlationId: null,
      payload: { axis_project_id: 'p-1', field_project_id: 42, ...payload },
      ...extra,
    });
  };
  const auditEvents = () => tx.auditEvent.create.mock.calls.map((c: any[]) => c[0].data.event as string);
  return { project: project!, work: () => row!, tx, outbox, send, auditEvents };
}

const created = { field_project_code: 'CSTR-PROJ-0042', url: 'https://field.lgc.local/projetos/42', status: 'planning', sow_plan_status: 'generated', tasks_count: 12, created_at: '2026-11-09T10:00:00Z' };
const progress = (date: string, percent: string, extra: Record<string, unknown> = {}) => ({ date, percent_complete: percent, tasks_total: 12, tasks_done: 3, real_man_hours: '40.50', planned_man_hours: '400.00', ...extra });

describe('field.project.created', () => {
  it('guarda no projeto o id da obra, o código, o link, o plano da SOW e o nº de tarefas', async () => {
    const f = fixture();
    await f.send('field.project.created', created);
    expect(f.tx.projectFieldWork.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId: 'p-1', fieldProjectId: '42', fieldProjectCode: 'CSTR-PROJ-0042', url: 'https://field.lgc.local/projetos/42', sowPlanStatus: 'generated', tasksCount: 12,
        createdInFieldAt: new Date('2026-11-09T10:00:00Z'),
      }),
    });
    // Criar a obra não muda o status do projeto: isso é o `started`.
    expect(f.project.status).toBe('aprovado');
    expect(f.outbox.record).not.toHaveBeenCalled();
  });

  it('repetir o created atualiza a mesma linha, sem duplicar', async () => {
    const f = fixture();
    await f.send('field.project.created', created);
    await f.send('field.project.created', { ...created, sow_plan_status: 'pending_review', created_at: '2026-11-09T11:00:00Z' });
    expect(f.tx.projectFieldWork.create).toHaveBeenCalledTimes(1);
    expect(f.work()).toMatchObject({ sowPlanStatus: 'pending_review' });
  });

  it('um created mais velho (reenvio atrasado) não desfaz o mais novo', async () => {
    const f = fixture();
    await f.send('field.project.created', { ...created, sow_plan_status: 'generated', created_at: '2026-11-09T12:00:00Z' });
    await f.send('field.project.created', { ...created, sow_plan_status: 'failed', created_at: '2026-11-09T08:00:00Z' });
    expect(f.work().sowPlanStatus).toBe('generated');
  });
});

describe('field.project.started (PA-18)', () => {
  it('leva o projeto de aprovado a em_execucao com o mesmo project.status_changed de uma mudança normal', async () => {
    const f = fixture();
    await f.send('field.project.started', { started_at: '2026-11-15T08:00:00Z' });

    expect(f.project.status).toBe('em_execucao');
    expect(f.outbox.record).toHaveBeenCalledTimes(1);
    expect(f.outbox.record).toHaveBeenCalledWith(f.tx, 'project.status_changed', expect.objectContaining({ project_id: 'p-1', status: 'em_execucao', previous_status: 'aprovado', cost_center_code: '100.1', site_code: 'GRU53' }));
    expect(f.work().startedAt).toEqual(new Date('2026-11-15T08:00:00Z'));
    expect(f.auditEvents()).toEqual(['project.status_changed_by_field']);
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'user-sistema', action: 'change_project_status', resourceType: 'project', resourceId: 'p-1' }) });
  });

  it.each(['em_execucao', 'encerrado'])('projeto %s: só registra a data, sem mudar o status nem emitir evento', async (status) => {
    const f = fixture({ status });
    await f.send('field.project.started', { started_at: '2026-11-15T08:00:00Z' });
    expect(f.project.status).toBe(status);
    expect(f.tx.project.update).not.toHaveBeenCalled();
    expect(f.outbox.record).not.toHaveBeenCalled();
    expect(f.work().startedAt).toEqual(new Date('2026-11-15T08:00:00Z'));
  });

  it('repetido: o projeto já em execução não é tocado de novo e a data mais antiga fica', async () => {
    const f = fixture();
    await f.send('field.project.started', { started_at: '2026-11-15T08:00:00Z' });
    await f.send('field.project.started', { started_at: '2026-11-16T08:00:00Z' });
    expect(f.outbox.record).toHaveBeenCalledTimes(1);
    expect(f.work().startedAt).toEqual(new Date('2026-11-15T08:00:00Z'));
  });

  it('started antes do created: cria a linha e o created completa depois', async () => {
    const f = fixture();
    await f.send('field.project.started', { started_at: '2026-11-15T08:00:00Z' });
    await f.send('field.project.created', created);
    expect(f.project.status).toBe('em_execucao');
    expect(f.work()).toMatchObject({ fieldProjectCode: 'CSTR-PROJ-0042', tasksCount: 12, startedAt: new Date('2026-11-15T08:00:00Z') });
  });
});

describe('field.project.progress', () => {
  it('guarda o último avanço: %, tarefas, HH real × previsto e a data', async () => {
    const f = fixture();
    await f.send('field.project.progress', progress('2026-11-16', '25.00'));
    expect(f.work()).toMatchObject({ progressDate: new Date('2026-11-16T00:00:00Z'), tasksTotal: 12, tasksDone: 3 });
    expect(f.work().percentComplete.toFixed(2)).toBe('25.00');
    expect(f.work().realManHours.toFixed(2)).toBe('40.50');
    expect(f.work().plannedManHours.toFixed(2)).toBe('400.00');
  });

  it('ignora snapshot mais velho que o guardado e aceita o mais novo', async () => {
    const f = fixture();
    await f.send('field.project.progress', progress('2026-11-17', '40.00', { tasks_done: 5 }));
    await f.send('field.project.progress', progress('2026-11-16', '25.00', { tasks_done: 3 }));
    expect(f.work().percentComplete.toFixed(2)).toBe('40.00');
    expect(f.work().tasksDone).toBe(5);
    await f.send('field.project.progress', progress('2026-11-18', '55.50', { tasks_done: 7 }));
    expect(f.work().percentComplete.toFixed(2)).toBe('55.50');
  });

  it('no mesmo dia vale o instante mais recente do evento, não o último a chegar', async () => {
    const f = fixture();
    await f.send('field.project.progress', progress('2026-11-17', '60.00'), { occurredAt: new Date('2026-11-17T20:00:00Z') });
    await f.send('field.project.progress', progress('2026-11-17', '50.00'), { occurredAt: new Date('2026-11-17T09:00:00Z') });
    expect(f.work().percentComplete.toFixed(2)).toBe('60.00');
  });

  it('o repetido não muda nada', async () => {
    const f = fixture();
    const event = progress('2026-11-17', '40.00');
    await f.send('field.project.progress', event, { occurredAt: new Date('2026-11-17T20:00:00Z') });
    await f.send('field.project.progress', event, { occurredAt: new Date('2026-11-17T20:00:00Z') });
    expect(f.work().percentComplete.toFixed(2)).toBe('40.00');
    expect(f.tx.projectFieldWork.create).toHaveBeenCalledTimes(1);
  });

  it('progress antes do created: o created completa sem apagar o avanço', async () => {
    const f = fixture();
    await f.send('field.project.progress', progress('2026-11-16', '25.00'));
    await f.send('field.project.created', created);
    expect(f.work().percentComplete.toFixed(2)).toBe('25.00');
    expect(f.work()).toMatchObject({ fieldProjectCode: 'CSTR-PROJ-0042', tasksTotal: 12 });
  });

  it('limita o percentual a 0–100 e recusa payload sem percentual', async () => {
    const f = fixture();
    await f.send('field.project.progress', progress('2026-11-16', '130'));
    expect(f.work().percentComplete.toFixed(2)).toBe('100.00');
    await expect(f.send('field.project.progress', { date: '2026-11-17' })).rejects.toThrow('sem "percent_complete"');
  });
});

describe('field.project.completed', () => {
  it('registra a conclusão e deixa o alerta para o responsável, sem encerrar o projeto', async () => {
    const f = fixture({ status: 'em_execucao' });
    await f.send('field.project.completed', { completed_at: '2026-11-30T17:00:00Z' });
    expect(f.work().completedAt).toEqual(new Date('2026-11-30T17:00:00Z'));
    expect(f.project.status).toBe('em_execucao');
    expect(f.outbox.record).not.toHaveBeenCalled();
    expect(f.auditEvents()).toEqual(['project.field_completed']);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ aggregateId: 'p-1', afterJson: expect.objectContaining({ responsibleCollaboratorId: 'col-resp' }) }) });
  });

  it('repetido: não registra o aviso duas vezes', async () => {
    const f = fixture({ status: 'em_execucao' });
    await f.send('field.project.completed', { completed_at: '2026-11-30T17:00:00Z' });
    await f.send('field.project.completed', { completed_at: '2026-12-01T17:00:00Z' });
    expect(f.auditEvents()).toEqual(['project.field_completed']);
    expect(f.work().completedAt).toEqual(new Date('2026-11-30T17:00:00Z'));
  });
});

describe('falhas com motivo legível', () => {
  it('projeto inexistente', async () => {
    const f = fixture(null);
    await expect(f.send('field.project.started', {})).rejects.toThrow('Projeto p-1 não encontrado no Core (evento field.project.started, obra 42 do Field).');
  });

  it('evento do satélite errado (field.* vindo da Logística)', async () => {
    const f = fixture();
    await expect(f.send('field.project.started', {}, { satellite: { id: 'sat-log', name: 'logistica' } })).rejects.toThrow('só é aceito do satélite Field, mas chegou de "logistica"');
    expect(f.tx.projectFieldWork.create).not.toHaveBeenCalled();
    expect(f.project.status).toBe('aprovado');
  });

  it('sem axis_project_id ou field_project_id', async () => {
    const f = fixture();
    await expect(f.send('field.project.started', { axis_project_id: null })).rejects.toThrow('sem "axis_project_id"');
    await expect(f.send('field.project.started', { field_project_id: null })).rejects.toThrow('sem "field_project_id"');
  });

  it('o projeto já ligado a outra obra do Field', async () => {
    const f = fixture({}, { fieldProjectId: '7' });
    await expect(f.send('field.project.progress', progress('2026-11-16', '10'))).rejects.toThrow('já está ligado à obra 7 do Field');
  });
});
