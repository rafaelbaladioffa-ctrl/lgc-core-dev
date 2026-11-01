import type { Request } from 'express';

/** Usuário vindo do JWT do Axis (SSO). `permissions` é a resolução LOCAL de Logística, não a do Axis. */
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
