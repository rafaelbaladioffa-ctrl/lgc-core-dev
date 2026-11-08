import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { FulfillmentService } from '../../src/fulfillment/fulfillment.service.js';
import { orderDestination, orderEventBase, summarizeItems } from '../../src/fulfillment/order-events.js';
import { ShippingService } from '../../src/shipping/shipping.service.js';
import { AxisWebhookService } from '../../src/integration/axis-webhook.service.js';

// Eventos que a Logística devolve ao Core (fulfillment.created, shipment.dispatched, delivery.*) e o destino da ordem,
// com Prisma simulado: o que importa é o que vai para o outbox, na mesma transação da escrita.

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const REQ = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const CC = '33333333-3333-4333-8333-333333333333';
const MAT_A = { id: 'mat-a', code: 'RED-CAB-0123', shortDescription: 'Cabo óptico 12F', stockUomId: 'uom-m', status: 'ATIVO', stockUom: { code: 'M' } };
const MAT_B = { id: 'mat-b', code: 'EPI-CAP-0001', shortDescription: 'Capacete', stockUomId: 'uom-un', status: 'ATIVO', stockUom: { code: 'UN' } };

const baseOrder = (over: Record<string, unknown> = {}) => ({
  id: 'ord-1', seq: 7, axisRequestId: REQ, requestVersion: 1, status: 'RECEBIDA', statusReason: null, warehouseId: 'wh-1',
  projectAxisId: 'proj-1', costCenterAxisId: CC, requesterAxisId: null, recipientAxisId: null, neededBy: null,
  destinationSiteAxisId: SITE, destinationText: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', destinationLat: D('-23.4'), destinationLng: D('-46.5'),
  notes: null, referenceWarnings: [], createdBy: 'axis-integration', ...over,
});

