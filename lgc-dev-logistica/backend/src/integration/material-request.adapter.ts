import { BadRequestException } from '@nestjs/common';
import type { CreateFulfillmentDto } from '../fulfillment/fulfillment.dto.js';

/**
 * Adaptador evento legado → evento de domínio (PLANNING_LOGISTICA.md 0.4).
 *
 * Hoje o Axis só publica `ticket.status_changed`; Logística o traduz em `material_request.approved` /
 * `material_request.cancel_requested`. Quando o Axis publicar os eventos dedicados (`material_request.*`),
 * eles já são aceitos aqui no mesmo formato — só este arquivo muda, o resto de Logística não.
 *
 * Payload aceito (ticket legado e `material_request.*`; envio de material para obra: plano §4.3):
 *   { request_id | ticket_id, category?, status?, version?, project_id?, cost_center_id?, requester_id?, recipient_id?,
 *     warehouse_code?, needed_by?, notes?,
 *     destination?: { site_id?, site_code?, address?, city?, state?, latitude?, longitude? },
 *     items: [{ material_code | material_id, quantity, notes? }] }
 * `quantity` pode vir número ou string decimal ("1200.000", até 6 casas); `latitude`/`longitude` número ou string.
 */
export type DomainRequestEvent =
  | { kind: 'approved'; order: CreateFulfillmentDto }
  | { kind: 'cancel_requested'; axisRequestId: string; reason: string };

export const MATERIAL_REQUEST_CATEGORIES = ['Requisição de material/insumo', 'Requisição de material em estoque'];
const OPEN_STATUSES = ['aberto'];
const CANCEL_STATUSES = ['cancelado'];

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

const QUANTITY = /^\d+(\.\d{1,6})?$/;

/** Quantidade positiva: número finito ou string decimal estrita (sem notação científica, até 6 casas). */
function toQuantity(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && QUANTITY.test(raw.trim()) ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Coordenada opcional (número ou string decimal) dentro do intervalo; ausente/nula vira undefined. */
function toCoordinate(raw: unknown, limit: number, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  if (!Number.isFinite(n) || Math.abs(n) > limit) throw new BadRequestException(`destination.${label} inválida.`);
  return Math.round(n * 1e6) / 1e6;
}

/** `destination` do envio para obra → campos de destino da ordem. Ausente = ordem sem destino (retirada/ticket legado). */
function toDestination(raw: unknown): Pick<CreateFulfillmentDto, 'destinationSiteAxisId' | 'destinationText' | 'destinationLat' | 'destinationLng'> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('destination inválido: esperado um objeto.');
  const d = raw as Record<string, unknown>;
  const lat = toCoordinate(d['latitude'], 90, 'latitude');
  const lng = toCoordinate(d['longitude'], 180, 'longitude');
  if ((lat === undefined) !== (lng === undefined)) throw new BadRequestException('destination: latitude e longitude devem vir juntas.');
  const place = [str(d['city']), str(d['state'])].filter(Boolean).join('/');
  const text = [str(d['site_code']), [str(d['address']), place].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  return { destinationSiteAxisId: str(d['site_id']), destinationText: text ? text.slice(0, 300) : undefined, destinationLat: lat, destinationLng: lng };
}

function toOrder(p: Record<string, unknown>, id: string): CreateFulfillmentDto {
  const rawItems = p['items'];
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new BadRequestException('Requisição sem itens: não é possível criar a ordem de atendimento.');
  const items = (rawItems as Array<Record<string, unknown>>).map((it) => {
    const quantity = toQuantity(it?.['quantity']);
    if (quantity === null) throw new BadRequestException('Item com quantidade inválida na requisição.');
    return { materialId: str(it['material_id']), materialCode: str(it['material_code']), quantity, notes: str(it['notes']) };
  });
  return {
    axisRequestId: id,
    requestVersion: typeof p['version'] === 'number' ? p['version'] : 1,
    projectAxisId: str(p['project_id']),
    costCenterAxisId: str(p['cost_center_id']),
    requesterAxisId: str(p['requester_id']),
    recipientAxisId: str(p['recipient_id']),
    warehouseCode: str(p['warehouse_code']),
    neededBy: str(p['needed_by']),
    notes: str(p['notes']),
    ...toDestination(p['destination']),
    items,
  };
}

/** Retorna null para eventos que Logística não consome (outras categorias, outros status). */
export function adaptMaterialRequestEvent(eventType: string, p: Record<string, unknown>): DomainRequestEvent | null {
  switch (eventType) {
    case 'material_request.approved':
    case 'material_request.changed': {
      const id = str(p['request_id']) ?? str(p['ticket_id']);
      if (!id) throw new BadRequestException('request_id ausente.');
      return { kind: 'approved', order: toOrder(p, id) };
    }
    case 'material_request.cancel_requested': {
      const id = str(p['request_id']) ?? str(p['ticket_id']);
      if (!id) throw new BadRequestException('request_id ausente.');
      return { kind: 'cancel_requested', axisRequestId: id, reason: str(p['reason']) ?? 'Cancelamento solicitado no Axis' };
    }
    case 'ticket.status_changed': {
      const category = str(p['category']);
      if (!category || !MATERIAL_REQUEST_CATEGORIES.includes(category)) return null; // ex.: "Solicitação de compra" é tratada na reposição (Sprint 8)
      const id = str(p['ticket_id']);
      if (!id) throw new BadRequestException('ticket_id ausente.');
      const status = str(p['status'])?.toLowerCase();
      if (status && OPEN_STATUSES.includes(status)) return { kind: 'approved', order: toOrder(p, id) };
      if (status && CANCEL_STATUSES.includes(status)) return { kind: 'cancel_requested', axisRequestId: id, reason: str(p['reason']) ?? 'Chamado cancelado no Axis' };
      return null;
    }
    default:
      return null;
  }
}
