import { api } from './client';

/**
 * GET /integration/satellites (SatellitesService.statusOverview) returns a different shape than
 * POST (SatellitesService.create): subscriptions as a flat `subscribedEvents: string[]` plus the
 * last relevant outbox event, not the raw `subscriptions` join-table rows. Keep the two shapes
 * separate instead of forcing one interface onto both responses.
 */
export interface Satellite {
  id: string;
  name: string;
  webhookUrl: string;
  // URL do frontend humano do satélite (null = satélite só de webhook, sem tela própria) — é o
  // que habilita o botão "Abrir" (launcher).
  frontendUrl: string | null;
  status: 'active' | 'inactive';
  subscribedEvents: string[];
  lastEvent: { eventType: string; status: string; createdAt: string } | null;
}

export interface CreateSatelliteInput {
  name: string;
  webhookUrl: string;
  frontendUrl?: string;
  subscribedEvents: string[];
}

export interface CreateSatelliteResult {
  id: string;
  name: string;
  webhookUrl: string;
  frontendUrl: string | null;
  status: 'active' | 'inactive';
  subscriptions: Array<{ satelliteId: string; eventType: string }>;
  apiKey: string;
  hmacSecret: string;
}

export const integrationApi = {
  list: () => api.get<Satellite[]>('/integration/satellites').then((r) => r.data),
  create: (input: CreateSatelliteInput) =>
    api.post<CreateSatelliteResult>('/integration/satellites', input).then((r) => r.data),
  /** Reenvia centros de custo, colaboradores e alocações vigentes aos satélites (carga inicial do cache). */
  resyncMasterData: () =>
    api.post<{ costCenters: number; collaborators: number; allocations: number; sites: number }>('/integration/satellites/resync-master-data').then((r) => r.data),
  testWebhook: (id: string) => api.post(`/integration/satellites/${id}/test-webhook`).then((r) => r.data),
  // Devolve a URL do satélite já com um token de curtíssima duração (90s) — abrir numa nova aba
  // imediatamente, nunca guardar/reusar essa URL depois de montada.
  launch: (id: string) => api.post<{ url: string }>(`/integration/satellites/${id}/launch`).then((r) => r.data),
};
