import { Module } from '@nestjs/common';
import { ReplenishmentModule } from '../replenishment/replenishment.module.js';
import { StockModule } from '../stock/stock.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';
import { IntegrationApiKeyGuard } from './api-key.guard.js';
import { FinanceIntegrationController, FinanceIntegrationService } from './finance-integration.controller.js';
import { MaterialsLookupController, MaterialsLookupService } from './materials-lookup.controller.js';
import { AxisLookupController, AxisLookupService } from './axis-lookup.controller.js';

@Module({ imports: [FulfillmentModule, ReplenishmentModule, StockModule], controllers: [AxisWebhookController, OutboxController, FinanceIntegrationController, MaterialsLookupController, AxisLookupController], providers: [AxisWebhookService, OutboxDispatcherService, FinanceIntegrationService, MaterialsLookupService, AxisLookupService, IntegrationApiKeyGuard], exports: [AxisWebhookService, OutboxDispatcherService] })
export class IntegrationModule {}
