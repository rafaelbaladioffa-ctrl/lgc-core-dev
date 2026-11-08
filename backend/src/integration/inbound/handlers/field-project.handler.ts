import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxService } from '../../outbox.service.js';
import type { InboundEvent, InboundEventHandler } from '../inbound-handler.js';
import { SYSTEM_ACTOR_EMAIL } from '../../../requests/envio-material.js';
import { changeProjectStatus } from '../../../projects/projects.service.js';
import { asDate, asDateOnly, asDecimal, asInt, asText, assertFromSatellite, requireText } from './inbound-payload.js';

type Tx = Prisma.TransactionClient;

const EVENT_TYPES = ['field.project.created', 'field.project.started', 'field.project.progress', 'field.project.completed'] as const;

/**
 * Acompanha a obra do projeto no Field (PT-09, PA-18). Eventos recebidos (formato em docs/integracao-core-field.md
 * §5.2), todos com `axis_project_id` e `field_project_id`; guardam o estado em `project_field_works` (uma linha por projeto,
 * criada pelo primeiro evento que chegar, na ordem que chegar):
 *
 * - `field.project.created` → id, código, link, situação do plano da SOW e nº de tarefas;
 * - `field.project.started` → projeto `aprovado → em_execucao` com o mesmo `project.status_changed` de uma mudança de
 *   status normal (já em execução ou encerrado: só registra a data);
 * - `field.project.progress` → último avanço (% , tarefas, HH real × previsto); snapshot mais velho que o guardado é ignorado;
 * - `field.project.completed` → registra e alerta o responsável do projeto (encerrar continua manual).
 *
 * Repetir um evento é seguro (cada campo só muda para um valor mais novo ou igual). O projeto fica travado (`FOR UPDATE`)
 * durante o tratamento, para dois eventos simultâneos não se atropelarem.
 */
@Injectable()
export class FieldProjectHandler implements InboundEventHandler {
  readonly eventTypes = EVENT_TYPES;

  constructor(private readonly outbox: OutboxService) {}

