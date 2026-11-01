import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { DashboardService, KpiQuery } from './dashboard.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get('kpis') @RequirePermissions('dashboard:read')
  kpis(@Query() q: KpiQuery, @CurrentUser() u: AuthenticatedUser) { return this.dash.kpis(q, u); }
}
