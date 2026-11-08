import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { CreateBudgetDto, SimulateRevisionDto, UpdateBudgetDto, UpdateRevisionDto } from './budget-inputs.dto.js';
import { BudgetsService } from './budgets.service.js';
import { CoreSyncService } from './core-sync.service.js';

/** Projetos do Core com orçamento (projetos-especificacao §11). */
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly budgets: BudgetsService,
    private readonly sync: CoreSyncService,
  ) {}

  @Get()
  @RequirePermissions('budget:read')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.budgets.listProjects(user);
  }

  /** Busca projetos e clientes no Core com o token de quem pediu. */
  @Post('sync')
  @HttpCode(200)
  @RequirePermissions('budget:read')
  syncFromCore(@CurrentUser() user: AuthenticatedUser, @Headers('authorization') authorization: string) {
    return this.sync.syncProjectsAndClients(user, authorization);
  }

  @Get(':axisProjectId')
  @RequirePermissions('budget:read')
  get(@Param('axisProjectId') axisProjectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.getProject(axisProjectId, user);
  }
}

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Post()
  @RequirePermissions('budget:write')
  create(@Body() dto: CreateBudgetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.createBudget(dto, user);
  }

  /** Cabeçalho: título e início/conclusão previstos (nulo = valor do projeto no Core). */
  @Patch(':id')
  @RequirePermissions('budget:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBudgetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.updateBudget(id, dto, user);
  }

  @Post(':id/revisions')
  @RequirePermissions('budget:write')
  newRevision(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.newRevision(id, user);
  }
}

@Controller('revisions')
export class RevisionsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get(':id')
  @RequirePermissions('budget:read')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.getRevision(id, user);
  }

  @Patch(':id')
  @RequirePermissions('budget:write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRevisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.updateRevision(id, dto, user);
  }

  /** Calcula sem gravar (painel de resultado ao editar). */
  @Post(':id/simulate')
  @HttpCode(200)
  @RequirePermissions('budget:read')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SimulateRevisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.simulate(id, dto.inputs, user);
  }

  @Post(':id/use-current-parameters')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  useCurrentParameters(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.useCurrentParameters(id, user);
  }

  @Post(':id/discard')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.discard(id, user);
  }
}
