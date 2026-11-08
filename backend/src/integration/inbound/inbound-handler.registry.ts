import { Inject, Injectable, Optional } from '@nestjs/common';
import { INBOUND_EVENT_HANDLERS, type InboundEventHandler } from './inbound-handler.js';

/** Índice dos handlers por `event_type`. Dois handlers para o mesmo tipo é erro de configuração. */
@Injectable()
export class InboundHandlerRegistry {
  private readonly byType = new Map<string, InboundEventHandler>();

  constructor(@Optional() @Inject(INBOUND_EVENT_HANDLERS) handlers: InboundEventHandler[] = []) {
    for (const handler of handlers) {
      for (const eventType of handler.eventTypes) {
        if (this.byType.has(eventType)) {
          throw new Error(`Mais de um handler registrado para o evento de entrada "${eventType}".`);
        }
        this.byType.set(eventType, handler);
      }
    }
  }

  get(eventType: string): InboundEventHandler | undefined {
    return this.byType.get(eventType);
  }

  registeredTypes(): string[] {
    return [...this.byType.keys()].sort();
  }
}
