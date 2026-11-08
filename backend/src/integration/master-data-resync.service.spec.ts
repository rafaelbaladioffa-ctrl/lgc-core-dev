import { describe, expect, it, vi } from 'vitest';
import { MasterDataResyncService } from './master-data-resync.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { OutboxService } from './outbox.service.js';

const cc = (id: string, code: string) => ({
  id,
  code,
  name: `CC ${code}`,
  sectorId: 's1',
  parentCostCenterId: null,
  responsibleCollaboratorId: 'c1',
  kind: 'equipe_tecnica',
  shortCode: code === '100.4.2' ? 'DC-001-JAI' : null,
});

const collaborator = (id: string, costCenterId: string | null) => ({
  id,
  fullName: `Pessoa ${id}`,
  status: 'ativo',
  sectorId: 's1',
  costCenterId,
  jobTitleId: 'j1',
  jobTitle: { name: 'Técnico' },
  admissionDate: new Date('2025-02-03T00:00:00Z'),
});

function setup() {
  const tx = {
    costCenter: { findMany: vi.fn().mockResolvedValue([cc('cc1', '100'), cc('cc2', '100.4.2')]) },
    collaborator: { findMany: vi.fn().mockResolvedValue([collaborator('c1', 'cc2'), collaborator('c2', null)]) },
    collaboratorCostCenterAllocation: {
      findMany: vi.fn().mockResolvedValue([
        { collaboratorId: 'c1', costCenterId: 'cc2', validFrom: new Date('2026-03-01T00:00:00Z'), validTo: null },
        { collaboratorId: 'sumido', costCenterId: 'cc1', validFrom: new Date('2026-01-01T00:00:00Z'), validTo: null },
      ]),
    },
  };
  const prisma = { $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const recorded: Array<{ type: string; payload: Record<string, unknown>; tx: unknown }> = [];
  const outbox = { record: vi.fn(async (t: unknown, type: string, payload: Record<string, unknown>) => void recorded.push({ type, payload, tx: t })) } as unknown as OutboxService;
  return { service: new MasterDataResyncService(prisma, outbox), recorded, tx };
}

describe('MasterDataResyncService', () => {
  it('registra no outbox, na mesma transação, o estado atual de CCs, colaboradores e alocações vigentes', async () => {
    const { service, recorded, tx } = setup();
    const result = await service.resync();

    expect(result).toEqual({ costCenters: 2, collaborators: 2, allocations: 1 });
    expect(recorded.every((r) => r.tx === tx)).toBe(true);
    expect(recorded.map((r) => r.type)).toEqual([
      'cost_center.updated',
      'cost_center.updated',
      'collaborator.updated',
      'collaborator.updated',
      'collaborator.cost_center_changed',
    ]);
    expect(recorded[1].payload).toMatchObject({ cost_center_id: 'cc2', short_code: 'DC-001-JAI', kind: 'equipe_tecnica', active: true });
    expect(recorded[2].payload).toMatchObject({ collaborator_id: 'c1', cost_center_id: 'cc2', job_title_name: 'Técnico', admission_date: '2025-02-03' });
    expect(recorded[4].payload).toEqual({
      collaborator_id: 'c1',
      name: 'Pessoa c1',
      job_title_id: 'j1',
      job_title_name: 'Técnico',
      previous_cost_center_id: null,
      cost_center_id: 'cc2',
      valid_from: '2026-03-01',
    });
  });
});
