import { Body, Controller, Get, HttpCode, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { SyncBatchDto, SyncService } from './sync.service.js';

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  /** Dados do almoxarifado para trabalhar sem rede (tarefas, códigos, endereços). */
  @Get('bootstrap') @RequirePermissions('warehouse:read')
  bootstrap(@Query('warehouseId', ParseUUIDPipe) warehouseId: string, @CurrentUser() u: AuthenticatedUser) { return this.sync.bootstrap(warehouseId, u); }

  /** Envia a fila offline em ordem; cada operação é idempotente por (deviceId, opId). */
  @Post('batch') @HttpCode(200) @RequirePermissions('warehouse:read')
  batch(@Body() dto: SyncBatchDto, @CurrentUser() u: AuthenticatedUser) { return this.sync.batch(dto, u); }
}
