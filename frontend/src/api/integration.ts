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

/** Satélite já cadastrado, sem segredos (GET/PATCH /integration/satellites/:id). */
export interface SatelliteDetail {
  id: string;
  name: string;
  webhookUrl: string;
  frontendUrl: string | null;
  status: 'active' | 'inactive';
  subscribedEvents: string[];
}

/** Evento que o Core emite (GET /integration/event-types); `family` é o prefixo do tipo, `familyLabel` o nome na tela. */
export interface EventTypeInfo {
  type: string;
  description: string;
  family: string;
  familyLabel: string;
}

/** Quantos cadastros o "Reenviar cadastros" registrou no outbox, por tipo. */
export interface MasterDataResyncResult {
  costCenters: number;
  collaborators: number;
  allocations: number;
  sites: number;
  clients: number;
  projects: number;
  users: number;
  jobTitles: number;
  holidays: number;
}

export const integrationApi = {
  list: () => api.get<Satellite[]>('/integration/satellites').then((r) => r.data),
  create: (input: CreateSatelliteInput) =>
    api.post<CreateSatelliteResult>('/integration/satellites', input).then((r) => r.data),
  get: (id: string) => api.get<SatelliteDetail>(`/integration/satellites/${id}`).then((r) => r.data),
  /** Substitui a assinatura do satélite pela lista informada. */
  updateSubscriptions: (id: string, subscribedEvents: string[]) =>
    api.patch<SatelliteDetail>(`/integration/satellites/${id}`, { subscribedEvents }).then((r) => r.data),
  eventTypes: () => api.get<EventTypeInfo[]>('/integration/event-types').then((r) => r.data),
  /** Reenvia o estado atual dos cadastros aos satélites inscritos (carga inicial do cache). */
  resyncMasterData: () => api.post<MasterDataResyncResult>('/integration/satellites/resync-master-data').then((r) => r.data),
  testWebhook: (id: string) => api.post(`/integration/satellites/${id}/test-webhook`).then((r) => r.data),
  // Devolve a URL do satélite já com um token de curtíssima duração (90s) — abrir numa nova aba
  // imediatamente, nunca guardar/reusar essa URL depois de montada.
  launch: (id: string) => api.post<{ url: string }>(`/integration/satellites/${id}/launch`).then((r) => r.data),
};
