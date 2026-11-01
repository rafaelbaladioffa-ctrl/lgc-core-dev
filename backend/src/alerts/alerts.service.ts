import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { AlertKind, AlertSeverity } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AvailabilityService, todayBR } from '../stock/availability.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

interface Candidate {
  dedupeKey: string;
  kind: AlertKind;
  severity: AlertSeverity;
  warehouseId?: string | null;
  refType?: string;
  refId?: string;
  message: string;
  responsibleRole: string;
  data?: Record<string, unknown>;
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export class ListAlertsQuery {
  @IsOptional() @IsIn(['ABERTO', 'RECONHECIDO', 'RESOLVIDO']) status?: 'ABERTO' | 'RECONHECIDO' | 'RESOLVIDO';
  @IsOptional() @IsIn(['INFO', 'ATENCAO', 'CRITICO']) severity?: 'INFO' | 'ATENCAO' | 'CRITICO';
  @IsOptional() @IsUUID('all') warehouseId?: string;
  @IsOptional() @IsIn(['ALMOXARIFE', 'GESTOR_ALMOXARIFADO', 'COMPRAS', 'HSE_QUALIDADE', 'CONTROLE_PATRIMONIO', 'ADMIN_TECNICO']) role?: string;
}

/** Varredura de alertas (19): idempotente por chave; o que deixa de valer é resolvido sozinho. */
@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly availability: AvailabilityService,
    private readonly config: ConfigService,
  ) {}

  private num(key: string, fallback: number) {
    const v = Number(this.config.get(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }

  private async collect(): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const now = Date.now();
    const today = todayBR();

    // 1) Reposição / ruptura prevista (considera demanda aprovada).
    const policies = await this.prisma.stockPolicy.findMany({ orderBy: { updatedAt: 'desc' }, take: 5000 });
    const mats = new Map((await this.prisma.material.findMany({ where: { id: { in: [...new Set(policies.map((p) => p.materialId))] } } })).map((m) => [m.id, m]));
    // Disponibilidade em lote: um cálculo por (almoxarifado, lead time), não por política.
    const groups = new Map<string, typeof policies>();
    for (const p of policies) { const m = mats.get(p.materialId); if (!m || m.status !== 'ATIVO') continue; const k = `${p.warehouseId}|${m.leadTimeDays ?? 0}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
    for (const [key, group] of groups) {
      const [warehouseId, lead] = key.split('|');
      const avs = new Map((await this.availability.compute(group.map((g) => g.materialId), { warehouseId, neededBy: new Date(today.getTime() + Number(lead) * DAY) })).map((a) => [a.material_id, a]));
      for (const p of group) {
        const m = mats.get(p.materialId)!;
        const av = avs.get(p.materialId)!;
        const available = new Prisma.Decimal(av.available);
        const rp = p.reorderPoint ?? p.minQty.plus(p.safetyQty);
        if (available.lte(0)) out.push({ dedupeKey: `policy:${p.id}`, kind: 'ESTOQUE_ABAIXO_PONTO_REPOSICAO', severity: 'CRITICO', warehouseId: p.warehouseId, refType: 'material', refId: p.materialId, message: `${m.code}: sem estoque disponível.`, responsibleRole: 'COMPRAS', data: { available: av.available } });
        else if (available.lte(rp)) out.push({ dedupeKey: `policy:${p.id}`, kind: 'ESTOQUE_ABAIXO_PONTO_REPOSICAO', severity: 'ATENCAO', warehouseId: p.warehouseId, refType: 'material', refId: p.materialId, message: `${m.code}: disponível ${av.available} abaixo do ponto de reposição ${rp.toString()}.`, responsibleRole: 'COMPRAS', data: { available: av.available, reorderPoint: rp.toString() } });
        if (new Prisma.Decimal(av.projected_on_needed_by).lt(0)) out.push({ dedupeKey: `rupt:${p.id}`, kind: 'RUPTURA_PREVISTA', severity: 'CRITICO', warehouseId: p.warehouseId, refType: 'material', refId: p.materialId, message: `${m.code}: ruptura prevista — demanda aprovada supera o disponível (${av.projected_on_needed_by}).`, responsibleRole: 'COMPRAS', data: { projected: av.projected_on_needed_by } });
      }
    }

    // 2) Lotes vencendo em 90/60/30/7 dias (e vencidos com saldo).
    const lots = await this.prisma.lot.findMany({ where: { expiresAt: { lte: new Date(today.getTime() + 90 * DAY) }, balances: { some: { quantity: { gt: 0 } } } }, include: { material: { select: { code: true } }, balances: { where: { quantity: { gt: 0 } }, select: { quantity: true, location: { select: { warehouseId: true } } } } }, take: 5000 });
    for (const l of lots) {
      const days = Math.floor((l.expiresAt!.getTime() - today.getTime()) / DAY);
      const bucket = days < 0 ? 0 : days <= 7 ? 7 : days <= 30 ? 30 : days <= 60 ? 60 : 90;
      const qty = l.balances.reduce((s, b) => s.plus(b.quantity), new Prisma.Decimal(0));
      out.push({ dedupeKey: `lot:${l.id}:${bucket}`, kind: 'LOTE_VENCENDO', severity: bucket <= 7 ? 'CRITICO' : bucket === 30 ? 'ATENCAO' : 'INFO', warehouseId: l.balances[0]?.location.warehouseId, refType: 'lot', refId: l.id, message: days < 0 ? `Lote ${l.lotNumber} de ${l.material.code} VENCIDO com ${qty.toString()} em estoque.` : `Lote ${l.lotNumber} de ${l.material.code} vence em ${days} dia(s) (${qty.toString()} em estoque).`, responsibleRole: 'GESTOR_ALMOXARIFADO', data: { days, bucket } });
    }

    // 3) Reservas próximas de expirar e reservas sobre material bloqueado/vencido.
    const badLots = await this.prisma.lot.findMany({ where: { OR: [{ status: { not: 'LIBERADO' } }, { expiresAt: { lt: today } }] }, select: { id: true } });
    const resv = await this.prisma.reservation.findMany({
      where: { status: 'ATIVA', OR: [{ expiresAt: { lt: new Date(now + 48 * HOUR) } }, { lotId: { in: badLots.map((l) => l.id) } }] },
      include: { item: { include: { order: { select: { seq: true, status: true, warehouseId: true } } } } }, take: 5000,
    });
    const lotMap = new Map((await this.prisma.lot.findMany({ where: { id: { in: [...new Set(resv.flatMap((r) => (r.lotId ? [r.lotId] : [])))] } } })).map((l) => [l.id, l]));
    for (const r of resv) {
      const wh = r.item.order.warehouseId;
      if (['RECEBIDA', 'EM_ANALISE', 'RESERVADA', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE'].includes(r.item.order.status) && r.expiresAt.getTime() - now < 48 * HOUR) {
        out.push({ dedupeKey: `resv:${r.id}`, kind: 'RESERVA_EXPIRANDO', severity: 'ATENCAO', warehouseId: wh, refType: 'reservation', refId: r.id, message: `Reserva da ordem ATD-${String(r.item.order.seq).padStart(8, '0')} expira em breve.`, responsibleRole: 'GESTOR_ALMOXARIFADO' });
      }
      const lot = r.lotId ? lotMap.get(r.lotId) : undefined;
      if (lot && (lot.status !== 'LIBERADO' || (lot.expiresAt && lot.expiresAt < today))) {
        out.push({ dedupeKey: `blk:${r.id}`, kind: 'MATERIAL_BLOQUEADO_RESERVADO', severity: 'CRITICO', warehouseId: wh, refType: 'reservation', refId: r.id, message: `Reserva da ordem ATD-${String(r.item.order.seq).padStart(8, '0')} sobre o lote ${lot.lotNumber}, que está ${lot.status !== 'LIBERADO' ? lot.status : 'vencido'}.`, responsibleRole: 'GESTOR_ALMOXARIFADO' });
      }
    }

    // 4) Requisições sem movimento dentro do SLA (espera por aprovação do Axis não conta).
    const analysisH = this.num('ALERT_ORDER_ANALYSIS_HOURS', 2);
    const pickingH = this.num('ALERT_ORDER_PICKING_HOURS', 24);
    const orders = await this.prisma.fulfillmentOrder.findMany({ where: { OR: [{ status: { in: ['RECEBIDA', 'EM_ANALISE'] }, updatedAt: { lt: new Date(now - analysisH * HOUR) } }, { status: { in: ['RESERVADA', 'RESERVADA_PARCIAL'] }, updatedAt: { lt: new Date(now - pickingH * HOUR) } }] }, take: 5000 });
    for (const o of orders) out.push({ dedupeKey: `order:${o.id}`, kind: 'REQUISICAO_SEM_MOVIMENTO', severity: 'ATENCAO', warehouseId: o.warehouseId, refType: 'fulfillment_order', refId: o.id, message: `Ordem ATD-${String(o.seq).padStart(8, '0')} parada em ${o.status} além do SLA.`, responsibleRole: 'ALMOXARIFE' });

    // 5) Trânsito não recebido no prazo.
    const transitH = this.num('ALERT_TRANSIT_HOURS', 48);
    const transfers = await this.prisma.transfer.findMany({ where: { status: 'EM_TRANSITO', dispatchedAt: { lt: new Date(now - transitH * HOUR) } }, take: 500 });
    for (const t of transfers) out.push({ dedupeKey: `trf:${t.id}`, kind: 'TRANSITO_NAO_RECEBIDO', severity: 'ATENCAO', warehouseId: t.toWarehouseId, refType: 'transfer', refId: t.id, message: `Transferência TRF-${String(t.seq).padStart(8, '0')} em trânsito há mais de ${transitH} h.`, responsibleRole: 'GESTOR_ALMOXARIFADO' });

    // 6) Custódia vencida.
    const custody = await this.prisma.custodyTerm.findMany({ where: { status: 'ATIVO', expectedReturnAt: { lt: today } }, take: 500 });
    for (const c of custody) out.push({ dedupeKey: `cus:${c.id}`, kind: 'CUSTODIA_VENCIDA', severity: 'ATENCAO', refType: 'custody_term', refId: c.id, message: `Custódia CUS-${String(c.seq).padStart(8, '0')} com devolução prevista vencida.`, responsibleRole: 'CONTROLE_PATRIMONIO' });

    // 7) Inventário apurado com divergência aguardando tratamento.
    const counts = await this.prisma.stockCount.findMany({ where: { status: 'APURADA' }, take: 200 });
    for (const c of counts) out.push({ dedupeKey: `inv:${c.id}`, kind: 'DIVERGENCIA_INVENTARIO', severity: 'ATENCAO', warehouseId: c.warehouseId, refType: 'stock_count', refId: c.id, message: `Inventário INV-${String(c.seq).padStart(8, '0')} apurado com divergências aguardando aprovação.`, responsibleRole: 'GESTOR_ALMOXARIFADO' });

    // 8) Integração: eventos de entrada com falha e fila de saída parada.
    const failed = await this.prisma.integrationMessage.findMany({ where: { direction: 'INBOUND', status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: 100 });
    for (const f of failed) out.push({ dedupeKey: `intf:${f.id}`, kind: 'FALHA_INTEGRACAO', severity: 'CRITICO', refType: 'integration_message', refId: f.id, message: `Evento ${f.eventType} do Axis falhou: ${f.lastError ?? 'erro desconhecido'}.`, responsibleRole: 'ADMIN_TECNICO' });
    const stuck = await this.prisma.integrationMessage.count({ where: { direction: 'OUTBOUND', status: 'PENDING', createdAt: { lt: new Date(now - HOUR) } } });
    if (stuck > 0) out.push({ dedupeKey: 'int-outbox', kind: 'FALHA_INTEGRACAO', severity: stuck > 100 ? 'CRITICO' : 'ATENCAO', refType: 'integration_message', message: `${stuck} evento(s) para o Axis aguardando envio há mais de 1 h.`, responsibleRole: 'ADMIN_TECNICO', data: { pending: stuck } });

    // 9) Consumo anômalo (para análise humana): últimos 7 dias contra a média dos 90 anteriores.
    const recent = await this.prisma.stockMovement.groupBy({ by: ['materialId'], where: { type: 'SAIDA_ENTREGA', reversesMovementId: null, effectiveAt: { gte: new Date(now - 7 * DAY) } }, _sum: { quantity: true } });
    for (const r of recent) {
      const base = await this.prisma.stockMovement.aggregate({ where: { materialId: r.materialId, type: 'SAIDA_ENTREGA', reversesMovementId: null, effectiveAt: { gte: new Date(now - 97 * DAY), lt: new Date(now - 7 * DAY) } }, _sum: { quantity: true } });
      const expected = new Prisma.Decimal(base._sum.quantity ?? 0).div(90).times(7);
      const last = new Prisma.Decimal(r._sum.quantity ?? 0);
      if (expected.gt(0) && last.gte(10) && last.gt(expected.times(3))) out.push({ dedupeKey: `anom:${r.materialId}`, kind: 'CONSUMO_ANOMALO', severity: 'INFO', refType: 'material', refId: r.materialId, message: `Consumo dos últimos 7 dias (${last.toString()}) é mais de 3× o esperado (${expected.toFixed(1)}). Analisar.`, responsibleRole: 'COMPRAS', data: { last7: last.toString(), expected: expected.toFixed(2) } });
    }
    return out;
  }

  async scan() {
    const candidates = new Map((await this.collect()).map((c) => [c.dedupeKey, c]));
    // Varreduras simultâneas são serializadas: a segunda enxerga o que a primeira criou e não duplica ABERTO.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('alerts-scan'))`;
      const current = await tx.alert.findMany({ where: { status: { in: ['ABERTO', 'RECONHECIDO'] } } });
      const byKey = new Map(current.map((a) => [a.dedupeKey, a]));
      let created = 0, updated = 0, resolved = 0;
      for (const c of candidates.values()) {
        const ex = byKey.get(c.dedupeKey);
        if (ex) {
          if (ex.severity !== c.severity || ex.message !== c.message) { await tx.alert.update({ where: { id: ex.id }, data: { severity: c.severity, message: c.message, data: (c.data ?? {}) as Prisma.InputJsonValue } }); updated++; }
          continue;
        }
        const a = await tx.alert.create({ data: { kind: c.kind, severity: c.severity, warehouseId: c.warehouseId ?? undefined, refType: c.refType, refId: c.refId, message: c.message, responsibleRole: c.responsibleRole, dedupeKey: c.dedupeKey, data: (c.data ?? {}) as Prisma.InputJsonValue } });
        // Críticos seguem para o papel responsável via Axis; a notificação não concede acesso ao registro (19).
        if (c.severity === 'CRITICO') await tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType: 'alert.raised', occurredAt: new Date(), status: 'PENDING', payload: { alert_id: a.id, kind: a.kind, severity: a.severity, responsible_role: a.responsibleRole, message: a.message } } });
        created++;
      }
      for (const a of current) {
        if (!candidates.has(a.dedupeKey)) { await tx.alert.update({ where: { id: a.id }, data: { status: 'RESOLVIDO', resolvedAt: new Date() } }); resolved++; }
      }
      return { open: candidates.size, created, updated, resolved };
    }, { timeout: 60_000, maxWait: 30_000 });
  }

  async list(q: ListAlertsQuery, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.alert.findMany({
      where: { status: q.status ?? { in: ['ABERTO', 'RECONHECIDO'] }, ...(q.severity && { severity: q.severity }), ...(q.role && { responsibleRole: q.role }), ...(q.warehouseId && { warehouseId: q.warehouseId }), ...(wh !== 'ALL' && { OR: [{ warehouseId: null }, { warehouseId: { in: wh } }] }) },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }], take: 300,
    });
    return rows;
  }

  async acknowledge(id: string, user: AuthenticatedUser) {
    const a = await this.prisma.alert.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Alerta não encontrado.');
    if (a.warehouseId) await this.rbac.assertWarehouseAccess(user, a.warehouseId);
    if (a.status !== 'ABERTO') throw new ConflictException(`O alerta está ${a.status}.`);
    return this.prisma.alert.update({ where: { id }, data: { status: 'RECONHECIDO', acknowledgedBy: user.userId, acknowledgedAt: new Date() } });
  }
}
