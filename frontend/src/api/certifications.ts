import { api } from './client';

export type CertificationType = 'NR10' | 'NR35' | 'NR12' | 'NR18';

export interface Certification {
  id: string;
  collaboratorId: string;
  type: CertificationType;
  issuedAt: string;
  expiresAt: string;
}

export interface ExpiringCertification extends Certification {
  collaborator: { id: string; fullName: string; corporateEmail: string };
}

export interface CreateCertificationInput {
  collaboratorId: string;
  type: CertificationType;
  issuedAt: string;
  expiresAt: string;
}

export const certificationsApi = {
  listForCollaborator: (collaboratorId: string) =>
    api.get<Certification[]>(`/certifications/collaborator/${collaboratorId}`).then((r) => r.data),
  expiring: (windowDays?: number) =>
    api.get<ExpiringCertification[]>('/certifications/expiring', { params: { windowDays } }).then((r) => r.data),
  create: (input: CreateCertificationInput) => api.post<Certification>('/certifications', input).then((r) => r.data),
  remove: (id: string) => api.delete(`/certifications/${id}`),
};
