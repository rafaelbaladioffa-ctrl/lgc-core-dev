import type { Prisma } from '@prisma/client';

export type BudgetAlertKind = 'ganha_conflito' | 'revisao_fora_de_enviada' | 'sem_centro_custo' | 'comprometido_duplicado';

/**
 * Grava um alerta aberto no orçamento (visível na tela do projeto). O mesmo alerta aberto da mesma revisão não se
 * repete: reentrega do evento ou novo clique não enche a tela.
 */
export async function raiseBudgetAlert(
  tx: Prisma.TransactionClient,
  alert: { budgetId: string; revisionId: string | null; kind: BudgetAlertKind; message: string; eventId?: string | null },
): Promise<boolean> {
  const open = await tx.budgetAlert.findFirst({ where: { budgetId: alert.budgetId, revisionId: alert.revisionId, kind: alert.kind, resolvedAt: null }, select: { id: true } });
  if (open) return false;
  await tx.budgetAlert.create({ data: { budgetId: alert.budgetId, revisionId: alert.revisionId, kind: alert.kind, message: alert.message, eventId: alert.eventId ?? null } });
  return true;
}
