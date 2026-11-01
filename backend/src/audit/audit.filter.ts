import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

/**
 * Registra negações de acesso (403) — inclusive as dos guards, que rodam antes do interceptor — como evento de segurança.
 * A resposta ao cliente segue o formato padrão do Nest.
 */
@Catch(HttpException)
export class AuditExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AuditExceptionFilter.name);

  constructor(private readonly prisma: PrismaService) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { user?: AuthenticatedUser }>();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    if (status === 403 && req.user?.userId) {
      const path = req.originalUrl.split('?')[0];
      void this.prisma.auditEvent
        .create({ data: { actorAxisId: req.user.userId, action: 'access.denied', aggregateType: path.replace(/^\/api\/v1\//, '').split('/')[0] || 'root', aggregateId: path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? '-', correlationId: String(res.getHeader('X-Correlation-Id') ?? ''), origin: `api ${req.ip ?? ''}`.trim(), diff: { method: req.method, route: path.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id'), status } } })
        .catch((e: Error) => this.logger.error(`Falha ao gravar auditoria: ${e.message}`));
    }
    const body = exception.getResponse();
    res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
  }
}
