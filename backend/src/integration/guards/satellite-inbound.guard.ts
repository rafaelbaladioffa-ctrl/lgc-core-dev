import { BadRequestException, CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { createHmac, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import type { IntegrationSatellite } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FieldEncryptionService } from '../../common/crypto/field-encryption.service.js';
import type { SatelliteRequest } from './satellite-api-key.guard.js';

/** Cabeçalhos de assinatura aceitos: um por satélite (Logística, Financeiro e Field). */
export const INBOUND_SIGNATURE_HEADERS = ['x-logistica-signature', 'x-financeiro-signature', 'x-field-signature'] as const;

type RawBodyRequest = SatelliteRequest & { rawBody?: Buffer };

function readSignature(headers: IncomingHttpHeaders): string | null {
  for (const name of INBOUND_SIGNATURE_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

/** `sha256=<hex>` ou só o hex → Buffer; null se não for hex de 32 bytes. */
function parseSignature(raw: string): Buffer | null {
  const hex = raw.trim().replace(/^sha256=/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

/**
 * Autentica a entrega de eventos de um satélite (`POST /integration/inbound`).
 *
 * A autenticidade vem do HMAC-SHA256 do corpo BRUTO com o segredo do satélite, comparado em tempo
 * constante. Os outbox da Logística e do Financeiro enviam só a assinatura e o `Idempotency-Key` — não
 * mandam a API key —, então o satélite é identificado por qual segredo ativo reproduz a assinatura. Se a
 * requisição trouxer `Authorization: Bearer <api_key>`, a chave precisa ser válida e a assinatura é
 * conferida contra o segredo daquele satélite.
 */
@Injectable()
export class SatelliteInboundGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RawBodyRequest>();

    const signatureHeader = readSignature(request.headers);
    if (!signatureHeader) throw new UnauthorizedException('Assinatura ausente.');
    const provided = parseSignature(signatureHeader);
    if (!provided) throw new UnauthorizedException('Assinatura inválida.');
    if (!request.rawBody) throw new BadRequestException('Corpo da requisição deve ser JSON.');

    const satellite = await this.resolveSatellite(request, provided);
    if (!satellite) throw new UnauthorizedException('Assinatura inválida.');
    request.satellite = satellite;
    return true;
  }

  private async resolveSatellite(request: RawBodyRequest, provided: Buffer): Promise<IntegrationSatellite | null> {
    const rawBody = request.rawBody!;
    let candidates = await this.prisma.integrationSatellite.findMany({ where: { status: 'active' } });

    const authorization = request.headers.authorization;
    if (authorization?.startsWith('Bearer ')) {
      const apiKey = authorization.slice('Bearer '.length);
      let owner: IntegrationSatellite | undefined;
      for (const satellite of candidates) {
        if (await bcrypt.compare(apiKey, satellite.apiKeyHash)) {
          owner = satellite;
          break;
        }
      }
      if (!owner) throw new UnauthorizedException('API key inválida.');
      candidates = [owner];
    }

    for (const satellite of candidates) {
      const secret = this.fieldEncryption.decrypt(satellite.hmacSecretEnc);
      const expected = createHmac('sha256', secret).update(rawBody).digest();
      if (timingSafeEqual(expected, provided)) return satellite;
    }
    return null;
  }
}
