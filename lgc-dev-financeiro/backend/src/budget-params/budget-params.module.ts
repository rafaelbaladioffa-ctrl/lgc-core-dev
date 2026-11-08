import { Module } from '@nestjs/common';
import { ParameterSetsController } from './parameter-sets.controller.js';
import { ParameterSetsService } from './parameter-sets.service.js';
import { BudgetDestinationsController, BudgetMaterialsController } from './catalogs.controller.js';
import { CatalogsService } from './catalogs.service.js';

/** Módulo Projetos — PJ1: parâmetros de orçamento versionados e catálogos. */
@Module({
  controllers: [ParameterSetsController, BudgetMaterialsController, BudgetDestinationsController],
  providers: [ParameterSetsService, CatalogsService],
  exports: [ParameterSetsService, CatalogsService],
})
export class BudgetParamsModule {}
