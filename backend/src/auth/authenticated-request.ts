import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  roles: string[];
  permissions: string[];
  collaboratorId: string | null;
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
