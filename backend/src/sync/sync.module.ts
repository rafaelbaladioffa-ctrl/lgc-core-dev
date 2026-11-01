import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReceivingModule } from '../receiving/receiving.module.js';
import { ShippingModule } from '../shipping/shipping.module.js';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';

@Module({ imports: [ShippingModule, ReceivingModule, InventoryModule], controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
