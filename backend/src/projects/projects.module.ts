import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectDocumentsService } from './project-documents.service.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { ProjectQuotesService } from './project-quotes.service.js';
import { ProjectQuotesIntegrationController } from './project-quotes-integration.controller.js';

@Module({
  imports: [IntegrationModule],
  controllers: [ProjectsController, ProjectQuotesIntegrationController],
  providers: [ProjectsService, ProjectDocumentsService, ProjectQuotesService],
  exports: [ProjectsService, ProjectDocumentsService],
})
export class ProjectsModule {}
