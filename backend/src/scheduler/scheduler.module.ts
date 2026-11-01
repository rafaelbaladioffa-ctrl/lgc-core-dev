import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DashboardModule } from '../dashboard/dashboard.module.js';
import { FulfillmentModule } from '../fulfillment/fulfillment.module.js';
import { IntegrationModule } from '../integration/integration.module.js';
import { ReconciliationModule } from '../reconciliation/reconciliation.module.js';
import { SchedulerService } from './scheduler.service.js';

@Module({ imports: [ScheduleModule.forRoot(), DashboardModule, FulfillmentModule, IntegrationModule, ReconciliationModule], providers: [SchedulerService] })
export class SchedulerModule {}
