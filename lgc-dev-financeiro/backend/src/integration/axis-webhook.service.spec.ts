import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { AxisWebhookService, toMasterRecord, toQuoteRequest, type Envelope } from './axis-webhook.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';

const SECRET = 'segredo-webhook-de-teste';
const EVENT_ID = '7f3c2a10-1b2c-4d5e-8f90-0123456789ab';
const NOW = Date.parse('2026-11-07T12:00:00Z');

const config = (values: Record<string, unknown>) => ({ get: (k: string) => values[k] }) as unknown as ConfigService;
const sign = (body: Buffer) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
const envelope = (over: Partial<Envelope> = {}): Envelope => ({ event_id: EVENT_ID, event_type: 'project.created', occurred_at: '2026-11-07T11:59:00Z', payload: { project_id: 'p1', code: 'PROP-1', status: 'aprovado' }, ...over });
const raw = (e: unknown) => Buffer.from(JSON.stringify(e));

function prismaMock() {
  const tx = { axisMasterCache: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) }, quoteRequest: { upsert: vi.fn().mockResolvedValue({}) } };
  const prisma = {
    integrationMessage: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 'm1' }), update: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma, tx };
}

describe('AxisWebhookService — assinatura e envelope', () => {
  const service = new AxisWebhookService({} as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));

  it('aceita a assinatura HMAC correta do corpo bruto', () => {
    const body = raw(envelope());
    expect(() => service.verifySignature(body, sign(body))).not.toThrow();
  });

  it('recusa assinatura ausente, malformada ou de outro corpo', () => {
    const body = raw(envelope());
    expect(() => service.verifySignature(body, undefined)).toThrow(UnauthorizedException);
    expect(() => service.verifySignature(body, 'abc')).toThrow(UnauthorizedException);
    expect(() => service.verifySignature(body, sign(raw({ outro: true })))).toThrow(UnauthorizedException);
  });

  it('sem segredo configurado responde 503', () => {
    const semSegredo = new AxisWebhookService({} as PrismaService, config({}));
    expect(() => semSegredo.verifySignature(Buffer.from('{}'), 'sha256=00')).toThrow(ServiceUnavailableException);
  });

  it('recusa envelope inválido, evento velho (replay) e evento no futuro', () => {
    expect(() => service.parse(Buffer.from('não é json'), NOW)).toThrow('Corpo do evento não é um JSON válido.');
    expect(() => service.parse(raw(envelope({ event_id: '123' })), NOW)).toThrow('event_id ausente ou inválido.');
    expect(() => service.parse(raw(envelope({ payload: [] as never })), NOW)).toThrow('payload ausente ou inválido.');
    expect(() => service.parse(raw(envelope({ occurred_at: '2026-11-01T00:00:00Z' })), NOW)).toThrow(BadRequestException);
    expect(() => service.parse(raw(envelope({ occurred_at: '2026-11-07T13:00:00Z' })), NOW)).toThrow('occurred_at no futuro.');
  });

  it('janela configurada inválida volta ao padrão de 72 h', () => {
    const s = new AxisWebhookService({} as PrismaService, config({ WEBHOOK_MAX_AGE_HOURS: 'abc' }));
    expect(s.parse(raw(envelope({ occurred_at: '2026-11-05T12:00:00Z' })), NOW).event_id).toBe(EVENT_ID);
    expect(() => s.parse(raw(envelope({ occurred_at: '2026-11-03T12:00:00Z' })), NOW)).toThrow(BadRequestException);
  });
});

