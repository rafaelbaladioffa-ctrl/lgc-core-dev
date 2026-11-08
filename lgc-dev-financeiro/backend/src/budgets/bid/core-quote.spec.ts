import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import { BudgetsService } from '../budgets.service.js';
import { OutboxDispatcherService, PermanentDeliveryError } from '../../integration/outbox-dispatcher.service.js';
import { buildCoreQuoteBody, buildCoreQuoteMaterials, CORE_QUOTE_EVENT, quoteMaterialsBlocker } from './core-quote.js';

/** Devolução ao Core (PJ7): corpo do contrato, entrega pelo outbox e trava da aprovação. */

const SRC = {
  revisionId: 'r2',
  revisionNumber: 2,
  approvedAt: new Date('2030-01-15T13:00:00Z'),
  approvedByEmail: 'gestor@lgc.test',
  sowDocumentId: 'doc-sow',
  schedule: { start: '2030-02-01', end: '2030-02-08' },
  result: {
    workDays: 6,
    labor: [
      { roleKey: 'tecnico', label: 'Técnico', fieldRole: true, people: 3, hours: '144.00' },
      { roleKey: 'encarregado', label: 'Encarregado', fieldRole: true, people: 0, hours: '0.00' },
      { roleKey: 'gerente_projeto', label: 'Gerente', fieldRole: false, people: null, hours: '12.5' },
    ],
    materials: [{ description: 'Cabo óptico 12F', unit: 'm', quantity: '1200', logisticsMaterialCode: 'RED-CAB-0123' }],
  },
};

