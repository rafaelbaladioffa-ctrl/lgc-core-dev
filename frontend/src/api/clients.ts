import { api } from './client';

export interface Client {
  id: string;
  code: number;
  legalName: string;
  tradeName: string | null;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  cep: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  /** Legado: JSON livre, sem campo na tela. */
  contacts: Array<{ name: string; phone?: string; email?: string }> | null;
  /** Legado: JSON livre, sem campo na tela. */
  address: Record<string, unknown> | null;
}

/** Campos opcionais: `null` limpa o valor na edição. */
export interface CreateClientInput {
  legalName: string;
  tradeName?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  cep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressDistrict?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
}

export const clientsApi = {
  list: () => api.get<Client[]>('/clients').then((r) => r.data),
  get: (id: string) => api.get<Client>(`/clients/${id}`).then((r) => r.data),
  create: (input: CreateClientInput) => api.post<Client>('/clients', input).then((r) => r.data),
  update: (id: string, input: Partial<CreateClientInput>) =>
    api.put<Client>(`/clients/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/clients/${id}`),
};
