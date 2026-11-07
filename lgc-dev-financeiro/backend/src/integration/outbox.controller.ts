import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RequirePermissions } from '../rbac/permissions.decorator.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

@Controller('integration/outbox')
export class OutboxController {
  constructor(private readonly dispatcher: OutboxDispatcherService) {}

  @Get('status')
  @RequirePermissions('integration:configure')
  status() {
    return this.dispatcher.status();
  }

  /** Dispara um ciclo de entrega agora (o agendador faz o mesmo a cada 30 s). */
  @Post('dispatch')
  @HttpCode(200)
  @RequirePermissions('integration:configure')
  dispatch() {
    return this.dispatcher.dispatchOnce();
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermissions('integration:configure')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.dispatcher.retry(id);
  }
}
