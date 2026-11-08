import { Prisma } from '@prisma/client';
import { shipmentOf } from './envio-material.js';

/**
 * Situação do envio de material na Logística (PT-09), guardada em `Request.formData.shipment.logistics` e
 * alimentada pelos eventos `fulfillment.created`, `shipment.dispatched` e `delivery.*` que a Logística manda
 * ao Core (docs/integracao-core-logistica.md §4.1). Os eventos podem chegar fora de ordem: o estado só avança
 * (`stage`) e a situação mais recente por etapa vence pela data do evento, nunca pela ordem de chegada.
 */

/** 1 = ordem criada/reservada, 2 = expedida (inclui entrega parcial ou recusada), 3 = entregue por inteiro. */
export type LogisticsStage = 1 | 2 | 3;

export interface LogisticsItem {
  materialCode: string;
  description: string | null;
  unit: string | null;
  /** Texto decimal: quantidade pedida. */
  quantity: string;
  /** Quanto a Logística reservou; `null` quando o evento não informou. */
  reserved: string | null;
  /** Quanto falta (pedido − reservado); `null` quando o evento não informou. */
  shortage: string | null;
}

export interface LogisticsShipment {
  shipmentId: string;
  shipmentCode: string | null;
  manifest: string | null;
  carrier: string | null;
  route: string | null;
  vehicle: string | null;
  dispatchedAt: string | null;
  packages: number | null;
  items: Array<{ materialCode: string; quantity: string }>;
}

export interface LogisticsDelivery {
  eventId: string;
  shipmentId: string | null;
  /** `true` em `delivery.confirmed` (nada pendente), `false` em `delivery.partial`. */
  complete: boolean;
  deliveredAt: string | null;
  receiverName: string | null;
  pendingPackages: number | null;
  /** O entregue NESTA confirmação, por material. */
  items: Array<{ materialCode: string; quantity: string }>;
}

export interface LogisticsRefusal {
  eventId: string;
  shipmentId: string | null;
  refusedAt: string | null;
  reason: string | null;
  items: Array<{ materialCode: string; quantity: string }>;
}

export interface ShipmentLogistics {
  orderId: string | null;
  orderCode: string | null;
  requestVersion: number;
  /** Situação da ordem na Logística (`RESERVADA`, `AGUARDANDO_ESTOQUE`, `EXPEDIDA`, `ENTREGUE`, `DIVERGENCIA`, …). */
  status: string;
  statusReason: string | null;
  /** Instante do evento que definiu `status` (ISO); desempata eventos da mesma etapa. */
  statusAt: string | null;
  stage: LogisticsStage;
  items: LogisticsItem[];
  shipments: LogisticsShipment[];
  deliveries: LogisticsDelivery[];
  refusals: LogisticsRefusal[];
  dispatchedAt: string | null;
  deliveredAt: string | null;
  /** Ids dos eventos já aplicados (últimos 200): garante que repetir um evento não soma duas vezes. */
  seenEventIds: string[];
}

export const LOGISTICS_STATUS_LABEL: Record<string, string> = {
  RESERVADA: 'Estoque reservado',
  RESERVADA_PARCIAL: 'Reserva parcial (falta material)',
  AGUARDANDO_ESTOQUE: 'Aguardando estoque',
  AGUARDANDO_INFORMACAO: 'Aguardando informação',
  BLOQUEADA: 'Bloqueada',
  EM_ANALISE: 'Em análise',
  EXPEDIDA: 'Expedida',
  ENTREGUE: 'Entregue',
  DIVERGENCIA: 'Divergência na entrega',
};

export function logisticsStatusLabel(status: string): string {
  return LOGISTICS_STATUS_LABEL[status] ?? status;
}

/** Lê `formData.shipment.logistics`; `null` enquanto a Logística não avisou nada. */
export function logisticsOf(formData: Prisma.JsonValue | null | undefined): ShipmentLogistics | null {
  const logistics = (shipmentOf(formData) as { logistics?: unknown } | null)?.logistics;
  return logistics && typeof logistics === 'object' ? (logistics as ShipmentLogistics) : null;
}

const MAX_SEEN_EVENTS = 200;

export function emptyLogistics(requestVersion: number): ShipmentLogistics {
  return {
    orderId: null,
    orderCode: null,
    requestVersion,
    status: 'EM_ANALISE',
    statusReason: null,
    statusAt: null,
    stage: 1,
    items: [],
    shipments: [],
    deliveries: [],
    refusals: [],
    dispatchedAt: null,
    deliveredAt: null,
    seenEventIds: [],
  };
}

export function rememberEvent(state: ShipmentLogistics, eventId: string): void {
  state.seenEventIds = [...state.seenEventIds, eventId].slice(-MAX_SEEN_EVENTS);
}

/**
 * Aplica a situação de um evento: só vale se a etapa é maior que a guardada ou, na mesma etapa, se o evento é
 * mais recente (ou igual). Evento atrasado (etapa menor) não faz a situação voltar. Devolve se a situação foi trocada.
 */
export function mergeStatus(
  state: ShipmentLogistics,
  stage: LogisticsStage,
  status: string,
  reason: string | null,
  at: Date,
): boolean {
  const stored = state.statusAt ? new Date(state.statusAt).getTime() : -Infinity;
  if (stage > state.stage || (stage === state.stage && at.getTime() >= stored)) {
    state.status = status;
    state.statusReason = reason;
    state.statusAt = at.toISOString();
    state.stage = stage;
    return true;
  }
  return false;
}

/** Soma o entregue por material em todas as confirmações recebidas (`delivery.confirmed` e `delivery.partial`). */
export function deliveredByMaterial(state: Pick<ShipmentLogistics, 'deliveries'>): Map<string, Prisma.Decimal> {
  const totals = new Map<string, Prisma.Decimal>();
  for (const delivery of state.deliveries) {
    for (const item of delivery.items) {
      totals.set(item.materialCode, (totals.get(item.materialCode) ?? new Prisma.Decimal(0)).plus(item.quantity));
    }
  }
  return totals;
}

/** Itens que a reserva não cobriu por inteiro (falta > 0), para o aviso da tela. */
export function shortageItems(state: Pick<ShipmentLogistics, 'items'>): LogisticsItem[] {
  return state.items.filter((item) => item.shortage !== null && new Prisma.Decimal(item.shortage).gt(0));
}

/** Texto decimal sem zeros à direita (`"1200.000"` → `"1200"`). */
export function formatQuantity(value: string | Prisma.Decimal): string {
  return new Prisma.Decimal(value).toDecimalPlaces(3).toString();
}
