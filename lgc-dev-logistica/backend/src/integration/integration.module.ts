import { Module } from '@nestjs/common';
import { ReplenishmentModule } from '../replenishment/replenishment.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';

@Module({ imports: [FulfillmentModule, ReplenishmentModule], controllers: [AxisWebhookController, OutboxController], providers: [AxisWebhookService, OutboxDispatcherService], exports: [AxisWebhookService, OutboxDispatcherService] })
export class IntegrationModule {}
