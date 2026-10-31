import { Module } from '@nestjs/common';
import { WarehousesController } from './warehouses.controller.js';
import { UnitsController } from '../units/units.controller.js';

@Module({ controllers: [WarehousesController, UnitsController] })
export class WarehousesModule {}
