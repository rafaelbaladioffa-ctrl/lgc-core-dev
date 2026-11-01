import { Module } from '@nestjs/common';
import { CostCentersService } from './cost-centers.service.js';
import { CostCentersController } from './cost-centers.controller.js';

@Module({
  controllers: [CostCentersController],
  providers: [CostCentersService],
  exports: [CostCentersService],
})
export class CostCentersModule {}
