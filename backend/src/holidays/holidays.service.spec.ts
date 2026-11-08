import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { HolidaysService } from './holidays.service.js';

/** Eventos `holiday.*` (contrato V1, docs/mapa-interoperabilidade.md §6), gravados na transação da escrita. */

const ROW = { id: 'h-1', date: new Date('2026-12-25T00:00:00Z'), name: 'Natal', createdAt: new Date() };

function fixture() {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    holiday: {
      findUnique: vi.fn().mockResolvedValue(ROW),
      create: vi.fn(async ({ data }) => ({ id: 'h-1', createdAt: new Date(), ...data })),
      delete: vi.fn(async () => ROW),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new HolidaysService(prisma, outbox as any), prisma, outbox };
}

describe('HolidaysService: eventos holiday.*', () => {
  it('criar grava holiday.created com a data em AAAA-MM-DD', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({ date: '2026-11-20', name: 'Consciência Negra' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'holiday.created', { holiday_id: 'h-1', date: '2026-11-20', name: 'Consciência Negra', active: true });
  });

  it('excluir grava holiday.deleted', async () => {
    const { service, prisma, outbox } = fixture();
    await service.remove('h-1');
    expect(prisma.holiday.delete).toHaveBeenCalledWith({ where: { id: 'h-1' } });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'holiday.deleted', { holiday_id: 'h-1', date: '2026-12-25', name: 'Natal', active: false, deleted: true });
  });

  it('feriado inexistente responde 404 sem evento', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.holiday.findUnique.mockResolvedValueOnce(null);
    await expect(service.remove('x')).rejects.toBeInstanceOf(NotFoundException);
    expect(outbox.record).not.toHaveBeenCalled();
  });
});
