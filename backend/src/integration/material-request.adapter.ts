import { BadRequestException } from '@nestjs/common';
import type { CreateFulfillmentDto } from '../fulfillment/fulfillment.dto.js';

/**
 * Adaptador evento legado → evento de domínio (PLANNING_LOGISTICA.md 0.4).
 *
 * Hoje o Axis só publica `ticket.status_changed`; Logística o traduz em `material_request.approved` /
 * `material_request.cancel_requested`. Quando o Axis publicar os eventos dedicados (`material_request.*`),
 * eles já são aceitos aqui no mesmo formato — só este arquivo muda, o resto de Logística não.
 *
 * ATENÇÃO — contrato assumido do payload do ticket (a confirmar com o Axis core, que ainda não publica o evento):
 *   { ticket_id, category, status, version?, project_id?, cost_center_id?, requester_id?, recipient_id?,
 *     warehouse_code?, needed_by?, notes?, items: [{ material_code | material_id, quantity, notes? }] }
 */
export type DomainRequestEvent =
  | { kind: 'approved'; order: CreateFulfillmentDto }
  | { kind: 'cancel_requested'; axisRequestId: string; reason: string };

export const MATERIAL_REQUEST_CATEGORIES = ['Requisição de material/insumo', 'Requisição de material em estoque'];
const OPEN_STATUSES = ['aberto'];
const CANCEL_STATUSES = ['cancelado'];

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

function toOrder(p: Record<string, unknown>, id: string): CreateFulfillmentDto {
  const rawItems = p['items'];
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new BadRequestException('Requisição sem itens: não é possível criar a ordem de atendimento.');
  for (const it of rawItems as Array<Record<string, unknown>>) {
    if (!Number.isFinite(Number(it['quantity'])) || Number(it['quantity']) <= 0) throw new BadRequestException('Item com quantidade inválida na requisição.');
  }
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
    items: rawItems.map((it: Record<string, unknown>) => ({ materialId: str(it['material_id']), materialCode: str(it['material_code']), quantity: Number(it['quantity']), notes: str(it['notes']) })),
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
