import { Module } from '@nestjs/common';
import { BudgetsController, ProjectsController, RevisionsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';
import { CoreSyncService } from './core-sync.service.js';

/** Módulo Projetos — PJ2: orçamento do projeto, revisões e cálculo. */
@Module({
  controllers: [ProjectsController, BudgetsController, RevisionsController],
  providers: [BudgetsService, CoreSyncService],
})
export class BudgetsModule {}
