import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProjectQuotesService, normalizeMaterials, normalizeTeam, quoteStatus, sameMaterials } from './project-quotes.service.js';
import { ReceiveProjectQuoteDto as ReceiveProjectQuoteDtoClass, type ReceiveProjectQuoteDto } from './dto/project-quote.dto.js';

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
    materials: [] as unknown[],
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
      create: vi.fn(async ({ data }) => quoteRow({ ...data, materials: (data.materials?.create ?? []).map((m: Record<string, unknown>, i: number) => ({ id: `m-${i}`, logisticsMaterialId: null, ...m })), sowDocument: { version: 2 }, satellite: { name: 'financeiro' } })),
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

const MATERIALS = [
  { material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' },
  { material_code: 'RED-CON-0007', description: 'Conector LC', unit: 'un', quantity: '48.000' },
];
const storedMaterial = (code: string, description: string, unit: string, quantity: string) => ({ id: `m-${code}`, materialCode: code, logisticsMaterialId: null, description, unit, quantity: new Prisma.Decimal(quantity) });
const XLSX_HASH = async () => (await import('crypto')).createHash('sha256').update(XLSX).digest('hex');

describe('ProjectQuotesService.receive — materiais', () => {
  it('grava os materiais com a cotação, na mesma criação, e sem preço', async () => {
    const { service, prisma } = fixture();
    await service.receive('p-1', 'sat-1', receiveDto({ materials: MATERIALS }));
    const created = prisma.projectQuote.create.mock.calls[0][0].data.materials.create;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ materialCode: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm' });
    expect(created[0].quantity.toFixed(3)).toBe('1200.000');
    // logistics_material_id fica nulo por enquanto (coluna sem valor)
    expect(Object.keys(created[0]).sort()).toEqual(['description', 'materialCode', 'quantity', 'unit']);
  });

  it('sem materials a cotação continua valendo (satélite antigo)', async () => {
    const { service, prisma } = fixture();
    await service.receive('p-1', 'sat-1', receiveDto());
    expect(prisma.projectQuote.create.mock.calls[0][0].data.materials.create).toEqual([]);
  });

  it('material_code repetido → 400, sem gravar nada', async () => {
    const { service, prisma } = fixture();
    await expect(service.receive('p-1', 'sat-1', receiveDto({ materials: [MATERIALS[0], { ...MATERIALS[0], quantity: '1.000' }] }))).rejects.toThrow('Material repetido na cotação: RED-CAB-0123');
    expect(prisma.projectQuote.create).not.toHaveBeenCalled();
  });

  it('quantidade zero → 400', async () => {
    const { service } = fixture();
    await expect(service.receive('p-1', 'sat-1', receiveDto({ materials: [{ ...MATERIALS[0], quantity: '0.000' }] }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reenvio com os mesmos materiais (em outra ordem) devolve a cotação gravada', async () => {
    const stored = [storedMaterial('RED-CON-0007', 'Conector LC', 'un', '48'), storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200')];
    const { service, prisma } = fixture({ existing: quoteRow({ bidContentHash: await XLSX_HASH(), materials: stored }) });
    const quote = await service.receive('p-1', 'sat-1', receiveDto({ materials: MATERIALS }));
    expect(prisma.projectQuote.create).not.toHaveBeenCalled();
    expect(quote.id).toBe('q-1');
  });

  it('mesma revisão e mesma Bid com materiais diferentes → 409', async () => {
    const hash = await XLSX_HASH();
    const stored = [storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200'), storedMaterial('RED-CON-0007', 'Conector LC', 'un', '48')];
    const outraQuantidade = fixture({ existing: quoteRow({ bidContentHash: hash, materials: stored }) });
    await expect(outraQuantidade.service.receive('p-1', 'sat-1', receiveDto({ materials: [MATERIALS[0], { ...MATERIALS[1], quantity: '50.000' }] }))).rejects.toBeInstanceOf(ConflictException);
    const semMateriais = fixture({ existing: quoteRow({ bidContentHash: hash, materials: stored }) });
    await expect(semMateriais.service.receive('p-1', 'sat-1', receiveDto())).rejects.toBeInstanceOf(ConflictException);
    const aMais = fixture({ existing: quoteRow({ bidContentHash: hash, materials: [] }) });
    await expect(aMais.service.receive('p-1', 'sat-1', receiveDto({ materials: MATERIALS }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('cotação antiga sem materiais reenviada sem materiais continua idempotente', async () => {
    const { service } = fixture({ existing: quoteRow({ bidContentHash: await XLSX_HASH(), materials: [] }) });
    await expect(service.receive('p-1', 'sat-1', receiveDto())).resolves.toMatchObject({ id: 'q-1', materials: [] });
  });

  it('a visão da cotação traz os materiais com a quantidade em texto, sem preço ou custo', async () => {
    const { service, prisma } = fixture();
    prisma.projectQuote.findMany.mockResolvedValue([quoteRow({ materials: [storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200')] })]);
    const { quotes } = await service.list('p-1');
    expect(quotes[0].materials).toEqual([{ id: 'm-RED-CAB-0123', materialCode: 'RED-CAB-0123', logisticsMaterialId: null, description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' }]);
  });
});

describe('ProjectQuotesService.receive — cotação sem Bid (modelo generico)', () => {
  const semBid = () => {
    const dto = receiveDto({ materials: MATERIALS });
    delete (dto as Partial<ReceiveProjectQuoteDto>).bid;
    return dto;
  };
  /** Cotação já gravada sem Bid, igual à que semBid() manda. */
  const gravada = (over: Record<string, unknown> = {}) =>
    quoteRow({
      bidFilename: null,
      bidMimeType: null,
      bidSizeBytes: null,
      bidContentHash: null,
      sowDocumentId: 'sow-2',
      workDays: new Prisma.Decimal(10),
      plannedStartDate: new Date('2026-12-01T00:00:00Z'),
      plannedEndDate: new Date('2026-12-12T00:00:00Z'),
      team: normalizeTeam(semBid()).lines,
      materials: [storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200'), storedMaterial('RED-CON-0007', 'Conector LC', 'un', '48')],
      ...over,
    });

  it('aceita a cotação sem Bid e grava as cinco colunas da Bid nulas', async () => {
    const { service, prisma } = fixture();
    const quote = await service.receive('p-1', 'sat-1', semBid());
    const data = prisma.projectQuote.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ bidFilename: null, bidMimeType: null, bidSizeBytes: null, bidContentHash: null, bidContent: null });
    expect(data.materials.create).toHaveLength(2);
    expect(quote).toMatchObject({ bidFilename: null, bidContentHash: null });
  });

  it('repetida idêntica devolve a cotação gravada, sem criar outra', async () => {
    const { service, prisma } = fixture({ existing: gravada() });
    const quote = await service.receive('p-1', 'sat-1', semBid());
    expect(prisma.projectQuote.create).not.toHaveBeenCalled();
    expect(quote.id).toBe('q-1');
  });

  it('repetida com materiais diferentes → 409', async () => {
    const { service } = fixture({ existing: gravada() });
    const dto = semBid();
    dto.materials = [MATERIALS[0], { ...MATERIALS[1], quantity: '49.000' }];
    await expect(service.receive('p-1', 'sat-1', dto)).rejects.toBeInstanceOf(ConflictException);
  });

  it('repetida com equipe, dias, datas ou SOW diferentes → 409', async () => {
    const mudancas: Array<(d: ReceiveProjectQuoteDto) => void> = [
      (d) => { d.work_days = 11; },
      (d) => { d.planned_end_date = '2026-12-15'; },
      (d) => { d.team[0].people = 5; },
      (d) => { d.team = d.team.slice(0, 2); },
      (d) => { d.sow_document_id = undefined; },
      (d) => { d.revision_number = 2; },
    ];
    for (const mudar of mudancas) {
      const { service } = fixture({ existing: gravada() });
      const dto = semBid();
      mudar(dto);
      await expect(service.receive('p-1', 'sat-1', dto)).rejects.toBeInstanceOf(ConflictException);
    }
  });

  it('gravada com Bid e reenviada sem Bid (ou o contrário) → 409', async () => {
    const hash = await XLSX_HASH();
    const comBid = fixture({ existing: quoteRow({ bidContentHash: hash, materials: gravada().materials }) });
    await expect(comBid.service.receive('p-1', 'sat-1', semBid())).rejects.toBeInstanceOf(ConflictException);
    const semBidGravada = fixture({ existing: gravada() });
    await expect(semBidGravada.service.receive('p-1', 'sat-1', receiveDto({ materials: MATERIALS }))).rejects.toBeInstanceOf(ConflictException);
  });

  it('o DTO aceita a cotação sem o campo bid', async () => {
    const dto = plainToInstance(ReceiveProjectQuoteDtoClass, { external_revision_id: 'rev-1', revision_number: 1, work_days: 10, team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 1, days: 10, hours: 88 }] });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('download da Bid de cotação sem Bid → 404 em português; com Bid devolve o arquivo', async () => {
    const { service, prisma } = fixture();
    prisma.projectQuote.findFirst = vi.fn().mockResolvedValue({ bidFilename: null, bidMimeType: null, bidContent: null, bidContentHash: null });
    await expect(service.getBid('p-1', 'q-1')).rejects.toThrow('não tem Bid');
    await expect(service.getBid('p-1', 'q-1')).rejects.toBeInstanceOf(NotFoundException);
    prisma.projectQuote.findFirst = vi.fn().mockResolvedValue({ bidFilename: 'Bid.xlsx', bidMimeType: 'application/zip', bidContent: XLSX, bidContentHash: 'h' });
    await expect(service.getBid('p-1', 'q-1')).resolves.toMatchObject({ bidFilename: 'Bid.xlsx' });
    prisma.projectQuote.findFirst = vi.fn().mockResolvedValue(null);
    await expect(service.getBid('p-1', 'q-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('normalizeMaterials / sameMaterials', () => {
  it('ausente vira lista vazia; tira espaços e fixa 3 casas', () => {
    expect(normalizeMaterials(undefined)).toEqual([]);
    expect(normalizeMaterials([{ material_code: ' A-1 ', description: ' Cabo ', unit: ' m ', quantity: '5' }])).toEqual([{ material_code: 'A-1', description: 'Cabo', unit: 'm', quantity: '5.000' }]);
  });
  it('compara pelo conteúdo, não pela ordem', () => {
    const a = normalizeMaterials(MATERIALS);
    expect(sameMaterials([storedMaterial('RED-CON-0007', 'Conector LC', 'un', '48.000'), storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200')], a)).toBe(true);
    expect(sameMaterials([storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200')], a)).toBe(false);
    expect(sameMaterials([storedMaterial('RED-CAB-0123', 'Cabo óptico 12F', 'm', '1200.001'), storedMaterial('RED-CON-0007', 'Conector LC', 'un', '48')], a)).toBe(false);
  });
});

describe('ReceiveProjectQuoteDto — materials', () => {
  const body = (materials: unknown) => ({
    external_revision_id: 'rev-1',
    revision_number: 1,
    work_days: 10,
    team: [{ role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 1, days: 10, hours: 88 }],
    materials,
    bid: { filename: 'Bid.xlsx', content_base64: XLSX.toString('base64') },
  });
  const errors = (materials: unknown) => validate(plainToInstance(ReceiveProjectQuoteDtoClass, body(materials)), { whitelist: true, forbidNonWhitelisted: true });

  it('aceita o formato do contrato, com ou sem materials', async () => {
    expect(await errors(MATERIALS)).toEqual([]);
    expect(await errors(undefined)).toEqual([]);
  });
  it('recusa preço, custo e outros campos extras no material', async () => {
    expect((await errors([{ ...MATERIALS[0], unit_price: '9.90' }])).length).toBeGreaterThan(0);
    expect((await errors([{ ...MATERIALS[0], cost: '5.00' }])).length).toBeGreaterThan(0);
  });
  it('recusa quantidade numérica, com 4 casas ou negativa, e código inválido', async () => {
    expect((await errors([{ ...MATERIALS[0], quantity: 1200 }])).length).toBeGreaterThan(0);
    expect((await errors([{ ...MATERIALS[0], quantity: '1.0001' }])).length).toBeGreaterThan(0);
    expect((await errors([{ ...MATERIALS[0], quantity: '-1.000' }])).length).toBeGreaterThan(0);
    expect((await errors([{ ...MATERIALS[0], material_code: 'código com espaço' }])).length).toBeGreaterThan(0);
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
