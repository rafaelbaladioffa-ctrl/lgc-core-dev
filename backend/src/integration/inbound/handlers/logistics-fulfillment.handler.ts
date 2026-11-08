import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestStatus } from '@prisma/client';
import { OutboxService } from '../../outbox.service.js';
import type { InboundEvent, InboundEventHandler } from '../inbound-handler.js';
import {
  emptyLogistics,
  formatQuantity,
  logisticsOf,
  logisticsStatusLabel,
  mergeStatus,
  rememberEvent,
  type LogisticsItem,
  type LogisticsStage,
  type ShipmentLogistics,
} from '../../../requests/envio-logistica.js';
import { SYSTEM_ACTOR_EMAIL, shipmentOf } from '../../../requests/envio-material.js';
import { asDate, asDecimal, asInt, asObjectArray, asText, assertFromSatellite, formatDateTimeSp, requireText } from './inbound-payload.js';

type Tx = Prisma.TransactionClient;

const EVENT_TYPES = ['fulfillment.created', 'shipment.dispatched', 'delivery.confirmed', 'delivery.partial', 'delivery.refused'] as const;

const DEFAULT_STATUS: Record<string, string> = {
  'shipment.dispatched': 'EXPEDIDA',
  'delivery.confirmed': 'ENTREGUE',
  'delivery.partial': 'EXPEDIDA',
  'delivery.refused': 'DIVERGENCIA',
};

/** Etapas da requisição de envio em ordem; só avança. `aprovada` é o ponto de partida antes da primeira notícia da Logística. */
const REQUEST_STATUS_RANK: Partial<Record<RequestStatus, number>> = { aprovada: 0, em_atendimento: 1, aguardando_entrega: 2 };

/**
 * Acompanha a Logística na requisição de envio de material (PT-09, PA-11). Eventos recebidos (formato em
 * docs/integracao-core-logistica.md §4.1), todos com `axis_request_id`:
 *
 * - `fulfillment.created` → `em_atendimento`; guarda `order_code`, a situação da ordem (inclusive
 *   `AGUARDANDO_ESTOQUE`) e as faltas por item; comenta;
 * - `shipment.dispatched` → `aguardando_entrega`; comentário "Expedido para o site" com romaneio e transportadora;
 * - `delivery.confirmed` → encerra (mesmos campos de encerramento da compra); `delivery.partial` mantém e soma o
 *   entregue por item; `delivery.refused` só comenta o motivo.
 *
 * Idempotente (o id do evento fica em `logistics.seenEventIds`) e tolerante à ordem trocada: a situação só avança
 * pela etapa (`stage`) e, dentro da mesma etapa, pela data do evento; `request_version` menor que o guardado é ignorado.
 * Roda na transação da inbox, com a requisição travada (`FOR UPDATE`) para dois eventos simultâneos não se atropelarem.
 */
@Injectable()
export class LogisticsFulfillmentHandler implements InboundEventHandler {
  readonly eventTypes = EVENT_TYPES;

  constructor(private readonly outbox: OutboxService) {}

