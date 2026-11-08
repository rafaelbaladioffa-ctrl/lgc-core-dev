import { describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobTitlesService } from './job-titles.service.js';

/** Eventos `job_title.*` (contrato V1, docs/mapa-interoperabilidade.md §6), gravados na transação da escrita. */

const ROW = { id: 'jt-1', name: 'Técnico de campo', isTechnician: true };

function fixture() {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    jobTitle: {
      findUnique: vi.fn().mockResolvedValue(ROW),
      create: vi.fn(async ({ data }) => ({ id: 'jt-1', ...data })),
      update: vi.fn(async ({ data }) => ({ ...ROW, ...data })),
      delete: vi.fn(async () => ROW),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new JobTitlesService(prisma, outbox as any), prisma, outbox };
}

describe('JobTitlesService: eventos job_title.*', () => {
  it('criar grava job_title.created', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({ name: 'Supervisor', isTechnician: false });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'job_title.created', { job_title_id: 'jt-1', name: 'Supervisor', is_technician: false, active: true });
  });

  it('editar grava job_title.updated com o estado completo', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('jt-1', { name: 'Técnico II' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'job_title.updated', { job_title_id: 'jt-1', name: 'Técnico II', is_technician: true, active: true });
  });

  it('excluir grava job_title.deleted', async () => {
    const { service, prisma, outbox } = fixture();
    await service.remove('jt-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'job_title.deleted', { job_title_id: 'jt-1', name: 'Técnico de campo', active: false, deleted: true });
  });

  it('cargo com colaboradores não é excluído e não gera evento', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.jobTitle.delete.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: 'x' }));
    await expect(service.remove('jt-1')).rejects.toBeInstanceOf(ConflictException);
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('nome repetido vira 409', async () => {
    const { service, prisma } = fixture();
    prisma.jobTitle.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.create({ name: 'Técnico de campo' })).rejects.toBeInstanceOf(ConflictException);
  });
});
