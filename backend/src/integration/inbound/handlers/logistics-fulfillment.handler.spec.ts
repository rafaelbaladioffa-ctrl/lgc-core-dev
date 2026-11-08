import { describe, expect, it, vi } from 'vitest';
import { LogisticsFulfillmentHandler } from './logistics-fulfillment.handler.js';
import { FieldProjectHandler } from './field-project.handler.js';
import { InboundHandlerRegistry } from '../inbound-handler.registry.js';
import type { InboundEvent } from '../inbound-handler.js';
import { deliveredByMaterial, logisticsOf, shortageItems } from '../../../requests/envio-logistica.js';
import type { ShipmentData } from '../../../requests/envio-material.js';

/**
 * Handlers da Logística (PT-09) com Prisma simulado em memória. Os payloads seguem
 * docs/integracao-core-logistica.md §4.1 (campos reais do outbox da Logística).
 */

const SYSTEM = 'col-sistema';
const LOGISTICA = { id: 'sat-log', name: 'logistica' };

const SHIPMENT: ShipmentData = {
  projectQuoteId: 'q-2',
  recipientCollaboratorId: 'col-resp',
  recipientName: 'Carla Responsável',
  neededBy: '2026-11-30',
  destination: { siteId: 'site-1', siteCode: 'GRU53', siteName: 'Aeroporto GRU', address: 'Rod. Hélio Smidt', city: 'Guarulhos', state: 'SP', latitude: null, longitude: null },
  items: [
    { materialCode: 'RED-CAB-0123', logisticsMaterialId: 'mat-1', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' },
    { materialCode: 'RED-CON-0001', logisticsMaterialId: 'mat-2', description: 'Conector LC', unit: 'un', quantity: '40.000' },
  ],
  warnings: [],
  approvedAt: '2026-11-08T10:00:00.000Z',
};

function fixture(requestOverrides: Record<string, unknown> | null = {}) {
  const request: Record<string, any> | null =
    requestOverrides === null
      ? null
      : { id: 'req-1', code: 'REQ-2026-000007', status: 'em_atendimento', projectId: 'p-1', costCenterId: 'cc-1', formData: { shipment: SHIPMENT }, ...requestOverrides };
  const tx: any = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    request: {
      findUnique: vi.fn(async () => (request ? structuredClone(request) : null)),
      update: vi.fn(async ({ data }) => {
        Object.assign(request!, data);
        return request;
      }),
    },
    collaborator: { findUnique: vi.fn().mockResolvedValue({ id: SYSTEM }) },
    requestComment: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  };
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const handler = new LogisticsFulfillmentHandler(outbox as any);
  let seq = 0;
  const send = (eventType: string, payload: Record<string, unknown>, extra: Partial<InboundEvent> = {}) => {
    seq += 1;
    return handler.handle(tx, {
      satellite: LOGISTICA,
      eventId: `ev-${seq}`,
      eventType,
      occurredAt: new Date(`2026-11-10T1${seq % 10}:00:00Z`),
      correlationId: null,
      payload: { axis_request_id: 'req-1', request_version: 1, fulfillment_order_id: 'ord-1', order_code: 'ATD-00000007', ...payload },
      ...extra,
    });
  };
  const comments = () => tx.requestComment.create.mock.calls.map((c: any[]) => c[0].data.body as string);
  const outboxTypes = () => outbox.record.mock.calls.map((c: any[]) => c[1] as string);
  return { request: request!, tx, outbox, handler, send, comments, outboxTypes };
}

