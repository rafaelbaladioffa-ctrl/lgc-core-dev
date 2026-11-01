import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userPermissions = request.user?.permissions ?? [];
    const hasAll = required.every((perm) => userPermissions.includes(perm));
    if (!hasAll) {
      throw new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
    }
    return true;
  }
}