  async handle(tx: Tx, event: InboundEvent): Promise<void> {
    assertFromSatellite(event, 'logistica');
    const requestId = requireText(event, 'axis_request_id');
    const orderCode = asText(event.payload.order_code);

    await tx.$queryRaw`SELECT id FROM requests WHERE id = ${requestId} FOR UPDATE`;
    const request = await tx.request.findUnique({
      where: { id: requestId },
      select: { id: true, code: true, status: true, projectId: true, costCenterId: true, formData: true },
    });
    if (!request) {
      throw new Error(`Requisição ${requestId} não encontrada no Core (evento ${event.eventType}${orderCode ? `, ordem ${orderCode}` : ''}).`);
    }
    const shipment = shipmentOf(request.formData);
    if (!shipment) throw new Error(`A requisição ${request.code} não é um envio de material para obra: o evento ${event.eventType} não se aplica.`);
    const system = await tx.collaborator.findUnique({ where: { corporateEmail: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
    if (!system) throw new Error('Usuário de sistema "Axis (automático)" ausente: aplique as migrações do Core.');

    const version = asInt(event.payload.request_version) ?? 1;
    let state = logisticsOf(request.formData);
    if (state?.seenEventIds.includes(event.eventId)) return;
    // Evento de uma versão antiga da requisição: o Core já conhece uma mais nova.
    if (state && version < state.requestVersion) return;
    if (!state || version > state.requestVersion) state = emptyLogistics(version);
    state = structuredClone(state);

    const at = event.occurredAt ?? new Date();
    const status = asText(event.payload.status) ?? DEFAULT_STATUS[event.eventType] ?? null;
    if (!status) throw new Error(`Evento "${event.eventType}" sem "status" no payload.`);
    state.orderId = asText(event.payload.fulfillment_order_id) ?? asText(event.payload.order_id) ?? state.orderId;
    state.orderCode = orderCode ?? state.orderCode;
    const reason = asText(event.payload.status_reason);

    let comment: string;
    let auditEvent: string;
    switch (event.eventType) {
      case 'fulfillment.created':
        const applied = mergeStatus(state, 1, status, reason, at);
        // Os itens (pedido, reservado, falta) acompanham a situação mais recente; um `created` atrasado só preenche se não há nada.
        const items = parseCreatedItems(event.payload.items, status);
        if (items.length > 0 && (applied || state.items.length === 0)) state.items = items;
        comment = createdComment(state, status, reason);
        auditEvent = 'request.logistics_order_created';
        break;
      case 'shipment.dispatched': {
        mergeStatus(state, 2, status, reason, at);
        const dispatched = recordShipment(state, event, shipmentSite(shipment));
        comment = dispatched;
        auditEvent = 'request.logistics_dispatched';
        break;
      }
      case 'delivery.confirmed':
      case 'delivery.partial': {
        const complete = event.eventType === 'delivery.confirmed';
        const stage: LogisticsStage = complete && status === 'ENTREGUE' ? 3 : 2;
        mergeStatus(state, stage, status, reason, at);
        const deliveredAt = asDate(event.payload.delivered_at) ?? at;
        recordDelivery(state, event, complete, deliveredAt);
        if (complete) state.deliveredAt = laterOf(state.deliveredAt, deliveredAt);
        comment = deliveryComment(state, event, complete, deliveredAt);
        auditEvent = complete ? 'request.logistics_delivery_confirmed' : 'request.logistics_delivery_partial';
        break;
      }
      default: {
        mergeStatus(state, 2, status, reason, at);
        recordRefusal(state, event, at);
        comment = refusalComment(event);
        auditEvent = 'request.logistics_delivery_refused';
      }
    }
    rememberEvent(state, event.eventId);

    const target: RequestStatus = state.stage === 3 ? 'encerrada' : state.stage === 2 ? 'aguardando_entrega' : 'em_atendimento';
    const currentRank = REQUEST_STATUS_RANK[request.status];
    // `encerrada` e os demais finais (cancelada, reprovada, concluída) nunca são reabertos por um evento atrasado.
    const advances = currentRank !== undefined && (target === 'encerrada' || (REQUEST_STATUS_RANK[target] ?? 0) > currentRank);
    const closedAt = state.deliveredAt ? new Date(state.deliveredAt) : at;

    const formData = { ...(request.formData as Record<string, unknown>), shipment: { ...shipment, logistics: state } };
    await tx.request.update({
      where: { id: request.id },
      data: {
        formData: formData as unknown as Prisma.InputJsonValue,
        ...(advances
          ? target === 'encerrada'
            ? { status: target, closedAt, completedAt: closedAt, requesterAcceptedAt: closedAt }
            : { status: target }
          : {}),
      },
    });
    await tx.requestComment.create({ data: { requestId: request.id, authorId: system.id, visibility: 'publico', body: comment } });
    await tx.auditEvent.create({
      data: {
        aggregateType: 'request',
        aggregateId: request.id,
        event: auditEvent,
        actorId: system.id,
        beforeJson: { status: request.status } as Prisma.InputJsonValue,
        afterJson: {
          status: advances ? target : request.status,
          orderCode: state.orderCode,
          logisticsStatus: state.status,
          eventId: event.eventId,
          satellite: event.satellite.name,
        } as Prisma.InputJsonValue,
        source: 'integration',
      },
    });
    if (advances) {
      if (target === 'encerrada') await this.outbox.record(tx, 'request.completed', { request_id: request.id, code: request.code });
      await this.outbox.record(tx, 'request.status_changed', { request_id: request.id, code: request.code, status: target });
    }
  }
}

function itemText(item: { materialCode: string; quantity: string; unit?: string | null }): string {
  return `${item.materialCode} (${formatQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ''})`;
}

/** Itens do `fulfillment.created`: pedido, reservado e falta por item. Sem `shortage` no evento, deduz pela situação. */
function parseCreatedItems(raw: unknown, status: string): LogisticsItem[] {
  return asObjectArray(raw).flatMap((row) => {
    const materialCode = asText(row.material_code);
    const quantity = asDecimal(row.quantity);
    if (!materialCode || !quantity) return [];
    let reserved = asDecimal(row.reserved);
    let shortage = asDecimal(row.shortage);
    if (shortage === null && reserved !== null) shortage = Prisma.Decimal.max(quantity.minus(reserved), 0);
    if (reserved === null && shortage !== null) reserved = Prisma.Decimal.max(quantity.minus(shortage), 0);
    if (reserved === null && shortage === null) {
      // O evento não detalhou: sem estoque nada foi reservado; reserva completa não tem falta.
      if (status === 'AGUARDANDO_ESTOQUE') {
        reserved = new Prisma.Decimal(0);
        shortage = quantity;
      } else if (status === 'RESERVADA') {
        reserved = quantity;
        shortage = new Prisma.Decimal(0);
      }
    }
    return [
      {
        materialCode,
        description: asText(row.description),
        unit: asText(row.unit),
        quantity: quantity.toFixed(3),
        reserved: reserved?.toFixed(3) ?? null,
        shortage: shortage?.toFixed(3) ?? null,
      },
    ];
  });
}

function parseEventItems(raw: unknown): Array<{ materialCode: string; quantity: string }> {
  return asObjectArray(raw).flatMap((row) => {
    const materialCode = asText(row.material_code);
    const quantity = asDecimal(row.quantity);
    return materialCode && quantity ? [{ materialCode, quantity: quantity.toFixed(3) }] : [];
  });
}

function shortagesText(items: LogisticsItem[]): string {
  const missing = items.filter((item) => item.shortage !== null && new Prisma.Decimal(item.shortage).gt(0));
  if (missing.length === 0) return '';
  return ` Faltam: ${missing.map((item) => `${item.materialCode} — ${formatQuantity(item.shortage!)} de ${formatQuantity(item.quantity)}${item.unit ? ` ${item.unit}` : ''}`).join('; ')}.`;
}

function createdComment(state: ShipmentLogistics, status: string, reason: string | null): string {
  const order = state.orderCode ? `Ordem de atendimento ${state.orderCode}` : 'Ordem de atendimento';
  const shortages = shortagesText(state.items);
  const why = reason ? ` ${reason}` : '';
  switch (status) {
    case 'AGUARDANDO_ESTOQUE':
      return `${order} criada na Logística, aguardando estoque: nenhum item foi reservado.${shortages} A compra do material que falta é aberta pelo Suprimentos.${why}`;
    case 'RESERVADA_PARCIAL':
      return `${order} criada na Logística com reserva parcial do estoque.${shortages} A compra do que falta é aberta pelo Suprimentos.${why}`;
    case 'RESERVADA':
      return `${order} criada na Logística: estoque reservado para todos os itens.${why}`;
    default:
      return `${order} criada na Logística — situação: ${logisticsStatusLabel(status)}.${why}`;
  }
}

function shipmentSite(shipment: NonNullable<ReturnType<typeof shipmentOf>>): string {
  return shipment.destination?.siteCode ?? 'de destino';
}

/** Guarda o volume expedido (um por `shipment_id`) e devolve o comentário "Expedido para o site …". */
function recordShipment(state: ShipmentLogistics, event: InboundEvent, siteCode: string): string {
  const p = event.payload;
  const shipmentId = asText(p.shipment_id) ?? asText(p.shipment_code) ?? event.eventId;
  const dispatchedAt = asDate(p.dispatched_at) ?? event.occurredAt ?? new Date();
  const entry = {
    shipmentId,
    shipmentCode: asText(p.shipment_code),
    manifest: asText(p.manifest),
    carrier: asText(p.carrier),
    route: asText(p.route),
    vehicle: asText(p.vehicle),
    dispatchedAt: dispatchedAt.toISOString(),
    packages: asInt(p.packages),
    items: parseEventItems(p.items),
  };
  const existing = state.shipments.findIndex((row) => row.shipmentId === shipmentId);
  if (existing >= 0) state.shipments[existing] = entry;
  else state.shipments.push(entry);
  state.dispatchedAt = earlierOf(state.dispatchedAt, dispatchedAt);

  const details = [
    entry.manifest ? `romaneio ${entry.manifest}` : entry.shipmentCode ? `remessa ${entry.shipmentCode}` : null,
    entry.carrier ? `transportadora ${entry.carrier}` : null,
    entry.vehicle ? `veículo ${entry.vehicle}` : null,
  ].filter(Boolean);
  return `Expedido para o site ${siteCode}${details.length ? ` — ${details.join(', ')}` : ''} (saída em ${formatDateTimeSp(dispatchedAt)}).`;
}

function recordDelivery(state: ShipmentLogistics, event: InboundEvent, complete: boolean, deliveredAt: Date): void {
  state.deliveries.push({
    eventId: event.eventId,
    shipmentId: asText(event.payload.shipment_id),
    complete,
    deliveredAt: deliveredAt.toISOString(),
    receiverName: asText(event.payload.receiver_name),
    pendingPackages: asInt(event.payload.pending_packages),
    items: parseEventItems(event.payload.items),
  });
}

function recordRefusal(state: ShipmentLogistics, event: InboundEvent, at: Date): void {
  state.refusals.push({
    eventId: event.eventId,
    shipmentId: asText(event.payload.shipment_id),
    refusedAt: (asDate(event.payload.delivered_at) ?? at).toISOString(),
    reason: asText(event.payload.reason),
    items: parseEventItems(event.payload.items),
  });
}

function deliveryComment(state: ShipmentLogistics, event: InboundEvent, complete: boolean, deliveredAt: Date): string {
  const receiver = asText(event.payload.receiver_name);
  const items = parseEventItems(event.payload.items);
  const list = items.length ? ` Entregue agora: ${items.map(itemText).join('; ')}.` : '';
  const when = formatDateTimeSp(deliveredAt);
  if (complete) {
    return `Entrega confirmada no site${receiver ? `, recebida por ${receiver}` : ''} (${when}).${list} Requisição encerrada pela Logística${state.orderCode ? ` (ordem ${state.orderCode})` : ''}.`;
  }
  const pending = asInt(event.payload.pending_packages);
  return `Entrega parcial confirmada no site${receiver ? `, recebida por ${receiver}` : ''} (${when}).${list}${pending ? ` Ainda faltam entregar ${pending} volume(s).` : ''}`;
}

function refusalComment(event: InboundEvent): string {
  const reason = asText(event.payload.reason);
  const items = parseEventItems(event.payload.items);
  return `Entrega recusada no site: ${reason ?? 'motivo não informado'}.${items.length ? ` Itens recusados: ${items.map(itemText).join('; ')}.` : ''} A Logística trata a divergência.`;
}

function laterOf(current: string | null, candidate: Date): string {
  return !current || new Date(current).getTime() < candidate.getTime() ? candidate.toISOString() : current;
}

function earlierOf(current: string | null, candidate: Date): string {
  return !current || new Date(current).getTime() > candidate.getTime() ? candidate.toISOString() : current;
}