describe('orderEventBase / orderDestination', () => {
  it('identifica a requisição de origem, a ordem, a situação e o destino', () => {
    expect(orderEventBase(baseOrder({ status: 'AGUARDANDO_ESTOQUE', statusReason: 'Sem estoque disponível para reservar.' }) as never)).toEqual({
      fulfillment_order_id: 'ord-1', order_id: 'ord-1', order_code: 'ATD-00000007', axis_request_id: REQ, request_version: 1,
      project_id: 'proj-1', cost_center_id: CC, status: 'AGUARDANDO_ESTOQUE', status_reason: 'Sem estoque disponível para reservar.',
      destination: { site_id: SITE, text: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', latitude: -23.4, longitude: -46.5 },
    });
  });

  it('o texto do romaneio (editável) substitui o da ordem; sem site, texto nem coordenadas o destino é null', () => {
    expect(orderDestination(baseOrder() as never, 'Portaria 2')).toMatchObject({ site_id: SITE, text: 'Portaria 2' });
    expect(orderDestination(baseOrder({ destinationSiteAxisId: null, destinationText: null, destinationLat: null, destinationLng: null }) as never)).toBeNull();
    expect(orderDestination(baseOrder({ destinationSiteAxisId: null, destinationText: null, destinationLat: D(0), destinationLng: D(0) }) as never)).toMatchObject({ latitude: 0, longitude: 0 });
  });
});

describe('summarizeItems', () => {
  it('soma por material, acrescenta código, descrição e unidade e mantém campos extras', async () => {
    const tx = { material: { findMany: vi.fn().mockResolvedValue([MAT_A, MAT_B]) } };
    const items = await summarizeItems(tx as never, [
      { materialId: 'mat-a', quantity: D('600.5') }, { materialId: 'mat-b', quantity: D(2), extra: { reserved: '2' } }, { materialId: 'mat-a', quantity: D('599.5') },
    ]);
    expect(items).toEqual([
      { material_id: 'mat-a', material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'M', quantity: '1200' },
      { material_id: 'mat-b', material_code: 'EPI-CAP-0001', description: 'Capacete', unit: 'UN', quantity: '2', reserved: '2' },
    ]);
  });

  it('sem linhas não consulta o catálogo', async () => {
    const tx = { material: { findMany: vi.fn() } };
    expect(await summarizeItems(tx as never, [])).toEqual([]);
    expect(tx.material.findMany).not.toHaveBeenCalled();
  });
});

// -------------------------------------------------------------------------------------------------
// fulfillment.created e destino na criação da ordem
// -------------------------------------------------------------------------------------------------

function fulfillmentFixture(opts: { noDestination?: boolean; cache?: Record<string, { code?: string; active: boolean } | undefined>; stock?: Array<{ id: string; locationId: string; lotId: null; quantity: Prisma.Decimal; reservedQty: Prisma.Decimal; lot: null; updatedAt: Date }> } = {}) {
  const messages: Array<{ eventType: string; payload: Record<string, any> }> = [];
  const order = baseOrder(opts.noDestination ? { destinationSiteAxisId: null, destinationText: null, destinationLat: null, destinationLng: null } : {});
  const reservations: Array<{ itemId: string; quantity: Prisma.Decimal; status: string }> = [];
  const items = [{ id: 'it-1', orderId: 'ord-1', materialId: 'mat-a', quantity: D('1200'), uomId: 'uom-m', createdAt: new Date() }];
  const tx = {
    fulfillmentOrder: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.id ? { ...order, items: items.map((i) => ({ ...i, reservations })) } : null)),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(order, data, { id: 'ord-1', seq: 7, status: 'RECEBIDA' })),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(order, data)),
    },
    fulfillmentItem: { findMany: vi.fn().mockImplementation(async () => items.map((i) => ({ ...i, reservations: reservations.filter((r) => r.status === 'ATIVA') }))) },
    material: { findFirst: vi.fn().mockResolvedValue(MAT_A), findMany: vi.fn().mockResolvedValue([MAT_A]) },
    unitOfMeasure: { findUniqueOrThrow: vi.fn().mockResolvedValue({ code: 'M', precision: 3 }) },
    axisMasterCache: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { kind_axisId: { kind: string; axisId: string } } }) => {
        const hit = (opts.cache ?? {})[`${where.kind_axisId.kind}:${where.kind_axisId.axisId}`];
        return hit ? { ...hit, kind: where.kind_axisId.kind, axisId: where.kind_axisId.axisId } : null;
      }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    warehouse: { findFirst: vi.fn().mockResolvedValue({ id: 'wh-1', status: 'ATIVO' }) },
    stockBalance: { findMany: vi.fn().mockResolvedValue(opts.stock ?? []) },
    reservation: { create: vi.fn().mockImplementation(async ({ data }: { data: { itemId: string; quantity: Prisma.Decimal } }) => { reservations.push({ itemId: data.itemId, quantity: data.quantity, status: 'ATIVA' }); }) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    integrationMessage: { create: vi.fn().mockImplementation(async ({ data }: { data: { eventType: string; payload: Record<string, any>; direction: string; status: string } }) => { messages.push({ eventType: data.eventType, payload: data.payload }); expect(data.direction).toBe('OUTBOUND'); expect(data.status).toBe('PENDING'); }) },
  };
  const service = new FulfillmentService({} as never, { get: vi.fn().mockReturnValue(undefined) } as never);
  const dto = {
    axisRequestId: REQ, requestVersion: 1, projectAxisId: 'proj-1', costCenterAxisId: CC, warehouseCode: 'ALM-CENTRAL', neededBy: '2026-11-24',
    destinationSiteAxisId: SITE, destinationText: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', destinationLat: -23.4, destinationLng: -46.5,
    items: [{ materialCode: MAT_A.code, quantity: 1200 }],
  };
  const create = (over: Record<string, unknown> = {}) => service.createFromRequest(tx as never, { ...dto, ...over } as never, { userId: 'axis-integration' }, 'evt-1');
  return { tx, messages, create };
}

