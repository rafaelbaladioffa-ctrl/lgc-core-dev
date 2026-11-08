import type { BudgetRevisionStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

/**
 * Regras puras do fluxo da revisão (projetos-especificacao §3). O serviço aplica; o banco garante as
 * transições (gatilho `budget_revisions_transition`) e os índices de uma enviada/ganha por orçamento.
 */

export type WorkflowAction = 'submit' | 'return' | 'approve_send' | 'won' | 'lost' | 'discard';

interface ActionRule {
  from: BudgetRevisionStatus;
  to: BudgetRevisionStatus;
  permission: 'budget:write' | 'budget:approve';
  /** Nome gravado no histórico. */
  event: string;
  reasonRequired: boolean;
  label: string;
}

export const WORKFLOW: Record<WorkflowAction, ActionRule> = {
  submit: { from: 'rascunho', to: 'em_aprovacao', permission: 'budget:write', event: 'submitted', reasonRequired: false, label: 'Submeter para aprovação' },
  return: { from: 'em_aprovacao', to: 'rascunho', permission: 'budget:approve', event: 'returned', reasonRequired: true, label: 'Devolver para ajuste' },
  approve_send: { from: 'em_aprovacao', to: 'enviada', permission: 'budget:approve', event: 'send_approved', reasonRequired: false, label: 'Aprovar envio' },
  won: { from: 'enviada', to: 'ganha', permission: 'budget:approve', event: 'won', reasonRequired: false, label: 'Cliente aceitou' },
  lost: { from: 'enviada', to: 'perdida', permission: 'budget:approve', event: 'lost', reasonRequired: true, label: 'Cliente recusou' },
  discard: { from: 'rascunho', to: 'descartada', permission: 'budget:write', event: 'discarded', reasonRequired: false, label: 'Descartar rascunho' },
};

export const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submetida para aprovação',
  returned: 'Devolvida para ajuste',
  send_approved: 'Envio aprovado',
  won: 'Ganha (cliente aceitou)',
  lost: 'Perdida (cliente recusou)',
  superseded: 'Substituída por revisão mais nova',
  discarded: 'Descartada',
};

/** Ações que este usuário pode fazer agora nesta revisão (a tela só mostra estas). */
export function allowedActions(status: BudgetRevisionStatus, user: Pick<AuthenticatedUser, 'permissions'>): WorkflowAction[] {
  return (Object.keys(WORKFLOW) as WorkflowAction[]).filter((a) => WORKFLOW[a].from === status && user.permissions.includes(WORKFLOW[a].permission));
}

/** Por que a revisão ainda não pode ser submetida (vazio = pode). */
export function submitBlockers(result: { revenue?: { total?: string }; fieldHours?: string; workDays?: number } | null): string[] {
  if (!result) return ['A revisão ainda não foi calculada.'];
  const blockers: string[] = [];
  if (!(Number(result.workDays) > 0)) blockers.push('Informe os dias de trabalho.');
  if (!(Number(result.fieldHours) > 0)) blockers.push('Informe a equipe de campo (pessoas).');
  if (!(Number(result.revenue?.total) > 0)) blockers.push('O valor da proposta está zerado.');
  return blockers;
}

/**
 * Avisos de divergência com o status do projeto no Core (§3.2). O Financeiro não altera o Core; só avisa.
 * "Feche o realizado" entra com a PJ5.
 */
export function coreDivergence(coreStatus: string | null, revisionStatuses: BudgetRevisionStatus[]): string[] {
  const won = revisionStatuses.includes('ganha');
  if ((coreStatus === 'aprovado' || coreStatus === 'em_execucao') && !won) return ['Projeto aprovado sem orçamento ganho'];
  if (coreStatus === 'proposta' && won) return ['Atualize o status do projeto no Core'];
  return [];
}
