import { api } from './client';

export interface LogisticsCatalogItem {
  id: string;
  code: string;
  shortDescription: string;
  technicalDescription?: string | null;
  category: string;
  subcategory?: string | null;
  unit: string;
  unitPrice: string | null;
}

const baseUrl = import.meta.env.VITE_LOGISTICA_API_BASE_URL ?? '/logistica-api';

export const logisticsCatalogApi = {
  // Reutiliza o cliente do Core para manter o mesmo token e o refresh automático
  // quando a sessão expira, apenas trocando a base URL para o satélite Logística.
  list: () => api.get<LogisticsCatalogItem[]>('/materials/purchase-catalog', { baseURL: baseUrl }).then((response) => response.data),
};
