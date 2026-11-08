import { createHash } from 'crypto';
import { BadGatewayException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import type { BudgetsService } from '../budgets.service.js';
import { CoreDocumentsClient } from './core-documents.client.js';
import { normalizeCables, quoteRequestStatus, SowService } from './sow.service.js';

vi.mock('./pdf-text.js', () => ({
  extractPdfText: vi.fn(async () => ({
    pages: 2,
    text: ['=== página 1 ===', 'FBN: XX00TEST0001', 'SOW UID: SOW-00001', 'Connections & Cable Types:', '--- 2x 2F LC-LC (30m) from A to B', 'AWS STANDARD GUIDELINES'].join('\n'),
  })),
}));

vi.mock('../bid/bid-template-reader.js', () => ({
  readBidTargets: vi.fn(async () => ({ templateVersion: '9.1', cluster: 'TST', currency: 'BRL', fx: 5, targets: {}, converted: {}, weights: {}, thresholds: {}, warnings: [] })),
}));

/** Fila de pedidos do Core e SOW da revisão (PJ4). Prisma simulado; valores fictícios. */

const ORC: AuthenticatedUser = { userId: 'orc', email: 'orc@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget:read', 'budget:write'] };
const REQUEST = {
  id: 'q1',
  axisQuoteRequestId: 'core-q1',
  axisProjectId: 'p1',
  projectCode: 'PROP-100.001-1126',
  sowDocumentId: 'doc-sow',
  sowVersion: 2,
  sowContentHash: 'hash-sow',
  bidTemplateDocumentId: 'doc-bt',
  bidTemplateVersion: 1,
  bidTemplateFilename: 'Bid Template.xlsm',
  bidTemplateContentHash: 'hash-bt',
  requestedAt: new Date('2030-01-10T12:00:00Z'),
  startedAt: null,
  budgetId: null,
};

