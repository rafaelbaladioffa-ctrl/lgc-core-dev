import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service.js';
import { AuditLogInterceptor } from './audit-log.interceptor.js';

@Global()
@Module({
  providers: [AuditLogService, AuditLogInterceptor],
  exports: [AuditLogService, AuditLogInterceptor],
})
export class AuditModule {}
