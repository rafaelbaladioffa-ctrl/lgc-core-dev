import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateDestinationDto, CreateMaterialDto, UpdateDestinationDto, UpdateMaterialDto } from './catalogs.dto.js';
import { CatalogsService } from './catalogs.service.js';

const truthy = (v: string | undefined) => v === 'true' || v === '1';

@Controller('budget-materials')
export class BudgetMaterialsController {
  constructor(private readonly service: CatalogsService) {}

  @Get()
  @RequirePermissions('budget_params:read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('includeInactive') includeInactive?: string) {
    return this.service.listMaterials(user, truthy(includeInactive));
  }

  @Get(':id')
  @RequirePermissions('budget_params:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.getMaterial(id, user);
  }

  @Post()
  @RequirePermissions('budget_params:write')
  create(@Body() dto: CreateMaterialDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createMaterial(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('budget_params:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateMaterial(id, dto, user);
  }
}

@Controller('budget-destinations')
export class BudgetDestinationsController {
  constructor(private readonly service: CatalogsService) {}

  @Get()
  @RequirePermissions('budget_params:read')
  list(@Query('includeInactive') includeInactive?: string) {
    return this.service.listDestinations(truthy(includeInactive));
  }

  @Get(':id')
  @RequirePermissions('budget_params:read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.getDestination(id);
  }

  @Post()
  @RequirePermissions('budget_params:write')
  create(@Body() dto: CreateDestinationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createDestination(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('budget_params:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDestinationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.updateDestination(id, dto, user);
  }
}
