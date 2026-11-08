import { api } from './client';

export type RequestFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox' | 'attachment';
export type RequestFieldOptionsSource = 'projects' | 'collaborators' | 'clients' | 'cost_centers' | 'job_titles';

export interface RequestFormField {
  key: string;
  label: string;
  type: RequestFieldType;
  required?: boolean;
  options?: string[];
  optionsSource?: RequestFieldOptionsSource;
}

export type RequestCategoryKind = 'padrao' | 'compra_material' | 'denuncia' | 'envio_material';
export type CategoryVersionStatus = 'rascunho' | 'publicada';
export type ManagementLevelStep = 'supervisor' | 'coordenador' | 'gerente' | 'diretor';
export type CompletionRule = 'todos' | 'qualquer_um' | 'n_de_m';

export interface WorkflowStep {
  stepOrder: number;
  approverRule: 'gestor_direto' | 'management_level' | 'colaboradores';
  requiredLevel?: ManagementLevelStep;
  collaboratorIds?: string[];
  completionRule?: CompletionRule;
  requiredCount?: number;
}

export interface CategoryVersion {
  id: string;
  version: number;
  formSchema: RequestFormField[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
}

/** Versão como vem da tela de administração (inclui rascunho e histórico). */
export interface CategoryVersionDetail extends CategoryVersion {
  status: CategoryVersionStatus;
  workflowSchema: WorkflowStep[];
  publishedAt: string | null;
  publishedBy: string | null;
  createdBy: string | null;
  createdAt: string;
  createdByName: string | null;
  publishedByName: string | null;
}

export type RequestConfidentiality = 'interna' | 'confidencial' | 'restrita';

export interface RequestCategory {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  kind: RequestCategoryKind;
  confidentiality: RequestConfidentiality;
  active: boolean;
  currentVersion: CategoryVersion | null;
}

export interface AdminCategoryRow {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  sector: { id: string; name: string };
  kind: RequestCategoryKind;
  confidentiality: RequestConfidentiality;
  active: boolean;
  requiresAcceptance: boolean;
  useDynamicAuthority: boolean;
  publishedVersion: number | null;
  hasDraft: boolean;
}

export interface AdminCategoryDetail extends Omit<AdminCategoryRow, 'publishedVersion' | 'hasDraft'> {
  versions: CategoryVersionDetail[];
}

export interface CreateRequestCategoryInput {
  code: string;
  name: string;
  sectorId: string;
  kind: RequestCategoryKind;
  confidentiality: RequestConfidentiality;
  requiresAcceptance: boolean;
  useDynamicAuthority: boolean;
  formSchema: RequestFormField[];
  workflowSchema: WorkflowStep[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
}

export interface UpdateRequestCategoryInput {
  name?: string;
  sectorId?: string;
  confidentiality?: RequestConfidentiality;
  requiresAcceptance?: boolean;
  useDynamicAuthority?: boolean;
  active?: boolean;
}

export interface UpdateCategoryDraftInput {
  formSchema: RequestFormField[];
  workflowSchema: WorkflowStep[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
}

export const requestCategoriesApi = {
  list: (sectorId?: string) => api.get<RequestCategory[]>('/request-categories', { params: { sectorId } }).then((r) => r.data),
  listAdmin: () => api.get<AdminCategoryRow[]>('/request-categories/admin').then((r) => r.data),
  getAdmin: (id: string) => api.get<AdminCategoryDetail>(`/request-categories/${id}`).then((r) => r.data),
  create: (input: CreateRequestCategoryInput) => api.post<{ id: string }>('/request-categories', input).then((r) => r.data),
  update: (id: string, input: UpdateRequestCategoryInput) => api.patch(`/request-categories/${id}`, input).then((r) => r.data),
  createDraft: (id: string) => api.post(`/request-categories/${id}/draft`).then((r) => r.data),
  updateDraft: (id: string, input: UpdateCategoryDraftInput) => api.put(`/request-categories/${id}/draft`, input).then((r) => r.data),
  discardDraft: (id: string) => api.delete(`/request-categories/${id}/draft`).then((r) => r.data),
  publishDraft: (id: string) => api.post(`/request-categories/${id}/draft/publish`).then((r) => r.data),
};
