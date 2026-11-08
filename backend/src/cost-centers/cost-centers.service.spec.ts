import { describe, expect, it, vi } from 'vitest';
import { CostCentersService } from './cost-centers.service.js';

/** Eventos `cost_center.*` para os satélites (o Financeiro usa no rateio). */

const ROW = {
  id: 'cc-1',
  code: '100',
  name: 'Obras',
  sectorId: 'sec-1',
  parentCostCenterId: null,
  responsibleCollaboratorId: null,
};

function fixture() {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    costCenter: {
      findUnique: vi.fn().mockResolvedValue(ROW),
      create: vi.fn(async ({ data }) => ({ ...ROW, ...data })),
      update: vi.fn(async ({ data }) => ({ ...ROW, ...data })),
      delete: vi.fn().mockResolvedValue(ROW),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 100n }]),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new CostCentersService(prisma, outbox as any), prisma, outbox };
}

describe('CostCentersService eventos', () => {
  it('criação emite cost_center.created na mesma transação', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({ name: 'Obras', sectorId: 'sec-1' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.created', expect.objectContaining({
      cost_center_id: 'cc-1', code: '100', name: 'Obras', sector_id: 'sec-1', active: true,
    }));
  });

  it('edição emite cost_center.updated', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('cc-1', { name: 'Obras SP' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.updated', expect.objectContaining({ name: 'Obras SP', active: true }));
  });

  it('exclusão emite cost_center.updated com active false', async () => {
    const { service, prisma, outbox } = fixture();
    await service.remove('cc-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.updated', expect.objectContaining({ cost_center_id: 'cc-1', active: false }));
  });
});
