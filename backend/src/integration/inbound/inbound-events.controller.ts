import { Body, Controller, Headers, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { SatelliteInboundGuard } from '../guards/satellite-inbound.guard.js';
import { SatelliteThrottlerGuard } from '../guards/satellite-throttler.guard.js';
import type { SatelliteRequest } from '../guards/satellite-api-key.guard.js';
import { InboundEventsService } from './inbound-events.service.js';

/**
 * Receptor dos eventos dos outbox dos satélites (Logística, Financeiro, Field). Sem JWT: a
 * autenticidade é a assinatura HMAC do corpo bruto (SatelliteInboundGuard), e a identidade do satélite
 * sai dela. Por isso não usa `@RequirePermissions`/`@AuditAction`: o rastro de cada entrega é a própria
 * linha da `integration_inbox`.
 *
 * Respostas: 200 processado (ou repetição de um já processado), 202 ignorado por falta de handler,
 * 401 assinatura inválida, 400 envelope inválido, 500 handler falhou (o satélite reenvia).
 */
@Controller('integration/inbound')
@UseGuards(SatelliteInboundGuard, SatelliteThrottlerGuard)
@Throttle({ default: { limit: 600, ttl: 60_000 } })
export class InboundEventsController {
  constructor(private readonly inbound: InboundEventsService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: SatelliteRequest,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.inbound.receive(req.satellite, body, headers);
    if (result.status === 'ignored') res.status(202);
    return { status: result.status, event_id: result.eventId, duplicate: result.duplicate };
  }
}
