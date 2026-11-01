import { api } from './client';

export type ProjectStatus = 'proposta' | 'aprovado' | 'em_execucao' | 'encerrado';

export interface Project {
  id: string;
  code: string;
  clientId: string;
  costCenterId: string;
  responsibleCollaboratorId: string;
  status: ProjectStatus;
  proposalSequence: number;
}

export interface CreateProjectInput {
  clientId: string;
  costCenterId: string;
  responsibleCollaboratorId: string;
  status?: ProjectStatus;
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects').then((r) => r.data),
  create: (input: CreateProjectInput) => api.post<Project>('/projects', input).then((r) => r.data),
  update: (id: string, input: Partial<CreateProjectInput>) =>
    api.put<Project>(`/projects/${id}`, input).then((r) => r.data),
  updateStatus: (id: string, status: ProjectStatus) =>
    api.put<Project>(`/projects/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string) => api.delete(`/projects/${id}`),
};
