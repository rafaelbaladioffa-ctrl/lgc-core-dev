import { Prisma } from '@prisma/client';
import type { FulfillmentOrder } from '@prisma/client';
import { randomUUID } from 'crypto';

type Tx = Prisma.TransactionClient;

export const orderCode = (seq: number) => `ATD-${String(seq).padStart(8, '0')}`;
export const shipmentCode = (seq: number) => `EXP-${String(seq).padStart(8, '0')}`;

/** Grava no outbox, na transação da escrita de negócio (AGENTS.md, regra 6). A entrega ao Axis é assíncrona. */
export function emitOutbound(tx: Tx, eventType: string, payload: Record<string, unknown>) {
  return tx.integrationMessage.create({
    data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue },
  });
}

/** Item como o Axis o recebe: material identificado por id e código, quantidade em string decimal, unidade de estoque. */
export interface EventItem {
  material_id: string;
  material_code: string;
  description: string;
  unit: string;
  quantity: string;
  [extra: string]: string;
}

/** Soma por material (na ordem de entrada) e acrescenta código, descrição e unidade do catálogo. */
export async function summarizeItems(tx: Tx, rows: Array<{ materialId: string; quantity: Prisma.Decimal; extra?: Record<string, string> }>): Promise<EventItem[]> {
  const merged = new Map<string, { quantity: Prisma.Decimal; extra?: Record<string, string> }>();
  for (const r of rows) {
    const cur = merged.get(r.materialId);
    merged.set(r.materialId, { quantity: (cur?.quantity ?? new Prisma.Decimal(0)).plus(r.quantity), extra: r.extra });
  }
  if (merged.size === 0) return [];
  const materials = await tx.material.findMany({ where: { id: { in: [...merged.keys()] } }, select: { id: true, code: true, shortDescription: true, stockUom: { select: { code: true } } } });
  const byId = new Map(materials.map((m) => [m.id, m]));
  return [...merged.entries()].map(([id, v]) => {
    const m = byId.get(id);
    return { material_id: id, material_code: m?.code ?? '', description: m?.shortDescription ?? '', unit: m?.stockUom.code ?? '', quantity: v.quantity.toString(), ...v.extra };
  });
}

/**
 * Campos comuns dos eventos que o Core acompanha (`fulfillment.created`, `shipment.dispatched`,
 * `delivery.confirmed|partial|refused`): identificam a requisição de origem, a ordem e o destino.
 * `order_id` repete `fulfillment_order_id` por compatibilidade com os demais eventos da ordem (reservation.*, picking.*).
 * `status` é a situação da ordem DEPOIS da operação que gerou o evento.
 */
export function orderEventBase(order: FulfillmentOrder, destinationText?: string | null) {
  return {
    fulfillment_order_id: order.id,
    order_id: order.id,
    order_code: orderCode(order.seq),
    axis_request_id: order.axisRequestId,
    request_version: order.requestVersion,
    project_id: order.projectAxisId,
    cost_center_id: order.costCenterAxisId,
    status: order.status,
    status_reason: order.statusReason,
    destination: orderDestination(order, destinationText),
  };
}

/** Destino da entrega (null quando a ordem não tem site nem texto); o texto do romaneio pode ter sido editado. */
export function orderDestination(order: Pick<FulfillmentOrder, 'destinationSiteAxisId' | 'destinationText' | 'destinationLat' | 'destinationLng'>, text?: string | null) {
  const label = text ?? order.destinationText;
  if (!order.destinationSiteAxisId && !label && order.destinationLat == null) return null;
  // Latitude e longitude como número, no mesmo formato em que chegam no `destination` do material_request.approved.
  return { site_id: order.destinationSiteAxisId, text: label, latitude: order.destinationLat == null ? null : Number(order.destinationLat), longitude: order.destinationLng == null ? null : Number(order.destinationLng) };
}