const createdItems = (shortageCable = '0.000') => [
  { material_id: 'mat-1', material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000', reserved: (1200 - Number(shortageCable)).toFixed(3), shortage: shortageCable },
  { material_id: 'mat-2', material_code: 'RED-CON-0001', description: 'Conector LC', unit: 'un', quantity: '40.000', reserved: '40.000', shortage: '0.000' },
];

const dispatched = { status: 'EXPEDIDA', shipment_id: 'sh-1', shipment_code: 'EXP-0001', manifest: 'ROM-0009', carrier: 'Transportes Rápido', dispatched_at: '2026-11-12T13:00:00Z', packages: 3, items: [{ material_code: 'RED-CAB-0123', quantity: '1200.000' }] };

describe('registro dos handlers de entrada', () => {
  it('registra os nove eventos do plano, cada um com um só handler', () => {
    const registry = new InboundHandlerRegistry([new LogisticsFulfillmentHandler({} as any), new FieldProjectHandler({} as any)]);
    expect(registry.registeredTypes()).toEqual([
      'delivery.confirmed',
      'delivery.partial',
      'delivery.refused',
      'field.project.completed',
      'field.project.created',
      'field.project.progress',
      'field.project.started',
      'fulfillment.created',
      'shipment.dispatched',
    ]);
  });
});

describe('fulfillment.created', () => {
  it('guarda o código da ordem e a situação e comenta na requisição', async () => {
    const f = fixture();
    await f.send('fulfillment.created', { status: 'RESERVADA', items: createdItems() });

    const logistics = logisticsOf(f.request.formData)!;
    expect(logistics).toMatchObject({ orderCode: 'ATD-00000007', orderId: 'ord-1', status: 'RESERVADA', stage: 1, requestVersion: 1 });
    expect(logistics.items).toHaveLength(2);
    expect(shortageItems(logistics)).toEqual([]);
    expect(f.comments()).toEqual([expect.stringContaining('ATD-00000007')]);
    expect(f.tx.requestComment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ authorId: SYSTEM, visibility: 'publico', requestId: 'req-1' }) });
    // Já estava em atendimento desde a aprovação: nada de status novo nem de evento de saída.
    expect(f.request.status).toBe('em_atendimento');
    expect(f.outboxTypes()).toEqual([]);
    expect(f.tx.auditEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ event: 'request.logistics_order_created', source: 'integration', actorId: SYSTEM }) });
  });

  it('leva uma requisição ainda "aprovada" para em_atendimento e avisa o outbox', async () => {
    const f = fixture({ status: 'aprovada' });
    await f.send('fulfillment.created', { status: 'RESERVADA', items: createdItems() });
    expect(f.request.status).toBe('em_atendimento');
    expect(f.outboxTypes()).toEqual(['request.status_changed']);
    expect(f.outbox.record).toHaveBeenCalledWith(f.tx, 'request.status_changed', { request_id: 'req-1', code: 'REQ-2026-000007', status: 'em_atendimento' });
  });

  it('AGUARDANDO_ESTOQUE sem detalhe por item: tudo falta e o comentário avisa (PA-11)', async () => {
    const f = fixture();
    await f.send('fulfillment.created', {
      status: 'AGUARDANDO_ESTOQUE',
      items: [
        { material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'm', quantity: '1200.000' },
        { material_code: 'RED-CON-0001', description: 'Conector LC', unit: 'un', quantity: '40.000' },
      ],
    });
    const logistics = logisticsOf(f.request.formData)!;
    expect(logistics.status).toBe('AGUARDANDO_ESTOQUE');
    expect(shortageItems(logistics).map((i) => [i.materialCode, i.shortage])).toEqual([
      ['RED-CAB-0123', '1200.000'],
      ['RED-CON-0001', '40.000'],
    ]);
    expect(f.comments()[0]).toContain('aguardando estoque');
    expect(f.comments()[0]).toContain('RED-CAB-0123 — 1200 de 1200 m');
    expect(f.comments()[0]).toContain('Suprimentos');
  });

  it('reserva parcial: guarda a falta por item', async () => {
    const f = fixture();
    await f.send('fulfillment.created', { status: 'RESERVADA_PARCIAL', items: createdItems('300.000') });
    const logistics = logisticsOf(f.request.formData)!;
    expect(shortageItems(logistics)).toEqual([expect.objectContaining({ materialCode: 'RED-CAB-0123', reserved: '900.000', shortage: '300.000' })]);
    expect(f.comments()[0]).toContain('reserva parcial');
    expect(f.comments()[0]).toContain('RED-CAB-0123 — 300 de 1200 m');
  });
});

describe('shipment.dispatched', () => {
  it('passa a aguardando_entrega e comenta "Expedido para o site" com romaneio e transportadora', async () => {
    const f = fixture();
    await f.send('fulfillment.created', { status: 'RESERVADA', items: createdItems() });
    await f.send('shipment.dispatched', dispatched);

    expect(f.request.status).toBe('aguardando_entrega');
    const comment = f.comments()[1];
    expect(comment).toMatch(/^Expedido para o site GRU53/);
    expect(comment).toContain('romaneio ROM-0009');
    expect(comment).toContain('transportadora Transportes Rápido');
    expect(logisticsOf(f.request.formData)).toMatchObject({ status: 'EXPEDIDA', stage: 2, dispatchedAt: '2026-11-12T13:00:00.000Z' });
    expect(logisticsOf(f.request.formData)!.shipments[0]).toMatchObject({ shipmentId: 'sh-1', manifest: 'ROM-0009', carrier: 'Transportes Rápido', packages: 3 });
    expect(f.outboxTypes()).toEqual(['request.status_changed']);
  });
});

