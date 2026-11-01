import { Module } from '@nestjs/common';
import { ReplenishmentModule } from '../replenishment/replenishment.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';

@Module({ imports: [FulfillmentModule, ReplenishmentModule], controllers: [AxisWebhookController], providers: [AxisWebhookService], exports: [AxisWebhookService] })
export class IntegrationModule {}
