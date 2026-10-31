import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityService } from './availability.service.js';
import { LotsController } from './lots.controller.js';
import { SerialsController } from './serials.controller.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({ controllers: [AvailabilityController, StockController, LotsController, SerialsController], providers: [StockService, AvailabilityService], exports: [StockService, AvailabilityService] })
export class StockModule {}
