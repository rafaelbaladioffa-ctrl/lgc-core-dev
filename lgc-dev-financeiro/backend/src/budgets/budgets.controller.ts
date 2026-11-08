import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import {
  CreateBudgetDto,
  ImportBidTemplateDto,
  ImportSowDto,
  RevisionTransitionDto,
  SimulateRevisionDto,
  UpdateBudgetDto,
  UpdateHoursTDto,
  UpdateKpiJustificationsDto,
  UpdateRevisionDto,
  UpdateSowCablesDto,
} from './budget-inputs.dto.js';
import { SowService } from './sow/sow.service.js';
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

/** Fila de pedidos de cotação vindos do Core (PJ4, integracao-core-financeiro §4). */
@Controller('quote-requests')
export class QuoteRequestsController {
  constructor(private readonly sow: SowService) {}

  @Get()
  @RequirePermissions('budget:read')
  list() {
    return this.sow.listQuoteRequests();
  }

  /** Abre (ou cria) o orçamento aws_sow do projeto e importa a SOW do pedido. */
  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  start(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sow.startQuote(id, user);
  }
}

@Controller('revisions')
export class RevisionsController {
  constructor(
    private readonly budgets: BudgetsService,
    private readonly sow: SowService,
  ) {}

  // SOW da revisão (§7.1). Só muda em rascunho; o texto original é do cliente (P-05).
  @Post(':id/sow/import')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  importSow(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportSowDto, @CurrentUser() user: AuthenticatedUser) {
    return dto.text !== undefined ? this.sow.importText(id, dto.text, user) : this.sow.importFromCore(id, { quoteRequestId: dto.quoteRequestId }, user);
  }

  @Put(':id/sow/cables')
  @RequirePermissions('budget:write')
  updateSowCables(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSowCablesDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sow.updateCables(id, dto.cables, user);
  }

  // Modelo aws_sow (§7.2–§7.4): Bid Template do RFQ, horas T e justificativas dos indicadores.
  @Post(':id/bid-template/import')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  async importBidTemplate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportBidTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    await this.sow.importBidTemplate(id, { quoteRequestId: dto.quoteRequestId }, user);
    return this.budgets.getRevision(id, user);
  }

  @Put(':id/aws/hours')
  @RequirePermissions('budget:write')
  async updateHoursT(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHoursTDto, @CurrentUser() user: AuthenticatedUser) {
    await this.sow.updateHours(id, dto.hours, user);
    return this.budgets.getRevision(id, user);
  }

  @Put(':id/aws/justifications')
  @RequirePermissions('budget:write')
  async updateJustifications(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKpiJustificationsDto, @CurrentUser() user: AuthenticatedUser) {
    await this.sow.updateJustifications(id, dto.justifications, user);
    return this.budgets.getRevision(id, user);
  }

  @Get(':id/sow/text')
  @RequirePermissions('budget:write')
  sowText(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.sow.getText(id, user);
  }

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

  // Fluxo da revisão (projetos-especificacao §3.1). Nada vai ao cliente sem "aprovar envio".
  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions('budget:write')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.transition(id, 'submit', user);
  }

  @Post(':id/return')
  @HttpCode(200)
  @RequirePermissions('budget:approve')
  returnForChanges(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionTransitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.transition(id, 'return', user, dto.reason);
  }

  @Post(':id/approve-send')
  @HttpCode(200)
  @RequirePermissions('budget:approve')
  approveSend(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.transition(id, 'approve_send', user);
  }

  @Post(':id/won')
  @HttpCode(200)
  @RequirePermissions('budget:approve')
  won(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionTransitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.transition(id, 'won', user, dto.reason);
  }

  @Post(':id/lost')
  @HttpCode(200)
  @RequirePermissions('budget:approve')
  lost(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RevisionTransitionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.budgets.transition(id, 'lost', user, dto.reason);
  }
}
