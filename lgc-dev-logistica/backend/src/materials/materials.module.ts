import { Module } from '@nestjs/common';
import { MaterialsController } from './materials.controller.js';
import { MaterialsService } from './materials.service.js';

@Module({ controllers: [MaterialsController], providers: [MaterialsService] })
export class MaterialsModule {}
