import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { RbacService } from '../rbac/rbac.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from './authenticated-request.js';

/** Claims emitidos pelo Axis (core: auth.service.ts / jwt.strategy.ts). */
/** Sessões emitidas pela troca do token do launcher levam este emissor; as do login normal do Axis não. */
export const LOGISTICA_ISSUER = 'axis-logistica';
export const SESSION_TTL_SECONDS = 8 * 3600; // um turno de trabalho; depois disso, novo login ou novo "Abrir" pelo Axis

export interface AxisJwtPayload {
  sub: string;
  email: string;
  roles?: string[];
  collaboratorId?: string | null;
  mustChangePassword?: boolean;
  iss?: string;
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
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      algorithms: ['HS256'],
    });
  }

  async validate(payload: AxisJwtPayload): Promise<AuthenticatedUser> {
    // A sessão própria (mais longa que o token do Axis) não sobrevive ao desligamento do usuário no Axis.
    if (payload.iss === LOGISTICA_ISSUER) {
      const cached = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'USER', axisId: payload.sub } } });
      if (cached && !cached.active) throw new UnauthorizedException('Usuário desativado no Axis.');
    }
    const axisRoles = Array.isArray(payload.roles) ? payload.roles : [];
    return {
      userId: payload.sub,
      email: payload.email,
      axisRoles,
      collaboratorId: payload.collaboratorId ?? null,
      mustChangePassword: payload.mustChangePassword === true,
      permissions: await this.rbac.resolvePermissions(axisRoles, payload.sub),
    };
  }
}
