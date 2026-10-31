import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CheckDto, ConfirmDeliveryDto, DispatchDto, ListTasksQuery, PackDto, ReleasePickingDto, ScanDto } from './shipping.dto.js';
import { ShippingService } from './shipping.service.js';

@Controller()
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post('fulfillment-orders/:id/release-picking')
  @HttpCode(201)
  @RequirePermissions('fulfillment:manage')
  release(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReleasePickingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.releasePicking(id, dto, user);
  }

  @Get('picking-tasks')
  @RequirePermissions('picking:execute')
  tasks(@Query() q: ListTasksQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.listTasks(q, user);
  }

  @Get('picking-tasks/:id')
  @RequirePermissions('picking:execute')
  task(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.getTask(id, user);
  }

  @Post('picking-tasks/:id/start')
  @HttpCode(200)
  @RequirePermissions('picking:execute')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.start(id, user);
  }

  @Post('picking-tasks/:id/scan')
  @HttpCode(200)
  @RequirePermissions('picking:execute')
  scan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.scan(id, dto, user);
  }

  @Post('picking-tasks/:id/complete')
  @HttpCode(200)
  @RequirePermissions('picking:execute')
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.complete(id, user);
  }

  @Post('picking-tasks/:id/check')
  @HttpCode(200)
  @RequirePermissions('picking:execute')
  check(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.check(id, dto, user);
  }

  @Post('fulfillment-orders/:id/pack')
  @HttpCode(201)
  @RequirePermissions('shipment:execute')
  pack(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PackDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.pack(id, dto, user);
  }

  @Get('shipments/:id')
  @RequirePermissions('shipment:execute')
  shipment(@Param('id', ParseUUIDPipe) id: string) {
    return this.shipping.getShipment(id);
  }

  @Post('shipments/:id/dispatch')
  @HttpCode(200)
  @RequirePermissions('shipment:execute')
  dispatch(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DispatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.dispatch(id, dto, user);
  }

  @Post('shipments/:id/confirm-delivery')
  @HttpCode(200)
  @RequirePermissions('shipment:execute')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmDeliveryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.shipping.confirmDelivery(id, dto, user);
  }
}
