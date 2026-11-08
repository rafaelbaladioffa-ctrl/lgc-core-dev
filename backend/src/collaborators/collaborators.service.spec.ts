import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CollaboratorsService, saoPauloToday } from './collaborators.service.js';

/** Alocação do colaborador em centro de custo com vigência e eventos para o Financeiro
 * (docs/integracao-centros-de-custo.md §2), com Prisma simulado e estado mutável. */

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function setup(initial: { status?: string; costCenterId?: string | null; allocations?: Array<{ costCenterId: string; validFrom: string; validTo?: string | null }> } = {}) {
  const collaborator: Record<string, any> = {
    id: 'col-1',
    fullName: 'Ana Técnica',
    sectorId: 'sec-1',
    jobTitleId: 'jt-1',
    jobTitle: { id: 'jt-1', name: 'Técnico de campo', isTechnician: true },
    workSchedule: null,
    costCenter: null,
    costCenterId: initial.costCenterId === undefined ? 'cc-a' : initial.costCenterId,
    status: initial.status ?? 'ativo',
    offboardedAt: null,
    admissionDate: day('2026-01-05'),
    corporateEmail: 'ana@lgc.com.br',
    matricula: '0042',
    phone: '(19) 98888-7777',
    yellowBadge: 'CA-123',
    supervisorId: 'col-sup',
    managementLevel: 'colaborador',
  };
  type SeedAllocation = { costCenterId: string; validFrom: string; validTo?: string | null };
  const seeded: SeedAllocation[] = initial.allocations ?? (collaborator.costCenterId ? [{ costCenterId: collaborator.costCenterId as string, validFrom: '2026-01-05' }] : []);
  const allocations: Array<Record<string, any>> = seeded.map((a, i) => ({
    id: `al-${i + 1}`,
    collaboratorId: 'col-1',
    costCenterId: a.costCenterId,
    validFrom: day(a.validFrom),
    validTo: a.validTo ? day(a.validTo) : null,
    createdAt: new Date(),
  }));
  const prisma: any = {
    collaborator: {
      findUnique: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(where.cpfHash ? null : { ...collaborator })),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...collaborator, ...data, id: 'col-novo' })),
      update: vi.fn().mockImplementation(({ data }: any) => {
        for (const [key, value] of Object.entries(data)) if (value !== undefined) collaborator[key] = value;
        return Promise.resolve({ ...collaborator });
      }),
    },
    jobTitle: { findUnique: vi.fn().mockResolvedValue({ id: 'jt-1' }) },
    costCenter: { findUnique: vi.fn().mockResolvedValue({ id: 'cc' }) },
    collaboratorCostCenterAllocation: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => Promise.resolve(allocations.find((a) => a.collaboratorId === where.collaboratorId && a.validTo === null) ?? null)),
      findMany: vi.fn().mockImplementation(() => Promise.resolve(allocations.map((a) => ({ ...a, costCenter: { code: '100.1', name: 'CC', shortCode: null } })))),
      create: vi.fn().mockImplementation(({ data }: any) => {
        allocations.push({ id: `al-${allocations.length + 1}`, validTo: null, createdAt: new Date(), ...data });
        return Promise.resolve(allocations[allocations.length - 1]);
      }),
      update: vi.fn().mockImplementation(({ where, data }: any) => {
        Object.assign(allocations.find((a) => a.id === where.id)!, data);
        return Promise.resolve({});
      }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 7n }]),
  };
  prisma.$transaction = vi.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
  const outbox = { record: vi.fn() };
  const encryption = { hashForLookup: vi.fn().mockReturnValue('hash'), encrypt: vi.fn((v: string) => `enc(${v})`), decrypt: vi.fn() };
  const service = new CollaboratorsService(prisma, encryption as any, outbox as any);
  const events = (type: string) => outbox.record.mock.calls.filter((c: any[]) => c[1] === type).map((c: any[]) => c[2]);
  const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  return { prisma, outbox, service, collaborator, allocations, events, iso };
}

