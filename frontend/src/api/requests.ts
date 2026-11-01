import { api } from './client';
import type { RequestConfidentiality } from './requestCategories';

export type RequestStatus =
  | 'rascunho'
  | 'enviada'
  | 'em_triagem'
  | 'aguardando_aprovacao'
  | 'aprovada'
  | 'planejada'
  | 'em_atendimento'
  | 'aguardando_solicitante'
  | 'aguardando_terceiro'
  | 'concluida'
  | 'encerrada'
  | 'devolvida_ajuste'
  | 'reprovada'
  | 'cancelada'
  | 'suspensa'
  | 'reaberta'
  | 'expirada';

export type RequestPriority = 'baixa' | 'normal' | 'alta' | 'critica';
export type RequestApprovalStatus = 'pendente' | 'aprovado' | 'reprovado' | 'devolvido';

export interface AxisRequest {
  id: string;
  code: string;
  categoryVersionId: string;
  sectorId: string;
  queueId: string | null;
  requesterId: string;
  beneficiaryId: string;
  assigneeId: string | null;
  title: string;
  description: string;
  priority: RequestPriority;
  confidentiality: RequestConfidentiality;
  anonymous: boolean;
  status: RequestStatus;
  neededBy: string | null;
  estimatedValue: string | null;
  currency: string;
  slaDueFirstResponseAt: string | null;
  slaDueResolutionAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface RequestApproval {
  id: string;
  stepOrder: number;
  requiredLevel: string | null;
  approverId: string;
  approver: { id: string; fullName: string };
  status: RequestApprovalStatus;
  decidedAt: string | null;
  comment: string | null;
}

export interface RequestComment {
  id: string;
  authorId: string;
  visibility: 'publico' | 'interno';
  body: string;
  createdAt: string;
}

export interface RequestSubtaskLink {
  source: { id: string; code: string; title: string; status: RequestStatus };
}

export interface RequestDetail extends AxisRequest {
  comments: RequestComment[];
  approvals: RequestApproval[];
  categoryVersion: { category: { id: string; name: string; code: string; requiresAcceptance: boolean } };
  relationsAsTarget: RequestSubtaskLink[];
  requesterAcceptedAt: string | null;
  // Null unless a denúncia (§7.3) is marked anônima; "Anônimo" when the viewer lacks
  // request:view_whistleblower_identity (requesterId also comes back null in that case).
  requesterDisplay: string | null;
}

export interface CreateRequestInput {
  categoryId: string;
  beneficiaryId?: string;
  parentRequestId?: string;
  title: string;
  description: string;
  priority?: RequestPriority;
  confidentiality?: RequestConfidentiality;
  neededBy?: string;
  projectId?: string;
  costCenterId?: string;
  estimatedValue?: string;
  formData?: Record<string, unknown>;
}

export interface MyApproval {
  approvalId: string;
  requestId: string;
  code: string;
  stepOrder: number;
  requiredLevel: string | null;
  title: string;
  categoryName: string;
  requesterName: string;
  createdAt: string;
}

export interface RequestsDashboard {
  byStatus: Array<{ status: RequestStatus; count: number }>;
  backlogOpen: number;
  aging: { '0-2d': number; '3-5d': number; '6-10d': number; '>10d': number };
  slaResolutionHours: { p50: number | null; p90: number | null; p95: number | null; sampleSize: number };
  rates: { devolucao: number | null; reprovacao: number | null; reabertura: number | null };
  loadByAssignee: Array<{ assigneeId: string; count: number }>;
}

export const requestsApi = {
  create: (input: CreateRequestInput) => api.post<AxisRequest>('/requests', input).then((r) => r.data),
  mine: () => api.get<AxisRequest[]>('/requests/mine').then((r) => r.data),
  queue: (params?: { sectorId?: string; status?: RequestStatus }) => api.get<AxisRequest[]>('/requests/queue', { params }).then((r) => r.data),
  dashboard: () => api.get<RequestsDashboard>('/requests/dashboard').then((r) => r.data),
  myApprovals: () => api.get<MyApproval[]>('/requests/my-approvals').then((r) => r.data),
  get: (id: string) => api.get<RequestDetail>(`/requests/${id}`).then((r) => r.data),
  submit: (id: string) => api.post<AxisRequest>(`/requests/${id}/submit`).then((r) => r.data),
  triage: (id: string, action: 'aceitar' | 'devolver' | 'recategorizar', reason?: string, newCategoryId?: string) =>
    api.post<AxisRequest>(`/requests/${id}/triage`, { action, reason, newCategoryId }).then((r) => r.data),
  assign: (id: string, assigneeId: string) => api.post<AxisRequest>(`/requests/${id}/assign`, { assigneeId }).then((r) => r.data),
  approve: (id: string, comment?: string) => api.post<AxisRequest>(`/requests/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id: string, comment: string) => api.post<AxisRequest>(`/requests/${id}/reject`, { comment }).then((r) => r.data),
  start: (id: string) => api.post<AxisRequest>(`/requests/${id}/start`).then((r) => r.data),
  requestInformation: (id: string, question: string) => api.post<AxisRequest>(`/requests/${id}/request-information`, { question }).then((r) => r.data),
  resume: (id: string, answer?: string) => api.post<AxisRequest>(`/requests/${id}/resume`, { answer }).then((r) => r.data),
  accept: (id: string) => api.post<AxisRequest>(`/requests/${id}/accept`).then((r) => r.data),
  complete: (id: string, resolution: string) => api.post<AxisRequest>(`/requests/${id}/complete`, { resolution }).then((r) => r.data),
  close: (id: string) => api.post<AxisRequest>(`/requests/${id}/close`).then((r) => r.data),
  reopen: (id: string, reason: string) => api.post<AxisRequest>(`/requests/${id}/reopen`, { reason }).then((r) => r.data),
  cancel: (id: string, reason: string) => api.post<AxisRequest>(`/requests/${id}/cancel`, { reason }).then((r) => r.data),
  comment: (id: string, body: string, visibility?: 'publico' | 'interno') => api.post(`/requests/${id}/comments`, { body, visibility }).then((r) => r.data),
};
