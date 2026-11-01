import { Module } from '@nestjs/common';
import { JobTitlesService } from './job-titles.service.js';
import { JobTitlesController } from './job-titles.controller.js';

@Module({
  controllers: [JobTitlesController],
  providers: [JobTitlesService],
  exports: [JobTitlesService],
})
export class JobTitlesModule {}
