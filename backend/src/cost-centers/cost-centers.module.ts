import { Module } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service.js';
import { CostCentersController } from './cost-centers.controller.js';
import { CostCentersIntegrationController } from './cost-centers-integration.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [CostCentersController, CostCentersIntegrationController],
  providers: [CostCentersService],
  exports: [CostCentersService],
})
export class CostCentersModule {}