describe('delivery.*', () => {
  const confirmed = { status: 'ENTREGUE', shipment_id: 'sh-1', delivered_at: '2026-11-13T15:30:00Z', receiver_name: 'Carla Responsável', pending_packages: 0, items: [{ material_code: 'RED-CAB-0123', quantity: '1200.000' }, { material_code: 'RED-CON-0001', quantity: '40.000' }] };

  it('delivery.confirmed encerra com os mesmos campos de encerramento da compra', async () => {
    const f = fixture({ status: 'aguardando_entrega' });
    await f.send('delivery.confirmed', confirmed);

    expect(f.request.status).toBe('encerrada');
    const closed = new Date('2026-11-13T15:30:00Z');
    expect(f.request).toMatchObject({ closedAt: closed, completedAt: closed, requesterAcceptedAt: closed });
    expect(f.outboxTypes()).toEqual(['request.completed', 'request.status_changed']);
    expect(f.comments()[0]).toContain('Entrega confirmada no site, recebida por Carla Responsável');
    expect(f.comments()[0]).toContain('Requisição encerrada');
    expect(logisticsOf(f.request.formData)).toMatchObject({ status: 'ENTREGUE', stage: 3, deliveredAt: '2026-11-13T15:30:00.000Z' });
  });

  it('delivery.partial mantém aguardando_entrega e soma o entregue por item', async () => {
    const f = fixture({ status: 'aguardando_entrega' });
    await f.send('delivery.partial', { status: 'EXPEDIDA', shipment_id: 'sh-1', delivered_at: '2026-11-13T15:30:00Z', pending_packages: 1, items: [{ material_code: 'RED-CAB-0123', quantity: '800.000' }] });
    await f.send('delivery.partial', { status: 'EXPEDIDA', shipment_id: 'sh-1', delivered_at: '2026-11-14T10:00:00Z', pending_packages: 1, items: [{ material_code: 'RED-CAB-0123', quantity: '250.500' }, { material_code: 'RED-CON-0001', quantity: '10.000' }] });

    expect(f.request.status).toBe('aguardando_entrega');
    expect(f.outboxTypes()).toEqual([]);
    const totals = deliveredByMaterial(logisticsOf(f.request.formData)!);
    expect(totals.get('RED-CAB-0123')!.toFixed(3)).toBe('1050.500');
    expect(totals.get('RED-CON-0001')!.toFixed(3)).toBe('10.000');
    expect(f.comments()[0]).toContain('Entrega parcial');
  });

  it('delivery.refused só comenta o motivo e não muda o status', async () => {
    const f = fixture({ status: 'aguardando_entrega' });
    await f.send('delivery.refused', { status: 'DIVERGENCIA', shipment_id: 'sh-1', reason: 'Caixas avariadas', items: [{ material_code: 'RED-CON-0001', quantity: '40.000' }] });

    expect(f.request.status).toBe('aguardando_entrega');
    expect(f.comments()[0]).toContain('Entrega recusada no site: Caixas avariadas');
    expect(f.comments()[0]).toContain('RED-CON-0001 (40)');
    expect(logisticsOf(f.request.formData)).toMatchObject({ status: 'DIVERGENCIA', refusals: [expect.objectContaining({ reason: 'Caixas avariadas' })] });
    expect(f.outboxTypes()).toEqual([]);
  });
});

