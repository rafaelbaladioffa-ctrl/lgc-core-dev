import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RequestCategoriesService } from './request-categories.service.js';
import { CreateRequestCategoryDto } from './dto/create-request-category.dto.js';
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

  @Get()
  @RequirePermissions('request_category:read')
  findAllCatalog(@Query('sectorId') sectorId?: string) {
    return this.requestCategoriesService.findAllCatalog(sectorId);
  }

  @Get(':id')
  @RequirePermissions('request_category:read')
  findOne(@Param('id') id: string) {
    return this.requestCategoriesService.findOne(id);
  }
}
