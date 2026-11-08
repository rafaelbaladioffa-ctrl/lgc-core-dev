import { Prisma } from '@prisma/client';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Brasil não tem horário de verão desde 2019: America/Sao_Paulo é sempre UTC−03:00.
 * Devolve o intervalo [start, end) em UTC da competência `AAAA-MM` no fuso de São Paulo.
 */
export function competenceRange(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new Error('Competência inválida: use AAAA-MM.');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return { start: new Date(Date.UTC(y, mo - 1, 1, 3)), end: new Date(Date.UTC(y, mo, 1, 3)) };
}

/** Linha de saída de entrega (ou estorno dela) do ledger, só com o que o cálculo de valor usa. */
export interface DeliveryRow {
  quantity: Prisma.Decimal.Value;
  unitCost: Prisma.Decimal.Value | null;
  costCenterAxisId: string | null;
  projectAxisId: string | null;
  reversesMovementId: string | null;
}

export interface ConsumptionByCostCenter {
  cost_center_id: string | null;
  project_id: string | null;
  value: string;
  movements: number;
}

/**
 * Valor das saídas de entrega por centro de custo e projeto: Σ quantidade × custo unitário histórico.
 * O estorno de uma saída (movimento com `reversesMovementId`) também é `SAIDA_ENTREGA`, com a data do
 * estorno; ele entra com sinal negativo na competência em que foi lançado, como no razão contábil —
 * assim um mês já importado pelo Financeiro não muda. `movements` conta saídas e estornos lançados.
 * Custo ausente vale zero (o custo vem do Axis e pode faltar em material novo).
 */
export function aggregateConsumption(rows: DeliveryRow[]): ConsumptionByCostCenter[] {
  const acc = new Map<string, { cc: string | null; project: string | null; value: Prisma.Decimal; movements: number }>();
  for (const r of rows) {
    const key = `${r.costCenterAxisId ?? ''}|${r.projectAxisId ?? ''}`;
    const cur = acc.get(key) ?? { cc: r.costCenterAxisId, project: r.projectAxisId, value: D(0), movements: 0 };
    const line = D(r.quantity).times(D(r.unitCost ?? 0));
    cur.value = r.reversesMovementId ? cur.value.minus(line) : cur.value.plus(line);
    cur.movements += 1;
    acc.set(key, cur);
  }
  return [...acc.values()]
    .map((v) => ({ cost_center_id: v.cc, project_id: v.project, value: v.value.toFixed(2), movements: v.movements }))
    .sort((a, b) => (a.cost_center_id ?? '￿').localeCompare(b.cost_center_id ?? '￿') || (a.project_id ?? '￿').localeCompare(b.project_id ?? '￿'));
}

/** Termo de custódia ativo com o custo do material (custo médio; na falta, o último custo). */
export interface CustodyRow {
  custodianAxisId: string;
  quantity: Prisma.Decimal.Value;
  returnedQty: Prisma.Decimal.Value;
  material: { averageCost: Prisma.Decimal.Value | null; lastCost: Prisma.Decimal.Value | null };
}

export interface CustodyValue {
  custodian_id: string;
  items: number;
  value: string;
}

/** Bens em custódia ativa por colaborador: `items` = termos ativos; `value` = Σ saldo não devolvido × custo. */
export function aggregateCustody(rows: CustodyRow[]): CustodyValue[] {
  const acc = new Map<string, { items: number; value: Prisma.Decimal }>();
  for (const t of rows) {
    const open = D(t.quantity).minus(D(t.returnedQty));
    if (open.lte(0)) continue;
    const cost = D(t.material.averageCost ?? t.material.lastCost ?? 0);
    const cur = acc.get(t.custodianAxisId) ?? { items: 0, value: D(0) };
    cur.items += 1;
    cur.value = cur.value.plus(open.times(cost));
    acc.set(t.custodianAxisId, cur);
  }
  return [...acc.entries()].map(([custodian_id, v]) => ({ custodian_id, items: v.items, value: v.value.toFixed(2) })).sort((a, b) => a.custodian_id.localeCompare(b.custodian_id));
}
