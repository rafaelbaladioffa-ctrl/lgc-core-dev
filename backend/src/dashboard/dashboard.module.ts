import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { AlertsController } from '../alerts/alerts.controller.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({ imports: [StockModule], controllers: [DashboardController, AlertsController], providers: [DashboardService, AlertsService] })
export class DashboardModule {}