describe('FulfillmentService.createFromRequest — destino e fulfillment.created', () => {
  it('grava o destino da ordem', async () => {
    const f = fulfillmentFixture();
    await f.create();
    expect(f.tx.fulfillmentOrder.create.mock.calls[0][0].data).toMatchObject({
      destinationSiteAxisId: SITE, destinationText: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', destinationLat: -23.4, destinationLng: -46.5, costCenterAxisId: CC, projectAxisId: 'proj-1',
    });
  });

  it('sem estoque a ordem fica AGUARDANDO_ESTOQUE (PA-11) e o evento já leva essa situação e o que falta', async () => {
    const f = fulfillmentFixture();
    const { order } = await f.create();
    expect(order.status).toBe('AGUARDANDO_ESTOQUE');
    const created = f.messages.filter((m) => m.eventType === 'fulfillment.created');
    expect(created).toHaveLength(1);
    expect(created[0].payload).toEqual({
      fulfillment_order_id: 'ord-1', order_id: 'ord-1', order_code: 'ATD-00000007', axis_request_id: REQ, request_version: 1, project_id: 'proj-1', cost_center_id: CC,
      status: 'AGUARDANDO_ESTOQUE', status_reason: 'Sem estoque disponível para reservar.',
      destination: { site_id: SITE, text: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', latitude: -23.4, longitude: -46.5 },
      items: [{ material_id: 'mat-a', material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'M', quantity: '1200', reserved: '0', shortage: '1200' }],
    });
  });

  it('com estoque a ordem fica RESERVADA e o evento mostra reservado e falta zero', async () => {
    const f = fulfillmentFixture({ stock: [{ id: 'bal-1', locationId: 'loc-1', lotId: null, quantity: D(5000), reservedQty: D(0), lot: null, updatedAt: new Date() }] });
    const { order } = await f.create();
    expect(order.status).toBe('RESERVADA');
    const created = f.messages.find((m) => m.eventType === 'fulfillment.created')!;
    expect(created.payload.status).toBe('RESERVADA');
    expect(created.payload.items[0]).toMatchObject({ quantity: '1200', reserved: '1200', shortage: '0' });
  });

  it('reservation.* e fulfillment.created saem na mesma transação (mesmo tx) e as reservas carregam a identificação da requisição', async () => {
    const f = fulfillmentFixture();
    await f.create();
    expect(f.messages.map((m) => m.eventType).sort()).toEqual(['availability.changed', 'fulfillment.created', 'reservation.failed']);
    const failed = f.messages.find((m) => m.eventType === 'reservation.failed')!;
    expect(failed.payload).toMatchObject({ fulfillment_order_id: 'ord-1', axis_request_id: REQ, request_version: 1, status: 'AGUARDANDO_ESTOQUE' });
  });

  it('centro de custo e site ainda não sincronizados: só avisa, nunca bloqueia', async () => {
    const f = fulfillmentFixture();
    const { order } = await f.create();
    expect(order.status).toBe('AGUARDANDO_ESTOQUE');
    const warnings = f.tx.fulfillmentOrder.create.mock.calls[0][0].data.referenceWarnings as string[];
    expect(warnings).toContain(`Centro de custo ${CC} ainda não sincronizado do Axis.`);
    expect(warnings).toContain(`Site de destino ${SITE} ainda não sincronizado do Axis.`);
    expect(warnings).toContain('Projeto proj-1 ainda não sincronizado do Axis.');
  });

  it('centro de custo e site presentes no cache: sem aviso; inativos: avisa e segue', async () => {
    const ok = fulfillmentFixture({ cache: { [`COST_CENTER:${CC}`]: { code: 'CC-001', active: true }, [`SITE:${SITE}`]: { code: 'GRU53', active: true } } });
    await ok.create();
    const w1 = ok.tx.fulfillmentOrder.create.mock.calls[0][0].data.referenceWarnings as string[];
    expect(w1.filter((w) => w.includes('Centro de custo') || w.includes('Site de destino') || w.includes('centro de custo') || w.includes('site de destino'))).toEqual([]);

    const off = fulfillmentFixture({ cache: { [`COST_CENTER:${CC}`]: { code: 'CC-001', active: false }, [`SITE:${SITE}`]: { code: 'GRU53', active: false } } });
    const { order } = await off.create();
    expect(order.status).not.toBe('BLOQUEADA');
    const w2 = off.tx.fulfillmentOrder.create.mock.calls[0][0].data.referenceWarnings as string[];
    expect(w2).toContain('O centro de custo CC-001 está inativo no Axis.');
    expect(w2).toContain('O site de destino GRU53 está inativo no Axis.');
  });

  it('ordem sem destino (ticket legado): destination null no evento e nenhuma consulta ao cache de site', async () => {
    const f = fulfillmentFixture({ noDestination: true });
    await f.create({ destinationSiteAxisId: undefined, destinationText: undefined, destinationLat: undefined, destinationLng: undefined });
    expect(f.tx.axisMasterCache.findUnique.mock.calls.some(([a]) => a.where.kind_axisId.kind === 'SITE')).toBe(false);
    expect(f.messages.find((m) => m.eventType === 'fulfillment.created')!.payload.destination).toBeNull();
  });

  it('replay da mesma versão não emite nada de novo', async () => {
    const f = fulfillmentFixture();
    f.tx.fulfillmentOrder.findUnique.mockResolvedValueOnce(baseOrder());
    const r = await f.create();
    expect(r.replayed).toBe(true);
    expect(f.messages).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// shipment.dispatched e delivery.*
// -------------------------------------------------------------------------------------------------

const user = { userId: 'user-1', permissions: [] } as never;

function shippingFixture(opts: { shipment?: Record<string, unknown>; order?: Record<string, unknown>; packages?: unknown[] } = {}) {
  const messages: Array<{ eventType: string; payload: Record<string, any> }> = [];
  let order = baseOrder({ status: 'PRONTA_EXPEDICAO', ...opts.order });
  const shipment = { id: 'ship-1', seq: 3, orderId: 'ord-1', status: 'PRONTO', destination: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', manifestCode: null, ...opts.shipment };
  const mkPackage = (id: string, status: string, materialId: string, qty: number) => ({ id, status, items: [{ id: `pi-${id}`, quantity: D(qty), pickingItem: { materialId, reservationId: `res-${id}`, serialIds: [] } }] });
  const packages = opts.packages ?? [mkPackage('pkg-1', 'ABERTO', 'mat-a', 1000), mkPackage('pkg-2', 'ABERTO', 'mat-b', 4)];
  const tx = {
    shipment: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...shipment, packages })),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => Object.assign(shipment, data)),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ship-new', seq: 9, ...data })),
      count: vi.fn().mockResolvedValue(0),
    },
    fulfillmentOrder: {
      findUnique: vi.fn().mockImplementation(async () => order),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => order),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => (order = { ...order, ...data } as typeof order)),
    },
    package: { findMany: vi.fn().mockImplementation(async () => packages), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    material: { findMany: vi.fn().mockResolvedValue([{ ...MAT_A, returnable: false, assetTagged: false, serialControlled: false, type: 'CONSUMIVEL', averageCost: D('3.5'), lastCost: null }, { ...MAT_B, returnable: false, assetTagged: false, serialControlled: false, type: 'CONSUMIVEL', averageCost: null, lastCost: D('20') }]) },
    reservation: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'res', balanceId: 'bal-1', locationId: 'loc-1', lotId: null, consumedQty: D(0), quantity: D(5000) }), update: vi.fn().mockResolvedValue({}) },
    deliveryProof: { create: vi.fn().mockResolvedValue({}) },
    axisMasterCache: { findFirst: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    integrationMessage: { create: vi.fn().mockImplementation(async ({ data }: { data: { eventType: string; payload: Record<string, any> } }) => { messages.push({ eventType: data.eventType, payload: data.payload }); }) },
  };
  const prisma = { $transaction: vi.fn().mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const stock = { applyInternal: vi.fn().mockResolvedValue({}) };
  const rbac = { assertWarehouseAccess: vi.fn().mockResolvedValue(undefined) };
  const service = new ShippingService(prisma as never, rbac as never, stock as never);
  return { service, tx, messages, stock, shipment, order: () => order };
}

