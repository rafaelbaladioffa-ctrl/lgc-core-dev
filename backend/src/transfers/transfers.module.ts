import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({ imports: [StockModule], controllers: [TransfersController], providers: [TransfersService] })
export class TransfersModule {}
