import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateParameterSetDto, PublishParameterSetDto, UpdateParameterSetDto } from './parameter-sets.dto.js';
import { ParameterSetsService } from './parameter-sets.service.js';

/** Parâmetros de orçamento versionados (projetos-especificacao §4 e §11). */
@Controller('parameter-sets')
export class ParameterSetsController {
  constructor(private readonly service: ParameterSetsService) {}

  @Get('schema')
  @RequirePermissions('budget_params:read')
  schema() {
    return this.service.schema();
  }

  @Get()
  @RequirePermissions('budget_params:read')
  list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions('budget_params:write')
  create(@Body() dto: CreateParameterSetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.createDraft(user, dto.basedOnId);
  }

  @Get(':id')
  @RequirePermissions('budget_params:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Get(':id/hourly-costs')
  @RequirePermissions('budget_params:read_payroll')
  hourlyCosts(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.hourlyCosts(id, user);
  }

  @Patch(':id')
  @RequirePermissions('budget_params:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateParameterSetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermissions('budget_params:write')
  publish(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PublishParameterSetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.publish(id, user, dto.effectiveFrom);
  }
}
