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
  /** AAAA-MM-DD */
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  status?: ProjectStatus;
}

/** O cliente não muda depois de criado: ele faz parte do código do projeto. */
export type UpdateProjectInput = Partial<Omit<CreateProjectInput, 'clientId' | 'status'>>;

export type ProjectDocumentKind = 'sow';

export const PROJECT_DOCUMENT_LABEL: Record<ProjectDocumentKind, string> = { sow: 'SOW' };

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

export const projectsApi = {
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  get: (id: string) => api.get<Project>(`/projects/${id}`).then((r) => r.data),
  create: (input: CreateProjectInput) => api.post<Project>('/projects', input).then((r) => r.data),
  update: (id: string, input: UpdateProjectInput) => api.put<Project>(`/projects/${id}`, input).then((r) => r.data),
  updateStatus: (id: string, status: ProjectStatus) =>
    api.put<Project>(`/projects/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`),
  listDocuments: (id: string) => api.get<ProjectDocument[]>(`/projects/${id}/documents`).then((r) => r.data),
  addDocument: (id: string, input: { kind: ProjectDocumentKind; filename: string; contentBase64: string }) =>
    api.post<ProjectDocument>(`/projects/${id}/documents`, input).then((r) => r.data),
  downloadDocument: (id: string, documentId: string) =>
    api.get<Blob>(`/projects/${id}/documents/${documentId}/content`, { responseType: 'blob' }).then((r) => r.data),
};
