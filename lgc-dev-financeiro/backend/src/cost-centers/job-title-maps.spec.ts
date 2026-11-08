import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxService } from '../integration/outbox.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CcContext } from './cc-context.js';
import type { LogisticsClient } from './logistics.client.js';
import { CostCentersService } from './cost-centers.service.js';

/** Cargos do Core × funções do orçamento (F2): o nome do cargo vem do cache JOB_TITLE, não do navegador. */

const JT1 = '11111111-1111-4111-8111-111111111111';
const JT2 = '22222222-2222-4222-8222-222222222222';
const JT3 = '33333333-3333-4333-8333-333333333333';
const CONTROLADORIA = { userId: 'u1', email: 'c@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['cost_center:write'] } as AuthenticatedUser;

type Row = Record<string, any>;

function fixture({ jobTitles = [] as Row[], collaborators = [] as Row[], maps = [] as Row[] } = {}) {
  const cache: Row[] = [...jobTitles.map((j) => ({ kind: 'JOB_TITLE', ...j })), ...collaborators.map((c) => ({ kind: 'COLLABORATOR', active: true, ...c }))];
  const prisma = {
    jobTitleRoleMap: {
      findMany: vi.fn(async () => maps),
      upsert: vi.fn(async ({ create }: Row) => ({ ...create })),
    },
    axisMasterCache: {
      findMany: vi.fn(async ({ where }: Row) => cache.filter((r) => r.kind === where.kind && (where.active === undefined || r.active === where.active))),
      findUnique: vi.fn(async ({ where }: Row) => cache.find((r) => r.kind === where.kind_axisId.kind && r.axisId === where.kind_axisId.axisId) ?? null),
      findFirst: vi.fn(async ({ where }: Row) => cache.find((r) => r.kind === where.kind && r.data?.job_title_id === where.data.equals) ?? null),
    },
  };
  const ctx = { paramsAt: vi.fn(async () => ({ roles: [{ roleKey: 'tecnico', label: 'Técnico' }] })) } as unknown as CcContext;
  const service = new CostCentersService(prisma as unknown as PrismaService, ctx, {} as OutboxService, {} as LogisticsClient);
  return { service, prisma };
}

describe('mapa cargo → função (F2)', () => {
  it('lista os mapas com o nome atual do Core e os cargos sem função do cache e dos colaboradores', async () => {
    const { service } = fixture({
      jobTitles: [
        { axisId: JT1, name: 'Técnico de fibra II', active: true },
        { axisId: JT2, name: 'Almoxarife', active: true },
        { axisId: 'jt-del', name: 'Excluído', active: false },
      ],
      collaborators: [
        { axisId: 'c1', data: { job_title_id: JT2, job_title_name: 'Almoxarife (velho)' } },
        { axisId: 'c2', data: { job_title_id: JT3, job_title_name: 'Motorista' } },
      ],
      maps: [{ axisJobTitleId: JT1, jobTitleName: 'Técnico de fibra', roleKey: 'tecnico' }],
    });
    const out = await service.jobTitleMaps();
    expect(out.maps).toEqual([{ jobTitleId: JT1, jobTitleName: 'Técnico de fibra II', roleKey: 'tecnico', active: true }]);
    expect(out.unmapped).toEqual([
      { jobTitleId: JT2, jobTitleName: 'Almoxarife', collaborators: 1 },
      { jobTitleId: JT3, jobTitleName: 'Motorista', collaborators: 1 },
    ]);
  });

  it('grava o nome do cache, ignorando o que o navegador mandou', async () => {
    const { service, prisma } = fixture({ jobTitles: [{ axisId: JT1, name: 'Técnico de fibra', active: true }] });
    await service.putJobTitleMap(CONTROLADORIA, JT1, { jobTitleName: 'Nome digitado', roleKey: 'tecnico' });
    expect(prisma.jobTitleRoleMap.upsert.mock.calls[0][0].create).toMatchObject({ jobTitleName: 'Técnico de fibra', roleKey: 'tecnico' });
  });

  it('sem o cargo no cache usa o nome do colaborador; cargo desconhecido sem nome é recusado; cargo excluído não mapeia', async () => {
    const viaColab = fixture({ collaborators: [{ axisId: 'c2', data: { job_title_id: JT3, job_title_name: 'Motorista' } }] });
    await viaColab.service.putJobTitleMap(CONTROLADORIA, JT3, { roleKey: 'tecnico' });
    expect(viaColab.prisma.jobTitleRoleMap.upsert.mock.calls[0][0].create.jobTitleName).toBe('Motorista');

    await expect(fixture().service.putJobTitleMap(CONTROLADORIA, JT2, { roleKey: 'tecnico' })).rejects.toThrow('Cargo não encontrado nos cadastros do Axis Core');
    const excluido = fixture({ jobTitles: [{ axisId: JT1, name: 'Velho', active: false }] });
    await expect(excluido.service.putJobTitleMap(CONTROLADORIA, JT1, { roleKey: 'tecnico' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
