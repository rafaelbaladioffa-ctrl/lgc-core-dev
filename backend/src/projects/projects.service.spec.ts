import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectsService, buildProjectCode } from './projects.service.js';

/** Projetos com Prisma simulado: nome, datas previstas e eventos completos para os satélites
 * (decisão P-07 do módulo Projetos do Financeiro). */

const COST_CENTER = { id: 'cc-1', code: '100', name: 'Obras' };

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    code: 'PROP-7.012-1126',
    name: 'Cabeamento DC Campinas',
    clientId: 'cl-1',
    costCenterId: COST_CENTER.id,
    costCenter: COST_CENTER,
    responsibleCollaboratorId: 'col-1',
    plannedStartDate: new Date('2026-12-01T00:00:00Z'),
    plannedEndDate: new Date('2027-01-15T00:00:00Z'),
    status: 'proposta',
    proposalSequence: 12,
    ...overrides,
  };
}

function fixture(current: Record<string, unknown> | null = projectRow()) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'cl-1', code: 7 }) },
    project: {
      findUnique: vi.fn().mockResolvedValue(current),
      create: vi.fn(async ({ data }) => ({ ...projectRow(), ...data, costCenter: COST_CENTER })),
      update: vi.fn(async ({ data }) => {
        const merged: Record<string, unknown> = { ...projectRow(), ...current };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) merged[k] = v;
        return { ...merged, costCenter: COST_CENTER };
      }),
      delete: vi.fn().mockResolvedValue(current),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 12n }]),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  const service = new ProjectsService(prisma, outbox as any);
  return { service, prisma, outbox };
}

describe('ProjectsService', () => {
  it('cria com nome e datas e emite project.created com o projeto inteiro', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({
      name: 'Cabeamento DC Campinas',
      clientId: 'cl-1',
      costCenterId: 'cc-1',
      responsibleCollaboratorId: 'col-1',
      plannedStartDate: '2026-12-01',
      plannedEndDate: '2027-01-15',
    });

    const data = prisma.project.create.mock.calls[0][0].data;
    expect(data.name).toBe('Cabeamento DC Campinas');
    expect(data.plannedStartDate).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.created', expect.objectContaining({
      project_id: 'p-1',
      name: 'Cabeamento DC Campinas',
      status: 'proposta',
      client_id: 'cl-1',
      cost_center_id: 'cc-1',
      cost_center_code: '100',
      cost_center_name: 'Obras',
      responsible_collaborator_id: 'col-1',
      planned_start_date: '2026-12-01',
      planned_end_date: '2027-01-15',
    }));
  });

  it('recusa conclusão antes do início', async () => {
    const { service } = fixture();
    await expect(service.create({
      name: 'X', clientId: 'cl-1', costCenterId: 'cc-1', responsibleCollaboratorId: 'col-1',
      plannedStartDate: '2027-01-15', plannedEndDate: '2026-12-01',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('na edição compara a data nova com a já gravada', async () => {
    const { service } = fixture();
    await expect(service.update('p-1', { plannedEndDate: '2026-11-30' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('edição emite project.updated com snapshot e campos alterados; null apaga a data', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('p-1', { name: 'Novo nome', plannedEndDate: null });

    expect(prisma.project.update.mock.calls[0][0].data).toMatchObject({ name: 'Novo nome', plannedEndDate: null });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.updated', expect.objectContaining({
      name: 'Novo nome',
      cost_center_code: '100',
      planned_end_date: null,
      changed_fields: ['name', 'plannedEndDate'],
    }));
  });

  it('troca de status leva o projeto inteiro e o status anterior', async () => {
    const { service, prisma, outbox } = fixture();
    await service.updateStatus('p-1', { status: 'aprovado' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.status_changed', expect.objectContaining({
      status: 'aprovado',
      previous_status: 'proposta',
      name: 'Cabeamento DC Campinas',
      cost_center_id: 'cc-1',
    }));
  });

  it('exclui proposta sem requisições e avisa os satélites como encerrado', async () => {
    const { service, prisma, outbox } = fixture(projectRow({ _count: { requests: 0 } }));
    await service.remove('p-1');
    expect(prisma.project.delete).toHaveBeenCalled();
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.deleted', expect.objectContaining({ status: 'encerrado', deleted: true }));
  });

  it('não exclui projeto fora de proposta', async () => {
    const { service, prisma } = fixture(projectRow({ status: 'aprovado', _count: { requests: 0 } }));
    await expect(service.remove('p-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.project.delete).not.toHaveBeenCalled();
  });

  it('não exclui proposta com requisições', async () => {
    const { service } = fixture(projectRow({ _count: { requests: 2 } }));
    await expect(service.remove('p-1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('buildProjectCode', () => {
  it('usa mês e ano de São Paulo, não do fuso do processo', () => {
    // 30/11/2026 22:30 em São Paulo = 01/12/2026 01:30 UTC.
    expect(buildProjectCode(7, 12, new Date('2026-12-01T01:30:00Z'))).toBe('PROP-7.012-1126');
    expect(buildProjectCode(7, 3, new Date('2026-12-01T03:30:00Z'))).toBe('PROP-7.003-1226');
  });
});