describe('ShippingService — destino do romaneio', () => {
  it('a expedição nasce com o destino da ordem; destino informado no romaneio prevalece', async () => {
    for (const [dtoDestination, expected] of [[undefined, 'GRU53 — Rua das Fibras, 100, Sumaré/SP'], ['Portaria 2 do site', 'Portaria 2 do site']] as const) {
      const f = shippingFixture({ order: { status: 'SEPARADA' } });
      const tx = f.tx as unknown as Record<string, Record<string, unknown>>;
      tx.pickingTask = { findFirst: vi.fn().mockResolvedValue({ status: 'SEPARADA', items: [{ id: 'pk-1', quantityPicked: D(10) }] }) };
      tx.material.findUniqueOrThrow = vi.fn().mockResolvedValue({ ...MAT_A, stockUom: { code: 'M', precision: 3 } });
      tx.package = { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) };
      f.tx.shipment.findUnique.mockResolvedValue({ id: 'ship-new', seq: 9, destination: expected, packages: [], proofs: [] });
      await f.service.pack('ord-1', { destination: dtoDestination, packages: [{ items: [{ pickingItemId: 'pk-1', quantity: 10 }] }] } as never, user);
      expect(f.tx.shipment.create.mock.calls[0][0].data.destination).toBe(expected);
    }
  });
});

