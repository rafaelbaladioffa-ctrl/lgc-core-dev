import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY } from './allow-while-password-change-required.decorator.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

/**
 * Besides the usual JWT check, enforces must_change_password server-side (PLANNING.md 4.7): a
 * temporary password set by admin/RH must be changed before anything else is reachable, not just
 * hidden by the frontend — calling the API directly must not bypass it. Only routes explicitly
 * marked with @AllowWhilePasswordChangeRequired() (change-password itself, logout) are exempt.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const activated = await super.canActivate(context);
    if (!activated) return false;

    const exempt = this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_PASSWORD_CHANGE_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.mustChangePassword) {
      throw new ForbiddenException('Password change required before accessing this resource');
    }
    return true;
  }
}
