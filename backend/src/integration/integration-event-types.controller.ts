import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { eventTypeCatalog } from './event-catalog.js';

/**
 * Catálogo dos eventos que o Core emite, para a tela de satélite montar a assinatura (event-catalog.ts).
 * Rota de usuário (JWT), não de satélite: fica fora do `IntegrationQueryController`, que é por API key.
 */
@Controller('integration/event-types')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class IntegrationEventTypesController {
  @Get()
  @RequirePermissions('integration:read')
  list() {
    return eventTypeCatalog();
  }
}
