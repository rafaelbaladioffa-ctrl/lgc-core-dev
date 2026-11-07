import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RequestsService } from './requests.service.js';
import { RequestCategoriesService } from '../request-categories/request-categories.service.js';

function legacyService(overrides: Record<string, any> = {}) {
  const prisma: any = {
    request: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'bpm-request',
        executionMode: 'bpm_v1',
        status: 'rascunho',
      }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    requestApproval: { findMany: vi.fn().mockResolvedValue([]) },
    slaClock: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return {
    prisma,
    service: new RequestsService(
      prisma,
      { record: vi.fn() } as any,
      { findActiveDelegationsOf: vi.fn().mockResolvedValue([]) } as any,
      {} as any,
      {} as any,
    ),
  };
}

describe('legacy executor separation from BPM', () => {
  it.each([
    ['update', (service: RequestsService) => service.update('bpm-request', 'actor', { title: 'x' } as any)],
    ['submit', (service: RequestsService) => service.submit('bpm-request', 'actor')],
    ['cancel', (service: RequestsService) => service.cancel('bpm-request', 'actor', false, { reason: 'x' } as any)],
    ['findOne', (service: RequestsService) => service.findOne('bpm-request', { collaboratorId: 'actor', canViewWhistleblowerIdentity: false })],
  ])('rejects %s for a BPM request without writing', async (_operation, action) => {
    const fixture = legacyService();
    await expect(action(fixture.service)).rejects.toMatchObject({
      response: { message: 'WRONG_EXECUTOR' },
    });
    expect(fixture.prisma.request.update).not.toHaveBeenCalled();
  });

  it('keeps legacy approval inbox scoped to legacy requests', async () => {
    const fixture = legacyService();
    await fixture.service.myApprovals('approver', false);
    expect(fixture.prisma.requestApproval.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          request: { executionMode: 'legacy' },
        }),
      }),
    );
  });

  it('keeps auto-close and SLA cron readers scoped to legacy rows', async () => {
    const fixture = legacyService();
    await fixture.service.runAutoClose();
    expect(fixture.prisma.request.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ executionMode: 'legacy' }),
      }),
    );
    await fixture.service.runSlaAlertsAndEscalation();
    expect(fixture.prisma.slaClock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          request: { executionMode: 'legacy' },
        }),
      }),
    );
  });

  // `bpmStatus` (CategoryVersion) e o conceito de "categoria BPM-only" que estes dois testes
  // verificavam deixaram de existir junto do resto do módulo BPM (98dfce5) — o schema não tem
  // mais o campo. O que resta de válido aqui é a mecânica de "categoria sem versão" e "latest
  // version", sem o filtro morto.
  it('rejects an unknown category through the category detail', async () => {
    const prisma: any = {
      requestCategory: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };
    const service = new RequestCategoriesService(prisma);
    await expect(service.findOne('missing-category')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('catalogs a category on its latest published version only', async () => {
    const prisma: any = {
      requestCategory: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'a-category',
            name: 'Categoria',
            versions: [{ id: 'v1', version: 1 }],
          },
        ]),
      },
    };
    const service = new RequestCategoriesService(prisma);
    const result = await service.findAllCatalog('sector-1');
    expect(result[0]).toMatchObject({ currentVersion: { id: 'v1' } });
    expect(prisma.requestCategory.findMany).toHaveBeenCalledWith({
      where: { active: true, sectorId: 'sector-1', versions: { some: { status: 'publicada' } } },
      include: {
        versions: {
          where: { status: 'publicada' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
  });

  it('does not use a recent BPM request in legacy dynamic authority fractionation', async () => {
    const prisma: any = {
      request: {
        findMany: vi.fn().mockImplementation((args: any) =>
          args.where.executionMode === 'legacy' ? Promise.resolve([]) : Promise.resolve([{ estimatedValue: 900 }]),
        ),
      },
    };
    const authorityRules = {
      findApplicableRule: vi.fn().mockResolvedValue({ levels: ['gerente'] }),
    };
    const service = new RequestsService(
      prisma,
      {} as any,
      {} as any,
      authorityRules as any,
      {} as any,
    );

    const result = await (service as any).resolveDynamicAuthoritySteps({
      id: 'legacy-current',
      requesterId: 'requester-1',
      sectorId: 'sector-1',
      estimatedValue: 100,
    });

    expect(result).toMatchObject({ effectiveValue: 100, fractionationDetected: false });
    expect(prisma.request.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        executionMode: 'legacy',
        requesterId: 'requester-1',
      }),
      select: { estimatedValue: true },
    });
  });
});
