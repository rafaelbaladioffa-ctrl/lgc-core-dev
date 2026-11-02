import { Module } from '@nestjs/common';
import { RequestProcessesController } from './request-processes.controller.js';
import { RequestProcessesService } from './request-processes.service.js';

@Module({ controllers: [RequestProcessesController], providers: [RequestProcessesService], exports: [RequestProcessesService] })
export class RequestProcessesModule {}
