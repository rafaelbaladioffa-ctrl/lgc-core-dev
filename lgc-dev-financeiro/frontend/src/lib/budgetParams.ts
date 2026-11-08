import { api } from './api';

/** Tipos e chamadas do módulo Projetos — PJ1 (parâmetros e catálogos). Valores chegam como texto decimal. */

export type FieldKind = 'rate' | 'money' | 'decimal' | 'int' | 'bool';
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  scale?: number;
  hint?: string;
  required: boolean;
}
export interface ParameterSchema {
  groups: Array<{ key: string; label: string; fields: FieldDef[] }>;
  roleFields: Record<string, string>;
  payrollFields: string[];
}

export type ParameterSetStatus = 'rascunho' | 'vigente' | 'arquivado';

export interface ParameterSetSummary {
  id: string;
  code: string;
  status: ParameterSetStatus;
  effectiveFrom: string | null;
  notes: string | null;
  createdAt: string;
  publishedAt: string | null;
  updatedAt: string;
}

export interface HourlyCost {
  source: 'calculado' | 'informado';
  workedDays: number | null;
  workedHours: string | null;
  annual: Record<'salaries' | 'thirteenth' | 'vacationThird' | 'employerCharges' | 'fgts' | 'plr' | 'meal' | 'transport' | 'fixedBenefits' | 'total' | 'monthlyAverage', string> | null;
  costPerHour: string;
  billingRate: string | null;
  hourMarkup: string | null;
}

export interface ParameterRole {
  id?: string;
  roleKey: string;
  label: string;
  fieldRole: boolean;
  sortOrder: number;
  billingRate: string | null;
  monthlySalary?: string | null;
  plrSalariesPerYear?: string | null;
  mealPerWorkedDay?: string | null;
  transportPerMonth?: string | null;
  gymPerMonth?: string | null;
  healthPerMonth?: string | null;
  otherBenefitsPerMonth?: string | null;
  costPerHourOverride?: string | null;
  hourlyCost?: { ok: true; value: HourlyCost } | { ok: false; missing: string[] };
}

export interface ParameterSet extends ParameterSetSummary {
  [key: string]: unknown;
  roles: ParameterRole[];
  payrollVisible: boolean;
  derived: { invoiceTaxRate: string | null; platformDailyCost: string | null };
  publishIssues: { missing: string[]; incompleteRoles: string[] } | null;
}

export const getParameterSchema = () => api<ParameterSchema>('/parameter-sets/schema');
export const listParameterSets = () => api<ParameterSetSummary[]>('/parameter-sets');
export const getParameterSet = (id: string) => api<ParameterSet>(`/parameter-sets/${id}`);
export const createParameterDraft = () => api<{ id: string; code: string }>('/parameter-sets', { method: 'POST', body: '{}' });
export const updateParameterSet = (id: string, body: Record<string, unknown>) => api<ParameterSet>(`/parameter-sets/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const publishParameterSet = (id: string, effectiveFrom?: string) =>
  api<ParameterSet>(`/parameter-sets/${id}/publish`, { method: 'POST', body: JSON.stringify(effectiveFrom ? { effectiveFrom } : {}) });

export interface BudgetMaterial {
  id: string;
  name: string;
  manufacturer: string | null;
  partNumber: string | null;
  unit: string;
  billedPrice: string;
  realCost?: string | null;
  clientRef: string | null;
  active: boolean;
  updatedAt: string;
}

/** Site do Core ligado ao destino (cache do Financeiro). */
export interface CoreSite {
  axisId: string;
  code: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  clientId: string | null;
  active: boolean;
}

export interface BudgetDestination {
  id: string;
  name: string;
  kmRoundTrip: string;
  tollPerDay: string;
  routeNotes: string | null;
  /** Site do Core (nulo = destino sem site cadastrado no Core). */
  siteAxisId: string | null;
  site: CoreSite | null;
  active: boolean;
  updatedAt: string;
}

/** "GRU53 — Prédio 53, Guarulhos/SP" (mesmo texto do seletor). */
export function siteLabel(site: Pick<CoreSite, 'code' | 'name' | 'city' | 'state'>): string {
  const head = [site.code, site.name].filter(Boolean).join(' — ');
  const place = [site.city, site.state].filter(Boolean).join('/');
  return place ? `${head}, ${place}` : head;
}

/** Destino ligado ao site do projeto, para o deslocamento da revisão vir preenchido. */
export function destinationForSite(destinations: BudgetDestination[], siteAxisId: string | null | undefined): BudgetDestination | null {
  if (!siteAxisId) return null;
  return destinations.find((d) => d.active && d.siteAxisId === siteAxisId) ?? null;
}

const qs = (includeInactive: boolean) => (includeInactive ? '?includeInactive=true' : '');

export const listMaterials = (includeInactive = false) => api<BudgetMaterial[]>(`/budget-materials${qs(includeInactive)}`);
export const getMaterial = (id: string) => api<BudgetMaterial>(`/budget-materials/${id}`);
export const saveMaterial = (id: string | null, body: Record<string, unknown>) =>
  api<BudgetMaterial>(id ? `/budget-materials/${id}` : '/budget-materials', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });

export const listDestinations = (includeInactive = false) => api<BudgetDestination[]>(`/budget-destinations${qs(includeInactive)}`);
export const getDestination = (id: string) => api<BudgetDestination>(`/budget-destinations/${id}`);
export const saveDestination = (id: string | null, body: Record<string, unknown>) =>
  api<BudgetDestination>(id ? `/budget-destinations/${id}` : '/budget-destinations', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });

export const STATUS_LABEL: Record<ParameterSetStatus, string> = { rascunho: 'Rascunho', vigente: 'Vigente', arquivado: 'Arquivado' };
