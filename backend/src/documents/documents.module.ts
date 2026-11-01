import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { LabelsController } from '../labels/labels.controller.js';
import { LabelsService } from '../labels/labels.service.js';

@Module({ controllers: [DocumentsController, LabelsController], providers: [DocumentsService, LabelsService] })
export class DocumentsModule {}
