import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHmac, randomUUID } from 'crypto';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import type { IntegrationOutbox } from '@prisma/client';

/** Backoff schedule per PLANNING.md 3.1 step 3: 1min, 5min, 30min, 2h, then FAILED. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200];
// One extra attempt beyond the backoff schedule: the schedule describes the WAIT after each of
// the first `BACKOFF_SECONDS.length` failures, so FAILED only happens on the attempt after that.
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const BATCH_SIZE = 50;
const WEBHOOK_TIMEOUT_MS = 5000;

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending(): Promise<void> {
    const now = new Date();
    const events = await this.prisma.integrationOutbox.findMany({
      where: { status: 'pending', nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
    });

    for (const event of events) {
      await this.dispatchOne(event);
    }
  }

  private async dispatchOne(event: IntegrationOutbox): Promise<void> {
    const subscribers = await this.prisma.integrationSubscription.findMany({
      where: { eventType: event.eventType, satellite: { status: 'active' } },
      include: { satellite: true },
    });

    if (subscribers.length === 0) {
      // Nothing subscribed to this event type — nothing to deliver, so it's trivially "delivered".
      await this.prisma.integrationOutbox.update({
        where: { id: event.id },
        data: { status: 'delivered', deliveredAt: new Date(), lastError: null },
      });
      return;
    }

    const body = {
      event_id: event.id,
      event_type: event.eventType,
      occurred_at: event.createdAt.toISOString(),
      payload: event.payload,
    };
    const serializedBody = JSON.stringify(body);

    const results = await Promise.all(
      subscribers.map((sub) => this.deliverToSatellite(sub.satellite, serializedBody)),
    );
    const allOk = results.every((ok) => ok);

    if (allOk) {
      await this.prisma.integrationOutbox.update({
        where: { id: event.id },
        data: { status: 'delivered', deliveredAt: new Date(), lastError: null },
      });
      return;
    }

    const attempts = event.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.prisma.integrationOutbox.update({
        where: { id: event.id },
        data: { status: 'failed', attempts, lastError: 'Max retry attempts reached' },
      });
      this.logger.error(`Event ${event.id} (${event.eventType}) marked FAILED after ${attempts} attempts`);
      return;
    }

    const delaySeconds = BACKOFF_SECONDS[attempts - 1];
    await this.prisma.integrationOutbox.update({
      where: { id: event.id },
      data: {
        attempts,
        lastError: 'One or more subscribers did not acknowledge the webhook',
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
      },
    });
  }

  private async deliverToSatellite(
    satellite: { id: string; webhookUrl: string; hmacSecretEnc: string },
    serializedBody: string,
  ): Promise<boolean> {
    try {
      const secret = this.fieldEncryption.decrypt(satellite.hmacSecretEnc);
      const signature = createHmac('sha256', secret).update(serializedBody).digest('hex');
      const response = await axios.post(satellite.webhookUrl, serializedBody, {
        headers: { 'Content-Type': 'application/json', 'X-Axis-Signature': `sha256=${signature}` },
        timeout: WEBHOOK_TIMEOUT_MS,
        validateStatus: () => true,
      });
      return response.status >= 200 && response.status < 300;
    } catch (err) {
      this.logger.warn(`Delivery to satellite ${satellite.id} failed: ${(err as Error).message}`);
      return false;
    }
  }

  /** Fires an ad-hoc "ping" event straight at one satellite, bypassing the outbox, for connectivity testing. */
  async sendTestPing(satellite: { id: string; webhookUrl: string; hmacSecretEnc: string }): Promise<boolean> {
    const body = { event_id: randomUUID(), event_type: 'ping', occurred_at: new Date().toISOString(), payload: {} };
    return this.deliverToSatellite(satellite, JSON.stringify(body));
  }
}
