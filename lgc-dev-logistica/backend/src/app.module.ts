import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuditModule } from './audit/audit.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { PermissionsGuard } from './rbac/permissions.guard.js';
import { MaterialsModule } from './materials/materials.module.js';
import { WarehousesModule } from './warehouses/warehouses.module.js';
import { StockModule } from './stock/stock.module.js';
import { FulfillmentModule } from './fulfillment/fulfillment.module.js';
import { ShippingModule } from './shipping/shipping.module.js';
import { ReceivingModule } from './receiving/receiving.module.js';
import { TransfersModule } from './transfers/transfers.module.js';
import { ReturnsModule } from './returns/returns.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ReplenishmentModule } from './replenishment/replenishment.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SyncModule } from './sync/sync.module.js';
import { AuditExceptionFilter } from './audit/audit.filter.js';
import { CorrelationMiddleware } from './audit/correlation.middleware.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { ReconciliationModule } from './reconciliation/reconciliation.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';
import { IntegrationModule } from './integration/integration.module.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    RbacModule,
    AuthModule,
    MaterialsModule,
    WarehousesModule,
    StockModule,
    FulfillmentModule,
    ShippingModule,
    ReceivingModule,
    TransfersModule,
    ReturnsModule,
    DocumentsModule,
    InventoryModule,
    ReplenishmentModule,
    DashboardModule,
    SyncModule,
    IntegrationModule,
    ReconciliationModule,
    SchedulerModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: throttle → JWT (SSO Axis) → permissões locais.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: AuditExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*path');
  }
}
