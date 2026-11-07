import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RbacService } from '../rbac/rbac.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from './authenticated-request.js';

/** Claims do access token do Core (`backend/src/auth/auth.service.ts`, `issueTokens`). */
export interface AxisJwtPayload {
  sub: string;
  email: string;
  roles?: unknown;
  collaboratorId?: string | null;
  mustChangePassword?: boolean;
  iss?: string;
}

/**
 * SSO com o Core (especificação §2.1): valida o access token do Core (HS256, segredo compartilhado).
 * Os tokens do Core não têm `iss`; qualquer token COM emissor (ex.: a sessão de 8 h da Logística,
 * `iss=axis-logistica`) é recusado. Não há troca por sessão própria.
 * As permissões do token do Core são ignoradas: vale o RBAC local.
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
    if (payload.iss !== undefined) throw new UnauthorizedException('Token não emitido pelo Axis Core.');
    if (typeof payload.sub !== 'string' || !payload.sub || typeof payload.email !== 'string') throw new UnauthorizedException('Token inválido.');

    // Quando o Core emitir user.disabled, o bloqueio vale na hora, sem esperar o token expirar.
    const cached = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'USER', axisId: payload.sub } } });
    if (cached && !cached.active) throw new UnauthorizedException('Usuário desativado no Axis.');

    const axisRoles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === 'string') : [];
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
