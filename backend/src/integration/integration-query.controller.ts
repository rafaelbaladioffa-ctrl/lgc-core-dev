import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';
import { SatelliteApiKeyGuard } from './guards/satellite-api-key.guard.js';
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
    const where = { sectorId, status };
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
