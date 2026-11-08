import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { IntegrationQueryController } from './integration-query.controller.js';

/** Consultas por API key do contrato V1 (docs/mapa-interoperabilidade.md §6): users, job-titles e holidays. */

function fixture() {
  const prisma: any = {
    user: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'u1', email: 'a@lgc.com.br', status: 'active', collaboratorId: 'c1', userRoles: [{ role: { name: 'gestor' } }] },
      ]),
      count: vi.fn().mockResolvedValue(1),
    },
    jobTitle: { findMany: vi.fn().mockResolvedValue([{ id: 'j1', name: 'Técnico', isTechnician: true }]), count: vi.fn().mockResolvedValue(1) },
    holiday: {
      findMany: vi.fn().mockResolvedValue([{ id: 'h1', date: new Date('2026-12-25T00:00:00Z'), name: 'Natal', createdAt: new Date() }]),
      count: vi.fn().mockResolvedValue(1),
    },
  };
  return { controller: new IntegrationQueryController(prisma), prisma };
}

describe('IntegrationQueryController (contrato V1)', () => {
  it('GET users pagina, tira o usuário do sistema e devolve collaborator_id e nomes dos papéis', async () => {
    const { controller, prisma } = fixture();
    const result = await controller.listUsers('active', '2', '10');
    expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'active', NOT: { collaborator: { isSystem: true } } },
      skip: 10,
      take: 10,
    });
    expect(result).toEqual({
      data: [{ id: 'u1', email: 'a@lgc.com.br', status: 'active', collaborator_id: 'c1', roles: ['gestor'] }],
      meta: { page: 2, per_page: 10, total: 1 },
    });
  });

  it('GET job-titles devolve id, nome e se é técnico', async () => {
    const { controller } = fixture();
    expect(await controller.listJobTitles()).toEqual({
      data: [{ id: 'j1', name: 'Técnico', isTechnician: true }],
      meta: { page: 1, per_page: 50, total: 1 },
    });
  });

  it('GET holidays filtra o período (inclusivo) e devolve a data em AAAA-MM-DD', async () => {
    const { controller, prisma } = fixture();
    const result = await controller.listHolidays('2026-01-01', '2026-12-31');
    expect(prisma.holiday.findMany.mock.calls[0][0].where).toEqual({
      date: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-12-31T00:00:00Z') },
    });
    expect(result.data).toEqual([{ id: 'h1', date: '2026-12-25', name: 'Natal' }]);
  });

  it('GET holidays sem período não filtra; data inválida responde 400', async () => {
    const { controller, prisma } = fixture();
    await controller.listHolidays();
    expect(prisma.holiday.findMany.mock.calls[0][0].where).toEqual({});
    await expect(controller.listHolidays('25/12/2026')).rejects.toBeInstanceOf(BadRequestException);
  });
});
