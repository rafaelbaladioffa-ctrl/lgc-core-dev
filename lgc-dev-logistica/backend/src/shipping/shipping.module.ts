import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { ShippingController } from './shipping.controller.js';
import { ShippingService } from './shipping.service.js';

@Module({ imports: [StockModule], controllers: [ShippingController], providers: [ShippingService], exports: [ShippingService] })
export class ShippingModule {}
