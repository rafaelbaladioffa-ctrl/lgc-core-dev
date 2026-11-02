import { Module } from '@nestjs/common';
import { RequestRuntimeController } from './request-runtime.controller.js';
import { RequestRuntimeService } from './request-runtime.service.js';

@Module({ controllers: [RequestRuntimeController], providers: [RequestRuntimeService] })
export class RequestRuntimeModule {}
