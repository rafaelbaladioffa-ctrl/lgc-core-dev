import { Module } from '@nestjs/common';
import { IntegrationModule } from '../integration/integration.module.js';
import { CcContext } from './cc-context.js';
import { CostCentersController } from './cost-centers.controller.js';
import { CostCentersService } from './cost-centers.service.js';
import { LogisticsClient } from './logistics.client.js';
import { LogisticsImportScheduler } from './logistics-import.scheduler.js';
import { TeamsService } from './teams.service.js';

@Module({
  imports: [IntegrationModule],
  controllers: [CostCentersController],
  providers: [CcContext, CostCentersService, TeamsService, LogisticsClient, LogisticsImportScheduler],
})
export class CostCentersModule {}
