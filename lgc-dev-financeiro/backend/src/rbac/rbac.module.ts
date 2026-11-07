import { Global, Module } from '@nestjs/common';
import { RbacController } from './rbac.controller.js';
import { RbacService } from './rbac.service.js';

@Global()
@Module({ providers: [RbacService], controllers: [RbacController], exports: [RbacService] })
export class RbacModule {}