describe('repetição e ordem trocada', () => {
  it('o mesmo evento repetido não soma de novo, não comenta de novo e não grava de novo', async () => {
    const f = fixture({ status: 'aguardando_entrega' });
    const partial = { status: 'EXPEDIDA', shipment_id: 'sh-1', pending_packages: 1, items: [{ material_code: 'RED-CAB-0123', quantity: '800.000' }] };
    await f.send('delivery.partial', partial, { eventId: 'ev-fixo' });
    const updates = f.tx.request.update.mock.calls.length;
    await f.send('delivery.partial', partial, { eventId: 'ev-fixo' });

    expect(f.tx.request.update).toHaveBeenCalledTimes(updates);
    expect(f.comments()).toHaveLength(1);
    expect(deliveredByMaterial(logisticsOf(f.request.formData)!).get('RED-CAB-0123')!.toFixed(3)).toBe('800.000');
  });

  it('entregue → expedido → criado, nessa ordem: a requisição fica encerrada e a situação não volta', async () => {
    const f = fixture({ status: 'em_atendimento' });
    await f.send('delivery.confirmed', { status: 'ENTREGUE', shipment_id: 'sh-1', delivered_at: '2026-11-13T15:30:00Z', pending_packages: 0, items: [{ material_code: 'RED-CAB-0123', quantity: '1200.000' }] }, { occurredAt: new Date('2026-11-13T15:31:00Z') });
    await f.send('shipment.dispatched', dispatched, { occurredAt: new Date('2026-11-12T13:01:00Z') });
    await f.send('fulfillment.created', { status: 'RESERVADA', items: createdItems() }, { occurredAt: new Date('2026-11-10T09:00:00Z') });

    expect(f.request.status).toBe('encerrada');
    const logistics = logisticsOf(f.request.formData)!;
    expect(logistics).toMatchObject({ status: 'ENTREGUE', stage: 3 });
    // Os dados dos eventos atrasados entram mesmo assim.
    expect(logistics.items).toHaveLength(2);
    expect(logistics.shipments).toHaveLength(1);
    expect(logistics.orderCode).toBe('ATD-00000007');
    // E o status da requisição mudou uma única vez (para encerrada).
    expect(f.outboxTypes()).toEqual(['request.completed', 'request.status_changed']);
  });

  it('parcial depois do confirmado soma o entregue sem reabrir a requisição', async () => {
    const f = fixture({ status: 'aguardando_entrega' });
    await f.send('delivery.confirmed', { status: 'ENTREGUE', shipment_id: 'sh-2', delivered_at: '2026-11-14T10:00:00Z', pending_packages: 0, items: [{ material_code: 'RED-CAB-0123', quantity: '400.000' }] }, { occurredAt: new Date('2026-11-14T10:01:00Z') });
    await f.send('delivery.partial', { status: 'EXPEDIDA', shipment_id: 'sh-1', delivered_at: '2026-11-13T10:00:00Z', pending_packages: 1, items: [{ material_code: 'RED-CAB-0123', quantity: '800.000' }] }, { occurredAt: new Date('2026-11-13T10:01:00Z') });

    expect(f.request.status).toBe('encerrada');
    const logistics = logisticsOf(f.request.formData)!;
    expect(logistics.status).toBe('ENTREGUE');
    expect(deliveredByMaterial(logistics).get('RED-CAB-0123')!.toFixed(3)).toBe('1200.000');
  });

  it('no mesmo estágio vale o evento mais recente, não o último a chegar', async () => {
    const f = fixture({ status: 'em_atendimento' });
    await f.send('fulfillment.created', { status: 'RESERVADA', items: createdItems() }, { occurredAt: new Date('2026-11-10T12:00:00Z') });
    await f.send('fulfillment.created', { status: 'AGUARDANDO_ESTOQUE' }, { occurredAt: new Date('2026-11-10T09:00:00Z'), eventId: 'ev-velho' });
    expect(logisticsOf(f.request.formData)!.status).toBe('RESERVADA');
  });

  it('evento de versão antiga da requisição é ignorado', async () => {
    const f = fixture({ status: 'em_atendimento' });
    await f.send('fulfillment.created', { status: 'RESERVADA', request_version: 2, items: createdItems() });
    const updates = f.tx.request.update.mock.calls.length;
    await f.send('shipment.dispatched', { ...dispatched, request_version: 1 });
    expect(f.tx.request.update).toHaveBeenCalledTimes(updates);
    expect(f.request.status).toBe('em_atendimento');
    expect(logisticsOf(f.request.formData)!.requestVersion).toBe(2);
  });

  it('requisição cancelada recebe o comentário mas não muda de status', async () => {
    const f = fixture({ status: 'cancelada' });
    await f.send('shipment.dispatched', dispatched);
    expect(f.request.status).toBe('cancelada');
    expect(f.comments()).toHaveLength(1);
    expect(f.outboxTypes()).toEqual([]);
  });
});

describe('falhas com motivo legível', () => {
  it('requisição inexistente', async () => {
    const f = fixture(null);
    await expect(f.send('fulfillment.created', { status: 'RESERVADA' })).rejects.toThrow('Requisição req-1 não encontrada no Core (evento fulfillment.created, ordem ATD-00000007).');
  });

  it('requisição que não é envio de material', async () => {
    const f = fixture({ formData: { purchaseItems: [] } });
    await expect(f.send('shipment.dispatched', dispatched)).rejects.toThrow('não é um envio de material para obra');
  });

  it('sem axis_request_id', async () => {
    const f = fixture();
    await expect(f.send('shipment.dispatched', { ...dispatched, axis_request_id: null })).rejects.toThrow('sem "axis_request_id"');
  });

  it('evento de outro satélite (field.* da Logística é tratado no outro handler; aqui, o contrário)', async () => {
    const f = fixture();
    await expect(f.send('shipment.dispatched', dispatched, { satellite: { id: 'sat-fin', name: 'financeiro' } })).rejects.toThrow('só é aceito do satélite Logística, mas chegou de "financeiro"');
    expect(f.tx.request.update).not.toHaveBeenCalled();
  });

  it('usuário de sistema ausente', async () => {
    const f = fixture();
    f.tx.collaborator.findUnique.mockResolvedValue(null);
    await expect(f.send('shipment.dispatched', dispatched)).rejects.toThrow('Usuário de sistema');
  });

  it('fulfillment.created sem status', async () => {
    const f = fixture();
    await expect(f.send('fulfillment.created', {})).rejects.toThrow('sem "status"');
  });
});
