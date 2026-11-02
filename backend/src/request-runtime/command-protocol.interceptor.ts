import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
@Injectable()
export class BpmCommandProtocolInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      const key = req.headers['idempotency-key'];
      if (
        typeof key !== 'string' ||
        !isUUID(key) ||
        key !== req.body?.commandKey ||
        !isUUID(req.body?.commandId)
      )
        throw new BadRequestException({
          code: 'COMMAND_PROTOCOL',
          message:
            'Idempotency-Key e commandId UUID obrigatórios e consistentes',
        });
      if (
        req.route?.path !== '/api/v1/bpm/requests' &&
        !req.url.split('?')[0].endsWith('/bpm/requests') &&
        !Number.isInteger(req.body.expectedVersion)
      )
        throw new BadRequestException({ code: 'EXPECTED_VERSION_REQUIRED' });
    }
    return next.handle();
  }
}
