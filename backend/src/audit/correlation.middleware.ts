import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/** Propaga (ou gera) o X-Correlation-Id antes dos guards, para a trilha ligar requisição, eventos e movimentos. */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const incoming = req.header('x-correlation-id');
    res.setHeader('X-Correlation-Id', incoming && /^[\w.-]{8,80}$/.test(incoming) ? incoming : randomUUID());
    next();
  }
}
