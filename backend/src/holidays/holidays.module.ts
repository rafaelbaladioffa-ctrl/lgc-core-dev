import { Module } from '@nestjs/common';
import { HolidaysService } from './holidays.service.js';
import { HolidaysController } from './holidays.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
