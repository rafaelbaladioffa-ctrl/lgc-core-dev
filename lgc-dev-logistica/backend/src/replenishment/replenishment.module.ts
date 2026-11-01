import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { ReplenishmentController } from './replenishment.controller.js';
import { ReplenishmentService } from './replenishment.service.js';

@Module({ imports: [StockModule], controllers: [ReplenishmentController], providers: [ReplenishmentService], exports: [ReplenishmentService] })
export class ReplenishmentModule {}
