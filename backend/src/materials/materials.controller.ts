import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateMaterialDto, ListMaterialsQuery, UpdateMaterialDto } from './materials.dto.js';
import { MaterialsService } from './materials.service.js';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @RequirePermissions('material:read')
  list(@Query() query: ListMaterialsQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.list(query, user);
  }

  @Get(':id')
  @RequirePermissions('material:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.get(id, user);
  }

  @Get(':id/versions')
  @RequirePermissions('material:read')
  versions(@Param('id', ParseUUIDPipe) id: string) {
    return this.materials.versions(id);
  }

  @Post()
  @RequirePermissions('material:write')
  create(@Body() dto: CreateMaterialDto, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('material:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialDto, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.update(id, dto, user);
  }

  /** Não há exclusão definitiva: DELETE inativa o material. */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('material:write')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.deactivate(id, user);
  }
}
