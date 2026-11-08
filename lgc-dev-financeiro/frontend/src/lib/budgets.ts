import { api } from './api';

/** Tipos e chamadas do orçamento de projeto (PJ2). Valores chegam como texto decimal. */

export type RevisionStatus = 'rascunho' | 'em_aprovacao' | 'enviada' | 'ganha' | 'perdida' | 'substituida' | 'descartada';

export const REVISION_STATUS: Record<RevisionStatus, { label: string; tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  rascunho: { label: 'Rascunho', tone: 'warning' },
  em_aprovacao: { label: 'Em aprovação', tone: 'warning' },
  enviada: { label: 'Enviada', tone: 'neutral' },
  ganha: { label: 'Ganha', tone: 'success' },
  perdida: { label: 'Perdida', tone: 'danger' },
  substituida: { label: 'Substituída', tone: 'neutral' },
  descartada: { label: 'Descartada', tone: 'neutral' },
};

export const PROJECT_STATUS: Record<string, string> = { proposta: 'Proposta', aprovado: 'Aprovado', em_execucao: 'Em execução', encerrado: 'Encerrado' };

/** Projeto do Axis Core como o Financeiro guarda (nome e datas previstas desde a P-07). */
export interface CoreProject {
  axisProjectId: string;
  code: string;
  /** Nulo em projetos antigos do Core, ainda sem nome. */
  name: string | null;
  status: string | null;
  active: boolean;
  client: { code: string | null; name: string | null } | null;
  costCenter: { code: string | null; name: string | null } | null;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
}

export type DateSource = 'orcamento' | 'core' | null;

/** Cabeçalho do orçamento: título e datas próprios são opcionais; vazios, valem os do projeto no Core. */
export interface BudgetHeader {
  title: string | null;
  displayTitle: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  schedule: { start: { value: string | null; source: DateSource }; end: { value: string | null; source: DateSource } };
}

export interface ProjectRow extends CoreProject {
  budget:
    | (BudgetHeader & {
        id: string;
        revision: { id: string; number: number; status: RevisionStatus; revenue: string | null; profit?: string | null; profitOnCost?: string | null } | null;
      })
    | null;
}

export interface ProjectDetail extends CoreProject {
  budgets: Array<BudgetHeader & {
    id: string;
    model: string;
    createdAt: string;
    revisions: Array<{ id: string; number: number; status: RevisionStatus; parameterSetCode: string; revenue: string | null; profit?: string | null; profitOnCost?: string | null; updatedAt: string }>;
  }>;
}

export interface TeamInput {
  roleKey: string;
  people?: number | null;
  hours?: string | null;
}
export interface MaterialInput {
  materialId?: string | null;
  description: string;
  unit?: string | null;
  quantity: string;
  billedUnitPrice: string;
  realUnitCost?: string | null;
}
export interface BudgetInputs {
  workDays: number;
  team: TeamInput[];
  materials: MaterialInput[];
  materialFreight?: string | null;
  materialLossRate?: string | null;
  travel?: { destinationId?: string | null; destinationName?: string | null; kmRoundTrip?: string | null; tollPerDay?: string | null; cars?: number | null; carRentalPerDay?: string | null; parkingPerDay?: string | null };
  platform?: { days?: number | null; dailyBilled?: string | null; realCost?: string | null };
  lodging?: { people?: number | null; nights?: number | null; nightValue?: string | null; realCost?: string | null };
  meals?: { people?: number | null; days?: number | null; dayValue?: string | null; realCost?: string | null };
  extraLabor?: { overtimeCost?: string | null; onboardingCost?: string | null };
  otherCosts?: { epi?: string | null; tools?: string | null; insurance?: string | null; other?: string | null; otherDescription?: string | null };
}

export interface LaborLine {
  roleKey: string;
  label: string;
  fieldRole: boolean;
  people: number | null;
  hours: string;
  billingRate: string;
  billed: string;
  costPerHour?: string | null;
  cost?: string;
}
export interface MaterialLine {
  materialId: string | null;
  description: string;
  unit: string;
  quantity: string;
  billedUnitPrice: string;
  billed: string;
  realUnitCost?: string | null;
  cost?: string;
  estimatedCost?: boolean;
}

