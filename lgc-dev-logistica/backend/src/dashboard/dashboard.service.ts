import { BadRequestException, Injectable } from '@nestjs/common';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AvailabilityService, todayBR } from '../stock/availability.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import { axisLabels } from '../common/axis-cache.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const pct = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 10_000) / 100);
const avgH = (pairs: Array<[Date | null | undefined, Date | null | undefined]>) => {
  const v = pairs.filter((p): p is [Date, Date] => !!p[0] && !!p[1] && p[1] >= p[0]).map(([a, b]) => (b.getTime() - a.getTime()) / HOUR);
  return v.length === 0 ? null : Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10;
};

const brl = (v: Prisma.Decimal) => Number(v.toString()).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Soma o valor de consumo (já líquido de estornos) por uma chave — projeto ou centro de custo — e ordena
 * do maior para o menor. `value` é decimal com 2 casas; `valueBRL` já vem formatado em pt-BR.
 */
export function sumValueBy<R extends { value: Prisma.Decimal.Value; movements: number }>(rows: R[], key: (r: R) => string | null) {
  const acc = new Map<string | null, { value: Prisma.Decimal; movements: number }>();
  for (const r of rows) {
    const k = key(r);
    const cur = acc.get(k) ?? { value: D(0), movements: 0 };
    cur.value = cur.value.plus(D(r.value));
    cur.movements += Number(r.movements);
    acc.set(k, cur);
  }
  return [...acc.entries()].sort((a, b) => b[1].value.comparedTo(a[1].value)).map(([k, v]) => ({ key: k, value: v.value.toFixed(2), valueBRL: brl(v.value), movements: v.movements }));
}

export class KpiQuery {
  @IsOptional() @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId?: string;
  @IsOptional() @IsDateString({}, { message: 'Data inicial inválida.' }) from?: string;
  @IsOptional() @IsDateString({}, { message: 'Data final inválida.' }) to?: string;
}

