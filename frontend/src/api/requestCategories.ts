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

export interface CategoryVersion {
  id: string;
  version: number;
  formSchema: RequestFormField[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
}

export type RequestConfidentiality = 'interna' | 'confidencial' | 'restrita';

export interface RequestCategory {
  id: string;
  code: string;
  name: string;
  sectorId: string;
  confidentiality: RequestConfidentiality;
  active: boolean;
  currentVersion: CategoryVersion | null;
}

export const requestCategoriesApi = {
  list: (sectorId?: string) => api.get<RequestCategory[]>('/request-categories', { params: { sectorId } }).then((r) => r.data),
};