describe('ShippingService.dispatch — shipment.dispatched', () => {
  it('emite no outbox, na transação, com a requisição, a ordem, o destino e os itens expedidos', async () => {
    const f = shippingFixture();
    await f.service.dispatch('ship-1', { carrier: 'Transp. Rápido', vehicle: 'ABC-1234' } as never, user);
    expect(f.messages).toHaveLength(1);
    const { eventType, payload } = f.messages[0];
    expect(eventType).toBe('shipment.dispatched');
    expect(payload).toMatchObject({
      fulfillment_order_id: 'ord-1', order_code: 'ATD-00000007', axis_request_id: REQ, request_version: 1, project_id: 'proj-1', cost_center_id: CC, status: 'EXPEDIDA',
      shipment_id: 'ship-1', shipment_code: 'EXP-00000003', manifest: 'ROM-00000003', carrier: 'Transp. Rápido', route: null, vehicle: 'ABC-1234', packages: 2,
      destination: { site_id: SITE, text: 'GRU53 — Rua das Fibras, 100, Sumaré/SP', latitude: -23.4, longitude: -46.5 },
      items: [
        { material_id: 'mat-a', material_code: 'RED-CAB-0123', description: 'Cabo óptico 12F', unit: 'M', quantity: '1000' },
        { material_id: 'mat-b', material_code: 'EPI-CAP-0001', description: 'Capacete', unit: 'UN', quantity: '4' },
      ],
    });
    expect(typeof payload.dispatched_at).toBe('string');
    expect(f.tx.shipment.update.mock.calls[0][0].data.status).toBe('EXPEDIDA');
  });

  it('destino editado na expedição vai no evento e na expedição', async () => {
    const f = shippingFixture();
    await f.service.dispatch('ship-1', { carrier: 'Frota própria', destination: 'Docas do site GRU53' } as never, user);
    expect(f.messages[0].payload.destination.text).toBe('Docas do site GRU53');
    expect(f.tx.shipment.update.mock.calls[0][0].data.destination).toBe('Docas do site GRU53');
  });

  it('expedição que não está pronta não emite nada', async () => {
    const f = shippingFixture({ shipment: { status: 'EXPEDIDA' } });
    await expect(f.service.dispatch('ship-1', { carrier: 'X' } as never, user)).rejects.toThrow('não pode ser despachada');
    expect(f.messages).toEqual([]);
  });
});

