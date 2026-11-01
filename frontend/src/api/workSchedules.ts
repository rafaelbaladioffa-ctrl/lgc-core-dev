import { api } from './client';

export interface WorkSchedule {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number | null;
  daysOfWeek: string[];
}

export interface CreateWorkScheduleInput {
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes?: number;
  daysOfWeek: string[];
}

export const workSchedulesApi = {
  list: () => api.get<WorkSchedule[]>('/work-schedules').then((r) => r.data),
  create: (input: CreateWorkScheduleInput) => api.post<WorkSchedule>('/work-schedules', input).then((r) => r.data),
  update: (id: string, input: Partial<CreateWorkScheduleInput>) =>
    api.put<WorkSchedule>(`/work-schedules/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/work-schedules/${id}`),
};
