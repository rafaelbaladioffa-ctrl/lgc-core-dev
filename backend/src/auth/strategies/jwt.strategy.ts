import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import type { AuthenticatedUser } from '../authenticated-request.js';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  permissions: string[];
  collaboratorId: string | null;
  mustChangePassword: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET')!,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      collaboratorId: payload.collaboratorId,
      mustChangePassword: payload.mustChangePassword,
    };
  }
}
