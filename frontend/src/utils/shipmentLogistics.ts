import type { ShipmentLogistics } from '../api/requests';

/** Situação da ordem na Logística em português (os códigos vêm dos eventos `fulfillment.*`, `shipment.*` e `delivery.*`). */
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

export type LogisticsTone = 'default' | 'success' | 'warning' | 'danger';

export function logisticsStatusLabel(status: string): string {
  return LOGISTICS_STATUS_LABEL[status] ?? status;
}

export function logisticsTone(status: string): LogisticsTone {
  if (status === 'ENTREGUE') return 'success';
  if (['AGUARDANDO_ESTOQUE', 'RESERVADA_PARCIAL', 'AGUARDANDO_INFORMACAO', 'EM_ANALISE'].includes(status)) return 'warning';
  if (['BLOQUEADA', 'DIVERGENCIA'].includes(status)) return 'danger';
  return 'default';
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Soma o entregue por material em todas as confirmações (`delivery.confirmed` e `delivery.partial`). */
export function deliveredByMaterial(logistics: Pick<ShipmentLogistics, 'deliveries'> | undefined): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const delivery of logistics?.deliveries ?? []) {
    for (const item of delivery.items) totals[item.materialCode] = round3((totals[item.materialCode] ?? 0) + Number(item.quantity));
  }
  return totals;
}

/** Itens que a reserva não cobriu por inteiro (falta > 0). */
export function shortageItems(logistics: Pick<ShipmentLogistics, 'items'> | undefined) {
  return (logistics?.items ?? []).filter((item) => item.shortage !== null && Number(item.shortage) > 0);
}
