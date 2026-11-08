import { api, apiDownload } from './api';

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
  /** Divergências com o status do projeto no Core (§3.2). */
  warnings: string[];
  budget:
    | (BudgetHeader & {
        id: string;
        revision: { id: string; number: number; status: RevisionStatus; revenue: string | null; profit?: string | null; profitOnCost?: string | null } | null;
      })
    | null;
}

export interface ProjectDetail extends CoreProject {
  warnings: string[];
  budgets: Array<BudgetHeader & {
    id: string;
    model: string;
    createdAt: string;
    revisions: Array<{
      id: string;
      number: number;
      status: RevisionStatus;
      parameterSetCode: string;
      revenue: string | null;
      profit?: string | null;
      profitOnCost?: string | null;
      updatedAt: string;
      approvedAt: string | null;
      approvedByEmail: string | null;
    }>;
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

export type WorkflowAction = 'submit' | 'return' | 'approve_send' | 'won' | 'lost' | 'discard';

export interface RevisionWorkflowInfo {
  /** O que este usuário pode fazer agora (calculado no servidor pela situação e pelas permissões). */
  allowedActions: WorkflowAction[];
  submitBlockers: string[];
  submittedAt: string | null;
  approvedAt: string | null;
  approvedByEmail: string | null;
  decidedAt: string | null;
  events: Array<{ id: string; action: string; label: string; fromStatus: RevisionStatus; toStatus: RevisionStatus; reason: string | null; actorEmail: string | null; createdAt: string }>;
}

export interface SowCableLine {
  type: string;
  kind: 'fibra' | 'cobre' | 'outro';
  fibers: number;
  lengthM: number;
  quantity: number;
}

/** SOW lida na revisão (PJ4, §7.1). O texto original vem à parte (GET /revisions/:id/sow/text). */
export interface RevisionSow {
  source: 'core_pdf' | 'texto';
  quoteRequestId: string | null;
  sowDocumentId: string | null;
  sowVersion: number | null;
  pages: number | null;
  header: {
    sowType: string | null;
    projectType: string | null;
    fbn: string | null;
    sites: string | null;
    projectName: string | null;
    spsProjectId: string | null;
    sowUid: string | null;
    walkthroughAt: string | null;
    bidDueAt: string | null;
    poDate: string | null;
    startDate: string | null;
    endDate: string | null;
    contacts: { primary: string | null; secondary: string | null; team: string | null };
    platform: 'pedida' | 'nao_precisa' | 'nao_mencionada';
  };
  devices: { total: number; live: number; notLive: number };
  cables: SowCableLine[];
  edited: boolean;
  types: Array<{ type: string; kind: SowCableLine['kind']; fibers: number; quantity: number; meters: number; averageLengthM: number; ports: number }>;
  totals: { cables: number; meters: number; ports: number };
  warnings: string[];
  importedAt: string;
  importedBy: string;
  updatedAt: string;
}

export type KpiKey = 'efficiency' | 'costPerPort' | 'laborCostPerPort' | 'hoursPerPort' | 'hoursPerMeter';

/** Metas lidas do Bid Template do RFQ (§7.3). */
export interface BidTargets {
  templateVersion: string | null;
  cluster: string | null;
  currency: string | null;
  fx: number | null;
  targets: { costPerPortUsd: number | null; hoursPerPort: number | null; hoursPerMeter: number | null; laborCostPerPortUsd: number | null; hoursPerDevice: number | null };
  converted: { costPerPort: number | null; laborCostPerPort: number | null };
  weights: { meters: number; ports: number; devices: number };
  thresholds: Record<KpiKey, number>;
  warnings: string[];
}

/** Cotação no modelo aws_sow (§7.2–§7.4), calculada no servidor. */
export interface AwsQuote {
  totals: { targetHours: number; meters: number; ports: number; fieldHours: number; totalLaborHours: number; fieldPeople: number };
  perType: Array<{ type: string; kind: string; fibers: number; quantity: number; averageLengthM: number; consideredMeters: number; ports: number; targetHours: number; hoursTAuto: number; hoursT: number; overridden: boolean }>;
  hoursTSum: number;
  hoursTMatches: boolean;
  suggestedDays: number | null;
  /** 1 encarregado + técnicos × dias que cobrem as horas-meta da AWS na janela da SOW. */
  suggestedTeam: { foremen: number; technicians: number; days: number } | null;
  workDays: number;
  windowBusinessDays: number | null;
  fitsWindow: boolean | null;
  kpis: Array<{ key: KpiKey; label: string; value: number | null; target: number | null; delta: number | null; threshold: number; flagged: boolean; justification: string | null; missingJustification: boolean }>;
  blockers: string[];
  warnings: string[];
  bidValues: {
    proposalName: string;
    start: string | null;
    end: string | null;
    labor: Array<{ roleKey: string; label: string; rate: string; hours: string }>;
    travel: { perCarDay: number | null; vehicleDays: number };
    platform: { days: number; daily: string | null };
    cables: Array<{ type: string; averageLengthM: number; quantity: number; hoursT: number }>;
  };
}

export interface RevisionAws {
  missing: Array<'sow' | 'bid_template'>;
  bidTemplate: { documentId: string; version: number; filename: string; importedAt: string; quoteRequestId: string | null } | null;
  targets: BidTargets | null;
  quote: AwsQuote | null;
  blockers: string[];
}

export type QuoteRequestStatus = 'pendente' | 'em_cotacao' | 'respondida';

export interface QuoteRequestRow {
  id: string;
  axisProjectId: string;
  projectCode: string;
  projectName: string | null;
  sowVersion: number;
  sowFilename: string;
  bidTemplateVersion: number | null;
  bidTemplateFilename: string | null;
  notes: string | null;
  requestedByEmail: string | null;
  requestedAt: string;
  startedAt: string | null;
  status: QuoteRequestStatus;
  budgetId: string | null;
  currentRevision: { id: string; number: number; status: RevisionStatus } | null;
  draftRevisionId: string | null;
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
  sow: RevisionSow | null;
  /** Só no modelo aws_sow. */
  aws: RevisionAws | null;
  workflow: RevisionWorkflowInfo;
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

const TRANSITION_PATH: Record<Exclude<WorkflowAction, 'discard'>, string> = {
  submit: 'submit',
  return: 'return',
  approve_send: 'approve-send',
  won: 'won',
  lost: 'lost',
};

/** Passo do fluxo da revisão (§3.1); `reason` é obrigatório ao devolver e ao perder. */
export const transitionRevision = (id: string, action: Exclude<WorkflowAction, 'discard'>, reason?: string) =>
  api<Revision>(`/revisions/${id}/${TRANSITION_PATH[action]}`, { method: 'POST', body: JSON.stringify(reason ? { reason } : {}) });

export const listQuoteRequests = () => api<QuoteRequestRow[]>('/quote-requests');
export const startQuote = (id: string) =>
  api<{ revisionId: string; sowImported: boolean; sowError: string | null; bidTemplateImported: boolean; bidTemplateError: string | null }>(`/quote-requests/${id}/start`, {
    method: 'POST',
    body: '{}',
  });
/** Sem corpo: baixa a SOW do pedido de cotação mais recente do projeto; `text`: lê o texto colado. */
export const importSow = (revisionId: string, body: { quoteRequestId?: string; text?: string }) =>
  api<RevisionSow>(`/revisions/${revisionId}/sow/import`, { method: 'POST', body: JSON.stringify(body) });
export const updateSowCables = (revisionId: string, cables: Array<{ type: string; lengthM: number; quantity: number; fibers?: number }>) =>
  api<RevisionSow>(`/revisions/${revisionId}/sow/cables`, { method: 'PUT', body: JSON.stringify({ cables }) });
export const getSowText = (revisionId: string) => api<{ text: string }>(`/revisions/${revisionId}/sow/text`);
export const importBidTemplate = (revisionId: string, quoteRequestId?: string) =>
  api<Revision>(`/revisions/${revisionId}/bid-template/import`, { method: 'POST', body: JSON.stringify(quoteRequestId ? { quoteRequestId } : {}) });
/** Horas T por tipo de cabo; `null` volta ao proporcional. */
export const updateHoursT = (revisionId: string, hours: Record<string, number | null>) => api<Revision>(`/revisions/${revisionId}/aws/hours`, { method: 'PUT', body: JSON.stringify({ hours }) });
export const updateKpiJustifications = (revisionId: string, justifications: Record<string, string | null>) =>
  api<Revision>(`/revisions/${revisionId}/aws/justifications`, { method: 'PUT', body: JSON.stringify({ justifications }) });

/** Perfil da Bid (PJ7): fornecedor no cabeçalho e linha do Bid Template de cada tipo de cabo e função. */
export interface BidCableLineProfile {
  code: string;
  description?: string | null;
  supplier?: string | null;
  partNumber?: string | null;
  unit?: string | null;
}
export interface BidProfile {
  header: { vendorName: string | null; pocName: string | null; pocEmail: string | null; leadTimeDays: number | null };
  cables: Record<string, BidCableLineProfile>;
  roles: Record<string, string>;
}
export interface BidTemplateLine {
  row: number;
  code: string;
  description: string;
  category: string;
  subcategory: string;
  supplier: string | null;
  free: boolean;
}
export interface BidPlanStatus {
  ready: boolean;
  blockers: string[];
  /** Linha sugerida pela SOW para os tipos sem mapeamento salvo no perfil. */
  suggestedCables: Record<string, BidCableLineProfile & { reason: string }>;
  unmappedCables: string[];
  unmappedRoles: string[];
  lines: Array<{ code: string; label: string; supplier: string | null }>;
  kpiYes: string[];
}

export const getBidProfile = () => api<BidProfile>('/bid-profile');
export const updateBidProfile = (body: { header?: Partial<BidProfile['header']>; cables?: Record<string, BidCableLineProfile | null>; roles?: Record<string, string | null> }) =>
  api<BidProfile>('/bid-profile', { method: 'PUT', body: JSON.stringify(body) });
export const getBidLines = (revisionId: string) => api<BidTemplateLine[]>(`/revisions/${revisionId}/bid/lines`);
export const getBidPlan = (revisionId: string) => api<BidPlanStatus>(`/revisions/${revisionId}/bid/plan`);
export const downloadBidPreview = (revisionId: string) => apiDownload(`/revisions/${revisionId}/bid/preview`, 'previa-bid.xlsm');
export const downloadBidOutput = (revisionId: string) => apiDownload(`/revisions/${revisionId}/bid/output`, 'bid.xlsm');
/** Recalcula a equipe pela SOW e pelo Bid Template: 1 encarregado + técnicos × dias (continua editável). */
export const applySuggestedTeam = (revisionId: string) => api<Revision>(`/revisions/${revisionId}/aws/suggest-team`, { method: 'POST', body: '{}' });
