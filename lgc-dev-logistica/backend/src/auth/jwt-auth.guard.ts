import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

/** Guard global: JWT obrigatório, exceto rotas @Public(). Replica no servidor a regra must_change_password do Axis. */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const activated = await super.canActivate(context);
    if (!activated) return false;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.mustChangePassword) {
      throw new ForbiddenException('É necessário trocar a senha no Axis antes de acessar este recurso.');
    }
    return true;
  }
}
