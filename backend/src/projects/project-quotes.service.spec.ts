import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectQuotesService, normalizeTeam, quoteStatus } from './project-quotes.service.js';
import type { ReceiveProjectQuoteDto } from './dto/project-quote.dto.js';

/** Cotação do projeto: pedido do Core e devolução do Financeiro. Prisma simulado; valores fictícios. */

const XLSX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('planilha bid fictícia')]);
const PDF = Buffer.from('%PDF-1.7 não é planilha');

const PROJECT = {
  id: 'p-1',
  code: 'PROP-7.012-1126',
  name: 'Data center Campinas',
  status: 'proposta',
  clientId: 'c-1',
  costCenterId: 'cc-1',
  costCenter: { id: 'cc-1', code: 'CC-01', name: 'Obras' },
  responsibleCollaboratorId: 'col-1',
  plannedStartDate: new Date('2026-12-01T00:00:00Z'),
  plannedEndDate: new Date('2026-12-20T00:00:00Z'),
};

function quoteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    projectId: 'p-1',
    externalRevisionId: 'rev-1',
    revisionNumber: 1,
    sowDocumentId: 'sow-2',
    sowDocument: { version: 2 },
    workDays: new Prisma.Decimal(10),
    plannedStartDate: null,
    plannedEndDate: null,
    team: [],
    fieldPeople: 4,
    totalHours: new Prisma.Decimal(352),
    approvedAt: null,
    approvedByEmail: null,
    bidFilename: 'Bid.xlsx',
    bidMimeType: 'application/zip',
    bidSizeBytes: XLSX.length,
    bidContentHash: 'hash',
    receivedAt: new Date('2026-11-08T12:00:00Z'),
    satellite: { name: 'financeiro' },
    ...overrides,
  };
}

function fixture({
  project = PROJECT as Record<string, unknown> | null,
  sow = { id: 'sow-2', version: 2, filename: 'SOW.pdf', contentHash: 'abc' } as Record<string, unknown> | null,
  bidTemplate = { id: 'bt-1', version: 1, filename: 'Bid Template.xlsm', contentHash: 'def' } as Record<string, unknown> | null,
  existing = null as Record<string, unknown> | null,
} = {}) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    projectDocument: { findFirst: vi.fn(async ({ where }) => (where.kind === 'bid_template' ? bidTemplate : sow)) },
    projectQuoteRequest: {
      create: vi.fn(async ({ data }) => ({ id: 'qr-1', createdAt: new Date('2026-11-08T10:00:00Z'), notes: data.notes, requestedBy: { email: 'comercial@lgc.test' } })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    projectQuote: {
      findUnique: vi.fn().mockResolvedValue(existing),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async ({ data }) => quoteRow({ ...data, sowDocument: { version: 2 }, satellite: { name: 'financeiro' } })),
    },
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new ProjectQuotesService(prisma, outbox as any), prisma, outbox };
}

function receiveDto(overrides: Partial<ReceiveProjectQuoteDto> = {}): ReceiveProjectQuoteDto {
  return {
    external_revision_id: 'rev-1',
    revision_number: 1,
    sow_document_id: 'sow-2',
    work_days: 10,
    planned_start_date: '2026-12-01',
    planned_end_date: '2026-12-12',
    team: [
      { role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 3, days: 10, hours: 264 },
      { role_key: 'encarregado', role_name: 'Encarregado', field_role: true, people: 1, days: 10, hours: 88 },
      { role_key: 'gerente_projeto', role_name: 'Gerente de projeto', field_role: false, hours: 20 },
    ],
    approved_by_email: 'gestor@lgc.test',
    bid: { filename: 'Bid PROP-7.012-1126 R1.xlsx', content_base64: XLSX.toString('base64') },
    ...overrides,
  } as ReceiveProjectQuoteDto;
}

