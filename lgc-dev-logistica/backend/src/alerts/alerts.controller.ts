import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { AlertsService, ListAlertsQuery } from './alerts.service.js';

@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Varredura sob demanda (um agendador chama o mesmo endpoint até o cron do Sprint 10). */
  @Post('scan') @HttpCode(200) @RequirePermissions('alert:manage')
  scan() { return this.alerts.scan(); }

  @Get() @RequirePermissions('alert:read')
  list(@Query() q: ListAlertsQuery, @CurrentUser() u: AuthenticatedUser) { return this.alerts.list(q, u); }

  @Post(':id/acknowledge') @HttpCode(200) @RequirePermissions('alert:read')
  ack(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) { return this.alerts.acknowledge(id, u); }
}
