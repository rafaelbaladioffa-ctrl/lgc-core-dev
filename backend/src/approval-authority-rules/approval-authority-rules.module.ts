import { Module } from '@nestjs/common';
import { ApprovalAuthorityRulesService } from './approval-authority-rules.service.js';
import { ApprovalAuthorityRulesController } from './approval-authority-rules.controller.js';

@Module({
  controllers: [ApprovalAuthorityRulesController],
  providers: [ApprovalAuthorityRulesService],
  exports: [ApprovalAuthorityRulesService],
})
export class ApprovalAuthorityRulesModule {}
