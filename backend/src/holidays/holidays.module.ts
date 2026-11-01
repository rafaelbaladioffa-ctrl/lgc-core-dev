import { Module } from '@nestjs/common';
import { HolidaysService } from './holidays.service.js';
import { HolidaysController } from './holidays.controller.js';

@Module({
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
