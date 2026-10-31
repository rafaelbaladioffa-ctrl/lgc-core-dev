import { Module } from '@nestjs/common';
import { LotsController } from './lots.controller.js';
import { SerialsController } from './serials.controller.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({ controllers: [StockController, LotsController, SerialsController], providers: [StockService], exports: [StockService] })
export class StockModule {}
