import { api } from './client';

export interface SensitiveAccessLogEntry {
  id: string;
  collaboratorId: string;
  actorUserId: string;
  fields: string[];
  createdAt: string;
  collaborator: { id: string; fullName: string };
  actor: { id: string; email: string };
}

export const sensitiveAccessLogsApi = {
  list: (params?: { collaboratorId?: string; actorUserId?: string; from?: string; to?: string; page?: number; perPage?: number }) =>
    api
      .get<{ data: SensitiveAccessLogEntry[]; meta: { page: number; perPage: number; total: number } }>('/sensitive-access-logs', { params })
      .then((r) => r.data),
};
