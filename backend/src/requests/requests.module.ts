import { Module } from '@nestjs/common';
import { RequestsService } from './requests.service.js';
import { RequestsController } from './requests.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { DelegationsModule } from '../delegations/delegations.module.js';
import { ApprovalAuthorityRulesModule } from '../approval-authority-rules/approval-authority-rules.module.js';
import { HolidaysModule } from '../holidays/holidays.module.js';

@Module({
  imports: [IntegrationModule, DelegationsModule, ApprovalAuthorityRulesModule, HolidaysModule],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}
