import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/** Marks a route as requiring one or more permissions, formatted "resource:action" (e.g. "collaborator:read_sensitive"). */
export const RequirePermissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
