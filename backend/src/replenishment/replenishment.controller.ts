import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CalculateDto, DiscardDto, ListSuggestionsQuery, ReplenishmentService, SetPolicyDto } from './replenishment.service.js';

@Controller()
export class ReplenishmentController {
  constructor(private readonly rep: ReplenishmentService) {}

  @Put('stock-policies') @RequirePermissions('policy:write')
  setPolicy(@Body() dto: SetPolicyDto, @CurrentUser() u: AuthenticatedUser) { return this.rep.setPolicy(dto, u); }

  @Get('stock-policies') @RequirePermissions('purchasing:read')
  policies(@Query('warehouseId') warehouseId: string | undefined, @CurrentUser() u: AuthenticatedUser) { return this.rep.listPolicies(warehouseId, u); }

  @Post('replenishment/calculate') @HttpCode(200) @RequirePermissions('replenishment:manage')
  calculate(@Body() dto: CalculateDto, @CurrentUser() u: AuthenticatedUser) { return this.rep.calculate(dto, u); }

  @Get('replenishment/suggestions') @RequirePermissions('purchasing:read')
  list(@Query() q: ListSuggestionsQuery, @CurrentUser() u: AuthenticatedUser) { return this.rep.list(q, u); }

  @Post('replenishment/suggestions/:id/send') @HttpCode(200) @RequirePermissions('replenishment:manage')
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.rep.send(id, u); }

  @Post('replenishment/suggestions/:id/discard') @HttpCode(200) @RequirePermissions('replenishment:manage')
  discard(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DiscardDto, @CurrentUser() u: AuthenticatedUser) { return this.rep.discard(id, dto.reason, u); }
}
