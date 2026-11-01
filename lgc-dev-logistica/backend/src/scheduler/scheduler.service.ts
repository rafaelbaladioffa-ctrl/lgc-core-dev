import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AlertsService } from '../alerts/alerts.service.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { OutboxDispatcherService } from '../integration/outbox-dispatcher.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';

/**
 * Agendamentos (12.4, 19): entrega do outbox, varredura de alertas, expiração de reservas e reconciliação.
 * Ligado por SCHEDULER_ENABLED=true (uma instância; as demais ficam só com a API). Cada tarefa isola a própria falha.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly alerts: AlertsService,
    private readonly fulfillment: FulfillmentService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  private get enabled() { return this.config.get('SCHEDULER_ENABLED') === 'true'; }

  private async job(name: string, fn: () => Promise<unknown>) {
    if (!this.enabled || this.running.has(name)) return; // sem sobreposição do mesmo job
    this.running.add(name);
    try { await fn(); } catch (e) { this.logger.error(`Job ${name} falhou: ${(e as Error).message}`); } finally { this.running.delete(name); }
  }

  @Cron('*/30 * * * * *') outbox() { return this.job('outbox', () => this.dispatcher.dispatchOnce()); }
  @Cron('0 */5 * * * *') scanAlerts() { return this.job('alerts', () => this.alerts.scan()); }
  @Cron('0 */5 * * * *') expireReservations() { return this.job('reservations', () => this.fulfillment.expireReservations()); }
  @Cron('0 15 * * * *') reconcile() { return this.job('reconciliation', () => this.reconciliation.run('sistema')); }
}
