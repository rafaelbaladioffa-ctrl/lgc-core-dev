import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { CreateSatelliteDto } from './dto/create-satellite.dto.js';
import { isKnownEventType } from './event-catalog.js';

@Injectable()
export class SatellitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fieldEncryption: FieldEncryptionService,
  ) {}

  /** Returns the plaintext API key and HMAC secret ONCE — they are never retrievable again. */
  async create(dto: CreateSatelliteDto) {
    const apiKey = `axis_sat_${randomBytes(24).toString('base64url')}`;
    const hmacSecret = randomBytes(32).toString('hex');

    const satellite = await this.prisma.integrationSatellite.create({
      data: {
        name: dto.name,
        webhookUrl: dto.webhookUrl,
        frontendUrl: dto.frontendUrl,
        apiKeyHash: await bcrypt.hash(apiKey, 12),
        hmacSecretEnc: this.fieldEncryption.encrypt(hmacSecret),
        subscriptions: { create: dto.subscribedEvents.map((eventType) => ({ eventType })) },
      },
      include: { subscriptions: true },
    });

    // apiKey/hmacSecret are returned here ONCE, in plaintext — never again. Everything else
    // internal (apiKeyHash, hmacSecretEnc) is deliberately left out of every API response.
    return {
      id: satellite.id,
      name: satellite.name,
      webhookUrl: satellite.webhookUrl,
      frontendUrl: satellite.frontendUrl,
      status: satellite.status,
      subscriptions: satellite.subscriptions,
      apiKey,
      hmacSecret,
    };
  }

  findAll() {
    return this.prisma.integrationSatellite.findMany({
      include: { subscriptions: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const satellite = await this.prisma.integrationSatellite.findUnique({
      where: { id },
      include: { subscriptions: true },
    });
    if (!satellite) throw new NotFoundException('Satellite not found');
    return satellite;
  }

  /** Satélite sem os segredos (hash da API key e segredo HMAC cifrado), com a assinatura como lista de tipos. */
  async findSafe(id: string) {
    const satellite = await this.findOne(id);
    return {
      id: satellite.id,
      name: satellite.name,
      webhookUrl: satellite.webhookUrl,
      frontendUrl: satellite.frontendUrl,
      status: satellite.status,
      subscribedEvents: satellite.subscriptions.map((s) => s.eventType).sort(),
    };
  }

  /**
   * Substitui a assinatura do satélite. Aceita os tipos do catálogo (event-catalog.ts) e, para não obrigar a
   * limpar assinaturas antigas de uma vez, os que o satélite já assinava; tipo desconhecido e novo é recusado.
   * A troca vale para os eventos ainda pendentes no outbox: o despacho lê a assinatura na hora de entregar.
   */
  async updateSubscriptions(id: string, subscribedEvents: string[]) {
    const satellite = await this.findOne(id);
    const current = new Set(satellite.subscriptions.map((s) => s.eventType));
    const unknown = subscribedEvents.filter((type) => !isKnownEventType(type) && !current.has(type));
    if (unknown.length > 0) {
      throw new BadRequestException(`Evento desconhecido: ${unknown.join(', ')}. Escolha entre os eventos que o Core emite.`);
    }
    const unique = [...new Set(subscribedEvents)];
    await this.prisma.$transaction(async (tx) => {
      await tx.integrationSubscription.deleteMany({ where: { satelliteId: id } });
      await tx.integrationSubscription.createMany({ data: unique.map((eventType) => ({ satelliteId: id, eventType })) });
    });
    return this.findSafe(id);
  }

  /** Last delivery per satellite, derived from the outbox rows targeting its subscribed event types. */
  async statusOverview() {
    const satellites = await this.findAll();
    return Promise.all(
      satellites.map(async (satellite) => {
        const eventTypes = satellite.subscriptions.map((s) => s.eventType);
        const lastDelivery =
          eventTypes.length > 0
            ? await this.prisma.integrationOutbox.findFirst({
                where: { eventType: { in: eventTypes } },
                orderBy: { createdAt: 'desc' },
              })
            : null;
        return {
          id: satellite.id,
          name: satellite.name,
          status: satellite.status,
          webhookUrl: satellite.webhookUrl,
          frontendUrl: satellite.frontendUrl,
          subscribedEvents: eventTypes,
          lastEvent: lastDelivery
            ? { eventType: lastDelivery.eventType, status: lastDelivery.status, createdAt: lastDelivery.createdAt }
            : null,
        };
      }),
    );
  }
}
