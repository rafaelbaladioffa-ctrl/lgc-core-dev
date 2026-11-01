import { Module } from '@nestjs/common';
import { RequestCategoriesService } from './request-categories.service.js';
import { RequestCategoriesController } from './request-categories.controller.js';

@Module({
  controllers: [RequestCategoriesController],
  providers: [RequestCategoriesService],
  exports: [RequestCategoriesService],
})
export class RequestCategoriesModule {}
