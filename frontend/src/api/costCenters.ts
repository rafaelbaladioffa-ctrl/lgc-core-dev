import { api } from './client';

export interface CostCenter {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  parentCostCenterId: string | null;
}

export interface CreateCostCenterInput {
  name: string;
  sectorId: string;
  parentCostCenterId?: string;
}

export interface UpdateCostCenterInput {
  name?: string;
  sectorId?: string;
}

export const costCentersApi = {
  list: () => api.get<CostCenter[]>('/cost-centers').then((r) => r.data),
  get: (id: string) => api.get<CostCenter>(`/cost-centers/${id}`).then((r) => r.data),
  create: (input: CreateCostCenterInput) => api.post<CostCenter>('/cost-centers', input).then((r) => r.data),
  update: (id: string, input: UpdateCostCenterInput) =>
    api.put<CostCenter>(`/cost-centers/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/cost-centers/${id}`),
};
