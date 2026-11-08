import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProjectsService, buildProjectCode } from './projects.service.js';

/** Projetos com Prisma simulado: nome, datas previstas e eventos completos para os satélites
 * (decisão P-07 do módulo Projetos do Financeiro). */

const COST_CENTER = { id: 'cc-1', code: '100', name: 'Obras' };
const SITE = { id: 'site-1', code: 'GRU53', name: 'Aeroporto GRU' };

/** Cadastro de site que o servidor confere antes de gravar (PA-05). */
function siteRow(overrides: Record<string, unknown> = {}) {
  return { clientId: 'cl-1', active: true, ...overrides };
}

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
    siteId: null,
    site: null,
    ...overrides,
  };
}

function fixture(current: Record<string, unknown> | null = projectRow()) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    client: { findUnique: vi.fn().mockResolvedValue({ id: 'cl-1', code: 7 }) },
    site: { findUnique: vi.fn().mockResolvedValue(siteRow()) },
    project: {
      findUnique: vi.fn().mockResolvedValue(current),
      create: vi.fn(async ({ data }) => ({ ...projectRow(), ...data, costCenter: COST_CENTER, site: data.siteId ? SITE : null })),
      update: vi.fn(async ({ data }) => {
        const merged: Record<string, unknown> = { ...projectRow(), ...current };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) merged[k] = v;
        return { ...merged, costCenter: COST_CENTER, site: merged.siteId ? SITE : null };
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
    const { service, prisma, outbox } = fixture(projectRow({ status: 'aprovado' }));
    await service.updateStatus('p-1', { status: 'em_execucao' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.status_changed', expect.objectContaining({
      status: 'em_execucao',
      previous_status: 'aprovado',
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

describe('ProjectsService — site do projeto (PA-05)', () => {
  const base = { name: 'X', clientId: 'cl-1', costCenterId: 'cc-1', responsibleCollaboratorId: 'col-1' };

  it('cria com site do mesmo cliente e leva site_id, site_code e site_name em project.created', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({ ...base, siteId: 'site-1' });

    expect(prisma.site.findUnique).toHaveBeenCalledWith({ where: { id: 'site-1' }, select: { clientId: true, active: true } });
    expect(prisma.project.create.mock.calls[0][0].data.siteId).toBe('site-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.created', expect.objectContaining({
      site_id: 'site-1',
      site_code: 'GRU53',
      site_name: 'Aeroporto GRU',
    }));
  });

  it('cria sem site (opcional até a aprovação) e o evento leva os campos de site nulos', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create(base);

    expect(prisma.site.findUnique).not.toHaveBeenCalled();
    expect(prisma.project.create.mock.calls[0][0].data.siteId).toBeNull();
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.created', expect.objectContaining({ site_id: null, site_code: null, site_name: null }));
  });

  it('site de outro cliente → 400, sem criar projeto nem evento', async () => {
    const { service, prisma, outbox } = fixture();
    prisma.site.findUnique.mockResolvedValue(siteRow({ clientId: 'cl-outro' }));

    await expect(service.create({ ...base, siteId: 'site-x' })).rejects.toThrow('O site não pertence ao cliente do projeto.');
    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('site inexistente ou inativo → 400', async () => {
    const { service, prisma } = fixture();
    prisma.site.findUnique.mockResolvedValueOnce(null);
    await expect(service.create({ ...base, siteId: 'site-x' })).rejects.toBeInstanceOf(BadRequestException);

    prisma.site.findUnique.mockResolvedValueOnce(siteRow({ active: false }));
    await expect(service.create({ ...base, siteId: 'site-1' })).rejects.toThrow('O site está inativo.');
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('edição confere o site contra o cliente do projeto, não contra o corpo', async () => {
    const { service, prisma } = fixture();
    prisma.site.findUnique.mockResolvedValue(siteRow({ clientId: 'cl-outro' }));
    await expect(service.update('p-1', { siteId: 'site-x' })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('edição troca o site e emite project.updated com o site novo', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('p-1', { siteId: 'site-1' });

    expect(prisma.project.update.mock.calls[0][0].data.siteId).toBe('site-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.updated', expect.objectContaining({
      site_id: 'site-1',
      site_code: 'GRU53',
      changed_fields: ['siteId'],
    }));
  });

  it('null desvincula o site sem consultar o cadastro', async () => {
    const { service, prisma, outbox } = fixture(projectRow({ siteId: 'site-1', site: SITE }));
    await service.update('p-1', { siteId: null });

    expect(prisma.site.findUnique).not.toHaveBeenCalled();
    expect(prisma.project.update.mock.calls[0][0].data.siteId).toBeNull();
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.updated', expect.objectContaining({ site_id: null, site_code: null }));
  });

  it('reenviar o mesmo site não reconfere: projeto com site depois inativado continua editável', async () => {
    const { service, prisma } = fixture(projectRow({ siteId: 'site-1', site: SITE }));
    prisma.site.findUnique.mockResolvedValue(siteRow({ active: false }));
    await service.update('p-1', { name: 'Novo nome', siteId: 'site-1' });
    expect(prisma.site.findUnique).not.toHaveBeenCalled();
  });

  it('troca de status e exclusão também levam o site no payload', async () => {
    const { service, prisma, outbox } = fixture(projectRow({ siteId: 'site-1', site: SITE, status: 'aprovado', _count: { requests: 0 } }));
    await service.updateStatus('p-1', { status: 'em_execucao' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.status_changed', expect.objectContaining({ site_id: 'site-1', site_code: 'GRU53', site_name: 'Aeroporto GRU' }));
  });

  it('project.deleted leva o site do projeto excluído', async () => {
    const { service, prisma, outbox } = fixture(projectRow({ siteId: 'site-1', site: SITE, _count: { requests: 0 } }));
    await service.remove('p-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.deleted', expect.objectContaining({ site_id: 'site-1', site_code: 'GRU53', deleted: true }));
  });
});

describe('aprovação do projeto não passa pelo updateStatus genérico', () => {
  it('recusa aprovado (a aprovação exige site e cotação e tem serviço próprio) e os campos do aceite em outros status', async () => {
    const { service, prisma } = fixture();
    await expect(service.updateStatus('p-1', { status: 'aprovado' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateStatus('p-1', { status: 'encerrado', clientPoNumber: 'PO-1' })).rejects.toThrow(/só valem na aprovação/);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});

describe('buildProjectCode', () => {
  it('usa mês e ano de São Paulo, não do fuso do processo', () => {
    // 30/11/2026 22:30 em São Paulo = 01/12/2026 01:30 UTC.
    expect(buildProjectCode(7, 12, new Date('2026-12-01T01:30:00Z'))).toBe('PROP-7.012-1126');
    expect(buildProjectCode(7, 3, new Date('2026-12-01T03:30:00Z'))).toBe('PROP-7.003-1226');
  });
});
