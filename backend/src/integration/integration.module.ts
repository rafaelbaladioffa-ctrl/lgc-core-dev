import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';

@Module({ imports: [FulfillmentModule], controllers: [AxisWebhookController], providers: [AxisWebhookService], exports: [AxisWebhookService] })
export class IntegrationModule {}
