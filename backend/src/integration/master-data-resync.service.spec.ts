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
  jobTitle: { name: 'Técnico', isTechnician: true },
  admissionDate: new Date('2025-02-03T00:00:00Z'),
  corporateEmail: `${id}@lgc.com.br`,
  matricula: `M-${id}`,
  phone: null,
  yellowBadge: null,
  supervisorId: null,
  managementLevel: 'colaborador',
});

const client = {
  id: 'cli1',
  code: 100,
  legalName: 'A100 ROW SERVICOS DE DADOS BRASIL LTDA',
  tradeName: 'A100 ROW',
  cnpj: '12.345.678/0001-90',
  phone: null,
  email: 'contato@a100row.com',
  cep: '13170-000',
  addressStreet: 'Rua A',
  addressNumber: '10',
  addressComplement: null,
  addressDistrict: 'Centro',
  addressCity: 'Sumaré',
  addressState: 'SP',
};

const project = {
  id: 'p1',
  code: 'PRJ-0001',
  name: 'Cabeamento GRU53',
  status: 'aprovado',
  clientId: 'cli1',
  costCenterId: 'cc2',
  costCenter: { id: 'cc2', code: '100.4.2', name: 'CC 100.4.2' },
  siteId: 's1',
  site: { id: 's1', code: 'GRU53', name: 'Site GRU53' },
  responsibleCollaboratorId: 'c1',
  plannedStartDate: new Date('2026-12-01T00:00:00Z'),
  plannedEndDate: null,
};

const user = (id: string, status: 'active' | 'disabled', collaboratorName: string | null) => ({
  id,
  email: `${id}@lgc.com.br`,
  status,
  collaboratorId: collaboratorName ? `col-${id}` : null,
  collaborator: collaboratorName ? { fullName: collaboratorName } : null,
  userRoles: [{ role: { name: 'gestor' } }],
});

const site = (id: string, code: string) => ({
  id,
  clientId: 'cli1',
  code,
  name: `Site ${code}`,
  cep: '07190100',
  addressStreet: 'Rodovia Hélio Smidt',
  addressNumber: 's/n',
  addressComplement: null,
  addressDistrict: 'Cumbica',
  addressCity: 'Guarulhos',
  addressState: 'SP',
  latitude: -23.4356,
  longitude: -46.4731,
  active: true,
});

function setup() {
  const tx = {
    costCenter: { findMany: vi.fn().mockResolvedValue([cc('cc1', '100'), cc('cc2', '100.4.2')]) },
    collaborator: { findMany: vi.fn().mockResolvedValue([collaborator('c1', 'cc2'), collaborator('c2', null)]) },
    site: { findMany: vi.fn().mockResolvedValue([site('s1', 'GRU53'), site('s2', 'CGH01')]) },
    client: { findMany: vi.fn().mockResolvedValue([client]) },
    project: { findMany: vi.fn().mockResolvedValue([project]) },
    user: { findMany: vi.fn().mockResolvedValue([user('u1', 'active', 'Pessoa c1'), user('u2', 'disabled', null)]) },
    jobTitle: { findMany: vi.fn().mockResolvedValue([{ id: 'j1', name: 'Técnico', isTechnician: true }]) },
    holiday: { findMany: vi.fn().mockResolvedValue([{ id: 'h1', date: new Date('2026-12-25T00:00:00Z'), name: 'Natal' }]) },
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
  it('registra no outbox, na mesma transação, o estado atual de todos os cadastros', async () => {
    const { service, recorded, tx } = setup();
    const result = await service.resync();

    expect(result).toEqual({ costCenters: 2, collaborators: 2, allocations: 1, sites: 2, clients: 1, projects: 1, users: 2, jobTitles: 1, holidays: 1 });
    expect(recorded.every((r) => r.tx === tx)).toBe(true);
    expect(recorded.map((r) => r.type)).toEqual([
      'cost_center.updated',
      'cost_center.updated',
      'collaborator.updated',
      'collaborator.updated',
      'collaborator.cost_center_changed',
      'client.updated',
      'site.updated',
      'site.updated',
      'project.updated',
      'user.updated',
      'user.disabled',
      'job_title.updated',
      'holiday.updated',
    ]);
    expect(recorded[1].payload).toMatchObject({ cost_center_id: 'cc2', short_code: 'DC-001-JAI', kind: 'equipe_tecnica', active: true });
    expect(recorded[2].payload).toMatchObject({
      collaborator_id: 'c1',
      cost_center_id: 'cc2',
      job_title_name: 'Técnico',
      job_title_is_technician: true,
      admission_date: '2025-02-03',
      email: 'c1@lgc.com.br',
      matricula: 'M-c1',
      active: true,
    });
    expect(recorded[4].payload).toEqual({
      collaborator_id: 'c1',
      name: 'Pessoa c1',
      job_title_id: 'j1',
      job_title_name: 'Técnico',
      previous_cost_center_id: null,
      cost_center_id: 'cc2',
      valid_from: '2026-03-01',
    });
    const byType = (type: string) => recorded.filter((r) => r.type === type).map((r) => r.payload);
    expect(byType('site.updated')[0]).toMatchObject({ site_id: 's1', client_id: 'cli1', code: 'GRU53', address_city: 'Guarulhos', latitude: -23.4356, active: true });
    expect(byType('client.updated')[0]).toEqual({
      client_id: 'cli1',
      code: 100,
      name: client.legalName,
      legal_name: client.legalName,
      trade_name: 'A100 ROW',
      cnpj: '12.345.678/0001-90',
      phone: null,
      email: 'contato@a100row.com',
      cep: '13170-000',
      address_street: 'Rua A',
      address_number: '10',
      address_complement: null,
      address_district: 'Centro',
      address_city: 'Sumaré',
      address_state: 'SP',
      active: true,
    });
    expect(byType('project.updated')[0]).toMatchObject({
      project_id: 'p1',
      code: 'PRJ-0001',
      status: 'aprovado',
      client_id: 'cli1',
      cost_center_code: '100.4.2',
      site_code: 'GRU53',
      planned_start_date: '2026-12-01',
      planned_end_date: null,
    });
    expect(byType('user.updated')[0]).toEqual({
      user_id: 'u1',
      email: 'u1@lgc.com.br',
      name: 'Pessoa c1',
      status: 'active',
      active: true,
      collaborator_id: 'col-u1',
      roles: ['gestor'],
    });
    expect(byType('user.disabled')[0]).toMatchObject({ user_id: 'u2', name: 'u2@lgc.com.br', status: 'disabled', active: false, collaborator_id: null });
    expect(byType('job_title.updated')[0]).toEqual({ job_title_id: 'j1', name: 'Técnico', is_technician: true, active: true });
    expect(byType('holiday.updated')[0]).toEqual({ holiday_id: 'h1', date: '2026-12-25', name: 'Natal', active: true });
  });

  it('não reenvia usuário nem colaborador do sistema', async () => {
    const { service, tx } = setup();
    await service.resync();
    expect(tx.user.findMany.mock.calls[0][0].where).toEqual({ NOT: { collaborator: { isSystem: true } } });
    expect(tx.collaborator.findMany.mock.calls[0][0].where).toEqual({ isSystem: false });
  });
});
