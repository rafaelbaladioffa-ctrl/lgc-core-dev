import { Module } from '@nestjs/common';
import { ReplenishmentModule } from '../replenishment/replenishment.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';
import { IntegrationApiKeyGuard } from './api-key.guard.js';
import { FinanceIntegrationController, FinanceIntegrationService } from './finance-integration.controller.js';

@Module({ imports: [FulfillmentModule, ReplenishmentModule], controllers: [AxisWebhookController, OutboxController, FinanceIntegrationController], providers: [AxisWebhookService, OutboxDispatcherService, FinanceIntegrationService, IntegrationApiKeyGuard], exports: [AxisWebhookService, OutboxDispatcherService] })
export class IntegrationModule {}
