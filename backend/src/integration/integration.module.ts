import { Module } from '@nestjs/common';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';

@Module({ controllers: [AxisWebhookController], providers: [AxisWebhookService], exports: [AxisWebhookService] })
export class IntegrationModule {}
