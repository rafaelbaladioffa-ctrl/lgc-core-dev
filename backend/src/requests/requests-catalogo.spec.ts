import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { RequestsService } from './requests.service.js';

/** create() e o catálogo versionado: só a maior versão publicada vale; categoria inativa é recusada. */

function fixture(category: Record<string, unknown> | null) {
  const prisma: any = {
    requestCategory: { findUnique: vi.fn().mockResolvedValue(category) },
    categoryVersion: { findFirst: vi.fn().mockResolvedValue({ id: 'cv-3', version: 3, formSchema: [] }) },
    collaborator: { findUnique: vi.fn().mockResolvedValue({ id: 'col-1', sectorId: 's' }) },
    costCenter: { findUnique: vi.fn().mockResolvedValue({ id: 'cc-1' }) },
    queue: { findFirst: vi.fn().mockResolvedValue({ id: 'q-1' }) },
    request: { create: vi.fn().mockRejectedValue(new Error('parou-no-create')) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ last_value: 1 }]),
    auditEvent: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const service = new RequestsService(prisma, { record: vi.fn() } as any, {} as any, {} as any, {} as any);
  return { prisma, service };
}

const dto = { categoryId: 'cat-1', title: 'Teste', costCenterId: 'cc-1', formData: {} } as any;
const activeCategory = { id: 'cat-1', active: true, kind: 'padrao', sectorId: 's', confidentiality: 'interna', code: 'TI-X', name: 'X' };

describe('RequestsService.create e o catálogo versionado', () => {
  it('busca a maior versão publicada e fixa a requisição nela', async () => {
    const { prisma, service } = fixture(activeCategory);
    await expect(service.create('col-1', dto)).rejects.toThrow('parou-no-create');
    expect(prisma.categoryVersion.findFirst).toHaveBeenCalledWith({
      where: { categoryId: 'cat-1', status: 'publicada' },
      orderBy: { version: 'desc' },
    });
    expect(prisma.request.create.mock.calls[0][0].data.categoryVersionId).toBe('cv-3');
  });

  it('recusa categoria inativa', async () => {
    const { prisma, service } = fixture({ ...activeCategory, active: false });
    await expect(service.create('col-1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.categoryVersion.findFirst).not.toHaveBeenCalled();
  });

  it('recusa categoria sem versão publicada', async () => {
    const { prisma, service } = fixture(activeCategory);
    prisma.categoryVersion.findFirst.mockResolvedValue(null);
    await expect(service.create('col-1', dto)).rejects.toThrow('Categoria sem versão publicada');
  });

  it('compra é identificada pelo kind, mesmo com outro código e nome', async () => {
    const { service } = fixture({ ...activeCategory, kind: 'compra_material', code: 'QUALQUER', name: 'Qualquer' });
    await expect(service.create('col-1', dto)).rejects.toThrow('Inclua ao menos um item da Logística.');
  });

  it('código SUP-COMPRA com kind padrao não é tratado como compra', async () => {
    const { service } = fixture({ ...activeCategory, kind: 'padrao', code: 'SUP-COMPRA', name: 'Compra de material' });
    await expect(service.create('col-1', dto)).rejects.toThrow('parou-no-create');
  });
});
