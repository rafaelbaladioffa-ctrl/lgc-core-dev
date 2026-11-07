import type { Request } from 'express';

/** Usuário vindo do JWT do Core. `permissions` é a resolução LOCAL do Financeiro, não a do Core. */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  axisRoles: string[];
  collaboratorId: string | null;
  mustChangePassword: boolean;
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
