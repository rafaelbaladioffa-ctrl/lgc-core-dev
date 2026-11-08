import { api } from './client';

/** Site (local de obra ou de entrega) de um cliente. Endereço no mesmo padrão do cliente. */
export interface Site {
  id: string;
  clientId: string;
  /** Ex.: GRU53. Único dentro do cliente. */
  code: string;
  name: string;
  cep: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}

export interface CreateSiteInput {
  clientId: string;
  code: string;
  name: string;
  cep?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  addressDistrict?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** O cliente do site não muda. `active: false` inativa o site (não há exclusão). */
export type UpdateSiteInput = Partial<Omit<CreateSiteInput, 'clientId'>> & { active?: boolean };

export const sitesApi = {
  list: (filter: { clientId?: string; active?: boolean } = {}) =>
    api.get<Site[]>('/sites', { params: filter }).then((r) => r.data),
  get: (id: string) => api.get<Site>(`/sites/${id}`).then((r) => r.data),
  create: (input: CreateSiteInput) => api.post<Site>('/sites', input).then((r) => r.data),
  update: (id: string, input: UpdateSiteInput) => api.put<Site>(`/sites/${id}`, input).then((r) => r.data),
};

/** "Rodovia Hélio Smidt, s/n — Cumbica, Guarulhos/SP" a partir das colunas de endereço. */
export function formatSiteAddress(site: Pick<Site, 'addressStreet' | 'addressNumber' | 'addressDistrict' | 'addressCity' | 'addressState'>): string {
  const street = [site.addressStreet, site.addressNumber].filter(Boolean).join(', ');
  const city = [site.addressCity, site.addressState].filter(Boolean).join('/');
  return [street, [site.addressDistrict, city].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
}
