import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Contexto da requisição: qualquer serviço (ex.: AuditService) lê o correlation id sem receber parâmetro extra. */
export const requestContext = new AsyncLocalStorage<{ correlationId: string }>();

/** Propaga (ou gera) o X-Correlation-Id antes dos guards, para a trilha ligar requisição, eventos e movimentos. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    const correlationId = incoming && /^[\w.-]{8,80}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);
    requestContext.run({ correlationId }, next);
  }
}
