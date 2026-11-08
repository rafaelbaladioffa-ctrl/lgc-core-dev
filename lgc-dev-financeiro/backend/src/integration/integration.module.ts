import { Module } from '@nestjs/common';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';
import { MasterDataController, MasterDataService } from './master-data.controller.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { OutboxService } from './outbox.service.js';

@Module({
  controllers: [AxisWebhookController, OutboxController, MasterDataController],
  providers: [AxisWebhookService, OutboxDispatcherService, OutboxService, MasterDataService],
  exports: [AxisWebhookService, OutboxService],
})
export class IntegrationModule {}
