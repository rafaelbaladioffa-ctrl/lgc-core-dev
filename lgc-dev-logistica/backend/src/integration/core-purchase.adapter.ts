/**
 * Compras do Core (`purchase.approved`, `purchase.order_registered`; docs/integracao-centros-de-custo.md §3) → previsão de compra da
 * reposição (`ReplenishmentService.registerPurchase`, o mesmo destino do `purchase_order.approved/changed`).
 *
 * A compra do Core é entregue ao solicitante/obra, não ao almoxarifado: o payload não diz para qual almoxarifado o material vai.
 * Contar toda compra como "compra em aberto" de um almoxarifado esconderia faltas reais na reposição. Por isso:
 *  - só vira previsão quando o payload traz `warehouse_code` (compra destinada a estoque) — hoje o Core **não** manda esse campo,
 *    então os eventos ficam registrados como ignorados, com o motivo;
 *  - grupo `Estoque` (`group_id: "estoque"`) é consumo do estoque da Logística, não compra: fica de fora;
 *  - item sem `material_id` (texto livre) fica de fora; `material_id` é o id do material da Logística (catálogo de compra).
 */
export type CorePurchaseMapping =
  | { kind: 'register'; payload: Record<string, unknown> }
  | { kind: 'ignored'; reason: string };

export const CORE_PURCHASE_EVENTS = ['purchase.approved', 'purchase.order_registered'];

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);

export function adaptCorePurchase(eventType: string, p: Record<string, unknown>): CorePurchaseMapping {
  if (!CORE_PURCHASE_EVENTS.includes(eventType)) return { kind: 'ignored', reason: `${eventType} não altera a reposição.` };
  const requestId = str(p['request_id']);
  if (!requestId) return { kind: 'ignored', reason: 'Compra do Core sem request_id.' };
  const warehouseCode = str(p['warehouse_code']);
  if (!warehouseCode) return { kind: 'ignored', reason: 'Compra do Core sem almoxarifado de destino (entregue ao solicitante): não entra na reposição.' };

  const groups = Array.isArray(p['groups']) ? (p['groups'] as Array<Record<string, unknown>>) : [];
  const items: Array<Record<string, unknown>> = [];
  let expected: string | undefined;
  for (const g of groups) {
    if (!g || typeof g !== 'object' || str(g['group_id']) === 'estoque') continue;
    expected ??= str(g['expected_delivery_date']);
    for (const it of Array.isArray(g['items']) ? (g['items'] as Array<Record<string, unknown>>) : []) {
      const materialId = str(it?.['material_id']);
      if (!materialId) continue;
      items.push({ material_id: materialId, quantity: it['quantity'] });
    }
  }
  if (items.length === 0) return { kind: 'ignored', reason: 'Compra do Core sem itens do catálogo da Logística fora do grupo Estoque.' };
  return {
    kind: 'register',
    payload: {
      // Mesmo id na aprovação e no registro do pedido: o código da requisição de compra do Core (o recebimento casa por ele).
      purchase_order_id: str(p['code']) ?? requestId,
      warehouse_code: warehouseCode,
      expected_date: expected,
      items,
    },
  };
}
