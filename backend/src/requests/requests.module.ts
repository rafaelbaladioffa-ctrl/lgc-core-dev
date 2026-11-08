import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service.js';
import { RequestsController } from './requests.controller.js';
import { ShipmentRequestsController } from './shipment-requests.controller.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { DelegationsModule } from '../delegations/delegations.module.js';
import { ApprovalAuthorityRulesModule } from '../approval-authority-rules/approval-authority-rules.module.js';
import { HolidaysModule } from '../holidays/holidays.module.js';

@Module({
  imports: [IntegrationModule, DelegationsModule, ApprovalAuthorityRulesModule, HolidaysModule],
  controllers: [RequestsController, ShipmentRequestsController],
  providers: [RequestsService, ShipmentRequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