describe('ProjectQuotesService.request', () => {
  it('grava o pedido com a SOW e o Bid Template vigentes e emite project.quote_requested na mesma transação', async () => {
    const { service, prisma, outbox } = fixture();
    const result = await service.request('p-1', { notes: 'Proposta até sexta' }, 'user-1');

    expect(prisma.projectQuoteRequest.create.mock.calls[0][0].data).toEqual({
      projectId: 'p-1',
      sowDocumentId: 'sow-2',
      bidTemplateDocumentId: 'bt-1',
      notes: 'Proposta até sexta',
      requestedByUserId: 'user-1',
    });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.quote_requested', expect.objectContaining({
      project_id: 'p-1',
      code: 'PROP-7.012-1126',
      name: 'Data center Campinas',
      planned_start_date: '2026-12-01',
      quote_request_id: 'qr-1',
      sow_document_id: 'sow-2',
      sow_version: 2,
      bid_template_document_id: 'bt-1',
      bid_template_version: 1,
      bid_template_filename: 'Bid Template.xlsm',
      notes: 'Proposta até sexta',
      requested_by_email: 'comercial@lgc.test',
      requested_at: '2026-11-08T10:00:00.000Z',
    }));
    expect(result.sowVersion).toBe(2);
    expect(result.bidTemplateVersion).toBe(1);
  });

  it('sem Bid Template não pede cotação', async () => {
    const { service, outbox } = fixture({ bidTemplate: null });
    await expect(service.request('p-1', {}, 'user-1')).rejects.toThrow('Anexe o Bid Template');
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('sem SOW não pede cotação', async () => {
    const { service, outbox } = fixture({ sow: null });
    await expect(service.request('p-1', {}, 'user-1')).rejects.toThrow('Anexe a SOW');
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('só projeto em proposta', async () => {
    const { service } = fixture({ project: { ...PROJECT, status: 'aprovado' } });
    await expect(service.request('p-1', {}, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('projeto inexistente → 404', async () => {
    const { service } = fixture({ project: null });
    await expect(service.request('p-x', {}, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProjectQuotesService.receive', () => {
  it('grava a cotação com equipe, dias e a Bid, sem nenhum custo', async () => {
    const { service, prisma } = fixture();
    const quote = await service.receive('p-1', 'sat-1', receiveDto());

    const data = prisma.projectQuote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      projectId: 'p-1',
      satelliteId: 'sat-1',
      externalRevisionId: 'rev-1',
      revisionNumber: 1,
      sowDocumentId: 'sow-2',
      fieldPeople: 4,
      bidFilename: 'Bid PROP-7.012-1126 R1.xlsx',
      bidMimeType: 'application/zip',
      approvedByEmail: 'gestor@lgc.test',
    });
    expect(data.workDays.toNumber()).toBe(10);
    expect(data.totalHours.toNumber()).toBe(372);
    expect(data.plannedEndDate).toEqual(new Date('2026-12-12T00:00:00Z'));
    expect(data.bidContentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.team[2]).toEqual({ role_key: 'gerente_projeto', role_name: 'Gerente de projeto', field_role: false, people: null, days: null, hours: 20 });
    expect(quote).not.toHaveProperty('bidContent');
    expect(quote.sowVersion).toBe(2);
  });

  it('reenvio da mesma revisão com a mesma Bid devolve a cotação gravada', async () => {
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(XLSX).digest('hex');
    const { service, prisma } = fixture({ existing: quoteRow({ bidContentHash: hash }) });
    const quote = await service.receive('p-1', 'sat-1', receiveDto());
    expect(prisma.projectQuote.create).not.toHaveBeenCalled();
    expect(quote.id).toBe('q-1');
  });

  it('mesma revisão com outra Bid → 409', async () => {
    const { service } = fixture({ existing: quoteRow({ bidContentHash: 'outro' }) });
    await expect(service.receive('p-1', 'sat-1', receiveDto())).rejects.toBeInstanceOf(ConflictException);
  });

  it('Bid que não é planilha é recusada', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.receive('p-1', 'sat-1', receiveDto({ bid: { filename: 'Bid.xlsx', content_base64: PDF.toString('base64') } })),
    ).rejects.toThrow('planilha');
    await expect(
      service.receive('p-1', 'sat-1', receiveDto({ bid: { filename: 'Bid.pdf', content_base64: XLSX.toString('base64') } })),
    ).rejects.toThrow('planilha');
    expect(prisma.projectQuote.create).not.toHaveBeenCalled();
  });

  it('SOW de outro projeto é recusada', async () => {
    const { service } = fixture({ sow: null, bidTemplate: null });
    await expect(service.receive('p-1', 'sat-1', receiveDto())).rejects.toThrow('SOW informada');
  });

  it('conclusão antes do início é recusada', async () => {
    const { service } = fixture();
    await expect(
      service.receive('p-1', 'sat-1', receiveDto({ planned_start_date: '2026-12-10', planned_end_date: '2026-12-01' })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('projeto inexistente → 404', async () => {
    const { service } = fixture({ project: null });
    await expect(service.receive('p-x', 'sat-1', receiveDto())).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('normalizeTeam', () => {
  it('função de campo sem pessoas ou dias é recusada', () => {
    expect(() => normalizeTeam({ team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, days: 5, hours: 40 }] })).toThrow('pessoas e dias');
  });

  it('função repetida é recusada', () => {
    const line = { role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 1, days: 1, hours: 8 };
    expect(() => normalizeTeam({ team: [line, line] })).toThrow('repetida');
  });
});

describe('quoteStatus', () => {
  const d = (s: string) => new Date(s);
  it('sem pedido nem cotação', () => expect(quoteStatus(null, null)).toBe('nao_solicitada'));
  it('pedido sem cotação', () => expect(quoteStatus(d('2026-11-08'), null)).toBe('aguardando'));
  it('pedido novo depois da última cotação', () => expect(quoteStatus(d('2026-11-09'), d('2026-11-08'))).toBe('aguardando'));
  it('cotação depois do pedido', () => expect(quoteStatus(d('2026-11-08'), d('2026-11-09'))).toBe('recebida'));
});
