import { Body, Controller, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { DelegationsService } from './delegations.service.js';
import { CreateDelegationDto } from './dto/create-delegation.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AuditAction } from '../audit/audit-action.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

function requireCollaboratorId(user: AuthenticatedUser): string {
  if (!user.collaboratorId) throw new ForbiddenException('Este usuário não está vinculado a um colaborador');
  return user.collaboratorId;
}

@Controller('delegations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DelegationsController {
  constructor(private readonly delegationsService: DelegationsService) {}

  @Post()
  @RequirePermissions('delegation:create')
  @AuditAction({ action: 'create_delegation', resourceType: 'delegation' })
  create(@Body() dto: CreateDelegationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.delegationsService.create(requireCollaboratorId(user), dto);
  }

  @Get('mine')
  @RequirePermissions('delegation:read')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.delegationsService.findMine(requireCollaboratorId(user));
  }

  @Post(':id/revoke')
  @RequirePermissions('delegation:create')
  @AuditAction({ action: 'revoke_delegation', resourceType: 'delegation', resourceIdParam: 'id' })
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.delegationsService.revoke(id, requireCollaboratorId(user));
  }
}
