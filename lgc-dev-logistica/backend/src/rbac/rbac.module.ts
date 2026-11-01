import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service.js';
import { RbacController } from './rbac.controller.js';

@Global()
@Module({
  providers: [RbacService],
  controllers: [RbacController],
  exports: [RbacService],
})
export class RbacModule {}
