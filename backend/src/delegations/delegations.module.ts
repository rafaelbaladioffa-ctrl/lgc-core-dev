import { Module } from '@nestjs/common';
import { DelegationsService } from './delegations.service.js';
import { DelegationsController } from './delegations.controller.js';

@Module({
  controllers: [DelegationsController],
  providers: [DelegationsService],
  exports: [DelegationsService],
})
export class DelegationsModule {}
