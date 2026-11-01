import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator.js';
import { AxisWebhookService } from './axis-webhook.service.js';

@Controller('webhooks')
export class AxisWebhookController {
  constructor(private readonly webhook: AxisWebhookService) {}

  /** Autenticado por assinatura HMAC (não por JWT). Responde 200 também para duplicados. */
  @Public()
  @SkipThrottle()
  @Post('axis')
  @HttpCode(200)
  receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-axis-signature') signature?: string) {
    return this.webhook.receive(req.rawBody, signature);
  }
}
