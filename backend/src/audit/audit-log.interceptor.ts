import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogService } from './audit-log.service.js';
import { AUDIT_ACTION_KEY, type AuditActionMeta } from './audit-action.decorator.js';
import type { AuthenticatedRequest } from '../auth/authenticated-request.js';

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditActionMeta | undefined>(AUDIT_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actorUserId = request.user?.userId;

    return next.handle().pipe(
      tap((result) => {
        if (!actorUserId) return;
        const resourceId = meta.resourceIdParam
          ? (request.params?.[meta.resourceIdParam] as string | undefined)
          : ((result as { id?: string } | undefined)?.id);

        void this.auditLog.record({
          actorUserId,
          action: meta.action,
          resourceType: meta.resourceType,
          resourceId,
        });
      }),
    );
  }
}
