import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { JwtPayload } from './strategies/jwt.strategy.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function parseDurationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 15 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return value * unitMs;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`)),
      ),
    ];

    return this.issueTokens(user.id, user.email, roles, permissions, user.collaboratorId, user.mustChangePassword);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: { sub: string };
    try {
      payload = this.jwt.verify(refreshToken, { secret: this.config.get<string>('JWT_REFRESH_SECRET') });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findFirst({
      where: { userId: payload.sub, tokenHash, revokedAt: null },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`)),
      ),
    ];

    return this.issueTokens(user.id, user.email, roles, permissions, user.collaboratorId, user.mustChangePassword);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } } },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const currentValid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!currentValid) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } });

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = [
      ...new Set(
        user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`)),
      ),
    ];
    return this.issueTokens(user.id, user.email, roles, permissions, user.collaboratorId, false);
  }

  /**
   * Token de curtíssima duração (90s, bem menor que os 15min do access token normal) pra
   * "lançar" um satélite já autenticado a partir do Axis — mesmo formato/segredo
   * (`JWT_ACCESS_SECRET`) de qualquer access token normal, então o satélite valida exatamente
   * como já valida o token que hoje é colado manualmente na tela dele (PLANNING_LOGISTICA.md
   * §0.3, segredo compartilhado) — nenhuma lógica nova do lado do satélite, só precisa ler o
   * token da querystring em vez de um campo de formulário. TTL curto limita a janela de
   * exposição de ele aparecer numa URL (histórico do navegador, log de acesso do satélite).
   */
  signSatelliteLaunchToken(user: { userId: string; email: string; roles: string[]; permissions: string[]; collaboratorId: string | null; mustChangePassword: boolean }): string {
    const payload: JwtPayload = {
      sub: user.userId,
      email: user.email,
      roles: user.roles,
      permissions: user.permissions,
      collaboratorId: user.collaboratorId,
      mustChangePassword: user.mustChangePassword,
    };
    return this.jwt.sign({ ...payload }, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: '90s',
      jwtid: randomUUID(),
    } as JwtSignOptions);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    email: string,
    roles: string[],
    permissions: string[],
    collaboratorId: string | null,
    mustChangePassword: boolean,
  ): Promise<TokenPair> {
    const payload: JwtPayload = { sub: userId, email, roles, permissions, collaboratorId, mustChangePassword };

    const accessToken = this.jwt.sign({ ...payload }, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
      jwtid: randomUUID(),
    } as JwtSignOptions);

    const refreshTtl = this.config.get<string>('JWT_REFRESH_TTL') ?? '7d';
    const refreshToken = this.jwt.sign({ sub: userId }, {
      secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtl,
      jwtid: randomUUID(),
    } as JwtSignOptions);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + parseDurationToMs(refreshTtl)),
      },
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
