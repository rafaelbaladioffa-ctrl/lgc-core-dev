import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CancelRequestDto } from '../fulfillment/fulfillment.dto.js';
import { ClassifyDto, CloseCustodyDto, CreateReturnDto, ListCustodyQuery } from './returns.dto.js';
import { ReturnsService } from './returns.service.js';

@Controller()
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Post('returns') @HttpCode(201) @RequirePermissions('return:execute')
  create(@Body() dto: CreateReturnDto, @CurrentUser() user: AuthenticatedUser) { return this.returns.create(dto, user); }

  @Get('returns') @RequirePermissions('return:execute')
  list(@CurrentUser() user: AuthenticatedUser) { return this.returns.list(user); }

  @Get('returns/:id') @RequirePermissions('return:execute')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) { return this.returns.get(id, user); }

  @Post('returns/:id/items/:itemId/classify') @HttpCode(200) @RequirePermissions('return:execute')
  classify(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body() dto: ClassifyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.returns.classify(id, itemId, dto, user);
  }

  /** Termos de custódia: o colaborador vê só os próprios; custody:execute/auditoria veem todos. */
  @Get('custody') @RequirePermissions('stock:read')
  custody(@Query() q: ListCustodyQuery, @CurrentUser() user: AuthenticatedUser) { return this.returns.listCustody(q, user); }

  @Get('custody/offboarded-pending') @RequirePermissions('custody:execute')
  offboarded() { return this.returns.offboardedPending(); }

  @Post('custody/:id/mark-lost') @HttpCode(200) @RequirePermissions('custody:execute')
  lost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseCustodyDto, @CurrentUser() user: AuthenticatedUser) { return this.returns.markLost(id, dto, user); }

  @Post('fulfillment-orders/:id/resolve-cancellation') @HttpCode(200) @RequirePermissions('fulfillment:manage')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRequestDto) { return this.returns.resolveCancellation(id, dto.reason); }
}
