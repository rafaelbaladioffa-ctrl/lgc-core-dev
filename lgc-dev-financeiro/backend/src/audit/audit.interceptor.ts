import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

export const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Leituras que expõem dados bancários, relatórios, acessos ou a própria trilha: sempre auditadas. */
export const SENSITIVE_READ = /^\/api\/v1\/(audit|rbac|reports|suppliers\/[^/]+\/bank-accounts)/;
const SKIP = /^\/api\/v1\/(health|webhooks\/)/; // o webhook tem trilha própria em integration_messages

/** Agregado e rota normalizada a partir do caminho, sem ids. */
export function describePath(path: string) {
  return {
    aggregateType: path.replace(/^\/api\/v1\//, '').split('/')[0] || 'root',
    aggregateId: path.match(UUID_RE)?.[0] ?? '-',
    route: path.replace(new RegExp(UUID_RE.source, 'gi'), ':id'),
  };
}

/**
 * Auditoria de toda mutação (quem, o quê, quando, de onde) e das leituras sensíveis.
 * Grava só NOMES de campos — nunca valores do corpo — para não vazar dados bancários nem tokens.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.originalUrl.split('?')[0];
    if (SKIP.test(path)) return next.handle();
    const correlationId = String(res.getHeader('X-Correlation-Id') ?? randomUUID());

    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const sensitive = !mutation && SENSITIVE_READ.test(path);
    const write = (action: string, status: number, bodyId?: string) => {
      const actor = req.user?.userId;
      if (!actor) return;
      const d = describePath(path);
      void this.prisma.auditEvent
        .create({
          data: {
            actorAxisId: actor,
            action,
            aggregateType: d.aggregateType,
            aggregateId: bodyId ?? d.aggregateId,
            correlationId,
            origin: `api ${req.ip ?? ''}`.trim(),
            diff: {
              method: req.method,
              route: d.route,
              status,
              bodyFields: mutation && req.body && typeof req.body === 'object' ? Object.keys(req.body as object).slice(0, 40) : undefined,
              queryFields: Object.keys(req.query ?? {}).slice(0, 20),
            },
          },
        })
        .catch((e: Error) => this.logger.error(`Falha ao gravar auditoria: ${e.message}`));
    };

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          const id = (body as { id?: unknown } | null)?.id;
          if (mutation) write(`request.${req.method.toLowerCase()}`, res.statusCode, typeof id === 'string' ? id : undefined);
          else if (sensitive) write('access.sensitive', res.statusCode);
        },
      }),
    );
  }
}
