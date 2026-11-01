import { Body, Controller, ForbiddenException, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service.js';
import { Public } from './public.decorator.js';
import { LOGISTICA_ISSUER, SESSION_TTL_SECONDS, type AxisJwtPayload } from './jwt.strategy.js';

export class ExchangeDto {
  @IsString({ message: 'Informe o token de acesso do Axis.' }) @MinLength(20, { message: 'Token inválido.' }) @MaxLength(4096, { message: 'Token inválido.' })
  token!: string;
}

/**
 * Entrada pelo botão "Abrir" do Axis (launcher de satélite): o Axis entrega um JWT de vida curta (~90 s) só para a troca inicial.
 * A Logística valida esse JWT com o MESMO segredo do Axis e devolve uma sessão própria, mais longa, para o PWA não cair em 90 s.
 * Não há senha nem cadastro aqui: a identidade continua sendo a do Axis; usuário desligado no Axis (evento user.disabled) não troca nem continua.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() dto: ExchangeDto) {
    let claims: AxisJwtPayload & { iss?: string };
    try {
      claims = await this.jwt.verifyAsync<AxisJwtPayload & { iss?: string }>(dto.token, { secret: this.config.getOrThrow<string>('JWT_SECRET'), algorithms: ['HS256'] });
    } catch {
      throw new UnauthorizedException('O acesso pelo Axis expirou ou é inválido. Entre com seu e-mail e senha.');
    }
    if (claims.iss === LOGISTICA_ISSUER) throw new UnauthorizedException('Token inválido para troca.'); // sessão da Logística não se renova por aqui
    if (!claims.sub || !claims.email) throw new UnauthorizedException('Token inválido.');
    if (claims.mustChangePassword === true) throw new ForbiddenException('É necessário trocar a senha no Axis antes de acessar a Logística.');
    const cached = await this.prisma.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'USER', axisId: claims.sub } } });
    if (cached && !cached.active) throw new UnauthorizedException('Usuário desativado no Axis.');

    const accessToken = await this.jwt.signAsync(
      { sub: claims.sub, email: claims.email, roles: Array.isArray(claims.roles) ? claims.roles : [], collaboratorId: claims.collaboratorId ?? null, mustChangePassword: false },
      { secret: this.config.getOrThrow<string>('JWT_SECRET'), algorithm: 'HS256', expiresIn: SESSION_TTL_SECONDS, issuer: LOGISTICA_ISSUER },
    );
    return { accessToken, expiresIn: SESSION_TTL_SECONDS, email: claims.email };
  }
}
