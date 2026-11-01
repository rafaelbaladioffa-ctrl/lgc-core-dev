import { api } from './client';

export interface JobTitle {
  id: string;
  name: string;
  isTechnician: boolean;
}

export interface CreateJobTitleInput {
  name: string;
  isTechnician?: boolean;
}

export const jobTitlesApi = {
  list: () => api.get<JobTitle[]>('/job-titles').then((r) => r.data),
  create: (input: CreateJobTitleInput) => api.post<JobTitle>('/job-titles', input).then((r) => r.data),
  update: (id: string, input: Partial<CreateJobTitleInput>) =>
    api.put<JobTitle>(`/job-titles/${id}`, input).then((r) => r.data),
  remove: (id: string) => api.delete(`/job-titles/${id}`),
};
