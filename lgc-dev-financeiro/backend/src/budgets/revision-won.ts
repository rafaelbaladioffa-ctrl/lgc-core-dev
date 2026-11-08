import type { Prisma } from '@prisma/client';
import { UnprocessableEventError } from '../integration/unprocessable-event.error.js';
import { parseDate, todaySaoPaulo } from '../cost-centers/cc-engine.js';
import { raiseBudgetAlert } from './budget-alerts.js';
import { commitmentAlert, postWonCommitments, SYSTEM_ACTOR, type WonCommitmentStatus } from './won-commitments.js';

/**
 * `project.approved` do Core (plano ponta a ponta §4.2): a revisão que o cliente aceitou (`accepted_quote.
 * external_revision_id`, o id da revisão aqui) passa de `enviada` a `ganha` e lança o comprometido no CC. É a mesma
 * regra da ação manual "Cliente aceitou" (`BudgetsService.transition`, ação `won`): mesma transição, mesmo histórico
 * e auditoria, mesmo `postWonCommitments`; a diferença é o ator (`sistema:core`) e o registro de que veio do Core.
 */

export interface ProjectApproval {
  projectAxisId: string;
  revisionId: string;
  /** Instante da aprovação no Core (`approved_at`); vira a data da decisão e a competência do comprometido. */
  approvedAt: Date;
  /** CC que o evento trouxe (estado completo do projeto); vale quando o cache ainda não o tem. */
  costCenterAxisId: string | null;
  clientPoNumber: string | null;
  eventId: string;
}

export type ApprovalOutcome =
  | { result: 'won'; commitments: WonCommitmentStatus }
  | { result: 'already_won'; commitments: WonCommitmentStatus }
  | { result: 'other_won' }
  | { result: 'not_sent'; status: string };

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'rascunho',
  em_aprovacao: 'em aprovação',
  enviada: 'enviada',
  ganha: 'ganha',
  perdida: 'perdida',
  substituida: 'substituída',
  descartada: 'descartada',
};

export async function winRevisionFromCore(tx: Prisma.TransactionClient, a: ProjectApproval): Promise<ApprovalOutcome> {
  const rev = await tx.budgetRevision.findUnique({ where: { id: a.revisionId }, include: { budget: true } });
  if (!rev) throw new UnprocessableEventError(`Revisão ${a.revisionId} não encontrada no Financeiro (accepted_quote.external_revision_id). Confira se a cotação aprovada no Core veio deste Financeiro.`);
  if (rev.budget.axisProjectId !== a.projectAxisId) {
    throw new UnprocessableEventError(`A revisão ${a.revisionId} pertence a outro projeto (${rev.budget.projectCode}); o evento é do projeto ${a.projectAxisId}.`);
  }
  const label = `R${rev.number} (${rev.budget.projectCode})`;
  const costCenterAxisId = a.costCenterAxisId ?? (await cachedCostCenter(tx, a.projectAxisId));
  const commit = async (): Promise<WonCommitmentStatus> => {
    const { status } = await postWonCommitments(tx, {
      revisionId: rev.id,
      revisionNumber: rev.number,
      projectCode: rev.budget.projectCode,
      axisProjectId: a.projectAxisId,
      costCenterAxisId,
      competence: parseDate(todaySaoPaulo(a.approvedAt)),
      revenue: rev.revenue,
      result: rev.result,
    });
    const alert = commitmentAlert(status, rev.number);
    if (alert) await raiseBudgetAlert(tx, { budgetId: rev.budgetId, revisionId: rev.id, eventId: a.eventId, ...alert });
    return status;
  };

  if (rev.status === 'ganha') return { result: 'already_won', commitments: await commit() };

  if (rev.status !== 'enviada') {
    await raiseBudgetAlert(tx, {
      budgetId: rev.budgetId,
      revisionId: rev.id,
      kind: 'revisao_fora_de_enviada',
      eventId: a.eventId,
      message: `O Core aprovou o projeto com a revisão ${label}, mas ela está ${STATUS_LABEL[rev.status] ?? rev.status} no Financeiro e só uma revisão enviada pode ser ganha. Nada foi alterado: confira a cotação aceita no Core.`,
    });
    return { result: 'not_sent', status: rev.status };
  }

  const other = await tx.budgetRevision.findFirst({ where: { budgetId: rev.budgetId, status: 'ganha', id: { not: rev.id } }, select: { number: true } });
  if (other) {
    await raiseBudgetAlert(tx, {
      budgetId: rev.budgetId,
      revisionId: rev.id,
      kind: 'ganha_conflito',
      eventId: a.eventId,
      message: `O Core aprovou o projeto com a revisão ${label}, mas a R${other.number} já está ganha neste orçamento. A R${other.number} foi mantida; confira qual cotação o cliente aceitou.`,
    });
    return { result: 'other_won' };
  }

  await tx.budgetRevision.update({ where: { id: rev.id }, data: { status: 'ganha', decidedAt: a.approvedAt, updatedBy: SYSTEM_ACTOR } });
  const reason = `Aprovado no Core (project.approved)${a.clientPoNumber ? `, PO ${a.clientPoNumber}` : ''}.`;
  await tx.budgetRevisionEvent.create({ data: { revisionId: rev.id, action: 'won', fromStatus: 'enviada', toStatus: 'ganha', reason, actorAxisId: SYSTEM_ACTOR, actorEmail: null } });
  const commitments = await commit();
  await tx.auditEvent.create({
    data: {
      actorAxisId: SYSTEM_ACTOR,
      action: 'budget_revision.won',
      aggregateType: 'budget_revision',
      aggregateId: rev.id,
      diff: { project: rev.budget.projectCode, revision: rev.number, before: 'enviada', after: 'ganha', reason, via: 'core', eventId: a.eventId, clientPoNumber: a.clientPoNumber, commitments },
      origin: 'webhook core',
    },
  });
  return { result: 'won', commitments };
}

/** CC do projeto no cache de mestres do Core. */
export async function cachedCostCenter(tx: Prisma.TransactionClient, axisProjectId: string): Promise<string | null> {
  const p = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: axisProjectId } }, select: { data: true } });
  const id = (p?.data as Record<string, unknown> | null | undefined)?.['cost_center_id'];
  return typeof id === 'string' && id !== '' ? id : null;
}