describe('alocação do colaborador no centro de custo', () => {
  it('criação com CC abre a alocação a partir da admissão e emite created + cost_center_changed', async () => {
    const { service, allocations, events, iso, prisma, outbox } = setup({ costCenterId: null, allocations: [] });
    await service.create({ fullName: 'Novo', rg: '1', cpf: '2', corporateEmail: 'n@lgc', jobTitleId: 'jt-1', sectorId: 'sec-1', costCenterId: 'cc-a', admissionDate: '2026-11-03' } as any);
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ collaboratorId: 'col-novo', costCenterId: 'cc-a' });
    expect(iso(allocations[0].validFrom)).toBe('2026-11-03');
    expect(events('collaborator.created')).toEqual([
      expect.objectContaining({ collaborator_id: 'col-novo', name: 'Novo', status: 'ativo', sector_id: 'sec-1', cost_center_id: 'cc-a', job_title_id: 'jt-1', job_title_name: 'Técnico de campo', admission_date: '2026-11-03' }),
    ]);
    expect(events('collaborator.cost_center_changed')).toEqual([
      { collaborator_id: 'col-novo', name: 'Novo', job_title_id: 'jt-1', job_title_name: 'Técnico de campo', previous_cost_center_id: null, cost_center_id: 'cc-a', valid_from: '2026-11-03' },
    ]);
    expect(outbox.record.mock.calls.every((c: any[]) => c[0] === prisma)).toBe(true);
  });

  it('criação sem CC não abre alocação', async () => {
    const { service, allocations, events } = setup({ costCenterId: null, allocations: [] });
    await service.create({ fullName: 'Novo', rg: '1', cpf: '2', corporateEmail: 'n@lgc', jobTitleId: 'jt-1', sectorId: 'sec-1' } as any);
    expect(allocations).toHaveLength(0);
    expect(events('collaborator.cost_center_changed')).toEqual([]);
  });

  it('trocar o CC fecha a vigente e abre outra na data informada', async () => {
    const { service, allocations, events, iso } = setup();
    await service.update('col-1', { costCenterId: 'cc-b', costCenterEffectiveFrom: '2026-11-10' });
    expect(allocations.map((a) => [a.costCenterId, iso(a.validFrom), iso(a.validTo)])).toEqual([
      ['cc-a', '2026-01-05', '2026-11-10'],
      ['cc-b', '2026-11-10', null],
    ]);
    expect(events('collaborator.cost_center_changed')).toEqual([expect.objectContaining({ previous_cost_center_id: 'cc-a', cost_center_id: 'cc-b', valid_from: '2026-11-10' })]);
    expect(events('collaborator.updated')).toEqual([expect.objectContaining({ collaborator_id: 'col-1', cost_center_id: 'cc-b', status: 'ativo', changed_fields: ['costCenterId', 'costCenterEffectiveFrom'] })]);
  });

  it('sem data, a troca vale a partir de hoje em São Paulo', async () => {
    const { service, allocations, iso } = setup();
    await service.update('col-1', { costCenterId: 'cc-b' });
    expect(iso(allocations[1].validFrom)).toBe(saoPauloToday());
  });

  it('data anterior ao início da vigente responde 400', async () => {
    const { service, allocations } = setup();
    await expect(service.update('col-1', { costCenterId: 'cc-b', costCenterEffectiveFrom: '2025-12-31' })).rejects.toBeInstanceOf(BadRequestException);
    expect(allocations).toHaveLength(1);
  });

  it('mesmo CC (ou outro campo) não mexe na alocação', async () => {
    const { service, allocations, events } = setup();
    await service.update('col-1', { costCenterId: 'cc-a', phone: '19999999999' });
    expect(allocations).toHaveLength(1);
    expect(events('collaborator.cost_center_changed')).toEqual([]);
  });

  it('limpar o CC fecha a vigente e emite cost_center_id null', async () => {
    const { service, allocations, events, iso } = setup();
    await service.update('col-1', { costCenterId: null as unknown as string, costCenterEffectiveFrom: '2026-11-10' });
    expect(iso(allocations[0].validTo)).toBe('2026-11-10');
    expect(allocations).toHaveLength(1);
    expect(events('collaborator.cost_center_changed')).toEqual([expect.objectContaining({ previous_cost_center_id: 'cc-a', cost_center_id: null, valid_from: '2026-11-10' })]);
  });

  it('desligar pela tela (PUT status desligado) fecha a vigente, grava offboarded_at e emite offboarded', async () => {
    const { service, allocations, events, iso, collaborator } = setup();
    await service.update('col-1', { status: 'desligado' });
    expect(collaborator.offboardedAt).toBeInstanceOf(Date);
    expect(iso(allocations[0].validTo)).toBe(saoPauloToday());
    expect(events('collaborator.cost_center_changed')).toEqual([expect.objectContaining({ previous_cost_center_id: 'cc-a', cost_center_id: null, valid_from: saoPauloToday() })]);
    expect(events('collaborator.offboarded')).toHaveLength(1);
  });

  it('POST offboard fecha a vigente; repetir não emite de novo', async () => {
    const { service, allocations, events, iso, collaborator } = setup();
    await service.offboard('col-1');
    expect(iso(allocations[0].validTo)).toBe(saoPauloToday());
    expect(events('collaborator.cost_center_changed')).toHaveLength(1);
    collaborator.status = 'desligado';
    await service.offboard('col-1');
    expect(events('collaborator.cost_center_changed')).toHaveLength(1);
  });

  it('reativar desligado com CC abre nova alocação', async () => {
    const { service, allocations, events } = setup({ status: 'desligado', allocations: [{ costCenterId: 'cc-a', validFrom: '2026-01-05', validTo: '2026-06-01' }] });
    await service.update('col-1', { status: 'ativo', costCenterEffectiveFrom: '2026-11-10' });
    expect(allocations).toHaveLength(2);
    expect(events('collaborator.cost_center_changed')).toEqual([expect.objectContaining({ previous_cost_center_id: null, cost_center_id: 'cc-a', valid_from: '2026-11-10' })]);
  });

  it('histórico devolve datas só-data', async () => {
    const { service } = setup({ allocations: [{ costCenterId: 'cc-a', validFrom: '2026-01-05', validTo: '2026-11-10' }, { costCenterId: 'cc-b', validFrom: '2026-11-10' }] });
    const history = await service.costCenterHistory('col-1');
    expect(history.map((h) => [h.costCenterId, h.validFrom, h.validTo])).toEqual([
      ['cc-a', '2026-01-05', '2026-11-10'],
      ['cc-b', '2026-11-10', null],
    ]);
  });
});

