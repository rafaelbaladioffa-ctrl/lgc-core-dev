import { api } from './client';

export type CostCenterKind = 'divisao' | 'administrativo' | 'operacional' | 'equipe_tecnica';
export type CostCenterBudgetStatus = 'ok' | 'alerta' | 'estourado';

export const COST_CENTER_KIND_LABELS: Record<CostCenterKind, string> = {
  divisao: 'Divisão',
  administrativo: 'Administrativo',
  operacional: 'Operacional',
  equipe_tecnica: 'Equipe técnica',
};

export const COST_CENTER_BUDGET_LABELS: Record<CostCenterBudgetStatus, string> = {
  ok: 'Orçamento ok',
  alerta: 'Orçamento em alerta',
  estourado: 'Orçamento estourado',
};

/** Sigla: maiúsculas, dígitos e hífen (ex.: DC-001-JAI), até 30 caracteres — mesma regra do servidor. */
export const COST_CENTER_SHORT_CODE_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  parentCostCenterId: string | null;
  responsibleCollaboratorId: string | null;
  responsibleCollaborator?: { id: string; fullName: string } | null;
  kind: CostCenterKind;
  shortCode: string | null;
  /** Situação do orçamento informada pelo Financeiro (só leitura). */
  budgetStatus: CostCenterBudgetStatus | null;
  /** Percentual de consumo (0–999), em string decimal. */
  budgetPercent: string | null;
  budgetYear: number | null;
  budgetStatusAt: string | null;
}

export interface CreateCostCenterInput {
  name: string;
  sectorId: string;
  parentCostCenterId?: string;
  responsibleCollaboratorId?: string;
  kind?: CostCenterKind;
  /** `null` limpa a sigla. */
  shortCode?: string | null;
}

export interface UpdateCostCenterInput {
  name?: string;
  sectorId?: string;
  responsibleCollaboratorId?: string;
  kind?: CostCenterKind;
  shortCode?: string | null;
}

export const costCentersApi = {
  list: () => api.get<CostCenter[]>('/cost-centers').then((r) => r.data),
  get: (id: string) => api.get<CostCenter>(`/cost-centers/${id}`).then((r) => r.data),
  create: (input: CreateCostCenterInput) => api.post<CostCenter>('/cost-centers', input).then((r) => r.data),
  update: (id: string, input: UpdateCostCenterInput) =>
    api.put<CostCenter>(`/cost-centers/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/cost-centers/${id}`),
};