describe('buildCoreQuoteBody', () => {
  it('equipe por função (quantidade, nunca nomes), dias, datas e quem aprovou; nada de custo', () => {
    expect(buildCoreQuoteBody(SRC)).toEqual({
      external_revision_id: 'r2',
      revision_number: 2,
      sow_document_id: 'doc-sow',
      work_days: 6,
      planned_start_date: '2030-02-01',
      planned_end_date: '2030-02-08',
      team: [
        { role_key: 'tecnico', role_name: 'Técnico', field_role: true, people: 3, days: 6, hours: 144 },
        { role_key: 'gerente_projeto', role_name: 'Gerente', field_role: false, hours: 12.5 },
      ],
      materials: [{ material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' }],
      approved_at: '2030-01-15T13:00:00.000Z',
      approved_by_email: 'gestor@lgc.test',
    });
  });

  it('sem dias ou sem equipe não monta', () => {
    expect(() => buildCoreQuoteBody({ ...SRC, result: { ...SRC.result, workDays: 0 } })).toThrow('dias de trabalho');
    expect(() => buildCoreQuoteBody({ ...SRC, result: { workDays: 6, labor: [], materials: [] } })).toThrow('equipe');
  });
});

describe('buildCoreQuoteMaterials', () => {
  const line = (over: Partial<Parameters<typeof buildCoreQuoteMaterials>[0][number]> = {}) => ({ description: 'Cabo', unit: 'm', quantity: '10', logisticsMaterialCode: 'A-1', ...over });

  it('quantidade como texto decimal com 3 casas e nada de preço ou custo', () => {
    const { materials, problems } = buildCoreQuoteMaterials([{ ...line({ quantity: '1200.5' }), billedUnitPrice: '9.99', realUnitCost: '5', cost: '100' } as never]);
    expect(problems).toEqual([]);
    expect(materials).toEqual([{ material_code: 'A-1', description: 'Cabo', unit: 'm', quantity: '1200.500' }]);
  });

  it('arredonda para 3 casas; quantidade zerada não vai ao site nem exige código', () => {
    const { materials, problems } = buildCoreQuoteMaterials([line({ quantity: '2.00049' }), line({ description: 'Sem uso', quantity: '0', logisticsMaterialCode: null }), line({ description: 'Quase zero', quantity: '0.0004', logisticsMaterialCode: null })]);
    expect(problems).toEqual([]);
    expect(materials).toEqual([{ material_code: 'A-1', description: 'Cabo', unit: 'm', quantity: '2.000' }]);
  });

  it('mesmo código em duas linhas vira uma, com a quantidade somada', () => {
    const { materials } = buildCoreQuoteMaterials([line({ quantity: '10.5' }), line({ description: 'Cabo (reserva)', quantity: '4.25' })]);
    expect(materials).toEqual([{ material_code: 'A-1', description: 'Cabo', unit: 'm', quantity: '14.750' }]);
  });

  it('mesmo código com unidades diferentes é problema', () => {
    const { problems } = buildCoreQuoteMaterials([line(), line({ unit: 'un' })]);
    expect(problems[0]).toContain('unidades diferentes');
  });

  it('material com quantidade e sem código aponta o item pelo nome', () => {
    const { problems } = buildCoreQuoteMaterials([line({ description: 'Conector LC', logisticsMaterialCode: null }), line({ description: 'Patch cord', logisticsMaterialCode: '  ' })]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('"Conector LC"');
    expect(quoteMaterialsBlocker([line({ description: 'Conector LC', logisticsMaterialCode: null })])).toContain('Conector LC');
    expect(quoteMaterialsBlocker([line()])).toBeNull();
  });

  it('a devolução não monta com material sem código', () => {
    expect(() => buildCoreQuoteBody({ ...SRC, result: { ...SRC.result, materials: [line({ logisticsMaterialCode: null })] } })).toThrow('código da Logística');
  });
});

describe('OutboxDispatcherService — cotação para o Core', () => {
  const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
  const tx = { revisionBidOutput: { findUnique: vi.fn().mockResolvedValue({ filename: 'Bid.xlsm', content: Buffer.from('PK fictício') }) } };
  const message = { axis_project_id: 'p1', revision_id: 'r2', quote: { external_revision_id: 'r2', work_days: 6 } };

  it('envia para a rota de cotações com a API key e a Bid em base64', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const d = new OutboxDispatcherService({} as PrismaService, config({ AXIS_API_URL: 'http://core.test/api/v1', AXIS_API_KEY: 'k' }));
    await d.deliverQuote(tx as never, message, fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://core.test/api/v1/integration/projects/p1/quotes');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' });
    expect(JSON.parse(init.body as string)).toEqual({ external_revision_id: 'r2', work_days: 6, bid: { filename: 'Bid.xlsm', content_base64: Buffer.from('PK fictício').toString('base64') } });
  });

  it('modelo generico (has_bid false) vai sem Bid e sem consultar a Bid guardada', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 201 }));
    const empty = { revisionBidOutput: { findUnique: vi.fn() } };
    const d = new OutboxDispatcherService({} as PrismaService, config({ AXIS_API_URL: 'http://core.test/api/v1', AXIS_API_KEY: 'k' }));
    await d.deliverQuote(empty as never, { ...message, has_bid: false }, fetchFn as unknown as typeof fetch);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ external_revision_id: 'r2', work_days: 6 });
    expect(empty.revisionBidOutput.findUnique).not.toHaveBeenCalled();
  });

  it('mensagem com Bid esperada e sem Bid guardada vai para a dead-letter', async () => {
    const d = new OutboxDispatcherService({} as PrismaService, config({ AXIS_API_KEY: 'k' }));
    const none = { revisionBidOutput: { findUnique: vi.fn().mockResolvedValue(null) } };
    await expect(d.deliverQuote(none as never, message, vi.fn() as unknown as typeof fetch)).rejects.toBeInstanceOf(PermanentDeliveryError);
  });

  it('409/400 são definitivos; 503 tenta de novo', async () => {
    const d = new OutboxDispatcherService({} as PrismaService, config({ AXIS_API_KEY: 'k' }));
    await expect(d.deliverQuote(tx as never, message, (async () => new Response('conflito', { status: 409 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(PermanentDeliveryError);
    await expect(d.deliverQuote(tx as never, message, (async () => new Response('', { status: 400 })) as unknown as typeof fetch)).rejects.toBeInstanceOf(PermanentDeliveryError);
    const retry = d.deliverQuote(tx as never, message, (async () => new Response('', { status: 503 })) as unknown as typeof fetch);
    await expect(retry).rejects.toThrow('HTTP 503');
    await expect(retry).rejects.not.toBeInstanceOf(PermanentDeliveryError);
  });

  it('sem API key a cotação fica pendente, sem contar tentativa', async () => {
    const update = vi.fn();
    const inner = {
      $queryRaw: vi.fn().mockResolvedValue([{ ok: true }]),
      integrationMessage: { findMany: vi.fn().mockResolvedValue([{ id: 'm1', eventType: CORE_QUOTE_EVENT, attempts: 0, payload: message }]), update },
    };
    const prisma = { $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(inner)) } as unknown as PrismaService;
    const out = await new OutboxDispatcherService(prisma, config({ AXIS_EVENTS_URL: 'http://core.test/events' })).dispatchOnce();
    expect(out).toMatchObject({ enabled: true, delivered: 0, retried: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Aprovar envio aws_sow só pela geração da Bid', () => {
  it('a transição direta é recusada', async () => {
    const tx = {
      budgetRevision: { findUnique: vi.fn().mockResolvedValue({ id: 'r2', number: 2, status: 'em_aprovacao', budgetId: 'b1', budget: { model: 'aws_sow', projectCode: 'P' }, parameterSet: { roles: [] } }) },
    };
    const prisma = { ...tx, $transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
    const user: AuthenticatedUser = { userId: 'g', email: 'g@lgc.test', axisRoles: [], collaboratorId: null, mustChangePassword: false, permissions: ['budget:approve'] };
    await expect(new BudgetsService(prisma, { record: vi.fn() } as unknown as AuditService).transition('r2', 'approve_send', user)).rejects.toBeInstanceOf(ConflictException);
  });
});
