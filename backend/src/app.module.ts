import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
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
    IntegrationModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: throttle → JWT (SSO Axis) → permissões locais.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
