import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { ConfirmPutawayDto, CreateReceiptDto, InspectDto, ScanReceiptItemDto } from './receiving.dto.js';
import { ReceivingService } from './receiving.service.js';

@Controller()
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Post('receipts')
  @HttpCode(201)
  @RequirePermissions('receipt:execute')
  create(@Body() dto: CreateReceiptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.create(dto, user);
  }

  @Get('receipts')
  @RequirePermissions('receipt:execute')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.receiving.list(user);
  }

  @Get('receipts/:id')
  @RequirePermissions('receipt:execute')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.get(id, user);
  }

  @Post('receipts/:id/items\\:scan')
  @HttpCode(201)
  @RequirePermissions('receipt:execute')
  scan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ScanReceiptItemDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.scanItem(id, dto, user);
  }

  @Post('receipts/:id/complete')
  @HttpCode(200)
  @RequirePermissions('receipt:execute')
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.complete(id, user);
  }

  @Post('receipts/:id/items/:itemId/inspect')
  @HttpCode(200)
  @RequirePermissions('inspection:execute')
  inspect(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: InspectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.inspect(id, itemId, dto, user);
  }

  @Get('putaway-tasks')
  @RequirePermissions('receipt:execute')
  putaway(@CurrentUser() user: AuthenticatedUser) {
    return this.receiving.listPutaway(user);
  }

  @Post('putaway-tasks/:id/confirm')
  @HttpCode(200)
  @RequirePermissions('receipt:execute')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmPutawayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.receiving.confirmPutaway(id, dto, user);
  }
}
