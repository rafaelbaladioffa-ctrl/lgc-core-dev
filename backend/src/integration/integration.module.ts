import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { MasterDataResyncService } from './master-data-resync.service.js';
import { OutboxService } from './outbox.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { SatellitesService } from './satellites.service.js';
import { SatelliteApiKeyGuard } from './guards/satellite-api-key.guard.js';
import { SatelliteInboundGuard } from './guards/satellite-inbound.guard.js';
import { SatelliteThrottlerGuard } from './guards/satellite-throttler.guard.js';
import { IntegrationQueryController } from './integration-query.controller.js';
import { IntegrationAdminController } from './integration-admin.controller.js';
import { IntegrationOutboxController } from './integration-outbox.controller.js';
import { InboundEventsController } from './inbound/inbound-events.controller.js';
import { InboxAdminController } from './inbound/inbox-admin.controller.js';
import { InboundEventsService } from './inbound/inbound-events.service.js';
import { InboundHandlerRegistry } from './inbound/inbound-handler.registry.js';
import { INBOUND_EVENT_HANDLERS } from './inbound/inbound-handler.js';
import { LogisticsFulfillmentHandler } from './inbound/handlers/logistics-fulfillment.handler.js';
import { FieldProjectHandler } from './inbound/handlers/field-project.handler.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), AuthModule],
  controllers: [
    IntegrationQueryController,
    IntegrationAdminController,
    IntegrationOutboxController,
    InboundEventsController,
    InboxAdminController,
  ],
  providers: [
    MasterDataResyncService,
    OutboxService,
    OutboxDispatcherService,
    SatellitesService,
    SatelliteApiKeyGuard,
    SatelliteInboundGuard,
    SatelliteThrottlerGuard,
    InboundEventsService,
    InboundHandlerRegistry,
    // Handlers de evento de satélite (PT-09): Logística acompanha o envio de material; Field, a obra do projeto.
    LogisticsFulfillmentHandler,
    FieldProjectHandler,
    {
      provide: INBOUND_EVENT_HANDLERS,
      useFactory: (logistics: LogisticsFulfillmentHandler, field: FieldProjectHandler) => [logistics, field],
      inject: [LogisticsFulfillmentHandler, FieldProjectHandler],
    },
  ],
  exports: [OutboxService, SatelliteApiKeyGuard, SatelliteThrottlerGuard],
})
export class IntegrationModule {}
