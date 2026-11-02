import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CollaboratorsService } from './collaborators.service.js';
import { SensitiveAccessLogService } from './sensitive-access-log.service.js';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto.js';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

@Controller('collaborators')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CollaboratorsController {
  constructor(
    private readonly collaboratorsService: CollaboratorsService,
    private readonly sensitiveAccessLog: SensitiveAccessLogService,
  ) {}

  @Get('me')
  @RequirePermissions('collaborator:read')
  findMe(@CurrentUser() user: AuthenticatedUser) {
    if (!user.collaboratorId) return null;
    return this.collaboratorsService.findOneSafe(user.collaboratorId);
  }

  @Post()
  @RequirePermissions('collaborator:create')
  @AuditAction({ action: 'create_collaborator', resourceType: 'collaborator' })
  create(@Body() dto: CreateCollaboratorDto) {
    return this.collaboratorsService.create(dto);
  }

  @Get()
  @RequirePermissions('collaborator:read')
  findAll() {
    return this.collaboratorsService.findAll();
  }

  @Get('org-chart')
  @RequirePermissions('collaborator:read')
  getOrgChart() {
    return this.collaboratorsService.getOrgChart();
  }

  @Get(':id')
  @RequirePermissions('collaborator:read')
  findOne(@Param('id') id: string) {
    return this.collaboratorsService.findOneSafe(id);
  }

  @Get(':id/sensitive')
  @RequirePermissions('collaborator:read_sensitive')
  async findOneSensitive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const full = await this.collaboratorsService.findOneFull(id);
    await this.sensitiveAccessLog.record(id, user.userId, ['rg', 'cpf', 'ctps', 'pis']);
    return full;
  }

  @Put(':id')
  @RequirePermissions('collaborator:update')
  @AuditAction({ action: 'update_collaborator', resourceType: 'collaborator', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateCollaboratorDto) {
    return this.collaboratorsService.update(id, dto);
  }

  @Post(':id/offboard')
  @RequirePermissions('collaborator:update')
  @AuditAction({ action: 'offboard_collaborator', resourceType: 'collaborator', resourceIdParam: 'id' })
  offboard(@Param('id') id: string) {
    return this.collaboratorsService.offboard(id);
  }
}
