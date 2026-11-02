import { Injectable, BadRequestException } from '@nestjs/common';
import type {
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom } from 'rxjs';
import { isUUID } from 'class-validator';
import { PERMISSIONS_KEY } from '../rbac/permissions.decorator.js';
import { RequestProcessesService } from './request-processes.service.js';
@Injectable()
export class ConfigCommandInterceptor implements NestInterceptor {
  constructor(
    private readonly service: RequestProcessesService,
    private readonly reflector: Reflector,
  ) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest();
    if (!['POST', 'PATCH', 'PUT'].includes(req.method)) return next.handle();
    const key = req.headers['idempotency-key'];
    if (
      typeof key !== 'string' ||
      !isUUID(key) ||
      key !== req.body?.commandKey ||
      !isUUID(req.body?.commandId)
    )
      throw new BadRequestException('COMMAND_PROTOCOL');
    const body = { ...req.body };
    // Protocol metadata is checked here; domain DTOs retain their strict whitelist.
    delete req.body.commandKey;
    delete req.body.commandId;
    const permissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    return from(
      this.service.configCommand(
        req.user,
        `${req.method} ${req.route.path}`,
        req.params.id,
        body,
        permissions,
        () => lastValueFrom(next.handle()),
      ),
    );
  }
}
