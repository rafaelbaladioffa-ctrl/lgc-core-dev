import { api } from './client';

export type UserStatus = 'active' | 'disabled';

export interface Role {
  id: string;
  name: string;
  description: string | null;
  rolePermissions?: { permission: Permission }[];
}

export interface Permission { id: string; resource: string; action: string; description: string | null }

export interface LoginUser {
  id: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  collaboratorId: string | null;
  collaboratorName: string | null;
  collaboratorMatricula: string | null;
  roles: Role[];
  createdAt: string;
}

export interface CreateUserInput {
  collaboratorId: string;
  email?: string;
  temporaryPassword?: string;
  roleIds: string[];
}

export interface CreatedUser extends LoginUser {
  /** Shown once at creation time — never retrievable again (no SMTP flow yet). */
  temporaryPassword: string;
}

export interface ResetPasswordResult {
  temporaryPassword: string;
}

export const usersApi = {
  list: (filters?: { status?: UserStatus; roleId?: string; search?: string }) =>
    api.get<LoginUser[]>('/users', { params: filters }).then((r) => r.data),
  get: (id: string) => api.get<LoginUser>(`/users/${id}`).then((r) => r.data),
  create: (input: CreateUserInput) => api.post<CreatedUser>('/users', input).then((r) => r.data),
  updateRoles: (id: string, roleIds: string[]) => api.put<LoginUser>(`/users/${id}/roles`, { roleIds }).then((r) => r.data),
  resetPassword: (id: string, temporaryPassword?: string) =>
    api.post<ResetPasswordResult>(`/users/${id}/reset-password`, { temporaryPassword }).then((r) => r.data),
  setStatus: (id: string, status: UserStatus) => api.put<LoginUser>(`/users/${id}/status`, { status }).then((r) => r.data),
};

export const rolesApi = {
  list: () => api.get<Role[]>('/roles').then((r) => r.data),
  permissions: () => api.get<Permission[]>('/roles/permissions').then((r) => r.data),
  create: (input: { name: string; description?: string; permissionIds: string[] }) => api.post<Role>('/roles', input).then((r) => r.data),
  update: (id: string, input: { name: string; description?: string; permissionIds: string[] }) => api.put<Role>(`/roles/${id}`, input).then((r) => r.data),
};
