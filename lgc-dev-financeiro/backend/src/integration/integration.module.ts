import { Module } from '@nestjs/common';
import { AxisWebhookController } from './axis-webhook.controller.js';
import { AxisWebhookService } from './axis-webhook.service.js';
import { OutboxController } from './outbox.controller.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { OutboxService } from './outbox.service.js';

@Module({
  controllers: [AxisWebhookController, OutboxController],
  providers: [AxisWebhookService, OutboxDispatcherService, OutboxService],
  exports: [AxisWebhookService, OutboxService],
})
export class IntegrationModule {}
