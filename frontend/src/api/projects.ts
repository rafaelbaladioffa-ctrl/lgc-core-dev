import { api } from './client';

export type ProjectStatus = 'proposta' | 'aprovado' | 'em_execucao' | 'encerrado';

export interface Project {
  id: string;
  code: string;
  /** Projetos antigos podem estar sem nome até alguém editar. */
  name: string | null;
  clientId: string;
  costCenterId: string;
  responsibleCollaboratorId: string;
  /** Site do cliente onde a obra acontece; nulo até alguém escolher (obrigatório só para aprovar). */
  siteId: string | null;
  /** ISO; só a parte AAAA-MM-DD importa. */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  status: ProjectStatus;
  proposalSequence: number;
}

export interface CreateProjectInput {
  name: string;
  clientId: string;
  costCenterId: string;
  responsibleCollaboratorId: string;
  /** Do mesmo cliente do projeto; `null` desvincula na edição. */
  siteId?: string | null;
  /** AAAA-MM-DD */
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  status?: ProjectStatus;
}

/** O cliente não muda depois de criado: ele faz parte do código do projeto. */
export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'clientId' | 'status'>>;

export type ProjectDocumentKind = 'sow' | 'bid_template' | 'po';

export const PROJECT_DOCUMENT_LABEL: Record<ProjectDocumentKind, string> = { sow: 'SOW', bid_template: 'Bid Template', po: 'PO do cliente' };

export interface ProjectDocument {
  id: string;
  projectId: string;
  kind: ProjectDocumentKind;
  version: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  createdAt: string;
  uploadedBy?: { email: string };
}

export type ProjectQuoteStatus = 'nao_solicitada' | 'aguardando' | 'recebida';

export const PROJECT_QUOTE_STATUS_LABEL: Record<ProjectQuoteStatus, string> = {
  nao_solicitada: 'Cotação não solicitada',
  aguardando: 'Aguardando o Financeiro',
  recebida: 'Cotação recebida',
};

export interface ProjectQuoteRequest {
  id: string;
  createdAt: string;
  notes: string | null;
  requestedByEmail: string;
  sowVersion: number;
  /** Nulo só em pedidos anteriores à exigência do Bid Template. */
  bidTemplateVersion: number | null;
}

/** Uma função da equipe orçada: quantidade de pessoas, nunca nomes. */
export interface ProjectQuoteTeamLine {
  role_key: string;
  role_name: string;
  field_role: boolean;
  people: number | null;
  days: number | null;
  hours: number;
}

/** Material a enviar ao site, com o código do catálogo da Logística. Nunca traz preço nem custo. */
export interface ProjectQuoteMaterial {
  id: string;
  materialCode: string;
  description: string;
  unit: string;
  /** Texto decimal com 3 casas, ex.: "1200.000". */
  quantity: string;
}

export interface ProjectQuote {
  id: string;
  revisionNumber: number;
  sowVersion: number | null;
  workDays: number;
  /** AAAA-MM-DD */
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  team: ProjectQuoteTeamLine[];
  fieldPeople: number;
  totalHours: number;
  approvedAt: string | null;
  approvedByEmail: string | null;
  /** Nulos quando a cotação veio sem Bid (orçamento genérico do Financeiro). */
  bidFilename: string | null;
  bidSizeBytes: number | null;
  receivedAt: string;
  satelliteName: string;
  materials: ProjectQuoteMaterial[];
}

export interface ProjectQuotes {
  status: ProjectQuoteStatus;
  requests: ProjectQuoteRequest[];
  quotes: ProjectQuote[];
}

/** Resposta de `PUT /projects/:id/status` com `aprovado`: o projeto mais a requisição de envio gerada (se houve materiais). */
export type ApprovedProject = Project & {
  materialRequest: { id: string; code: string; status: string } | null;
  withoutMaterials: boolean;
};

export interface ProjectAcceptance {
  acceptance: {
    id: string;
    projectQuoteId: string;
    revisionNumber: number;
    clientPoNumber: string | null;
    acceptedByEmail: string;
    acceptedAt: string;
  } | null;
  materialRequest: { id: string; code: string; status: string; estimatedValue: string | null; neededBy: string | null } | null;
}

export interface ApproveProjectInput {
  /** Padrão: a cotação vigente (maior revisão). */
  acceptedQuoteId?: string;
  clientPoNumber?: string;
}

/** Obra que o Field deu por concluída num projeto do usuário, aguardando o encerramento (PT-09). */
export interface ProjectFieldAlert {
  projectId: string;
  projectCode: string;
  projectName: string | null;
  fieldProjectCode: string | null;
  completedAt: string;
}

export const projectsApi = {
  fieldAlerts: () => api.get<ProjectFieldAlert[]>('/projects/field-alerts').then((r) => r.data),
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  get: (id: string) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (input: CreateProjectInput) => api.post<Project>('/projects', input).then((r) => r.data),
  update: (id: string, input: UpdateProjectInput) => api.put<Project>(`/projects/${id}`, input).then((r) => r.data),
  updateStatus: (id: string, status: ProjectStatus) =>
    api.put<Project>(`/projects/${id}/status`, { status }).then((r) => r.data),
  /** Aprovar exige site e cotação (o servidor confere); cria o aceite e a requisição de envio de material. */
  approve: (id: string, input: ApproveProjectInput) =>
    api.put<ApprovedProject>(`/projects/${id}/status`, { status: 'aprovado', ...input }).then((r) => r.data),
  getAcceptance: (id: string) => api.get<ProjectAcceptance>(`/projects/${id}/acceptance`).then((r) => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`),
  listDocuments: (id: string) => api.get<ProjectDocument[]>(`/projects/${id}/documents`).then((r) => r.data),
  addDocument: (id: string, input: { kind: ProjectDocumentKind; filename: string; contentBase64: string }) =>
    api.post<ProjectDocument>(`/projects/${id}/documents`, input).then((r) => r.data),
  downloadDocument: (id: string, documentId: string) =>
    api.get<Blob>(`/projects/${id}/documents/${documentId}/content`, { responseType: 'blob' }).then((r) => r.data),
  listQuotes: (id: string) => api.get<ProjectQuotes>(`/projects/${id}/quotes`).then((r) => r.data),
  requestQuote: (id: string, notes?: string) =>
    api.post<ProjectQuoteRequest & { bidTemplateVersion: number }>(`/projects/${id}/quote-requests`, notes ? { notes } : {}).then((r) => r.data),
  downloadBid: (id: string, quoteId: string) =>
    api.get<Blob>(`/projects/${id}/quotes/${quoteId}/bid`, { responseType: 'blob' }).then((r) => r.data),
};
