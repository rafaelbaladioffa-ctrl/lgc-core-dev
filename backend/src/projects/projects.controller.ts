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
import { ProjectQuotesService } from './project-quotes.service.js';
import { ProjectApprovalService } from './project-approval.service.js';
import { ProjectJourneyService } from './project-journey.service.js';
import { RequestProjectQuoteDto } from './dto/project-quote.dto.js';

/** A Bid é guardada como ZIP genérico (detecção pelos bytes); o download usa o tipo de planilha. */
const BID_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('projects')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly documentsService: ProjectDocumentsService,
    private readonly quotesService: ProjectQuotesService,
    private readonly approvalService: ProjectApprovalService,
    private readonly journeyService: ProjectJourneyService,
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

  /** Obras que o Field deu por concluídas nos projetos do usuário e que ainda esperam o encerramento (PT-09). */
  @Get('field-alerts')
  @RequirePermissions('project:read')
  fieldAlerts(@CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.fieldAlerts(user.collaboratorId);
  }

  /** Etapa atual de cada projeto (selo da lista), `{ [projectId]: { key, label, state } }` (PT-11). */
  @Get('journey-stages')
  @RequirePermissions('project:read')
  async journeyStages() {
    const projects = await this.projectsService.findAll();
    return this.journeyService.currentStages(projects.map((p) => p.id));
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
  updateStatus(@Param('id') id: string, @Body() dto: UpdateProjectStatusDto, @CurrentUser() user: AuthenticatedUser) {
    // Aprovar o projeto exige site e cotação, grava o aceite e cria a requisição de envio de material (PT-06).
    if (dto.status === 'aprovado') return this.approvalService.approve(id, dto, user.userId);
    return this.projectsService.updateStatus(id, dto);
  }

  @Get(':id/acceptance')
  @RequirePermissions('project:read')
  getAcceptance(@Param('id') id: string) {
    return this.approvalService.getAcceptance(id);
  }

  /** Jornada do projeto: cotação → aprovado → requisição de envio → obra no Field → encerrado (PT-11). Sem valores de custo. */
  @Get(':id/journey')
  @RequirePermissions('project:read')
  getJourney(@Param('id') id: string) {
    return this.journeyService.journey(id);
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

  // Cotação pelo Financeiro (docs/integracao-core-financeiro.md §4). Pedir exige project:update;
  // ver a cotação e baixar a Bid exige project:read_documents (a Bid traz os valores cobrados).
  @Post(':id/quote-requests')
  @RequirePermissions('project:update')
  @AuditAction({ action: 'request_project_quote', resourceType: 'project', resourceIdParam: 'id' })
  requestQuote(@Param('id') id: string, @Body() dto: RequestProjectQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.quotesService.request(id, dto, user.userId);
  }

  @Get(':id/quotes')
  @RequirePermissions('project:read_documents')
  listQuotes(@Param('id') id: string) {
    return this.quotesService.list(id);
  }

  @Get(':id/quotes/:quoteId/bid')
  @RequirePermissions('project:read_documents')
  @AuditAction({ action: 'download_project_bid', resourceType: 'project', resourceIdParam: 'id' })
  async downloadBid(@Param('id') id: string, @Param('quoteId') quoteId: string, @Res() res: Response) {
    const quote = await this.quotesService.getBid(id, quoteId);
    res.set({
      'Content-Type': BID_CONTENT_TYPE,
      'Content-Disposition': contentDisposition(quote.bidFilename),
      'X-Content-SHA256': quote.bidContentHash,
    });
    res.send(quote.bidContent);
  }
}
