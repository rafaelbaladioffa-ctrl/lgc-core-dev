import { Module } from '@nestjs/common';
import { JobTitlesService } from './job-titles.service.js';
import { JobTitlesController } from './job-titles.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [JobTitlesController],
  providers: [JobTitlesService],
  exports: [JobTitlesService],
})
export class JobTitlesModule {}