describe('toMasterRecord', () => {
  it('mapeia os mestres emitidos pelo Core', () => {
    expect(toMasterRecord(envelope())).toMatchObject({ kind: 'PROJECT', axisId: 'p1', code: 'PROP-1', active: true });
    expect(toMasterRecord(envelope({ event_type: 'project.status_changed', payload: { project_id: 'p1', status: 'encerrado' } }))).toMatchObject({ active: false });
    expect(toMasterRecord(envelope({ event_type: 'collaborator.offboarded', payload: { collaborator_id: 'c1' } }))).toMatchObject({ kind: 'COLLABORATOR', active: false });
    expect(toMasterRecord(envelope({ event_type: 'collaborator.updated', payload: { collaborator_id: 'c1', name: 'Ana' } }))?.active).toBeUndefined();
    expect(toMasterRecord(envelope({ event_type: 'user.disabled', payload: { user_id: 'u1' } }))).toMatchObject({ kind: 'USER', active: false });
    expect(toMasterRecord(envelope({ event_type: 'client.created', payload: { client_id: 'k1', code: 12 } }))).toMatchObject({ kind: 'CLIENT', code: '12' });
  });

  // Contrato do Core (cadastros §4 e §10): todo project.* leva o estado completo do projeto.
  const projectState = {
    project_id: 'p1',
    code: 'PROP-100.001-1126',
    name: 'Projeto Exemplo',
    status: 'aprovado',
    client_id: 'k1',
    cost_center_id: 'cc1',
    cost_center_code: '110',
    cost_center_name: 'Centro Exemplo',
    responsible_collaborator_id: 'c1',
    planned_start_date: '2026-12-01',
    planned_end_date: '2027-01-15',
  };

  it('project.updated traz nome, centro de custo e datas previstas', () => {
    const m = toMasterRecord(envelope({ event_type: 'project.updated', payload: { ...projectState, changed_fields: ['name', 'planned_end_date'] } }));
    expect(m).toMatchObject({ kind: 'PROJECT', axisId: 'p1', code: 'PROP-100.001-1126', name: 'Projeto Exemplo', active: true });
    expect(m?.data).toMatchObject({ cost_center_id: 'cc1', cost_center_name: 'Centro Exemplo', planned_start_date: '2026-12-01', planned_end_date: '2027-01-15' });
  });

  it('project.deleted (status encerrado e deleted: true) marca o projeto inativo', () => {
    const m = toMasterRecord(envelope({ event_type: 'project.deleted', payload: { ...projectState, status: 'encerrado', deleted: true } }));
    expect(m).toMatchObject({ kind: 'PROJECT', axisId: 'p1', name: 'Projeto Exemplo', active: false });
    expect(m?.data).toMatchObject({ deleted: true });
  });

  it('projeto antigo sem nome não apaga o nome guardado', () => {
    expect(toMasterRecord(envelope({ event_type: 'project.status_changed', payload: { ...projectState, name: null, previous_status: 'proposta' } }))?.name).toBeUndefined();
  });

  it('cost_center.created/updated, com active false na exclusão', () => {
    const cc = { cost_center_id: 'cc1', code: '110', name: 'Centro Exemplo', sector_id: 's1', parent_cost_center_id: null, responsible_collaborator_id: null, active: true };
    expect(toMasterRecord(envelope({ event_type: 'cost_center.created', payload: cc }))).toMatchObject({ kind: 'COST_CENTER', axisId: 'cc1', code: '110', name: 'Centro Exemplo', active: true });
    expect(toMasterRecord(envelope({ event_type: 'cost_center.updated', payload: { ...cc, active: false } }))).toMatchObject({ kind: 'COST_CENTER', active: false });
  });

  it('ignora eventos que não são mestres', () => {
    expect(toMasterRecord(envelope({ event_type: 'request.completed', payload: { request_id: 'r1' } }))).toBeNull();
  });

  it('exige o identificador do mestre', () => {
    expect(() => toMasterRecord(envelope({ payload: { code: 'x' } }))).toThrow('project_id ausente.');
  });
});

describe('AxisWebhookService.receive', () => {
  const fresh = () => envelope({ occurred_at: new Date(Date.now() - 60_000).toISOString() });

  it('processa o evento e grava o cache', async () => {
    const { prisma, tx } = prismaMock();
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(fresh());
    await expect(service.receive(body, sign(body))).resolves.toEqual({ status: 'processed', event_id: EVENT_ID });
    expect(tx.axisMasterCache.upsert).toHaveBeenCalledOnce();
    expect(prisma.integrationMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }));
  });

  it('project.deleted grava o projeto inativo e mantém o nome já guardado quando vier sem nome', async () => {
    const { prisma, tx } = prismaMock();
    tx.axisMasterCache.findUnique.mockResolvedValue({ sourceOccurredAt: new Date(Date.now() - 3_600_000), code: 'PROP-1', name: 'Projeto Exemplo', active: true, data: { project_id: 'p1', status: 'proposta' } });
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(envelope({ event_type: 'project.deleted', occurred_at: new Date(Date.now() - 60_000).toISOString(), payload: { project_id: 'p1', code: 'PROP-1', name: null, status: 'encerrado', deleted: true } }));
    await expect(service.receive(body, sign(body))).resolves.toEqual({ status: 'processed', event_id: EVENT_ID });
    const { update } = tx.axisMasterCache.upsert.mock.calls[0][0];
    expect(update).toMatchObject({ name: 'Projeto Exemplo', active: false, data: { status: 'encerrado', deleted: true } });
  });

  it('evento repetido não é reprocessado', async () => {
    const { prisma, tx } = prismaMock();
    prisma.integrationMessage.findUnique.mockResolvedValue({ id: 'm1', status: 'PROCESSED' });
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(fresh());
    await expect(service.receive(body, sign(body))).resolves.toEqual({ status: 'duplicate', event_id: EVENT_ID });
    expect(tx.axisMasterCache.upsert).not.toHaveBeenCalled();
  });

  it('evento fora de ordem não sobrescreve versão mais nova', async () => {
    const { prisma, tx } = prismaMock();
    tx.axisMasterCache.findUnique.mockResolvedValue({ sourceOccurredAt: new Date(Date.now() + 1000), data: {} });
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(fresh());
    await service.receive(body, sign(body));
    expect(tx.axisMasterCache.upsert).not.toHaveBeenCalled();
    expect(prisma.integrationMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastError: 'out_of_order' }) }));
  });

  it('falha de processamento marca FAILED e devolve erro para o Core reentregar', async () => {
    const { prisma } = prismaMock();
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(envelope({ occurred_at: new Date().toISOString(), payload: { code: 'sem id' } }));
    await expect(service.receive(body, sign(body))).rejects.toThrow('project_id ausente.');
    expect(prisma.integrationMessage.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
  });
});

