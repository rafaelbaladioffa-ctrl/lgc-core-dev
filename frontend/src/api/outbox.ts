import { api } from './client';

export type OutboxStatus = 'pending' | 'delivered' | 'failed';

export interface OutboxEvent {
  id: string;
  eventType: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  createdAt: string;
  deliveredAt: string | null;
}

export interface OutboxEventDetail extends OutboxEvent {
  payload: Record<string, unknown>;
  timeline: Array<{ label: string; at: string | null; done: boolean }>;
}

export const outboxApi = {
  list: (params?: { status?: OutboxStatus; eventType?: string; page?: number; perPage?: number }) =>
    api.get<{ data: OutboxEvent[]; meta: { page: number; perPage: number; total: number } }>('/integration/outbox', { params }).then((r) => r.data),
  get: (id: string) => api.get<OutboxEventDetail>(`/integration/outbox/${id}`).then((r) => r.data),
};
