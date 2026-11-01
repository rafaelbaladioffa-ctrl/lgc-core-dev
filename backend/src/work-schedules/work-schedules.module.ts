import { Module } from '@nestjs/common';
import { WorkSchedulesService } from './work-schedules.service.js';
import { WorkSchedulesController } from './work-schedules.controller.js';

@Module({
  controllers: [WorkSchedulesController],
  providers: [WorkSchedulesService],
  exports: [WorkSchedulesService],
})
export class WorkSchedulesModule {}
