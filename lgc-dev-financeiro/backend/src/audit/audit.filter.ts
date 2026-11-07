import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { describePath } from './audit.interceptor.js';

/** Registra negações de acesso (403), inclusive as dos guards, como evento de segurança. Resposta no formato padrão do Nest. */
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
      const d = describePath(req.originalUrl.split('?')[0]);
      void this.prisma.auditEvent
        .create({
          data: {
            actorAxisId: req.user.userId,
            action: 'access.denied',
            aggregateType: d.aggregateType,
            aggregateId: d.aggregateId,
            correlationId: String(res.getHeader('X-Correlation-Id') ?? ''),
            origin: `api ${req.ip ?? ''}`.trim(),
            diff: { method: req.method, route: d.route, status },
          },
        })
        .catch((e: Error) => this.logger.error(`Falha ao gravar auditoria: ${e.message}`));
    }
    const body = exception.getResponse();
    res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
  }
}