describe('Pedido de cotação do Core (PJ4)', () => {
  const quotePayload = {
    project_id: 'p1',
    code: 'PROP-100.001-1126',
    name: 'Projeto Exemplo',
    status: 'proposta',
    client_id: 'k1',
    quote_request_id: 'core-q1',
    sow_document_id: 'doc-sow',
    sow_version: 2,
    sow_filename: 'SOW.pdf',
    sow_content_hash: 'abc',
    bid_template_document_id: 'doc-bt',
    bid_template_version: 1,
    bid_template_filename: 'Bid.xlsm',
    bid_template_content_hash: 'def',
    notes: 'Proposta até sexta',
    requested_by_email: 'comercial@lgc.test',
    requested_at: '2026-11-07T11:58:00.000Z',
  };

  it('converte o evento na linha da fila', () => {
    expect(toQuoteRequest(envelope({ event_type: 'project.quote_requested', payload: quotePayload }))).toMatchObject({
      axisQuoteRequestId: 'core-q1',
      axisProjectId: 'p1',
      projectCode: 'PROP-100.001-1126',
      sowDocumentId: 'doc-sow',
      sowVersion: 2,
      sowContentHash: 'abc',
      bidTemplateDocumentId: 'doc-bt',
      bidTemplateVersion: 1,
      notes: 'Proposta até sexta',
      requestedAt: new Date('2026-11-07T11:58:00.000Z'),
      eventId: EVENT_ID,
    });
    expect(() => toQuoteRequest(envelope({ event_type: 'project.quote_requested', payload: { ...quotePayload, sow_document_id: '' } }))).toThrow('sow_document_id ausente');
  });

  it('põe na fila e atualiza o projeto no cache só com o estado do projeto', async () => {
    const { prisma, tx } = prismaMock();
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(envelope({ event_type: 'project.quote_requested', occurred_at: new Date(Date.now() - 60_000).toISOString(), payload: quotePayload }));
    await expect(service.receive(body, sign(body))).resolves.toEqual({ status: 'processed', event_id: EVENT_ID });
    expect(tx.quoteRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { axisQuoteRequestId: 'core-q1' }, update: {} }));
    const cached = tx.axisMasterCache.upsert.mock.calls[0][0].create.data;
    expect(cached).toMatchObject({ project_id: 'p1', name: 'Projeto Exemplo', status: 'proposta' });
    expect(cached).not.toHaveProperty('sow_document_id');
    expect(cached).not.toHaveProperty('notes');
  });

  it('project.document_added é ignorado pelo cache', async () => {
    const { prisma, tx } = prismaMock();
    const service = new AxisWebhookService(prisma as unknown as PrismaService, config({ AXIS_WEBHOOK_SECRET: SECRET }));
    const body = raw(envelope({ event_type: 'project.document_added', occurred_at: new Date(Date.now() - 60_000).toISOString(), payload: { project_id: 'p1', document_id: 'd1', kind: 'sow' } }));
    await expect(service.receive(body, sign(body))).resolves.toEqual({ status: 'ignored', event_id: EVENT_ID });
    expect(tx.axisMasterCache.upsert).not.toHaveBeenCalled();
  });
});
