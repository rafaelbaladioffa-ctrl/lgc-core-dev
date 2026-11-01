import { Module } from '@nestjs/common';
import { SectorsService } from './sectors.service.js';
import { SectorsController } from './sectors.controller.js';

@Module({
  controllers: [SectorsController],
  providers: [SectorsService],
  exports: [SectorsService],
})
export class SectorsModule {}