export interface BudgetResult {
  workDays: number;
  fieldHours: string;
  vehicleDays: number;
  kmTotal: string;
  labor: LaborLine[];
  materials: MaterialLine[];
  revenue: { labor: string; material: string; travel: string; platform: string; lodgingMeals: string; total: string };
  warnings: string[];
  // Só com budget:read_cost
  taxes?: { rate: string | null; amount: string };
  directCosts?: {
    labor: string;
    laborDetail: { hours: string; overtime: string; onboarding: string };
    material: string;
    materialDetail: { items: string; freight: string; losses: string };
    travel: string;
    travelDetail: { fuel: string; tolls: string; wear: string; rentalAndParking: string };
    platform: string;
    lodgingMeals: string;
    other: string;
    total: string;
  };
  indirect?: { contingency: string; overhead: string; commission: string; financial: string; total: string };
  result?: {
    contributionMargin: string;
    profit: string;
    totalCost: string;
    profitOnCost: string | null;
    margin: string | null;
    target: string | null;
    status: 'PREJUIZO' | 'ABAIXO_DA_META' | 'META_ATINGIDA';
    profitPerDay: string | null;
    profitPerFieldHour: string | null;
  };
  pricing?: { minimumPrice: string | null; targetPrice: string | null; gapToTarget: string | null; hourRatesForTarget: Array<{ roleKey: string; label: string; current: string; needed: string }> };
  groups?: Array<{ key: string; label: string; billed: string; cost: string; result: string; profitOnCost: string | null }>;
  estimatedCost?: boolean;
}

export interface Revision {
  id: string;
  number: number;
  code: string;
  status: RevisionStatus;
  notes: string | null;
  budget: BudgetHeader & { id: string; model: string; axisProjectId: string; projectCode: string };
  project: CoreProject | null;
  parameterSet: { id: string; code: string; status: string; hoursPerDay: string | null; kmRate: string | null; materialMarkup: string | null; platformDailyBilled: string | null };
  currentParameterSet: { id: string; code: string } | null;
  roles: Array<{ roleKey: string; label: string; fieldRole: boolean; billingRate: string | null }>;
  inputs: BudgetInputs;
  result: BudgetResult | null;
  costVisible: boolean;
  revisions: Array<{ id: string; number: number; status: RevisionStatus }>;
  updatedAt: string;
}

export const listProjects = () => api<{ lastSyncedAt: string | null; projects: ProjectRow[] }>('/projects');
export const syncProjects = () => api<{ clients: number; projects: number; updated: number }>('/projects/sync', { method: 'POST', body: '{}' });
export const getProject = (id: string) => api<ProjectDetail>(`/projects/${encodeURIComponent(id)}`);
export const createBudget = (axisProjectId: string) => api<{ budgetId: string; revisionId: string }>('/budgets', { method: 'POST', body: JSON.stringify({ axisProjectId }) });
export const updateBudget = (id: string, body: { title?: string | null; plannedStartDate?: string | null; plannedEndDate?: string | null }) =>
  api<BudgetHeader>(`/budgets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const newRevision =(budgetId: string) => api<{ revisionId: string }>(`/budgets/${budgetId}/revisions`, { method: 'POST', body: '{}' });
export const getRevision = (id: string) => api<Revision>(`/revisions/${id}`);
export const saveRevision = (id: string, body: { inputs?: BudgetInputs; notes?: string | null }) => api<Revision>(`/revisions/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const simulateRevision = (id: string, inputs: BudgetInputs) => api<BudgetResult>(`/revisions/${id}/simulate`, { method: 'POST', body: JSON.stringify({ inputs }) });
export const useCurrentParameters = (id: string) => api<Revision>(`/revisions/${id}/use-current-parameters`, { method: 'POST', body: '{}' });
export const discardRevision = (id: string) => api<Revision>(`/revisions/${id}/discard`, { method: 'POST', body: '{}' });
