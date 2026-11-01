import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { DocumentsService } from './documents.service.js';

class StatementQuery {
  @IsOptional() @IsUUID('all', { message: 'Material inválido.' }) materialId?: string;
  @IsOptional() @IsUUID('all', { message: 'Endereço inválido.' }) locationId?: string;
  @IsOptional() @IsDateString({}, { message: 'Data inicial inválida.' }) from?: string;
  @IsOptional() @IsDateString({}, { message: 'Data final inválida.' }) to?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('receipts/:id') @RequirePermissions('document:read')
  receipt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.receipt(id, u); }

  @Get('receipts/:id/divergence') @RequirePermissions('document:read')
  divergence(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.receipt(id, u, true); }

  @Get('picking-tasks/:id') @RequirePermissions('document:read')
  picking(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.picking(id, u); }

  @Get('shipments/:id') @RequirePermissions('document:read')
  shipment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.shipment(id, u); }

  @Get('deliveries/:shipmentId') @RequirePermissions('document:read')
  delivery(@Param('shipmentId', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.delivery(id, u); }

  @Get('transfers/:id') @RequirePermissions('document:read')
  transfer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.transfer(id, u); }

  /** Termo de custódia: sem document:read fixo — o próprio custodiante também acessa (checado no serviço). */
  @Get('custody/:id') @RequirePermissions('stock:read')
  custody(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.custody(id, u); }

  @Get('returns/:id') @RequirePermissions('document:read')
  returnDoc(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.docs.returnDoc(id, u); }

  @Get('movements') @RequirePermissions('document:read')
  statement(@Query() q: StatementQuery, @CurrentUser() u: AuthenticatedUser) { return this.docs.statement(q, u); }
}
