import { Module } from '@nestjs/common';
import { ClientsService } from './clients.service.js';
import { ClientsController } from './clients.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
