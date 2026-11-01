import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { ListIssuesQuery, ReconciliationService, ResolveIssueDto } from './reconciliation.service.js';

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly rec: ReconciliationService) {}

  @Post('run') @HttpCode(200) @RequirePermissions('reconciliation:manage')
  run(@CurrentUser() u: AuthenticatedUser) { return this.rec.run(u.userId); }

  @Get('issues') @RequirePermissions('reconciliation:manage')
  list(@Query() q: ListIssuesQuery) { return this.rec.list(q); }

  @Post('issues/:id/resolve') @HttpCode(200) @RequirePermissions('reconciliation:manage')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveIssueDto, @CurrentUser() u: AuthenticatedUser) { return this.rec.resolve(id, dto.resolution, u.userId); }
}
