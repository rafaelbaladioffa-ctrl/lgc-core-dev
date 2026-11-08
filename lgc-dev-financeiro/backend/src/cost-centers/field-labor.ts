import { D, ZERO, isoDate, type Dec } from './cc-engine.js';
import type { LaborHourRow } from './field.client.js';

/**
 * Mão de obra realizada por projeto (PT-10, plano ponta a ponta PA-14 e §4.5). Funções puras: o serviço lê o cache,
 * as alocações e os parâmetros e entrega o que resolveu aqui.
 *
 * Cada (colaborador, projeto, dia) do Field vira um **par** de lançamentos realizados, ambos categoria `folha`:
 *  - `custo`: horas × custo hora médio da função, no CC do projeto e com o projeto (aparece no resultado do projeto);
 *  - `credito`: o mesmo valor **negativo** no CC de origem do colaborador no dia (a alocação vigente), sem projeto.
 * A folha inteira já cai no CC do colaborador (`generatePayroll`); o crédito tira de lá a parte que o projeto assumiu.
 * Com o mesmo CC nos dois lados o par se anula no total do CC, mas o projeto passa a mostrar a mão de obra.
 */

export const LABOR_REF_PREFIX = 'mao_obra:';
export type LaborPart = 'custo' | 'credito';
export const laborRef = (date: string, projectId: string, collaboratorId: string, part: LaborPart) => `${LABOR_REF_PREFIX}${date}:${projectId}:${collaboratorId}:${part}`;
export const isLaborCredit = (sourceRef: string | null) => !!sourceRef && sourceRef.startsWith(LABOR_REF_PREFIX) && sourceRef.endsWith(':credito');

export type PendingReason = 'sem_funcao' | 'sem_custo_funcao' | 'projeto_desconhecido' | 'projeto_sem_cc' | 'sem_cc_origem';

export const PENDING_LABEL: Record<PendingReason, string> = {
  sem_funcao: 'Cargo do colaborador sem função mapeada (Cargos × funções)',
  sem_custo_funcao: 'Função sem custo hora nos parâmetros de custo',
  projeto_desconhecido: 'Projeto não encontrado no Financeiro (atualize os projetos do Core)',
  projeto_sem_cc: 'Projeto sem centro de custo',
  sem_cc_origem: 'Colaborador sem centro de custo de origem na data',
};

export interface LaborLine {
  ref: string;
  part: LaborPart;
  costCenterAxisId: string;
  projectAxisId: string | null;
  competence: Date;
  amount: Dec;
  description: string;
}

export interface LaborDayPlan {
  collaboratorAxisId: string;
  projectAxisId: string;
  date: string;
  hours: Dec;
  adjusted: boolean;
  status: 'lancado' | 'pendente';
  pendingReason: PendingReason | null;
  projectCostCenterAxisId: string | null;
  originCostCenterAxisId: string | null;
}

export interface LaborResolver {
  /** CC do projeto e se o projeto existe no cache. */
  project(projectId: string): { known: boolean; costCenterId: string | null; code: string | null };
  /** Função do orçamento do colaborador (cargo → função), ou null. */
  roleOf(collaboratorId: string): string | null;
  /** Custo hora médio da função na data (parâmetros vigentes), ou null. */
  rateAt(roleKey: string, date: string): Dec | null;
  /** CC de origem (alocação vigente) do colaborador no dia. */
  originAt(collaboratorId: string, date: string): string | null;
}

export const monthStart = (date: string) => new Date(`${date.slice(0, 7)}-01T00:00:00Z`);

/** Resolve as linhas do Field em dias lançados (com o par de lançamentos) e pendentes (com o motivo). */
export function planLabor(rows: LaborHourRow[], resolver: LaborResolver): { days: LaborDayPlan[]; lines: LaborLine[] } {
  // Defesa: o Field manda uma linha por chave; se repetir, soma.
  const merged = new Map<string, LaborHourRow & { dec: Dec }>();
  for (const r of rows) {
    const key = `${r.date}|${r.axisProjectId}|${r.axisCollaboratorId}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, dec: prev.dec.plus(r.hours), adjusted: prev.adjusted || r.adjusted } : { ...r, dec: new D(r.hours) });
  }
  const days: LaborDayPlan[] = [];
  const lines: LaborLine[] = [];
  for (const r of [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || a.axisProjectId.localeCompare(b.axisProjectId) || a.axisCollaboratorId.localeCompare(b.axisCollaboratorId))) {
    const project = resolver.project(r.axisProjectId);
    const origin = resolver.originAt(r.axisCollaboratorId, r.date);
    const roleKey = resolver.roleOf(r.axisCollaboratorId);
    const rate = roleKey ? resolver.rateAt(roleKey, r.date) : null;
    const day: LaborDayPlan = {
      collaboratorAxisId: r.axisCollaboratorId,
      projectAxisId: r.axisProjectId,
      date: r.date,
      hours: r.dec,
      adjusted: r.adjusted,
      status: 'pendente',
      pendingReason: null,
      projectCostCenterAxisId: project.costCenterId,
      originCostCenterAxisId: origin,
    };
    if (!project.known) day.pendingReason = 'projeto_desconhecido';
    else if (!project.costCenterId) day.pendingReason = 'projeto_sem_cc';
    else if (!roleKey) day.pendingReason = 'sem_funcao';
    else if (!rate) day.pendingReason = 'sem_custo_funcao';
    else if (!origin) day.pendingReason = 'sem_cc_origem';
    days.push(day);
    if (day.pendingReason) continue;

    day.status = 'lancado';
    const amount = r.dec.mul(rate!).toDecimalPlaces(2, D.ROUND_HALF_UP);
    if (amount.isZero()) continue;
    const competence = monthStart(r.date);
    const projectLabel = project.code ?? r.axisProjectId;
    lines.push({
      ref: laborRef(r.date, r.axisProjectId, r.axisCollaboratorId, 'custo'),
      part: 'custo',
      costCenterAxisId: project.costCenterId!,
      projectAxisId: r.axisProjectId,
      competence,
      amount,
      description: `Mão de obra do projeto ${projectLabel} (horas do Field) — ${r.date}`,
    });
    lines.push({
      ref: laborRef(r.date, r.axisProjectId, r.axisCollaboratorId, 'credito'),
      part: 'credito',
      costCenterAxisId: origin!,
      projectAxisId: null,
      competence,
      amount: amount.negated(),
      description: `Mão de obra transferida ao projeto ${projectLabel} — ${r.date}`,
    });
  }
  return { days, lines };
}

export const totalHours = (days: Array<Pick<LaborDayPlan, 'hours'>>) => days.reduce((acc, d) => acc.plus(d.hours), ZERO);

/** Dia seguinte (AAAA-MM-DD), para o limite exclusivo da faixa de referências. */
export function nextDay(date: string): string {
  return isoDate(new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000));
}
