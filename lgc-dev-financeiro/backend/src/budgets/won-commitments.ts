import { Prisma, type CcCategory } from '@prisma/client';

/**
 * Comprometido da revisão ganha (plano ponta a ponta, PA-13): ao ganhar, a receita contratada e os custos orçados
 * viram lançamentos `comprometido` no CC do projeto, com o projeto e `sourceRef = ganho:<revisão>:<linha>`.
 * É o único caminho: a marcação manual ("Cliente aceitou") e o evento `project.approved` do Core chamam
 * `postWonCommitments`, que não duplica (a revisão ganha é imutável, então não há o que recalcular).
 *
 * Regra de comprometido × realizado (documentada em centros-de-custo-especificacao §5): sem estorno. O realizado
 * chega em categorias do CC que não casam uma a uma com as linhas do orçamento; o resultado do projeto mostra o
 * comprometido líquido (comprometido − realizado, por grupo) e o orçamento anual do CC ignora estes lançamentos.
 */

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;

export const WON_SOURCE_PREFIX = 'ganho:';
export const wonRefPrefix = (revisionId: string) => `${WON_SOURCE_PREFIX}${revisionId}:`;
export const SYSTEM_ACTOR = 'sistema:core';

const num = (v: unknown): Dec => {
  if (v === null || v === undefined || v === '') return new D(0);
  try {
    const d = new D(v as Prisma.Decimal.Value);
    return d.isFinite() ? d : new D(0);
  } catch {
    return new D(0);
  }
};

interface DirectCosts {
  labor?: unknown;
  material?: unknown;
  materialDetail?: { items?: unknown; freight?: unknown; losses?: unknown };
  travel?: unknown;
  platform?: unknown;
  lodgingMeals?: unknown;
  other?: unknown;
}

export interface CommitmentLine {
  /** Parte final do `sourceRef`. */
  key: string;
  label: string;
  kind: 'receita' | 'custo';
  category: CcCategory;
  amount: Dec;
}

/**
 * Linhas do comprometido a partir do resultado da revisão: receita contratada (a coluna `revenue`) e os custos
 * diretos orçados por categoria do CC. Contingência e indiretos não entram (não são gasto do projeto).
 * Linha zerada não gera lançamento.
 */
export function buildCommitmentLines(revenue: Prisma.Decimal.Value | null | undefined, result: unknown): CommitmentLine[] {
  const direct = ((result as { directCosts?: DirectCosts } | null)?.directCosts ?? {}) as DirectCosts;
  const detail = direct.materialDetail;
  // Sem detalhe de material (resultado antigo), o total de material vai inteiro em Material.
  const freight = detail ? num(detail.freight) : new D(0);
  const material = detail ? num(detail.items).plus(num(detail.losses)) : num(direct.material);
  const lines: CommitmentLine[] = [
    { key: 'receita', label: 'Receita contratada', kind: 'receita', category: 'faturamento', amount: num(revenue) },
    { key: 'mao_de_obra', label: 'Mão de obra', kind: 'custo', category: 'folha', amount: num(direct.labor) },
    { key: 'material', label: 'Material', kind: 'custo', category: 'material', amount: material },
    { key: 'frete', label: 'Frete do material', kind: 'custo', category: 'material', amount: freight },
    { key: 'deslocamento', label: 'Deslocamento', kind: 'custo', category: 'frota', amount: num(direct.travel) },
    { key: 'plataforma', label: 'Plataforma', kind: 'custo', category: 'servicos', amount: num(direct.platform) },
    { key: 'hospedagem_alimentacao', label: 'Hospedagem e alimentação', kind: 'custo', category: 'despesas_campo', amount: num(direct.lodgingMeals) },
    { key: 'outros', label: 'Outros custos', kind: 'custo', category: 'outros', amount: num(direct.other) },
  ];
  return lines.filter((l) => l.amount.toDecimalPlaces(2).gt(0));
}

export interface WonCommitmentInput {
  revisionId: string;
  revisionNumber: number;
  projectCode: string;
  axisProjectId: string;
  /** CC do projeto no cache do Core (ou o que o evento trouxe). */
  costCenterAxisId: string | null;
  /** Data da aceitação (dia em São Paulo, à meia-noite UTC). */
  competence: Date;
  revenue: Prisma.Decimal.Value | null | undefined;
  result: unknown;
  actor?: string;
}

/**
 * - `posted`: lançou o comprometido agora;
 * - `exists`: a revisão já tinha o comprometido (reentrega, manual + evento);
 * - `no_cost_center`: o projeto não tem CC no cache do Core; nada foi lançado (a revisão ganha mesmo assim, com alerta);
 * - `other_baseline`: outra revisão do mesmo projeto (de outro orçamento) já é a linha de base no CC; não duplica;
 * - `nothing`: a revisão não tem valor nenhum a comprometer.
 */
export type WonCommitmentStatus = 'posted' | 'exists' | 'no_cost_center' | 'other_baseline' | 'nothing';

export async function postWonCommitments(tx: Prisma.TransactionClient, input: WonCommitmentInput): Promise<{ status: WonCommitmentStatus; entries: number }> {
  const prefix = wonRefPrefix(input.revisionId);
  const done = await tx.ccEntry.findFirst({ where: { sourceRef: { startsWith: prefix } }, select: { id: true } });
  if (done) return { status: 'exists', entries: 0 };
  if (!input.costCenterAxisId) return { status: 'no_cost_center', entries: 0 };
  const other = await tx.ccEntry.findFirst({ where: { projectAxisId: input.axisProjectId, source: 'projeto', sourceRef: { startsWith: WON_SOURCE_PREFIX }, NOT: { sourceRef: { startsWith: prefix } } }, select: { id: true } });
  if (other) return { status: 'other_baseline', entries: 0 };
  const lines = buildCommitmentLines(input.revenue, input.result);
  for (const line of lines) {
    await tx.ccEntry.create({
      data: {
        costCenterAxisId: input.costCenterAxisId,
        projectAxisId: input.axisProjectId,
        competence: input.competence,
        kind: line.kind,
        category: line.category,
        stage: 'comprometido',
        source: 'projeto',
        amount: line.amount.toDecimalPlaces(2),
        description: `Comprometido ${input.projectCode} R${input.revisionNumber} — ${line.label}`,
        sourceRef: `${prefix}${line.key}`,
        createdBy: input.actor ?? SYSTEM_ACTOR,
      },
    });
  }
  return { status: lines.length ? 'posted' : 'nothing', entries: lines.length };
}

/** Texto do alerta para cada situação em que o comprometido não foi lançado. */
export function commitmentAlert(status: WonCommitmentStatus, revisionNumber: number): { kind: 'sem_centro_custo' | 'comprometido_duplicado'; message: string } | null {
  if (status === 'no_cost_center') {
    return { kind: 'sem_centro_custo', message: `A revisão R${revisionNumber} ficou ganha, mas o projeto não tem centro de custo no Financeiro: o comprometido não foi lançado. Atualize os cadastros do Core e peça o reenvio do evento de aprovação.` };
  }
  if (status === 'other_baseline') {
    return { kind: 'comprometido_duplicado', message: `A revisão R${revisionNumber} ficou ganha, mas outra revisão deste projeto (em outro orçamento) já é a linha de base no centro de custo: o comprometido não foi duplicado.` };
  }
  return null;
}
