import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** Leituras que expõem documentos, custos, custódia de pessoas ou a própria trilha: sempre auditadas (20). */
const SENSITIVE_READ = /^\/api\/v1\/(documents|dashboard|custody|audit|rbac|stock-counts\/[^/]+\/report)/;
const SKIP = /^\/api\/v1\/(health|webhooks\/|sync\/batch)/; // webhook e sync já têm trilha própria (inbox / offline_operations)

/**
 * Auditoria append-only de toda mutação (quem, o quê, quando, de onde) + acessos sensíveis e negados.
 * Grava só nomes de campos — nunca valores do corpo — para não vazar token, assinatura ou dados pessoais nos logs.
 * Propaga/gera `X-Correlation-Id` para ligar a requisição aos eventos e movimentos que ela produz.
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
    const correlationId = String(res.getHeader('X-Correlation-Id') ?? randomUUID()); // definido pelo CorrelationMiddleware, antes dos guards
    if (SKIP.test(path)) return next.handle();

    const mutation = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    const sensitive = !mutation && SENSITIVE_READ.test(path);
    const write = (action: string, status: number, aggregateId?: string) => {
      const actor = req.user?.userId;
      if (!actor) return; // sem autenticação não há ator; 401 não é auditado aqui
      const seg = path.replace(/^\/api\/v1\//, '').split('/')[0] || 'root';
      void this.prisma.auditEvent
        .create({
          data: {
            actorAxisId: actor, action, aggregateType: seg, aggregateId: aggregateId ?? path.match(UUID)?.[0] ?? '-', correlationId, origin: `api ${req.ip ?? ''}`.trim(),
            diff: { method: req.method, route: path.replace(new RegExp(UUID, 'gi'), ':id'), status, bodyFields: mutation && req.body && typeof req.body === 'object' ? Object.keys(req.body as object).slice(0, 40) : undefined, queryFields: Object.keys(req.query ?? {}).slice(0, 20) },
          },
        })
        .catch((e: Error) => this.logger.error(`Falha ao gravar auditoria: ${e.message}`));
    };

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          if (mutation) write(`request.${req.method.toLowerCase()}`, res.statusCode, typeof (body as { id?: unknown })?.id === 'string' ? (body as { id: string }).id : undefined);
          else if (sensitive) write('access.sensitive', res.statusCode);
        },
      }),
    );
  }
}