describe('ShippingService.confirmDelivery — delivery.confirmed | partial | refused', () => {
  const dispatched = (extra: Record<string, unknown> = {}) => shippingFixture({
    shipment: { status: 'EXPEDIDA', manifestCode: 'ROM-00000003', ...extra },
    order: { status: 'EXPEDIDA' },
    packages: [
      { id: 'pkg-1', status: 'EXPEDIDO', items: [{ id: 'pi-1', quantity: D(1000), pickingItem: { materialId: 'mat-a', reservationId: 'res-1', serialIds: [] } }] },
      { id: 'pkg-2', status: 'EXPEDIDO', items: [{ id: 'pi-2', quantity: D(4), pickingItem: { materialId: 'mat-b', reservationId: 'res-2', serialIds: [] } }] },
    ],
  });

  it('entrega total: delivery.confirmed com a ordem ENTREGUE, o recebedor e todos os itens', async () => {
    const f = dispatched();
    await f.service.confirmDelivery('ship-1', { outcome: 'ENTREGUE', receiverName: 'Maria Souza', receiverAxisId: 'colab-9', deliveredAt: '2026-11-20T14:00:00.000Z' } as never, user);
    const confirmed = f.messages.filter((m) => m.eventType === 'delivery.confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0].payload).toMatchObject({
      fulfillment_order_id: 'ord-1', axis_request_id: REQ, request_version: 1, status: 'ENTREGUE', shipment_id: 'ship-1', manifest: 'ROM-00000003',
      delivered_at: '2026-11-20T14:00:00.000Z', receiver_name: 'Maria Souza', receiver_id: 'colab-9', pending_packages: 0,
      destination: { site_id: SITE },
      items: [
        { material_code: 'RED-CAB-0123', quantity: '1000', unit: 'M' },
        { material_code: 'EPI-CAP-0001', quantity: '4', unit: 'UN' },
      ],
    });
    expect(f.messages.filter((m) => ['delivery.partial', 'delivery.refused'].includes(m.eventType))).toEqual([]);
  });

  it('a baixa leva centro de custo e projeto e o custo médio (ou o último custo, na falta)', async () => {
    const f = dispatched();
    await f.service.confirmDelivery('ship-1', { outcome: 'ENTREGUE', receiverName: 'Maria Souza' } as never, user);
    const calls = f.stock.applyInternal.mock.calls.map(([, input]) => input);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ type: 'SAIDA_ENTREGA', materialId: 'mat-a', costCenterAxisId: CC, projectAxisId: 'proj-1', unitCost: 3.5 });
    expect(calls[1]).toMatchObject({ type: 'SAIDA_ENTREGA', materialId: 'mat-b', costCenterAxisId: CC, projectAxisId: 'proj-1', unitCost: 20 });
  });

  it('entrega parcial: delivery.partial só com o que foi entregue agora e quantos volumes faltam', async () => {
    const f = dispatched();
    await f.service.confirmDelivery('ship-1', { outcome: 'PARCIAL', packageIds: ['pkg-1'], receiverName: 'Maria Souza' } as never, user);
    const partial = f.messages.filter((m) => m.eventType === 'delivery.partial');
    expect(partial).toHaveLength(1);
    expect(partial[0].payload).toMatchObject({
      fulfillment_order_id: 'ord-1', axis_request_id: REQ, request_version: 1, status: 'EXPEDIDA', pending_packages: 1, shipment_id: 'ship-1',
      items: [{ material_code: 'RED-CAB-0123', quantity: '1000' }],
    });
    expect(partial[0].payload.items).toHaveLength(1);
    expect(f.messages.some((m) => m.eventType === 'delivery.confirmed')).toBe(false);
  });

  it('recusa: delivery.refused com o motivo, a ordem em DIVERGENCIA e os itens recusados', async () => {
    const f = dispatched();
    await f.service.confirmDelivery('ship-1', { outcome: 'RECUSADA', receiverName: 'Maria Souza', notes: 'Obra fechada' } as never, user);
    const refused = f.messages.filter((m) => m.eventType === 'delivery.refused');
    expect(refused).toHaveLength(1);
    expect(refused[0].payload).toMatchObject({
      fulfillment_order_id: 'ord-1', axis_request_id: REQ, request_version: 1, status: 'DIVERGENCIA', reason: 'Obra fechada', shipment_id: 'ship-1',
      items: [{ material_code: 'RED-CAB-0123', quantity: '1000' }, { material_code: 'EPI-CAP-0001', quantity: '4' }],
    });
    expect(f.stock.applyInternal).not.toHaveBeenCalled(); // recusa não baixa estoque
  });

  it('recusa sem motivo falha e não emite evento', async () => {
    const f = dispatched();
    await expect(f.service.confirmDelivery('ship-1', { outcome: 'RECUSADA', receiverName: 'Maria Souza' } as never, user)).rejects.toThrow('Recusa exige o motivo');
    expect(f.messages).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// Cadastros do webhook: site.* e cost_center.*
// -------------------------------------------------------------------------------------------------

describe('AxisWebhookService — site.* e cost_center.* viram cache de cadastros', () => {
  const OCCURRED = '2026-11-08T12:00:00.000Z';
  function webhook(current: Record<string, unknown> | null = null) {
    const tx = { axisMasterCache: { findUnique: vi.fn().mockResolvedValue(current), upsert: vi.fn().mockResolvedValue({}) } };
    const service = new AxisWebhookService({} as never, { get: vi.fn() } as never, {} as never, {} as never);
    const handle = (eventType: string, payload: Record<string, unknown>) =>
      (service as unknown as { handle: (tx: unknown, env: unknown) => Promise<string> }).handle(tx, { event_id: 'e', event_type: eventType, occurred_at: OCCURRED, payload });
    return { tx, handle };
  }

  it('site.created grava o site no cache (kind SITE) com código, nome e o payload completo', async () => {
    const w = webhook();
    const payload = { site_id: SITE, client_id: 'cli-1', code: 'GRU53', name: 'Data center GRU53', address: 'Rua das Fibras, 100', city: 'Sumaré', state: 'SP', latitude: -23.4, longitude: -46.5, active: true };
    expect(await w.handle('site.created', payload)).toBe('processed');
    const arg = w.tx.axisMasterCache.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ kind_axisId: { kind: 'SITE', axisId: SITE } });
    expect(arg.create).toMatchObject({ kind: 'SITE', axisId: SITE, code: 'GRU53', name: 'Data center GRU53', active: true, data: payload });
  });

  it('site.updated desativando o site marca inativo e mescla os campos parciais', async () => {
    const w = webhook({ kind: 'SITE', axisId: SITE, code: 'GRU53', name: 'Antigo', active: true, data: { city: 'Sumaré' }, sourceOccurredAt: new Date('2026-11-01T00:00:00Z') });
    expect(await w.handle('site.updated', { site_id: SITE, name: 'Novo nome', active: false })).toBe('processed');
    const arg = w.tx.axisMasterCache.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ code: 'GRU53', name: 'Novo nome', active: false, data: { city: 'Sumaré', name: 'Novo nome', site_id: SITE, active: false } });
  });

  it('site sem active no payload mantém o estado atual; evento mais antigo que o cache é descartado', async () => {
    const w = webhook({ kind: 'SITE', axisId: SITE, code: 'GRU53', name: 'X', active: false, data: {}, sourceOccurredAt: new Date('2026-11-01T00:00:00Z') });
    await w.handle('site.updated', { site_id: SITE, name: 'Y' });
    expect(w.tx.axisMasterCache.upsert.mock.calls[0][0].update.active).toBe(false);

    const old = webhook({ kind: 'SITE', axisId: SITE, code: 'GRU53', name: 'X', active: true, data: {}, sourceOccurredAt: new Date('2026-12-01T00:00:00Z') });
    expect(await old.handle('site.updated', { site_id: SITE, name: 'velho' })).toBe('out_of_order');
    expect(old.tx.axisMasterCache.upsert).not.toHaveBeenCalled();
  });

  it('aceita site_code no lugar de code; site sem site_id é 400', async () => {
    const w = webhook();
    await w.handle('site.created', { site_id: SITE, site_code: 'GRU53', name: 'N' });
    expect(w.tx.axisMasterCache.upsert.mock.calls[0][0].create.code).toBe('GRU53');
    await expect(w.handle('site.created', { code: 'GRU53' })).rejects.toThrow('site_id ausente');
  });

  it('cost_center.created/updated alimenta o cache (kind COST_CENTER); antes era ignorado', async () => {
    const w = webhook();
    const payload = { cost_center_id: CC, code: 'CC-001', name: 'Projetos Sudeste', kind: 'operacional', short_code: 'PRJ-SE', active: true };
    expect(await w.handle('cost_center.created', payload)).toBe('processed');
    expect(w.tx.axisMasterCache.upsert.mock.calls[0][0].create).toMatchObject({ kind: 'COST_CENTER', axisId: CC, code: 'CC-001', name: 'Projetos Sudeste', active: true });
    await w.handle('cost_center.updated', { ...payload, active: false });
    expect(w.tx.axisMasterCache.upsert.mock.calls[1][0].update.active).toBe(false);
    await expect(w.handle('cost_center.updated', { code: 'x' })).rejects.toThrow('cost_center_id ausente');
  });
});
