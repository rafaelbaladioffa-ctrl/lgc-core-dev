import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequireAnyPermission, RequirePermissions } from '../rbac/permissions.decorator.js';
import {
  AdvancesQuery,
  BudgetDto,
  CreateEntryDto,
  JobTitleMapDto,
  OverheadRuleDto,
  PeriodQuery,
  PurchasesQuery,
  ReverseEntryDto,
  SettingsDto,
  SettleAdvanceDto,
  TeamLogDto,
} from './cost-centers.dto.js';
import { CostCentersService } from './cost-centers.service.js';
import { TeamsService } from './teams.service.js';

const READ = ['cost_center:read', 'cost_center:read_own'];

/** Centros de custo (centros-de-custo-especificacao §8). Visibilidade por CC filtrada no serviço. */
@Controller()
export class CostCentersController {
  constructor(
    private readonly costCenters: CostCentersService,
    private readonly teams: TeamsService,
  ) {}

  @Get('cost-centers')
  @RequireAnyPermission(...READ)
  list(@CurrentUser() user: AuthenticatedUser, @Query() q: PeriodQuery) {
    return this.costCenters.list(user, q.from, q.to);
  }

  /** Antes de `cost-centers/:id` para não casar "payroll" como id. */
  @Post('cost-centers/payroll/:month')
  @HttpCode(200)
  @RequirePermissions('cost_center:write')
  payroll(@CurrentUser() user: AuthenticatedUser, @Param('month') month: string) {
    return this.costCenters.generatePayroll(user, month);
  }

  @Post('cost-centers/logistics-import/:month')
  @HttpCode(200)
  @RequirePermissions('cost_center:write')
  importLogistics(@CurrentUser() user: AuthenticatedUser, @Param('month') month: string) {
    return this.costCenters.importLogistics(user, month);
  }

  @Get('cost-centers/:id')
  @RequireAnyPermission(...READ)
  detail(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PeriodQuery) {
    return this.costCenters.detail(user, id, q.from, q.to);
  }

  @Get('cost-centers/:id/entries')
  @RequireAnyPermission(...READ)
  entries(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PeriodQuery) {
    return this.costCenters.entries(user, id, q.from, q.to);
  }

  @Post('cost-centers/:id/entries')
  @RequirePermissions('cost_center:write')
  createEntry(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEntryDto) {
    return this.costCenters.createEntry(user, id, dto);
  }

  @Post('cost-center-entries/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('cost_center:write')
  reverse(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReverseEntryDto) {
    return this.costCenters.reverseEntry(user, id, dto.reason);
  }

  @Get('cost-centers/:id/budget/:year')
  @RequireAnyPermission(...READ)
  getBudget(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('year', ParseIntPipe) year: number) {
    return this.costCenters.getBudget(user, id, year);
  }

  @Put('cost-centers/:id/budget/:year')
  @RequirePermissions('cost_center:write')
  putBudget(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('year', ParseIntPipe) year: number, @Body() dto: BudgetDto) {
    return this.costCenters.putBudget(user, id, year, dto);
  }

  @Put('cost-centers/:id/settings')
  @RequirePermissions('cost_center:write')
  settings(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettingsDto) {
    return this.costCenters.putSettings(user, id, dto.fieldDailyLimit);
  }

  @Get('teams')
  @RequireAnyPermission(...READ)
  teamList(@CurrentUser() user: AuthenticatedUser, @Query() q: PeriodQuery) {
    return this.teams.list(user, q.from, q.to);
  }

  @Get('cost-centers/:id/team')
  @RequireAnyPermission(...READ)
  team(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PeriodQuery) {
    return this.teams.panel(user, id, q.from, q.to);
  }

  @Get('cost-centers/:id/team-logs')
  @RequireAnyPermission(...READ)
  teamLogs(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PeriodQuery) {
    return this.teams.logs(user, id, q.from, q.to);
  }

  @Post('cost-centers/:id/team-logs')
  @RequirePermissions('team_log:write')
  createTeamLog(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TeamLogDto) {
    return this.teams.createLog(user, id, dto);
  }

  @Delete('team-logs/:id')
  @HttpCode(204)
  @RequirePermissions('team_log:write')
  async deleteTeamLog(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.teams.deleteLog(user, id);
  }

  @Get('overhead-rules')
  @RequirePermissions('cost_center:read')
  overheadRules() {
    return this.costCenters.overheadRules();
  }

  @Put('overhead-rules/:sourceId')
  @RequirePermissions('cost_center:write')
  putOverheadRule(@CurrentUser() user: AuthenticatedUser, @Param('sourceId', ParseUUIDPipe) sourceId: string, @Body() dto: OverheadRuleDto) {
    return this.costCenters.putOverheadRule(user, sourceId, dto);
  }

  @Delete('overhead-rules/:sourceId')
  @HttpCode(204)
  @RequirePermissions('cost_center:write')
  async deleteOverheadRule(@Param('sourceId', ParseUUIDPipe) sourceId: string) {
    await this.costCenters.deleteOverheadRule(sourceId);
  }

  @Get('job-title-maps')
  @RequirePermissions('cost_center:write')
  jobTitleMaps() {
    return this.costCenters.jobTitleMaps();
  }

  @Put('job-title-maps/:jobTitleId')
  @RequirePermissions('cost_center:write')
  putJobTitleMap(@CurrentUser() user: AuthenticatedUser, @Param('jobTitleId', ParseUUIDPipe) jobTitleId: string, @Body() dto: JobTitleMapDto) {
    return this.costCenters.putJobTitleMap(user, jobTitleId, dto);
  }

  @Get('advances')
  @RequireAnyPermission(...READ)
  advances(@CurrentUser() user: AuthenticatedUser, @Query() q: AdvancesQuery) {
    return this.costCenters.advances(user, q.status);
  }

  @Post('advances/:id/settle')
  @HttpCode(200)
  @RequirePermissions('cost_center:write')
  settle(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettleAdvanceDto) {
    return this.costCenters.settleAdvance(user, id, dto);
  }

  @Get('purchases')
  @RequireAnyPermission(...READ)
  purchases(@CurrentUser() user: AuthenticatedUser, @Query() q: PurchasesQuery) {
    return this.costCenters.purchases(user, q.costCenterId, q.status);
  }
}
