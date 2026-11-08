import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SatellitesService } from './satellites.service.js';
import { UpdateSatelliteDto } from './dto/update-satellite.dto.js';

/** Edição da assinatura de um satélite já cadastrado (PATCH /integration/satellites/:id). */

function fixture(current: string[] = ['collaborator.created', 'ticket.created']) {
  let subscriptions = current.map((eventType) => ({ satelliteId: 'sat-1', eventType }));
  const satellite = () => ({
    id: 'sat-1',
    name: 'Field',
    webhookUrl: 'http://field/webhook',
    frontendUrl: null,
    status: 'active',
    apiKeyHash: 'hash',
    hmacSecretEnc: 'enc',
    subscriptions,
  });
  const prisma: any = {
    integrationSatellite: { findUnique: vi.fn(async () => satellite()) },
    integrationSubscription: {
      deleteMany: vi.fn(async () => {
        subscriptions = [];
      }),
      createMany: vi.fn(async ({ data }: any) => {
        subscriptions = data;
      }),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new SatellitesService(prisma, {} as any), prisma };
}

describe('SatellitesService.updateSubscriptions', () => {
  it('substitui a assinatura inteira, na mesma transação, e devolve o satélite sem segredos', async () => {
    const { service, prisma } = fixture();
    const result = await service.updateSubscriptions('sat-1', ['user.disabled', 'client.updated', 'client.updated']);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.integrationSubscription.deleteMany).toHaveBeenCalledWith({ where: { satelliteId: 'sat-1' } });
    expect(prisma.integrationSubscription.createMany).toHaveBeenCalledWith({
      data: [
        { satelliteId: 'sat-1', eventType: 'user.disabled' },
        { satelliteId: 'sat-1', eventType: 'client.updated' },
      ],
    });
    expect(result).toEqual({
      id: 'sat-1',
      name: 'Field',
      webhookUrl: 'http://field/webhook',
      frontendUrl: null,
      status: 'active',
      subscribedEvents: ['client.updated', 'user.disabled'],
    });
  });

  it('mantém um tipo antigo que o satélite já assinava, mesmo fora do catálogo', async () => {
    const { service, prisma } = fixture();
    await service.updateSubscriptions('sat-1', ['ticket.created', 'site.updated']);
    expect(prisma.integrationSubscription.createMany.mock.calls[0][0].data.map((d: any) => d.eventType)).toEqual(['ticket.created', 'site.updated']);
  });

  it('recusa tipo desconhecido novo, sem mexer na assinatura', async () => {
    const { service, prisma } = fixture();
    await expect(service.updateSubscriptions('sat-1', ['site.updated', 'inventado.x'])).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.integrationSubscription.deleteMany).not.toHaveBeenCalled();
  });

  it('satélite inexistente responde 404', async () => {
    const { service, prisma } = fixture();
    prisma.integrationSatellite.findUnique.mockResolvedValueOnce(null);
    await expect(service.updateSubscriptions('x', ['site.updated'])).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('UpdateSatelliteDto', () => {
  const check = (input: object) => validate(plainToInstance(UpdateSatelliteDto, input));

  it('exige ao menos um evento', async () => {
    expect((await check({ subscribedEvents: [] })).map((e) => e.property)).toEqual(['subscribedEvents']);
    expect(await check({ subscribedEvents: ['site.updated'] })).toHaveLength(0);
  });
});
