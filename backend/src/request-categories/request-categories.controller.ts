import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { RequestCategoriesService } from './request-categories.service.js';
import { CreateRequestCategoryDto } from './dto/create-request-category.dto.js';
import { UpdateRequestCategoryDto } from './dto/update-request-category.dto.js';
import { UpdateCategoryDraftDto } from './dto/update-category-draft.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

@Controller('request-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RequestCategoriesController {
  constructor(private readonly requestCategoriesService: RequestCategoriesService) {}

  @Post()
  @RequirePermissions('request_category:create')
  @AuditAction({ action: 'create_request_category', resourceType: 'request_category' })
  create(@Body() dto: CreateRequestCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.requestCategoriesService.create(dto, user.collaboratorId);
  }

  /** Catálogo da abertura de requisição: só ativas com versão publicada. */
  @Get()
  @RequirePermissions('request_category:read')
  findAllCatalog(@Query('sectorId') sectorId?: string) {
    return this.requestCategoriesService.findAllCatalog(sectorId);
  }

  // Declarada antes de ':id' para não ser interpretada como id.
  @Get('admin')
  @RequirePermissions('request_category:update')
  findAllAdmin() {
    return this.requestCategoriesService.findAllAdmin();
  }

  @Get(':id')
  @RequirePermissions('request_category:update')
  findOne(@Param('id') id: string) {
    return this.requestCategoriesService.findOne(id);
  }

  @Patch(':id')
  @RequirePermissions('request_category:update')
  @AuditAction({ action: 'update_request_category', resourceType: 'request_category', resourceIdParam: 'id' })
  update(@Param('id') id: string, @Body() dto: UpdateRequestCategoryDto) {
    return this.requestCategoriesService.update(id, dto);
  }

  @Post(':id/draft')
  @RequirePermissions('request_category:update')
  @AuditAction({ action: 'create_request_category_draft', resourceType: 'request_category', resourceIdParam: 'id' })
  createDraft(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestCategoriesService.createDraft(id, user.collaboratorId);
  }

  @Put(':id/draft')
  @RequirePermissions('request_category:update')
  @AuditAction({ action: 'update_request_category_draft', resourceType: 'request_category', resourceIdParam: 'id' })
  updateDraft(@Param('id') id: string, @Body() dto: UpdateCategoryDraftDto) {
    return this.requestCategoriesService.updateDraft(id, dto);
  }

  @Delete(':id/draft')
  @RequirePermissions('request_category:update')
  @AuditAction({ action: 'discard_request_category_draft', resourceType: 'request_category', resourceIdParam: 'id' })
  discardDraft(@Param('id') id: string) {
    return this.requestCategoriesService.discardDraft(id);
  }

  @Post(':id/draft/publish')
  @RequirePermissions('request_category:publish')
  @AuditAction({ action: 'publish_request_category_draft', resourceType: 'request_category', resourceIdParam: 'id' })
  publishDraft(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.requestCategoriesService.publishDraft(id, user.collaboratorId);
  }
}
