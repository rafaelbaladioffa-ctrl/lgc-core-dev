import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { ListBalancesQuery, ListMovementsQuery, PostMovementDto, ReverseMovementDto } from './stock.dto.js';
import { StockService } from './stock.service.js';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  /** Permissão fina (stock:post ou stock:adjust conforme o tipo) é verificada no serviço. */
  @Post('movements')
  @HttpCode(201)
  post(@Body() dto: PostMovementDto, @Headers('idempotency-key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stock.post(dto, key, user);
  }

  @Post('movements/:id/reverse')
  @HttpCode(201)
  reverse(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseMovementDto, @Headers('idempotency-key') key: string, @CurrentUser() user: AuthenticatedUser) {
    return this.stock.reverse(id, dto, key, user);
  }

  @Get('movements')
  @RequirePermissions('stock:read')
  movements(@Query() query: ListMovementsQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.stock.listMovements(query, user);
  }

  @Get('balances')
  @RequirePermissions('stock:read')
  balances(@Query() query: ListBalancesQuery, @CurrentUser() user: AuthenticatedUser) {
    return this.stock.listBalances(query, user);
  }
}
