import { Module } from '@nestjs/common';
import { CollaboratorsService } from './collaborators.service.js';
import { CollaboratorsController } from './collaborators.controller.js';
import { SensitiveAccessLogService } from './sensitive-access-log.service.js';
import { SensitiveAccessLogController } from './sensitive-access-log.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [CollaboratorsController, SensitiveAccessLogController],
  providers: [CollaboratorsService, SensitiveAccessLogService],
  exports: [CollaboratorsService],
})
export class CollaboratorsModule {}
