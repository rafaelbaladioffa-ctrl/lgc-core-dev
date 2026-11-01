import { api } from './client';

export interface Sector {
  id: string;
  code: string;
  name: string;
  parentSectorId: string | null;
  responsibleCollaboratorId: string | null;
}

export interface CreateSectorInput {
  name: string;
  parentSectorId?: string;
  responsibleCollaboratorId?: string;
}

export interface UpdateSectorInput {
  name?: string;
  responsibleCollaboratorId?: string;
}

export const sectorsApi = {
  list: () => api.get<Sector[]>('/sectors').then((r) => r.data),
  get: (id: string) => api.get<Sector>(`/sectors/${id}`).then((r) => r.data),
  create: (input: CreateSectorInput) => api.post<Sector>('/sectors', input).then((r) => r.data),
  update: (id: string, input: UpdateSectorInput) => api.put<Sector>(`/sectors/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/sectors/${id}`),
};
