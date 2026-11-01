import { api } from './client';

export interface Delegation {
  id: string;
  delegatorId: string;
  delegateId: string;
  sectorId: string | null;
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface CreateDelegationInput {
  delegateId: string;
  sectorId?: string;
  startsAt: string;
  endsAt: string;
}

export const delegationsApi = {
  create: (input: CreateDelegationInput) => api.post<Delegation>('/delegations', input).then((r) => r.data),
  mine: () => api.get<Delegation[]>('/delegations/mine').then((r) => r.data),
  revoke: (id: string) => api.post<Delegation>(`/delegations/${id}/revoke`).then((r) => r.data),
};
