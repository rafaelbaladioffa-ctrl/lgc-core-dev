import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { SatelliteApiKeyGuard, type SatelliteRequest } from './guards/satellite-api-key.guard.js';
import { PROJECT_DOCUMENT_EVENT, contentDisposition } from '../projects/project-documents.service.js';
import { SatelliteThrottlerGuard } from './guards/satellite-throttler.guard.js';
import type { CollaboratorStatus } from '@prisma/client';

function paginate(page?: string, perPage?: string) {
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.min(200, Math.max(1, Number(perPage) || 50));
  return { skip: (pageNum - 1) * perPageNum, take: perPageNum, page: pageNum, perPage: perPageNum };
}

/**
 * Synchronous read API for satellite systems (PLANNING.md 6.1/6.2), authenticated by API key
 * (not the end-user JWT) and rate-limited per key. Mounted under /integration rather than the
 * literal "/api/v1/<resource>" paths in the doc, because those paths are already used by the
 * JWT-protected internal CRUD controllers in this app — the resource names, filters and the
 * {data, meta} pagination envelope otherwise match section 6.2 exactly.
 */
@Controller('integration')
@UseGuards(SatelliteApiKeyGuard, SatelliteThrottlerGuard)
@Throttle({ default: { limit: 100, ttl: 60_000 } })
export class IntegrationQueryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('collaborators/:id')
  async getCollaborator(@Param('id') id: string) {
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id },
      select: this.collaboratorSafeSelect(),
    });
    if (!collaborator) throw new NotFoundException('Collaborator not found');
    return collaborator;
  }

  @Get('collaborators')
  async listCollaborators(
    @Query('sector_id') sectorId?: string,
    @Query('status') status?: CollaboratorStatus,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const where = { sectorId, status, isSystem: false };
    const [data, total] = await Promise.all([
      this.prisma.collaborator.findMany({ where, skip, take, select: this.collaboratorSafeSelect() }),
      this.prisma.collaborator.count({ where }),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  @Get('users/:id')
  async getUser(@Param('id') id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, status: true, userRoles: { select: { role: { select: { name: true } } } } },
    });
    if (!user) throw new NotFoundException('User not found');
    return { id: user.id, email: user.email, status: user.status, roles: user.userRoles.map((ur) => ur.role.name) };
  }

  @Get('clients/:id')
  async getClient(@Param('id') id: string) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  @Get('clients')
  async listClients(@Query('code') code?: string, @Query('page') page?: string, @Query('per_page') perPage?: string) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const where = code ? { code: Number(code) } : {};
    const [data, total] = await Promise.all([
      this.prisma.client.findMany({ where, skip, take }),
      this.prisma.client.count({ where }),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  @Get('sites/:id')
  async getSite(@Param('id') id: string) {
    const site = await this.prisma.site.findUnique({ where: { id } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  @Get('sites')
  async listSites(
    @Query('client_id') clientId?: string,
    @Query('code') code?: string,
    @Query('active') active?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const where = { clientId, code, active: active === 'true' ? true : active === 'false' ? false : undefined };
    const [data, total] = await Promise.all([
      this.prisma.site.findMany({ where, orderBy: [{ clientId: 'asc' }, { code: 'asc' }], skip, take }),
      this.prisma.site.count({ where }),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  @Get('projects/:id')
  async getProject(@Param('id') id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  @Get('projects')
  async listProjects(
    @Query('client_id') clientId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const where = { clientId, status: status as never };
    const [data, total] = await Promise.all([
      this.prisma.project.findMany({ where, skip, take }),
      this.prisma.project.count({ where }),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  /**
   * Documentos do projeto (SOW). Só para satélites assinantes de `project.document_added`: a SOW é
   * documento do cliente e não entra na consulta geral de dados não sensíveis.
   */
  @Get('projects/:id/documents')
  async listProjectDocuments(@Param('id') id: string, @Req() req: SatelliteRequest) {
    await this.assertDocumentSubscriber(req);
    const project = await this.prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) throw new NotFoundException('Project not found');
    const data = await this.prisma.projectDocument.findMany({
      where: { projectId: id },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      select: { id: true, projectId: true, kind: true, version: true, filename: true, mimeType: true, sizeBytes: true, contentHash: true, createdAt: true },
    });
    return { data };
  }

  @Get('projects/:id/documents/:documentId/content')
  async getProjectDocumentContent(
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: SatelliteRequest,
    @Res() res: Response,
  ) {
    await this.assertDocumentSubscriber(req);
    const document = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId: id },
      select: { filename: true, mimeType: true, content: true, contentHash: true },
    });
    if (!document) throw new NotFoundException('Document not found');
    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': contentDisposition(document.filename),
      'X-Content-SHA256': document.contentHash,
    });
    res.send(document.content);
  }

  private async assertDocumentSubscriber(req: SatelliteRequest): Promise<void> {
    const subscription = await this.prisma.integrationSubscription.findUnique({
      where: { satelliteId_eventType: { satelliteId: req.satellite.id, eventType: PROJECT_DOCUMENT_EVENT } },
    });
    if (!subscription) {
      throw new ForbiddenException(`O satélite precisa assinar ${PROJECT_DOCUMENT_EVENT} para ler documentos de projeto.`);
    }
  }

  @Get('sectors')
  async listSectors(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const [data, total] = await Promise.all([
      this.prisma.sector.findMany({ skip, take }),
      this.prisma.sector.count(),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  @Get('cost-centers')
  async listCostCenters(@Query('page') page?: string, @Query('per_page') perPage?: string) {
    const { skip, take, page: p, perPage: pp } = paginate(page, perPage);
    const [data, total] = await Promise.all([
      this.prisma.costCenter.findMany({ skip, take }),
      this.prisma.costCenter.count(),
    ]);
    return { data, meta: { page: p, per_page: pp, total } };
  }

  private collaboratorSafeSelect() {
    return {
      id: true,
      fullName: true,
      corporateEmail: true,
      jobTitle: { select: { name: true, isTechnician: true } },
      sectorId: true,
      supervisorId: true,
      status: true,
    } as const;
  }
}
