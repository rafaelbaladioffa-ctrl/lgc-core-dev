import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ProjectsService } from './projects.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { ProjectDocumentsService, contentDisposition } from './project-documents.service.js';
import { CreateProjectDocumentDto } from './dto/create-project-document.dto.js';

@Controller('projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly documentsService: ProjectDocumentsService,
  ) {}

  @Post()
  @RequirePermissions('project:create')
  @AuditAction({ action: 'create_project', resourceType: 'project' })
  create(@Body() dto: CreateProjectDto) {
    return this.projectsService.create(dto);
  }

  @Get()
  @RequirePermissions('project:read')
  findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  @RequirePermissions('project:read')
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Put(':id')
  @RequirePermissions('project:update')
  @AuditAction({ action: 'update_project', resourceType: 'project', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projectsService.update(id, dto);
  }

  @Put(':id/status')
  @RequirePermissions('project:update')
  @AuditAction({ action: 'change_project_status', resourceType: 'project', resourceIdParam: 'id' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto) {
    return this.projectsService.updateStatus(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('project:delete')
  @AuditAction({ action: 'delete_project', resourceType: 'project', resourceIdParam: 'id' })
  remove(@Param('id') id: string) {
    return this.projectsService.remove(id);
  }

  // Documentos (SOW). Enviar exige project:update; ver e baixar exige project:read_documents,
  // porque a SOW é documento do cliente (decisão P-05 do módulo Projetos do Financeiro).
  @Post(':id/documents')
  @RequirePermissions('project:update')
  @AuditAction({ action: 'upload_project_document', resourceType: 'project', resourceIdParam: 'id' })
  addDocument(@Param('id') id: string, @Body() dto: CreateProjectDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.documentsService.add(id, dto.kind, dto.filename, dto.contentBase64, user.userId);
  }

  @Get(':id/documents')
  @RequirePermissions('project:read_documents')
  listDocuments(@Param('id') id: string) {
    return this.documentsService.list(id);
  }

  @Get(':id/documents/:documentId/content')
  @RequirePermissions('project:read_documents')
  @AuditAction({ action: 'download_project_document', resourceType: 'project', resourceIdParam: 'id' })
  async downloadDocument(@Param('id') id: string, @Param('documentId') documentId: string, @Res() res: Response) {
    const document = await this.documentsService.getContent(id, documentId);
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': contentDisposition(document.filename),
      'X-Content-SHA256': document.contentHash,
    });
    res.send(document.content);
  }
}
