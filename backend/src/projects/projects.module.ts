import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectDocumentsService } from './project-documents.service.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectDocumentsService],
  exports: [ProjectsService, ProjectDocumentsService],
})
export class ProjectsModule {}