/**
 * Indicadores (18). Sempre agregados por processo, projeto ou item — nunca ranking individual de
 * produtividade (não usar isoladamente para punição). Custos só com `material:read_cost`.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly availability: AvailabilityService,
  ) {}

  async kpis(q: KpiQuery, user: AuthenticatedUser) {
    if (q.warehouseId) await this.rbac.assertWarehouseAccess(user, q.warehouseId);
    const allowed = await this.rbac.accessibleWarehouseIds(user);
    const whFilter: string[] | undefined = q.warehouseId ? [q.warehouseId] : allowed === 'ALL' ? undefined : allowed;
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 90 * DAY);
    const to = q.to ? new Date(q.to) : new Date();
    if (from > to) throw new BadRequestException('Período inválido: a data inicial é posterior à final.');
    const canCost = user.permissions.includes('material:read_cost');
    const inWh = whFilter ? { in: whFilter } : undefined;

    // Acuracidade: linhas de inventários concluídos no período que conferiram na contagem.
    const counted = await this.prisma.stockCountLine.groupBy({ by: ['status'], where: { count: { status: 'CONCLUIDA', closedAt: { gte: from, lte: to }, ...(inWh && { warehouseId: inWh }) }, status: { in: ['CONFERIDO', 'DIVERGENTE'] } }, _count: { _all: true } });
    const ok = counted.find((c) => c.status === 'CONFERIDO')?._count._all ?? 0;
    const bad = counted.find((c) => c.status === 'DIVERGENTE')?._count._all ?? 0;

    // Ciclo do atendimento e nível de serviço (fill rate) das ordens criadas no período.
    const orders = await this.prisma.fulfillmentOrder.findMany({ where: { createdAt: { gte: from, lte: to }, ...(inWh && { warehouseId: inWh }) }, take: 2000 });
    const orderIds = orders.map((o) => o.id);
    const firstResv = await this.prisma.reservation.groupBy({ by: ['itemId'], where: { item: { orderId: { in: orderIds } } }, _min: { createdAt: true } });
    const itemOrder = new Map((await this.prisma.fulfillmentItem.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, orderId: true } })).map((i) => [i.id, i.orderId]));
    const resvAt = new Map<string, Date>();
    for (const r of firstResv) { const oid = itemOrder.get(r.itemId)!; const d = r._min.createdAt!; if (!resvAt.has(oid) || d < resvAt.get(oid)!) resvAt.set(oid, d); }
    const tasks = await this.prisma.pickingTask.findMany({ where: { orderId: { in: orderIds }, completedAt: { not: null } }, select: { orderId: true, completedAt: true } });
    const ships = await this.prisma.shipment.findMany({ where: { orderId: { in: orderIds } }, include: { proofs: { where: { outcome: { in: ['ENTREGUE', 'PARCIAL'] } }, orderBy: { deliveredAt: 'asc' } } } });
    const taskAt = new Map(tasks.map((t) => [t.orderId, t.completedAt]));
    const shipByOrder = new Map(ships.map((s) => [s.orderId, s]));
    const delivered = orders.filter((o) => o.status === 'ENTREGUE' || o.status === 'ENCERRADA');
    const onTime = delivered.filter((o) => { const lastProof = shipByOrder.get(o.id)?.proofs.at(-1); return !!lastProof && (!o.neededBy || lastProof.deliveredAt <= new Date(o.neededBy.getTime() + DAY - 1)); });

    // Estoque: ruptura, cobertura e giro por política.
    const policies = await this.prisma.stockPolicy.findMany({ where: { ...(inWh && { warehouseId: inWh }) }, take: 500 });
    let stockouts = 0, belowMin = 0;
    const coverage: number[] = [];
    for (const p of policies) {
      const [av] = await this.availability.compute([p.materialId], { warehouseId: p.warehouseId });
      const available = D(av.available);
      if (available.lte(0)) stockouts++;
      if (available.lt(p.minQty)) belowMin++;
      const out = await this.prisma.stockMovement.aggregate({ where: { materialId: p.materialId, type: 'SAIDA_ENTREGA', reversesMovementId: null, fromLocation: { warehouseId: p.warehouseId }, effectiveAt: { gte: new Date(Date.now() - 90 * DAY) } }, _sum: { quantity: true } });
      const daily = D(out._sum.quantity ?? 0).div(90);
      if (daily.gt(0)) coverage.push(Number(available.div(daily).toFixed(1)));
    }

    // Vencimentos próximos (30/60/90) com saldo.
    const today = todayBR();
    const lotsExp = await this.prisma.lot.findMany({ where: { expiresAt: { lte: new Date(today.getTime() + 90 * DAY) }, balances: { some: { quantity: { gt: 0 }, ...(inWh && { location: { warehouseId: inWh } }) } } }, select: { expiresAt: true } });
    const expiring = { vencidos: 0, ate30: 0, ate60: 0, ate90: 0 };
    for (const l of lotsExp) { const d = Math.floor((l.expiresAt!.getTime() - today.getTime()) / DAY); if (d < 0) expiring.vencidos++; else if (d <= 30) expiring.ate30++; else if (d <= 60) expiring.ate60++; else expiring.ate90++; }

    // Consumo por projeto e centro de custo (agregado).
    const consumption = await this.prisma.stockMovement.groupBy({ by: ['projectAxisId', 'costCenterAxisId'], where: { type: 'SAIDA_ENTREGA', reversesMovementId: null, effectiveAt: { gte: from, lte: to }, ...(inWh && { fromLocation: { warehouseId: inWh } }) }, _sum: { quantity: true }, _count: { _all: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 10 });
    // Valor em R$: o estorno de uma entrega também é SAIDA_ENTREGA (origem e destino trocados) e entra
    // negativo no período em que foi lançado; por isso o almoxarifado é o da origem ou, no estorno, o do destino.
    const whClause = whFilter && whFilter.length > 0 ? Prisma.sql`AND COALESCE(from_location_id, to_location_id) IN (SELECT id FROM locations WHERE warehouse_id IN (${Prisma.join(whFilter)}))` : whFilter ? Prisma.sql`AND false` : Prisma.empty;
    const consumptionValue = canCost ? await this.prisma.$queryRaw<Array<{ project: string | null; cost_center: string | null; value: Prisma.Decimal; movements: number }>>`SELECT project_axis_id AS project, cost_center_axis_id AS cost_center, SUM(CASE WHEN reverses_movement_id IS NULL THEN 1 ELSE -1 END * quantity * COALESCE(unit_cost, 0)) AS value, COUNT(*)::int AS movements FROM stock_movements WHERE type = 'SAIDA_ENTREGA' AND effective_at BETWEEN ${from} AND ${to} ${whClause} GROUP BY project_axis_id, cost_center_axis_id` : [];

    // Recebimento: divergências por fornecedor. Perdas e ajustes por tipo.
    const receipts = await this.prisma.receipt.groupBy({ by: ['supplierAxisId', 'hasDivergence'], where: { createdAt: { gte: from, lte: to }, status: { not: 'AGENDADO' }, ...(inWh && { warehouseId: inWh }) }, _count: { _all: true } });
    const bySupplier = new Map<string, { total: number; divergentes: number }>();
    for (const r of receipts) { const k = r.supplierAxisId ?? 'sem fornecedor'; const cur = bySupplier.get(k) ?? { total: 0, divergentes: 0 }; cur.total += r._count._all; if (r.hasDivergence) cur.divergentes += r._count._all; bySupplier.set(k, cur); }
    const losses = await this.prisma.stockMovement.groupBy({ by: ['type'], where: { type: { in: ['AJUSTE_NEGATIVO', 'AJUSTE_POSITIVO', 'BAIXA_PERDA', 'DESCARTE'] }, effectiveAt: { gte: from, lte: to }, ...(inWh && { OR: [{ fromLocation: { warehouseId: inWh } }, { toLocation: { warehouseId: inWh } }] }) }, _sum: { quantity: true }, _count: { _all: true } });

    // Custódia, trânsito, ocupação, integração e alertas.
    const custody = await this.prisma.custodyTerm.groupBy({ by: ['status'], _count: { _all: true } });
    const overdue = await this.prisma.custodyTerm.count({ where: { status: 'ATIVO', expectedReturnAt: { lt: today } } });
    const inTransit = await this.prisma.transfer.findMany({ where: { status: 'EM_TRANSITO', ...(inWh && { OR: [{ fromWarehouseId: inWh }, { toWarehouseId: inWh }] }) }, select: { dispatchedAt: true } });
    const capLocs = await this.prisma.location.findMany({ where: { capacityKind: 'QUANTIDADE', capacityValue: { gt: 0 }, isVirtual: false, ...(inWh && { warehouseId: inWh }) }, select: { id: true, code: true, capacityValue: true, balances: { where: { quantity: { gt: 0 } }, select: { quantity: true } } }, take: 500 });
    const occupancy = capLocs.map((l) => ({ code: l.code, pct: Number(l.balances.reduce((s, b) => s.plus(b.quantity), D(0)).div(l.capacityValue!).times(100).toFixed(1)) })).sort((a, b) => b.pct - a.pct);
    const [pendingOut, failedIn, lastIn] = await Promise.all([
      this.prisma.integrationMessage.count({ where: { direction: 'OUTBOUND', status: 'PENDING' } }),
      this.prisma.integrationMessage.count({ where: { direction: 'INBOUND', status: 'FAILED' } }),
      this.prisma.integrationMessage.findFirst({ where: { direction: 'INBOUND' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    const alerts = await this.prisma.alert.groupBy({ by: ['severity'], where: { status: { in: ['ABERTO', 'RECONHECIDO'] } }, _count: { _all: true } });
    const emergency = await this.prisma.receipt.count({ where: { createdAt: { gte: from, lte: to }, exceptionApprovalRef: { not: null }, ...(inWh && { warehouseId: inWh }) } });

    // Nomes de projeto e centro de custo pelo cache do Core (id sem cadastro aparece como o próprio id).
    const projectNames = await axisLabels(this.prisma, ['PROJECT'], [...consumption.map((c) => c.projectAxisId), ...consumptionValue.map((v) => v.project)]);
    const ccNames = await axisLabels(this.prisma, ['COST_CENTER'], [...consumption.map((c) => c.costCenterAxisId), ...consumptionValue.map((v) => v.cost_center)]);
    const nameOf = (names: Map<string, string>, id: string | null) => (id ? (names.get(id) ?? id) : null);

    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      accuracy: { counted: ok + bad, matched: ok, pct: pct(ok, ok + bad) },
      serviceLevel: { orders: orders.length, delivered: delivered.length, onTime: onTime.length, fillRatePct: pct(onTime.length, delivered.length) },
      cycleHours: {
        approvalToReservation: avgH(orders.map((o) => [o.createdAt, resvAt.get(o.id)])),
        reservationToPicking: avgH(orders.map((o) => [resvAt.get(o.id), taskAt.get(o.id)])),
        pickingToDispatch: avgH(orders.map((o) => [taskAt.get(o.id), shipByOrder.get(o.id)?.dispatchedAt])),
        dispatchToDelivery: avgH(orders.map((o) => [shipByOrder.get(o.id)?.dispatchedAt, shipByOrder.get(o.id)?.proofs[0]?.deliveredAt])),
      },
      stock: { policies: policies.length, stockouts, belowMin, avgCoverageDays: coverage.length ? Math.round((coverage.reduce((s, x) => s + x, 0) / coverage.length) * 10) / 10 : null },
      expiring,
      consumption: {
        top: consumption.map((c) => ({ project: c.projectAxisId, projectLabel: nameOf(projectNames, c.projectAxisId), costCenter: c.costCenterAxisId, costCenterLabel: nameOf(ccNames, c.costCenterAxisId), quantity: c._sum.quantity?.toString(), movements: c._count._all })),
        ...(canCost && {
          valueByProject: sumValueBy(consumptionValue, (v) => v.project).map(({ key, ...v }) => ({ project: key, projectLabel: nameOf(projectNames, key), ...v })),
          valueByCostCenter: sumValueBy(consumptionValue, (v) => v.cost_center).map(({ key, ...v }) => ({ costCenter: key, costCenterLabel: nameOf(ccNames, key), ...v })),
        }),
      },
      receiving: { bySupplier: [...bySupplier.entries()].map(([supplier, v]) => ({ supplier, ...v, divergencePct: pct(v.divergentes, v.total) })), withoutOrderException: emergency },
      lossesAndAdjustments: losses.map((l) => ({ type: l.type, movements: l._count._all, quantity: l._sum.quantity?.toString() })),
      custody: { byStatus: Object.fromEntries(custody.map((c) => [c.status, c._count._all])), overdue },
      transit: { count: inTransit.length, avgHours: avgH(inTransit.map((t) => [t.dispatchedAt, new Date()])) },
      occupancy: { locationsWithCapacity: occupancy.length, top: occupancy.slice(0, 10) },
      integration: { pendingOutbound: pendingOut, failedInbound: failedIn, lastInboundAt: lastIn?.createdAt.toISOString() ?? null },
      alerts: Object.fromEntries(alerts.map((a) => [a.severity, a._count._all])),
    };
  }
}