function fixture({ revisionStatus = 'rascunho', budget = null as unknown, request = REQUEST as unknown, sowRow = null as unknown } = {}) {
  const tx = {
    quoteRequest: { findUnique: vi.fn().mockResolvedValue(request), findFirst: vi.fn().mockResolvedValue(request), update: vi.fn().mockResolvedValue({}) },
    projectBudget: { findUnique: vi.fn().mockResolvedValue(budget) },
    budgetRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', number: 1, status: revisionStatus, budget: { axisProjectId: 'p1' } }) },
    revisionBidTemplate: { upsert: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(null) },
    budgetRevisionSow: {
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(sowRow),
    },
  };
  const prisma = { ...tx, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
  const audit = { record: vi.fn().mockResolvedValue({}) } as unknown as AuditService;
  const budgets = {
    createBudget: vi.fn().mockResolvedValue({ budgetId: 'b-new', revisionId: 'r-new' }),
    newRevision: vi.fn().mockResolvedValue({ revisionId: 'r-next' }),
  } as unknown as BudgetsService & { createBudget: ReturnType<typeof vi.fn>; newRevision: ReturnType<typeof vi.fn> };
  const core = { download: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fictício')) } as unknown as CoreDocumentsClient & { download: ReturnType<typeof vi.fn> };
  return { service: new SowService(prisma, audit, budgets, core), tx, budgets, core, audit };
}

describe('SowService.startQuote', () => {
  it('primeiro pedido cria o orçamento aws_sow, liga o pedido e importa a SOW do Core', async () => {
    const { service, tx, budgets, core } = fixture();
    const out = await service.startQuote('q1', ORC);
    expect(budgets.createBudget).toHaveBeenCalledWith({ axisProjectId: 'p1' }, ORC, 'aws_sow');
    expect(tx.quoteRequest.update).toHaveBeenCalledWith({ where: { id: 'q1' }, data: expect.objectContaining({ budgetId: 'b-new', startedBy: 'orc' }) });
    expect(core.download).toHaveBeenCalledWith('p1', 'doc-sow', 'hash-sow');
    expect(core.download).toHaveBeenCalledWith('p1', 'doc-bt', 'hash-bt');
    expect(out).toEqual({ revisionId: 'r-new', sowImported: true, sowError: null, bidTemplateImported: true, bidTemplateError: null });
  });

  it('orçamento existente: usa o rascunho; sem rascunho, cria nova revisão', async () => {
    const withDraft = fixture({ budget: { id: 'b1', revisions: [{ id: 'r1', status: 'rascunho' }] } });
    expect((await withDraft.service.startQuote('q1', ORC)).revisionId).toBe('r1');
    expect(withDraft.budgets.newRevision).not.toHaveBeenCalled();

    const sent = fixture({ budget: { id: 'b1', revisions: [{ id: 'r1', status: 'enviada' }] } });
    expect((await sent.service.startQuote('q1', ORC)).revisionId).toBe('r-next');
  });

  it('continuar num rascunho que já tem os documentos deste pedido não reimporta (preserva correções)', async () => {
    const { service, tx, core } = fixture({ budget: { id: 'b1', revisions: [{ id: 'r1', status: 'rascunho' }] }, sowRow: { quoteRequestId: 'q1' } });
    Object.assign(tx.revisionBidTemplate, { findUnique: vi.fn().mockResolvedValue({ quoteRequestId: 'q1' }) });
    const out = await service.startQuote('q1', ORC);
    expect(out).toMatchObject({ revisionId: 'r1', sowImported: true, bidTemplateImported: true });
    expect(core.download).not.toHaveBeenCalled();
  });

  it('falha no download não perde o rascunho: devolve o erro para a tela', async () => {
    const { service, core } = fixture();
    core.download.mockRejectedValue(new ServiceUnavailableException('Não foi possível falar com o Axis Core.'));
    expect(await service.startQuote('q1', ORC)).toEqual({
      revisionId: 'r-new',
      sowImported: false,
      sowError: 'Não foi possível falar com o Axis Core.',
      bidTemplateImported: false,
      bidTemplateError: 'Não foi possível falar com o Axis Core.',
    });
  });
});

describe('SowService — SOW da revisão', () => {
  it('importa do Core guardando texto, o que foi lido e a versão da SOW', async () => {
    const { service, tx } = fixture();
    await service.importFromCore('r1', { quoteRequestId: 'q1' }, ORC);
    const data = tx.budgetRevisionSow.upsert.mock.calls[0][0].create;
    expect(data).toMatchObject({ revisionId: 'r1', source: 'core_pdf', quoteRequestId: 'q1', sowDocumentId: 'doc-sow', sowVersion: 2, pages: 2, importedBy: 'orc' });
    expect(data.header).toMatchObject({ fbn: 'XX00TEST0001', sowUid: 'SOW-00001' });
    expect(data.cables).toEqual([{ type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 30, quantity: 2 }]);
    expect(data.parsedCables).toEqual(data.cables);
  });

  it('texto colado também serve', async () => {
    const { service, tx } = fixture();
    await service.importText('r1', 'FBN: XX\nConnections & Cable Types:\n--- 1x 36F LC-LC (20m) from A to B', ORC);
    expect(tx.budgetRevisionSow.upsert.mock.calls[0][0].create).toMatchObject({ source: 'texto', sowVersion: null });
  });

  it('pedido de outro projeto é recusado', async () => {
    const { service } = fixture({ request: { ...REQUEST, axisProjectId: 'outro' } });
    await expect(service.importFromCore('r1', { quoteRequestId: 'q1' }, ORC)).rejects.toThrow('outro projeto');
  });

  it('revisão fora de rascunho não muda a SOW', async () => {
    const { service } = fixture({ revisionStatus: 'enviada' });
    await expect(service.importText('r1', 'x', ORC)).rejects.toBeInstanceOf(ConflictException);
  });

  it('corrigir cabos normaliza, soma e registra antes/depois', async () => {
    const { service, tx, audit } = fixture({ sowRow: { cables: [{ type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 30, quantity: 2 }] } });
    await service.updateCables(
      'r1',
      [
        { type: '2f lc-lc', lengthM: 30, quantity: 2 },
        { type: '2F LC-LC', lengthM: 30, quantity: 1 },
        { type: '8F MPO-4LC', lengthM: 25, quantity: 4 },
      ],
      ORC,
    );
    expect(tx.budgetRevisionSow.update.mock.calls[0][0].data.cables).toEqual([
      { type: '2F LC-LC', kind: 'fibra', fibers: 2, lengthM: 30, quantity: 3 },
      { type: '8F 4LC-MPO', kind: 'fibra', fibers: 8, lengthM: 25, quantity: 4 },
    ]);
    expect((audit.record as ReturnType<typeof vi.fn>).mock.calls[0][4]).toMatchObject({ before: { cables: 2, ports: 2 }, after: { cables: 7, ports: 19 } });
  });
});

describe('SowService — Bid Template, horas T e justificativas (PJ4 parte 2)', () => {
  it('importa o Bid Template do pedido, guarda o arquivo e as metas lidas', async () => {
    const { service, tx, core } = fixture();
    const out = await service.importBidTemplate('r1', { quoteRequestId: 'q1' }, ORC);
    expect(core.download).toHaveBeenCalledWith('p1', 'doc-bt', 'hash-bt');
    expect(tx.revisionBidTemplate.upsert.mock.calls[0][0].create).toMatchObject({ revisionId: 'r1', quoteRequestId: 'q1', documentId: 'doc-bt', version: 1, contentHash: 'hash-bt', importedBy: 'orc' });
    expect(out.targets).toMatchObject({ cluster: 'TST', currency: 'BRL' });
  });

  it('pedido sem Bid Template explica o que fazer', async () => {
    const { service } = fixture({ request: { ...REQUEST, bidTemplateDocumentId: null, bidTemplateContentHash: null, bidTemplateVersion: null } });
    await expect(service.importBidTemplate('r1', {}, ORC)).rejects.toThrow('não trouxe o Bid Template');
  });

  it('horas T: grava número, apaga com null e recusa tipo fora da SOW', async () => {
    const { service, tx } = fixture({ sowRow: { cables: [{ type: '2F LC-LC' }, { type: 'Cat6 green' }], fieldHoursOverrides: { 'Cat6 green': 5 } } });
    await service.updateHours('r1', { '2F LC-LC': 70.555, 'Cat6 green': null }, ORC);
    expect(tx.budgetRevisionSow.update.mock.calls[0][0].data.fieldHoursOverrides).toEqual({ '2F LC-LC': 70.56 });
    await expect(service.updateHours('r1', { 'Coax': 1 }, ORC)).rejects.toThrow('não está na SOW');
    await expect(service.updateHours('r1', { '2F LC-LC': -1 }, ORC)).rejects.toThrow('Horas inválidas');
  });

  it('justificativas: grava, apaga vazio e recusa indicador desconhecido', async () => {
    const { service, tx } = fixture({ sowRow: { kpiJustifications: { efficiency: 'old' } } });
    await service.updateJustifications('r1', { efficiency: '  ', hoursPerMeter: 'Long cable runs between rooms' }, ORC);
    expect(tx.budgetRevisionSow.update.mock.calls[0][0].data.kpiJustifications).toEqual({ hoursPerMeter: 'Long cable runs between rooms' });
    await expect(service.updateJustifications('r1', { foo: 'x' }, ORC)).rejects.toThrow('Indicador desconhecido');
  });
});

describe('regras da fila e dos cabos', () => {
  it('situação do pedido', () => {
    const at = new Date('2030-01-10T12:00:00Z');
    expect(quoteRequestStatus({ budgetId: null, requestedAt: at }, [])).toBe('pendente');
    expect(quoteRequestStatus({ budgetId: 'b1', requestedAt: at }, [null, new Date('2030-01-01')])).toBe('em_cotacao');
    expect(quoteRequestStatus({ budgetId: 'b1', requestedAt: at }, [new Date('2030-01-11')])).toBe('respondida');
  });

  it('tipo não reconhecido mantém as fibras informadas', () => {
    expect(normalizeCables([{ type: 'Trunk especial', lengthM: 10, quantity: 1, fibers: 24 }])).toEqual([{ type: 'Trunk especial', kind: 'outro', fibers: 24, lengthM: 10, quantity: 1 }]);
  });
});

describe('CoreDocumentsClient', () => {
  const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
  const body = Buffer.from('%PDF-1.4 conteúdo fictício');
  const sha = createHash('sha256').update(body).digest('hex');
  const ok = vi.fn(async () => new Response(body, { status: 200 }));

  it('baixa com a API key e confere o hash', async () => {
    const client = new CoreDocumentsClient(config({ AXIS_API_URL: 'http://core.test/api/v1/', AXIS_API_KEY: 'k' }));
    expect(await client.download('p1', 'd1', sha, ok as unknown as typeof fetch)).toEqual(body);
    expect(ok).toHaveBeenCalledWith('http://core.test/api/v1/integration/projects/p1/documents/d1/content', expect.objectContaining({ headers: { Authorization: 'Bearer k' } }));
  });

  it('hash diferente, 403 e falta de API key viram mensagens claras', async () => {
    const client = new CoreDocumentsClient(config({ AXIS_API_KEY: 'k' }));
    await expect(client.download('p1', 'd1', 'outro-hash', ok as unknown as typeof fetch)).rejects.toThrow('não confere');
    const forbidden = vi.fn(async () => new Response('', { status: 403 }));
    await expect(client.download('p1', 'd1', sha, forbidden as unknown as typeof fetch)).rejects.toBeInstanceOf(BadGatewayException);
    await expect(new CoreDocumentsClient(config({})).download('p1', 'd1', sha, ok as unknown as typeof fetch)).rejects.toThrow('AXIS_API_KEY');
  });
});

describe('SowService.applySuggestedTeam', () => {
  function teamFixture(inputs: Record<string, unknown>, suggestedTeam: unknown = { foremen: 1, technicians: 3, days: 6 }) {
    const rev = {
      id: 'r1',
      number: 1,
      status: 'rascunho',
      inputs,
      budget: { axisProjectId: 'p1' },
      parameterSet: { roles: [{ roleKey: 'tecnico' }, { roleKey: 'encarregado' }, { roleKey: 'gerente_projeto' }] },
    };
    const budgets = {
      loadRevisionFull: vi.fn().mockResolvedValue(rev),
      projectInfoOrNull: vi.fn().mockResolvedValue(null),
      awsInfo: vi.fn().mockReturnValue({ quote: { suggestedTeam } }),
      holidays: vi.fn().mockResolvedValue(null),
      updateRevision: vi.fn().mockResolvedValue({}),
    };
    const audit = { record: vi.fn().mockResolvedValue({}) };
    const service = new SowService({} as PrismaService, audit as unknown as AuditService, budgets as unknown as BudgetsService, {} as CoreDocumentsClient);
    return { service, budgets };
  }
  const empty = { workDays: 0, team: [{ roleKey: 'tecnico', people: 0 }, { roleKey: 'encarregado', people: 0 }, { roleKey: 'gerente_projeto', hours: '0' }], materials: [] };

  it('revisão vazia recebe 1 encarregado + técnicos × dias das horas-meta', async () => {
    const { service, budgets } = teamFixture(empty);
    await service.applySuggestedTeam('r1', ORC, { onlyIfEmpty: true });
    expect(budgets.updateRevision).toHaveBeenCalledWith('r1', { inputs: expect.objectContaining({ workDays: 6, team: [{ roleKey: 'tecnico', people: 3 }, { roleKey: 'encarregado', people: 1 }, { roleKey: 'gerente_projeto', hours: '0' }] }) }, ORC);
  });

  it('no automático não mexe em equipe já preenchida; o botão recalcula', async () => {
    const filled = { ...empty, workDays: 4, team: [{ roleKey: 'tecnico', people: 2 }, { roleKey: 'encarregado', people: 1 }] };
    const auto = teamFixture(filled);
    await auto.service.applySuggestedTeam('r1', ORC, { onlyIfEmpty: true });
    expect(auto.budgets.updateRevision).not.toHaveBeenCalled();
    const manual = teamFixture(filled);
    await manual.service.applySuggestedTeam('r1', ORC, { onlyIfEmpty: false });
    expect(manual.budgets.updateRevision.mock.calls[0][1].inputs).toMatchObject({ workDays: 6, team: [{ roleKey: 'tecnico', people: 3 }, { roleKey: 'encarregado', people: 1 }] });
  });

  it('sem SOW e Bid Template não há como calcular', async () => {
    const { service } = teamFixture(empty, null);
    await expect(service.applySuggestedTeam('r1', ORC, { onlyIfEmpty: false })).rejects.toThrow('Importe a SOW e o Bid Template');
  });
});
