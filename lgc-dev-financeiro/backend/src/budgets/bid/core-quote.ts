/**
 * Cotação devolvida ao Core (integracao-core-financeiro §4, P-12/P-15): revisão aprovada para envio com a
 * Bid preenchida e a equipe orçada em quantidade por função. Nunca leva custo, salário, imposto ou lucro —
 * o Core recusa campos extras.
 *
 * O outbox guarda este retrato (sem o arquivo); o despachante junta a Bid guardada na revisão ao enviar.
 */

export const CORE_QUOTE_EVENT = 'project_quote.ready';

export interface CoreQuoteSource {
  revisionId: string;
  revisionNumber: number;
  approvedAt: Date | null;
  approvedByEmail: string | null;
  sowDocumentId: string | null;
  schedule: { start: string | null; end: string | null };
  result: {
    workDays: number;
    labor: Array<{ roleKey: string; label: string; fieldRole: boolean; people: number | null; hours: string }>;
  };
}

/** Corpo do `POST /integration/projects/:id/quotes`, sem o campo `bid`. */
export interface CoreQuoteBody {
  external_revision_id: string;
  revision_number: number;
  sow_document_id?: string;
  work_days: number;
  planned_start_date?: string;
  planned_end_date?: string;
  team: Array<{ role_key: string; role_name: string; field_role: boolean; people?: number; days?: number; hours: number }>;
  approved_at?: string;
  approved_by_email?: string;
}

/** Mensagem do outbox: projeto do Core, retrato da cotação e a revisão de onde vem a Bid. */
export interface CoreQuoteMessage {
  axis_project_id: string;
  revision_id: string;
  quote: CoreQuoteBody;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Função de campo leva pessoas e os dias da revisão (todas as funções de campo trabalham os mesmos dias, §5);
 * o gerente vai só com horas. Funções sem pessoas nem horas ficam de fora.
 */
export function buildCoreQuoteBody(src: CoreQuoteSource): CoreQuoteBody {
  if (!(src.result.workDays > 0)) throw new Error('A revisão não tem dias de trabalho.');
  const team = src.result.labor
    .map((l) => {
      const hours = round2(Number(l.hours) || 0);
      return l.fieldRole
        ? { role_key: l.roleKey, role_name: l.label, field_role: true, people: l.people ?? 0, days: src.result.workDays, hours }
        : { role_key: l.roleKey, role_name: l.label, field_role: false, hours };
    })
    .filter((l) => (l.field_role ? (l.people ?? 0) > 0 : l.hours > 0));
  if (team.length === 0) throw new Error('A revisão não tem equipe orçada.');
  const { start, end } = src.schedule;
  return {
    external_revision_id: src.revisionId,
    revision_number: src.revisionNumber,
    ...(src.sowDocumentId ? { sow_document_id: src.sowDocumentId } : {}),
    work_days: src.result.workDays,
    ...(start ? { planned_start_date: start } : {}),
    ...(end && (!start || end >= start) ? { planned_end_date: end } : {}),
    team,
    ...(src.approvedAt ? { approved_at: src.approvedAt.toISOString() } : {}),
    ...(src.approvedByEmail ? { approved_by_email: src.approvedByEmail } : {}),
  };
}
