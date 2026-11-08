import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './permissions.decorator.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const any = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);
    const granted = context.switchToHttp().getRequest<AuthenticatedRequest>().user?.permissions ?? [];
    if (any && any.length > 0 && !any.some((p) => granted.includes(p))) {
      throw new ForbiddenException(`Permissão insuficiente. Necessário uma de: ${any.join(', ')}.`);
    }
    if (!required || required.length === 0) return true;

    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`Permissão insuficiente. Necessário: ${missing.join(', ')}.`);
    }
    return true;
  }
}
