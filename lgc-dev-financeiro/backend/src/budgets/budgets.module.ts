import { Module } from '@nestjs/common';
import { BidProfileController, BudgetsController, ProjectsController, QuoteRequestsController, RevisionsController } from './budgets.controller.js';
import { BidService } from './bid/bid.service.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { SowService } from './sow/sow.service.js';
import { CoreDocumentsClient } from './sow/core-documents.client.js';
import { LogisticsMaterialsController } from './logistics-materials.controller.js';
import { LogisticsClient } from '../cost-centers/logistics.client.js';
import { BudgetsService } from './budgets.service.js';
import { CoreSyncService } from './core-sync.service.js';

/** Módulo Projetos: orçamento do projeto, revisões, cálculo (PJ2), fluxo (PJ3), SOW e fila do Core (PJ4). */
@Module({
  imports: [IntegrationModule],
  controllers: [ProjectsController, BudgetsController, RevisionsController, QuoteRequestsController, BidProfileController, LogisticsMaterialsController],
  providers: [BudgetsService, CoreSyncService, SowService, CoreDocumentsClient, BidService, LogisticsClient],
})
export class BudgetsModule {}
