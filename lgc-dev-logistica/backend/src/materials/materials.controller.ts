import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateMaterialDto, ListMaterialsQuery, UpdateMaterialDto } from './materials.dto.js';
import { MATERIAL_FAMILIES } from './material-families.js';
import { MaterialsService } from './materials.service.js';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get()
  @RequirePermissions('material:read')
  list(@Query() query: ListMaterialsQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.list(query, user);
  }

  @Get('families')
  @RequirePermissions('material:read')
  families() {
    return MATERIAL_FAMILIES;
  }

  /** Catálogo enxuto consumido pelo formulário de compra do Axis. */
  @Get('purchase-catalog')
  @RequirePermissions('material:read')
  purchaseCatalog() {
    return this.materials.purchaseCatalog();
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

  @Get(':id/deletable')
  @RequirePermissions('material:write')
  deletable(@Param('id', ParseUUIDPipe) id: string) {
    return this.materials.deletability(id);
  }

  /** Exclusão física só sem nenhum histórico de estoque; com histórico responde 409 e a ação é inativar. */
  @Delete(':id')
  @HttpCode(200)
  @RequirePermissions('material:write')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.remove(id, user);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('material:write')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.materials.deactivate(id, user);
  }
}