describe('payload dos eventos collaborator.* (contrato V1, docs/mapa-interoperabilidade.md §6)', () => {
  const FULL_STATE = {
    collaborator_id: 'col-1',
    name: 'Ana Técnica',
    sector_id: 'sec-1',
    cost_center_id: 'cc-a',
    job_title_id: 'jt-1',
    job_title_name: 'Técnico de campo',
    job_title_is_technician: true,
    admission_date: '2026-01-05',
    email: 'ana@lgc.com.br',
    matricula: '0042',
    phone: '(19) 98888-7777',
    yellow_badge: 'CA-123',
    supervisor_id: 'col-sup',
    management_level: 'colaborador',
  };

  it('collaborator.updated leva o estado completo, active e changed_fields', async () => {
    const { service, events } = setup();
    await service.update('col-1', { phone: '(19) 98888-7777' });
    expect(events('collaborator.updated')).toEqual([{ ...FULL_STATE, status: 'ativo', active: true, changed_fields: ['phone'] }]);
  });

  it('desligar pela tela: updated e offboarded dizem os dois desligado (active false), offboarded com offboarded_at', async () => {
    const { service, events, collaborator } = setup();
    await service.update('col-1', { status: 'desligado' });
    const [updated] = events('collaborator.updated');
    const [offboarded] = events('collaborator.offboarded');
    expect(updated).toMatchObject({ status: 'desligado', active: false });
    expect(offboarded).toEqual({ ...FULL_STATE, cost_center_id: 'cc-a', status: 'desligado', active: false, offboarded_at: collaborator.offboardedAt });
    expect(offboarded.offboarded_at).toBeInstanceOf(Date);
  });

  it('POST offboard emite offboarded com o estado completo', async () => {
    const { service, events, collaborator } = setup();
    await service.offboard('col-1');
    expect(events('collaborator.offboarded')).toEqual([{ ...FULL_STATE, status: 'desligado', active: false, offboarded_at: collaborator.offboardedAt }]);
  });

  it('afastado e férias continuam active true', async () => {
    const { service, events } = setup();
    await service.update('col-1', { status: 'ferias' });
    expect(events('collaborator.updated')[0]).toMatchObject({ status: 'ferias', active: true });
  });
});
