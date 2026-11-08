import { api } from './client';

export type InboxStatus = 'processed' | 'ignored' | 'failed';

export interface InboxMessage {
  id: string;
  satelliteId: string;
  satelliteName: string;
  eventId: string;
  eventType: string;
  status: InboxStatus;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
}

export interface InboxMessageDetail extends InboxMessage {
  payload: Record<string, unknown>;
}

export const inboxApi = {
  list: (params?: { satelliteId?: string; status?: InboxStatus; eventType?: string; page?: number; perPage?: number }) =>
    api
      .get<{ data: InboxMessage[]; meta: { page: number; perPage: number; total: number } }>('/integration/inbox', { params })
      .then((r) => r.data),
  get: (id: string) => api.get<InboxMessageDetail>(`/integration/inbox/${id}`).then((r) => r.data),
};
