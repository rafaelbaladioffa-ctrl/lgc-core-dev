import { Controller, ForbiddenException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { ShipmentRequestsService } from './shipment-requests.service.js';

@Controller('requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShipmentRequestsController {
  constructor(private readonly shipments: ShipmentRequestsService) {}

  /** "Reavaliar aprovador" do envio de material sem responsável de CC: só o admin de Requisições (catálogo). */
  @Post(':id/resolve-approver')
  @RequirePermissions('request_category:update')
  @AuditAction({ action: 'resolve_shipment_approver', resourceType: 'request', resourceIdParam: 'id' })
  resolveApprover(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (!user.collaboratorId) throw new ForbiddenException('Este usuário não está vinculado a um colaborador');
    return this.shipments.resolveApprover(id, user.collaboratorId);
  }
}
