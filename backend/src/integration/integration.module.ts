import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { OutboxService } from './outbox.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { SatellitesService } from './satellites.service.js';
import { SatelliteApiKeyGuard } from './guards/satellite-api-key.guard.js';
import { SatelliteThrottlerGuard } from './guards/satellite-throttler.guard.js';
import { IntegrationQueryController } from './integration-query.controller.js';
import { IntegrationAdminController } from './integration-admin.controller.js';
import { IntegrationOutboxController } from './integration-outbox.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), AuthModule],
  controllers: [IntegrationQueryController, IntegrationAdminController, IntegrationOutboxController],
  providers: [OutboxService, OutboxDispatcherService, SatellitesService, SatelliteApiKeyGuard, SatelliteThrottlerGuard],
  exports: [OutboxService, SatelliteApiKeyGuard, SatelliteThrottlerGuard],
})
export class IntegrationModule {}
