import type { PurchaseDelivery, PurchaseRequestItem, PurchaseSelectionRow } from '../api/requests';

export interface DeliveryGroup {
  groupId: string;
  supplier: string;
  items: Array<{ materialId: string; item: string; quantity: number; total: number | null }>;
}

/** Mesma regra do servidor (`deliveryGroupsOf`): um grupo por fornecedor distinto escolhido (id = quotationId
 * da primeira cotação escolhida dele) e o grupo `estoque` com os itens que não foram comprados. */
export function deliveryGroups(purchaseItems: PurchaseRequestItem[], selection: PurchaseSelectionRow[]): DeliveryGroup[] {
  const groups = new Map<string, DeliveryGroup>();
  const bySupplier = new Map<string, string>();
  const nameOf = (materialId: string) => purchaseItems.find((item) => item.materialId === materialId)?.item ?? materialId;
  for (const row of selection) {
    const key = row.supplier.trim().toLowerCase();
    let groupId = bySupplier.get(key);
    if (!groupId) {
      groupId = row.quotationId;
      bySupplier.set(key, groupId);
      groups.set(groupId, { groupId, supplier: row.supplier.trim(), items: [] });
    }
    groups.get(groupId)!.items.push({ materialId: row.materialId, item: nameOf(row.materialId), quantity: Number(row.quantity), total: Number(row.total) });
  }
  const selected = new Set(selection.map((row) => row.materialId));
  const fromStock = purchaseItems.filter((item) => !selected.has(item.materialId));
  if (fromStock.length > 0) {
    groups.set('estoque', { groupId: 'estoque', supplier: 'Estoque', items: fromStock.map((item) => ({ materialId: item.materialId, item: item.item, quantity: Number(item.quantity), total: null })) });
  }
  return [...groups.values()];
}

/** `aaaa-mm-dd` para `dd/mm/aaaa`, sem passar por Date (não desloca o dia por fuso). */
export function formatIsoDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [year, month, day] = value.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : '—';
}

/** Hoje (aaaa-mm-dd) em America/Sao_Paulo. */
export function todayIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/** Previsão mais distante entre as entregas ainda não recebidas (aaaa-mm-dd), ou null. */
export function latestPendingForecast(deliveries: PurchaseDelivery[]): string | null {
  const dates = deliveries.filter((d) => !d.receivedAt).map((d) => d.expectedDeliveryDate).sort();
  return dates.length ? dates[dates.length - 1] : null;
}
