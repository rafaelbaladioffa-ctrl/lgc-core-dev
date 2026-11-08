import { CanActivate, ExecutionContext, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/** Compara em tempo constante: os dois lados viram SHA-256, então nem o tamanho da chave vaza. */
export function sameKey(expected: string, received: string): boolean {
  const a = createHash('sha256').update(expected, 'utf8').digest();
  const b = createHash('sha256').update(received, 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * Autentica sistemas internos (hoje, o Financeiro) pelo cabeçalho `X-Api-Key` contra `INTEGRATION_API_KEY`.
 * Usado junto com `@Public()`: a rota sai do JWT de usuário do Axis e passa a exigir só a chave.
 * Sem variável configurada → 503 (a integração está desligada); chave ausente ou errada → 401.
 */
@Injectable()
export class IntegrationApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(IntegrationApiKeyGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = this.config.get<string>('INTEGRATION_API_KEY');
    if (!secret) throw new ServiceUnavailableException('Integração por chave não configurada (INTEGRATION_API_KEY).');
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['x-api-key'];
    const received = Array.isArray(header) ? header[0] : header;
    if (!received || !sameKey(secret, received)) {
      this.logger.warn(`Chave de integração ausente ou inválida em ${req.method} ${req.originalUrl?.split('?')[0] ?? ''} (${req.ip ?? 'ip desconhecido'}).`);
      throw new UnauthorizedException('Chave de integração ausente ou inválida.');
    }
    return true;
  }
}
