import { api } from './client';

export type CollaboratorStatus = 'ativo' | 'afastado' | 'ferias' | 'desligado';
export type MaritalStatus = 'solteiro' | 'casado' | 'divorciado' | 'viuvo' | 'uniao_estavel';
export type ContractType = 'CLT' | 'PJ' | 'estagio' | 'terceirizado';
export type Gender = 'masculino' | 'feminino' | 'outro' | 'prefiro_nao_informar';
export type ManagementLevel = 'colaborador' | 'supervisor' | 'coordenador' | 'gerente' | 'diretor';

export interface CollaboratorSafe {
  id: string;
  matricula: string;
  fullName: string;
  personalEmail: string | null;
  corporateEmail: string;
  jobTitleId: string;
  jobTitleName: string;
  isTechnician: boolean;
  sectorId: string;
  supervisorId: string | null;
  asoDate: string | null;
  asoValidity: string | null;
  yellowBadge: string | null;
  status: CollaboratorStatus;
  offboardedAt: string | null;
  managementLevel: ManagementLevel;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  birthDate: string | null;
  maritalStatus: MaritalStatus | null;
  gender: Gender | null;
  cep: string | null;
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  addressCity: string | null;
  addressState: string | null;
  admissionDate: string | null;
  contractType: ContractType | null;
  workScheduleId: string | null;
  workScheduleName: string | null;
  costCenterId: string | null;
  costCenterName: string | null;
  photoFilename: string | null;
  photoStoragePath: string | null;
  uniformSize: string | null;
  cnhCategory: string | null;
  cnhNumber: string | null;
  cnhExpiresAt: string | null;
}

export interface CollaboratorFull extends CollaboratorSafe {
  rg: string;
  cpf: string;
  ctps: string | null;
  pis: string | null;
}

export interface OrgChartNode extends CollaboratorSafe {
  children: OrgChartNode[];
}

export interface CreateCollaboratorInput {
  fullName: string;
  rg: string;
  cpf: string;
  ctps?: string;
  pis?: string;
  corporateEmail: string;
  personalEmail?: string;
  jobTitleId: string;
  sectorId: string;
  supervisorId?: string;
  asoDate?: string;
  asoValidity?: string;
  yellowBadge?: string;
  managementLevel?: ManagementLevel;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  birthDate?: string;
  maritalStatus?: MaritalStatus;
  gender?: Gender;
  cep?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressDistrict?: string;
  addressCity?: string;
  addressState?: string;
  admissionDate?: string;
  contractType?: ContractType;
  workScheduleId?: string;
  costCenterId?: string;
  photoFilename?: string;
  photoStoragePath?: string;
  uniformSize?: string;
  cnhCategory?: string;
  cnhNumber?: string;
  cnhExpiresAt?: string;
}

export interface UpdateCollaboratorInput extends Partial<CreateCollaboratorInput> {
  status?: CollaboratorStatus;
}

export const collaboratorsApi = {
  list: () => api.get<CollaboratorSafe[]>('/collaborators').then((r) => r.data),
  me: () => api.get<CollaboratorSafe | null>('/collaborators/me').then((r) => r.data),
  get: (id: string) => api.get<CollaboratorSafe>(`/collaborators/${id}`).then((r) => r.data),
  getSensitive: (id: string) => api.get<CollaboratorFull>(`/collaborators/${id}/sensitive`).then((r) => r.data),
  create: (input: CreateCollaboratorInput) => api.post<CollaboratorSafe>('/collaborators', input).then((r) => r.data),
  update: (id: string, input: UpdateCollaboratorInput) =>
    api.put<CollaboratorSafe>(`/collaborators/${id}`, input).then((r) => r.data),
  offboard: (id: string) => api.post<CollaboratorSafe>(`/collaborators/${id}/offboard`).then((r) => r.data),
  orgChart: () => api.get<OrgChartNode[]>('/collaborators/org-chart').then((r) => r.data),
};

export interface ViaCepResult {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  erro?: boolean;
}

export type CepLookupOutcome =
  | { kind: 'found'; result: ViaCepResult }
  | { kind: 'not_found' }
  | { kind: 'invalid_format' }
  | { kind: 'network_error' };

/**
 * ViaCEP is a free, keyless public API — called directly from the browser, no backend involved.
 * Returns a discriminated outcome (not just `null`) so the caller can show a specific message for
 * each case instead of all three (bad format / no such CEP / network failure) looking identical.
 * A hung connection (no response at all, rather than a clean HTTP error) is capped at 8s so the
 * UI doesn't spin forever and never tells the user anything went wrong.
 */
export async function lookupCep(cep: string): Promise<CepLookupOutcome> {
  const digits = cep.replace(/\D/g, '');
  if (digits.length !== 8) return { kind: 'invalid_format' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal: controller.signal });
    if (!response.ok) return { kind: 'network_error' };
    const data = (await response.json()) as ViaCepResult;
    return data.erro ? { kind: 'not_found' } : { kind: 'found', result: data };
  } catch (err) {
    console.error('ViaCEP lookup failed:', err);
    return { kind: 'network_error' };
  } finally {
    clearTimeout(timeout);
  }
}
