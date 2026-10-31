import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { RbacService } from '../rbac/rbac.service.js';
import type { AuthenticatedUser } from './authenticated-request.js';

/** Claims emitidos pelo Axis (core: auth.service.ts / jwt.strategy.ts). */
export interface AxisJwtPayload {
  sub: string;
  email: string;
  roles?: string[];
  collaboratorId?: string | null;
  mustChangePassword?: boolean;
}

/**
 * SSO (PLANNING_LOGISTICA.md 0.3): valida o mesmo JWT do Axis (HS256, segredo compartilhado).
 * Não existe login nem senha próprios; as permissões do JWT do Axis são ignoradas — vale o
 * mapeamento local `axis_role_to_logistics_role`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly rbac: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AxisJwtPayload): Promise<AuthenticatedUser> {
    const axisRoles = Array.isArray(payload.roles) ? payload.roles : [];
    return {
      userId: payload.sub,
      email: payload.email,
      axisRoles,
      collaboratorId: payload.collaboratorId ?? null,
      mustChangePassword: payload.mustChangePassword === true,
      permissions: await this.rbac.resolvePermissions(axisRoles),
    };
  }
}
