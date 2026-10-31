import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CancelRequestDto, CreateFulfillmentDto, ListFulfillmentQuery } from './fulfillment.dto.js';
import { FulfillmentService } from './fulfillment.service.js';

@Controller()
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  /** Recebe requisição aprovada do Axis (13.2). Idempotente por (axisRequestId, requestVersion). */
  @Post('fulfillment-orders')
  @HttpCode(201)
  @RequirePermissions('fulfillment:create')
  create(@Body() dto: CreateFulfillmentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.fulfillment.create(dto, user);
  }

  @Get('fulfillment-orders')
  @RequirePermissions('fulfillment:read')
  list(@Query() query: ListFulfillmentQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.fulfillment.list(query, user);
  }

  @Get('fulfillment-orders/:id')
  @RequirePermissions('fulfillment:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.fulfillment.get(id, user);
  }

  /** Reanalisa e tenta reservar o que falta (ex.: após entrada de estoque). */
  @Post('fulfillment-orders/:id/reserve')
  @HttpCode(200)
  @RequirePermissions('fulfillment:manage')
  reserve(@Param('id', ParseUUIDPipe) id: string) {
    return this.fulfillment.reserveOrder(id);
  }

  @Post('fulfillment-orders/:id/cancel-request')
  @HttpCode(200)
  @RequirePermissions('fulfillment:manage')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRequestDto) {
    return this.fulfillment.cancelOrder(id, dto.reason);
  }

  /** Libera reservas vencidas; também pode ser chamado por agendador externo até o cron do Sprint 10. */
  @Post('reservations/expire')
  @HttpCode(200)
  @RequirePermissions('fulfillment:manage')
  expire() {
    return this.fulfillment.expireReservations();
  }
}