  async handle(tx: Tx, event: InboundEvent): Promise<void> {
    assertFromSatellite(event, 'field');
    const projectId = requireText(event, 'axis_project_id');
    const fieldProjectId = requireText(event, 'field_project_id');

    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true, code: true, status: true, responsibleCollaboratorId: true } });
    if (!project) throw new Error(`Projeto ${projectId} não encontrado no Core (evento ${event.eventType}, obra ${fieldProjectId} do Field).`);

    const existing = await tx.projectFieldWork.findUnique({ where: { projectId } });
    if (existing && existing.fieldProjectId !== fieldProjectId) {
      throw new Error(
        `O projeto ${project.code} já está ligado à obra ${existing.fieldProjectId} do Field; o evento ${event.eventType} trouxe a obra ${fieldProjectId}. Confira no Field.`,
      );
    }

    const at = event.occurredAt ?? new Date();
    let data: Prisma.ProjectFieldWorkUncheckedUpdateInput;
    switch (event.eventType) {
      case 'field.project.created':
        data = createdData(event, existing, at);
        break;
      case 'field.project.started':
        data = { startedAt: earlier(existing?.startedAt, asDate(event.payload.started_at) ?? at) };
        break;
      case 'field.project.progress':
        data = progressData(event, existing, at);
        break;
      default:
        data = { completedAt: earlier(existing?.completedAt, asDate(event.payload.completed_at) ?? at) };
    }

    if (existing) await tx.projectFieldWork.update({ where: { id: existing.id }, data });
    else await tx.projectFieldWork.create({ data: { ...(data as Prisma.ProjectFieldWorkUncheckedCreateInput), projectId, fieldProjectId } });

    if (event.eventType === 'field.project.started') await this.startExecution(tx, project, event);
    if (event.eventType === 'field.project.completed' && !existing?.completedAt) await this.registerCompletion(tx, project, event, data.completedAt as Date);
  }

  /** PA-18: primeira tarefa iniciada no Field → projeto em execução, com o mesmo evento de outbox da mudança manual. */
  private async startExecution(tx: Tx, project: { id: string; code: string; status: string }, event: InboundEvent): Promise<void> {
    // Só `aprovado` avança: em execução ou encerrado fica como está; proposta não deveria ter obra (só registra).
    if (project.status !== 'aprovado') return;
    await changeProjectStatus(tx, this.outbox, project.id, 'aprovado', 'em_execucao');
    const system = await tx.user.findUnique({ where: { email: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
    await tx.auditEvent.create({
      data: {
        aggregateType: 'project',
        aggregateId: project.id,
        event: 'project.status_changed_by_field',
        actorId: system?.id ?? null,
        beforeJson: { status: 'aprovado' },
        afterJson: { status: 'em_execucao', eventId: event.eventId, fieldProjectId: asText(event.payload.field_project_id) } as Prisma.InputJsonValue,
        source: 'integration',
      },
    });
    // Mesmo registro de auditoria da rota `PUT /projects/:id/status` (`change_project_status`), pelo usuário de sistema.
    if (system) {
      await tx.auditLog.create({
        data: {
          actorUserId: system.id,
          action: 'change_project_status',
          resourceType: 'project',
          resourceId: project.id,
          metadata: { from: 'aprovado', to: 'em_execucao', origin: 'field.project.started', eventId: event.eventId } as Prisma.InputJsonValue,
        },
      });
    }
  }

  /** O responsável é avisado pelo sino (`GET /projects/field-alerts`) enquanto o projeto não for encerrado; aqui fica o registro. */
  private async registerCompletion(tx: Tx, project: { id: string; responsibleCollaboratorId: string }, event: InboundEvent, completedAt: Date): Promise<void> {
    await tx.auditEvent.create({
      data: {
        aggregateType: 'project',
        aggregateId: project.id,
        event: 'project.field_completed',
        actorId: null,
        afterJson: {
          completedAt: completedAt.toISOString(),
          responsibleCollaboratorId: project.responsibleCollaboratorId,
          eventId: event.eventId,
        } as Prisma.InputJsonValue,
        source: 'integration',
      },
    });
  }
}

/** A data mais antiga entre a guardada e a nova (início e conclusão valem uma vez só). */
function earlier(current: Date | null | undefined, candidate: Date): Date {
  return current && current.getTime() <= candidate.getTime() ? current : candidate;
}

function createdData(event: InboundEvent, existing: { createdInFieldAt: Date | null } | null, at: Date): Prisma.ProjectFieldWorkUncheckedUpdateInput {
  const createdAt = asDate(event.payload.created_at) ?? at;
  // Um `created` mais velho que o guardado (reenvio atrasado) não desfaz o mais novo.
  if (existing?.createdInFieldAt && existing.createdInFieldAt.getTime() > createdAt.getTime()) return {};
  return {
    fieldProjectCode: asText(event.payload.field_project_code),
    url: asText(event.payload.url),
    sowPlanStatus: asText(event.payload.sow_plan_status),
    tasksCount: asInt(event.payload.tasks_count),
    createdInFieldAt: createdAt,
  };
}

/** Avanço do dia: ignora snapshot de data anterior à guardada ou, no mesmo dia, de um instante anterior. */
function progressData(
  event: InboundEvent,
  existing: { progressDate: Date | null; progressEventAt: Date | null } | null,
  at: Date,
): Prisma.ProjectFieldWorkUncheckedUpdateInput {
  // Sem `date` válida o snapshot vale para o dia do evento (São Paulo não importa: o Field já manda `date` em São Paulo).
  const date = asDateOnly(event.payload.date) ?? asDateOnly(at.toISOString())!;
  const percent = asDecimal(event.payload.percent_complete);
  if (!percent) throw new Error('Evento "field.project.progress" sem "percent_complete" válido no payload.');
  if (existing?.progressDate) {
    const stored = existing.progressDate.getTime();
    const older = date.getTime() < stored || (date.getTime() === stored && existing.progressEventAt !== null && at.getTime() < existing.progressEventAt.getTime());
    if (older) return {};
  }
  return {
    progressDate: date,
    progressEventAt: at,
    percentComplete: Prisma.Decimal.min(Prisma.Decimal.max(percent, 0), 100),
    tasksTotal: asInt(event.payload.tasks_total),
    tasksDone: asInt(event.payload.tasks_done),
    realManHours: asDecimal(event.payload.real_man_hours),
    plannedManHours: asDecimal(event.payload.planned_man_hours),
  };
}
