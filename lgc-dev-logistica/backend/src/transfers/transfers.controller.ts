import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CancelTransferDto, CreateTransferDto, ReceiveTransferDto } from './transfers.dto.js';
import { TransfersService } from './transfers.service.js';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post() @HttpCode(201) @RequirePermissions('transfer:request')
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthenticatedUser) { return this.transfers.create(dto, user); }

  @Get() @RequirePermissions('transfer:request')
  list(@CurrentUser() user: AuthenticatedUser) { return this.transfers.list(user); }

  @Get(':id') @RequirePermissions('transfer:request')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.transfers.get(id, user); }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('transfer:approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.transfers.approve(id, user); }

  @Post(':id/start-picking') @HttpCode(200) @RequirePermissions('transfer:request')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.transfers.startPicking(id, user); }

  @Post(':id/dispatch') @HttpCode(200) @RequirePermissions('transfer:request')
  dispatch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.transfers.dispatch(id, user); }

  @Post(':id/receive') @HttpCode(200) @RequirePermissions('transfer:request')
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiveTransferDto, @CurrentUser() user: AuthenticatedUser) { return this.transfers.receive(id, dto, user); }

  @Post(':id/close') @HttpCode(200) @RequirePermissions('transfer:request')
  close(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.transfers.close(id, user); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('transfer:request')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelTransferDto, @CurrentUser() user: AuthenticatedUser) { return this.transfers.cancel(id, dto, user); }
}
