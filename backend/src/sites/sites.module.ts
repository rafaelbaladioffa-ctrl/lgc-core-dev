import { Module } from '@nestjs/common';
import { SitesService } from './sites.service.js';
import { SitesController } from './sites.controller.js';
import { IntegrationModule } from '../integration/integration.module.js';

@Module({
  imports: [IntegrationModule],
  controllers: [SitesController],
  providers: [SitesService],
  exports: [SitesService],
})
export class SitesModule {}
