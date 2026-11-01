import { api } from './client';

export interface Client {
  id: string;
  code: number;
  legalName: string;
  cnpj: string | null;
  contacts: Array<{ name: string; phone?: string; email?: string }> | null;
  address: Record<string, unknown> | null;
}

export interface CreateClientInput {
  legalName: string;
  cnpj?: string;
  contacts?: Array<{ name: string; phone?: string; email?: string }>;
  address?: Record<string, unknown>;
}

export const clientsApi = {
  list: () => api.get<Client[]>('/clients').then((r) => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then((r) => r.data),
  create: (input: CreateClientInput) => api.post<Client>('/clients', input).then((r) => r.data),
  update: (id: string, input: Partial<CreateClientInput>) =>
    api.put<Client>(`/clients/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/clients/${id}`),
};
