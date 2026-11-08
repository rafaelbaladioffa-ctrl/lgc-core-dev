import { Module } from '@nestjs/common';
import { BudgetsController, ProjectsController, QuoteRequestsController, RevisionsController } from './budgets.controller.js';
import { SowService } from './sow/sow.service.js';
import { CoreDocumentsClient } from './sow/core-documents.client.js';
import { BudgetsService } from './budgets.service.js';
import { CoreSyncService } from './core-sync.service.js';

/** Módulo Projetos: orçamento do projeto, revisões, cálculo (PJ2), fluxo (PJ3), SOW e fila do Core (PJ4). */
@Module({
  controllers: [ProjectsController, BudgetsController, RevisionsController, QuoteRequestsController],
  providers: [BudgetsService, CoreSyncService, SowService, CoreDocumentsClient],
})
export class BudgetsModule {}
