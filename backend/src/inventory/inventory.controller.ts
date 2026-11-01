import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { ActionPlanDto, ApplyAdjustmentsDto, CancelCountDto, CreateCountDto, ListCountsQuery, SubmitCountDto } from './inventory.dto.js';
import { InventoryService } from './inventory.service.js';

@Controller('stock-counts')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Post() @HttpCode(201) @RequirePermissions('stockcount:manage')
  create(@Body() dto: CreateCountDto, @CurrentUser() u: AuthenticatedUser) { return this.inv.create(dto, u); }

  @Get() @RequirePermissions('stockcount:count')
  list(@Query() q: ListCountsQuery, @CurrentUser() u: AuthenticatedUser) { return this.inv.list(q, u); }

  @Get(':id') @RequirePermissions('stockcount:manage')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.inv.get(id, u); }

  /** Folha cega do contador: sem saldo do sistema. */
  @Get(':id/sheet') @RequirePermissions('stockcount:count')
  sheet(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.inv.sheet(id, u); }

  @Post(':id/start') @HttpCode(200) @RequirePermissions('stockcount:manage')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.inv.start(id, u); }

  /** POST /stock-counts/:id/counts (13.3) */
  @Post(':id/counts') @HttpCode(200) @RequirePermissions('stockcount:count')
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SubmitCountDto, @CurrentUser() u: AuthenticatedUser) { return this.inv.submit(id, dto, u); }

  @Post(':id/close-round') @HttpCode(200) @RequirePermissions('stockcount:manage')
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.inv.closeRound(id, u); }

  @Get(':id/report') @RequirePermissions('stockcount:manage')
  report(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.inv.report(id, u); }

  @Put(':id/action-plan') @RequirePermissions('stockcount:manage')
  plan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ActionPlanDto, @CurrentUser() u: AuthenticatedUser) { return this.inv.setActionPlan(id, dto.text, u); }

  /** Ajuste só com aprovação do Axis (permissão de ajuste + referência de aprovação). */
  @Post(':id/adjustments') @HttpCode(200) @RequirePermissions('stockcount:manage', 'stock:adjust')
  adjust(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApplyAdjustmentsDto, @CurrentUser() u: AuthenticatedUser) { return this.inv.applyAdjustments(id, dto, u); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('stockcount:manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelCountDto, @CurrentUser() u: AuthenticatedUser) { return this.inv.cancel(id, dto.reason, u); }
}
