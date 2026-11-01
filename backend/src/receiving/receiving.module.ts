import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { ReceivingController } from './receiving.controller.js';
import { ReceivingService } from './receiving.service.js';

@Module({ imports: [StockModule], controllers: [ReceivingController], providers: [ReceivingService], exports: [ReceivingService] })
export class ReceivingModule {}
