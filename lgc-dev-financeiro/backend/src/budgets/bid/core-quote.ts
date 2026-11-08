/**
 * Cotação devolvida ao Core (integracao-core-financeiro §4, P-12/P-15): revisão aprovada para envio com a
 * Bid preenchida e a equipe orçada em quantidade por função. Nunca leva custo, salário, imposto ou lucro —
 * o Core recusa campos extras.
 *
 * O outbox guarda este retrato (sem o arquivo); o despachante junta a Bid guardada na revisão ao enviar.
 */

import { Prisma } from '@prisma/client';

export const CORE_QUOTE_EVENT = 'project_quote.ready';

/** Material orçado como o motor devolve (só o que a devolução usa; preço e custo nunca saem daqui). */
export interface QuoteMaterialLine {
  description: string;
  unit: string;
  quantity: string;
  logisticsMaterialCode: string | null;
  logisticsMaterialId?: string | null;
}

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
    materials: QuoteMaterialLine[];
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
  /** Materiais da Logística a enviar ao site (§4.1 do plano ponta a ponta). Sem preço nem custo. */
  materials: Array<{ material_code: string; description: string; unit: string; quantity: string }>;
  approved_at?: string;
  approved_by_email?: string;
}

/** Mensagem do outbox: projeto do Core, retrato da cotação e a revisão de onde vem a Bid. */
export interface CoreQuoteMessage {
  axis_project_id: string;
  revision_id: string;
  /** `false` no modelo `generico` (sem Bid). Mensagens antigas não têm o campo e valem como com Bid. */
  has_bid?: boolean;
  quote: CoreQuoteBody;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Quantidade enviada à Logística: texto decimal com 3 casas (a Logística movimenta com 3). */
const QTY_SCALE = 3;
const qty3 = (v: string) => new Prisma.Decimal(v || 0).toDecimalPlaces(QTY_SCALE, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Materiais da devolução (PA-08). Regras:
 * - só entra linha com quantidade > 0 depois de arredondar para 3 casas; linha zerada não vai ao site;
 * - toda linha que entra precisa de `logisticsMaterialCode`; o que falta volta em `problems`;
 * - o mesmo código em duas linhas vira uma só, com a quantidade somada (o Core recusa código repetido);
 *   se as unidades diferem, é um problema (não dá para somar metro com unidade);
 * - a quantidade é a orçada. As perdas do motor (`materialLossRate`) são um percentual sobre o **custo**,
 *   não somam quantidade, então não entram aqui; se a LGC quiser enviar com sobra, a sobra vai na quantidade
 *   da linha;
 * - nada de preço, markup, custo ou frete.
 */
export function buildCoreQuoteMaterials(lines: QuoteMaterialLine[]): { materials: CoreQuoteBody['materials']; problems: string[] } {
  const problems: string[] = [];
  const byCode = new Map<string, { material_code: string; description: string; unit: string; quantity: Prisma.Decimal }>();
  for (const line of lines) {
    const quantity = qty3(line.quantity);
    if (!quantity.gt(0)) continue;
    const code = line.logisticsMaterialCode?.trim();
    if (!code) {
      problems.push(`O material "${line.description}" não tem código da Logística. Escolha o item no catálogo da Logística.`);
      continue;
    }
    const unit = (line.unit || 'un').trim();
    const prev = byCode.get(code);
    if (!prev) {
      byCode.set(code, { material_code: code, description: line.description, unit, quantity });
    } else if (prev.unit !== unit) {
      problems.push(`O código ${code} aparece com unidades diferentes (${prev.unit} e ${unit}). Use a mesma unidade ou separe os materiais.`);
    } else {
      prev.quantity = prev.quantity.plus(quantity);
    }
  }
  const materials = [...byCode.values()].map((m) => ({ ...m, quantity: m.quantity.toFixed(QTY_SCALE) }));
  return { materials, problems };
}

/** Texto único dos materiais sem código ou conflitantes, para recusar a aprovação do envio. */
export function quoteMaterialsBlocker(lines: QuoteMaterialLine[]): string | null {
  const { problems } = buildCoreQuoteMaterials(lines);
  return problems.length ? `Há material sem vínculo com a Logística: ${problems.join(' ')}` : null;
}

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
  const { materials, problems } = buildCoreQuoteMaterials(src.result.materials);
  if (problems.length > 0) throw new Error(problems.join(' '));
  const { start, end } = src.schedule;
  return {
    external_revision_id: src.revisionId,
    revision_number: src.revisionNumber,
    ...(src.sowDocumentId ? { sow_document_id: src.sowDocumentId } : {}),
    work_days: src.result.workDays,
    ...(start ? { planned_start_date: start } : {}),
    ...(end && (!start || end >= start) ? { planned_end_date: end } : {}),
    team,
    materials,
    ...(src.approvedAt ? { approved_at: src.approvedAt.toISOString() } : {}),
    ...(src.approvedByEmail ? { approved_by_email: src.approvedByEmail } : {}),
  };
}
