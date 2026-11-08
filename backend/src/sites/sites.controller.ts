import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SitesService } from './sites.service.js';
import { CreateSiteDto } from './dto/create-site.dto.js';
import { UpdateSiteDto } from './dto/update-site.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';

@Controller('sites')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  /** `?clientId=` filtra por cliente; `?active=true|false` por situação. */
  @Get()
  @RequirePermissions('site:read')
  findAll(@Query('clientId') clientId?: string, @Query('active') active?: string) {
    return this.sitesService.findAll({
      clientId: clientId || undefined,
      active: active === 'true' ? true : active === 'false' ? false : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions('site:read')
  findOne(@Param('id') id: string) {
    return this.sitesService.findOne(id);
  }

  @Post()
  @RequirePermissions('site:create')
  @AuditAction({ action: 'create_site', resourceType: 'site' })
  create(@Body() dto: CreateSiteDto) {
    return this.sitesService.create(dto);
  }

  /** Também inativa e reativa o site (`active`); site não se exclui. */
  @Put(':id')
  @RequirePermissions('site:update')
  @AuditAction({ action: 'update_site', resourceType: 'site', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sitesService.update(id, dto);
  }
}
