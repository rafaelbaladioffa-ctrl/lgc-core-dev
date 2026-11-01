import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

export class ResolveIssueDto {
  @IsString({ message: 'Informe como foi tratada.' }) @MinLength(3, { message: 'A resolução deve ter ao menos 3 caracteres.' }) @MaxLength(500) resolution!: string;
}

export class ListIssuesQuery {
  @IsOptional() @IsIn(['ABERTA', 'RESOLVIDA']) status?: 'ABERTA' | 'RESOLVIDA';
  @IsOptional() @IsString() @MaxLength(60) kind?: string;
}

interface Found { kind: string; severity: string; refType: string; refId: string; details: Record<string, unknown> }
const LIMIT = 200;

/**
 * Reconciliação agendada (12.4): confronta saldo × ledger, reservas × saldo reservado, reservas órfãs, entregas sem baixa
 * e a dead-letter do outbox. O que divergir vira item na fila — NUNCA é corrigido em silêncio; só uma pessoa resolve.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async detect(): Promise<Found[]> {
    const out: Found[] = [];

    const ledger = await this.prisma.$queryRaw<Array<{ ref: string; material_id: string; location_id: string; condition: string; balance: Prisma.Decimal; ledger: Prisma.Decimal }>>`
      WITH mov AS (
        SELECT material_id, to_location_id AS location_id, COALESCE(lot_id, '') AS lot_key, to_condition::text AS cond, ownership::text AS own, quantity AS q FROM stock_movements WHERE to_location_id IS NOT NULL
        UNION ALL
        SELECT material_id, from_location_id, COALESCE(lot_id, ''), from_condition::text, ownership::text, -quantity FROM stock_movements WHERE from_location_id IS NOT NULL
      ), led AS (SELECT material_id, location_id, lot_key, cond, own, SUM(q) AS q FROM mov GROUP BY 1, 2, 3, 4, 5)
      SELECT COALESCE(b.id, l.material_id || ':' || l.location_id) AS ref, COALESCE(b.material_id, l.material_id) AS material_id, COALESCE(b.location_id, l.location_id) AS location_id,
             COALESCE(b.condition::text, l.cond) AS condition, COALESCE(b.quantity, 0) AS balance, COALESCE(l.q, 0) AS ledger
      FROM stock_balances b
      FULL OUTER JOIN led l ON l.material_id = b.material_id AND l.location_id = b.location_id AND l.lot_key = b.lot_key AND l.cond = b.condition::text AND l.own = b.ownership::text
      WHERE COALESCE(b.quantity, 0) <> COALESCE(l.q, 0) LIMIT ${LIMIT}`;
    for (const r of ledger) out.push({ kind: 'BALANCE_VS_LEDGER', severity: 'CRITICO', refType: 'stock_balance', refId: r.ref, details: { materialId: r.material_id, locationId: r.location_id, condition: r.condition, balance: r.balance.toString(), ledger: r.ledger.toString() } });

    const drift = await this.prisma.$queryRaw<Array<{ id: string; material_id: string; reserved: Prisma.Decimal; expected: Prisma.Decimal }>>`
      SELECT b.id, b.material_id, b.reserved_qty AS reserved, COALESCE(r.q, 0) + COALESCE(t.q, 0) AS expected FROM stock_balances b
      LEFT JOIN (SELECT balance_id, SUM(quantity - consumed_qty) AS q FROM reservations WHERE status = 'ATIVA' GROUP BY 1) r ON r.balance_id = b.id
      LEFT JOIN (SELECT balance_id, SUM(reserved_qty) AS q FROM transfer_items WHERE balance_id IS NOT NULL GROUP BY 1) t ON t.balance_id = b.id
      WHERE b.reserved_qty <> COALESCE(r.q, 0) + COALESCE(t.q, 0) LIMIT ${LIMIT}`;
    for (const r of drift) out.push({ kind: 'RESERVED_DRIFT', severity: 'ATENCAO', refType: 'stock_balance', refId: r.id, details: { materialId: r.material_id, reservedOnBalance: r.reserved.toString(), activeReservations: r.expected.toString() } });

    const orphan = await this.prisma.reservation.findMany({ where: { status: 'ATIVA', item: { order: { status: { in: ['CANCELADA', 'ENTREGUE', 'ENCERRADA'] } } } }, include: { item: { select: { order: { select: { status: true } } } } }, take: LIMIT });
    for (const r of orphan) out.push({ kind: 'ORPHAN_RESERVATION', severity: 'ATENCAO', refType: 'reservation', refId: r.id, details: { orderStatus: r.item.order.status, quantity: r.quantity.toString() } });

    const noLedger = await this.prisma.fulfillmentOrder.findMany({ where: { status: { in: ['ENTREGUE', 'ENCERRADA'] } }, select: { id: true, seq: true }, take: 1000, orderBy: { createdAt: 'desc' } });
    if (noLedger.length > 0) {
      const withMoves = new Set((await this.prisma.stockMovement.findMany({ where: { type: 'SAIDA_ENTREGA', correlationId: { in: noLedger.map((o) => o.id) } }, select: { correlationId: true }, distinct: ['correlationId'] })).map((m) => m.correlationId));
      for (const o of noLedger.filter((x) => !withMoves.has(x.id))) out.push({ kind: 'DELIVERED_WITHOUT_LEDGER', severity: 'CRITICO', refType: 'fulfillment_order', refId: o.id, details: { code: `ATD-${String(o.seq).padStart(8, '0')}` } });
    }

    const dlq = await this.prisma.integrationMessage.findMany({ where: { direction: 'OUTBOUND', status: 'FAILED' }, orderBy: { createdAt: 'desc' }, take: LIMIT });
    for (const m of dlq) out.push({ kind: 'OUTBOX_DEAD_LETTER', severity: 'CRITICO', refType: 'integration_message', refId: m.id, details: { eventType: m.eventType, attempts: m.attempts, lastError: m.lastError } });
    return out;
  }

  async run(actor: string) {
    const found = await this.detect();
    const keyOf = (f: Found) => `${f.kind}:${f.refId}`;
    const seen = new Set(found.map(keyOf));
    const open = await this.prisma.reconciliationIssue.findMany({ where: { status: 'ABERTA' } });
    const byKey = new Map(open.map((i) => [i.dedupeKey, i]));
    let created = 0, refreshed = 0, closed = 0;

    for (const f of found) {
      const ex = byKey.get(keyOf(f));
      if (ex) { await this.prisma.reconciliationIssue.update({ where: { id: ex.id }, data: { lastSeenAt: new Date(), details: f.details as Prisma.InputJsonValue, severity: f.severity } }); refreshed++; continue; }
      await this.prisma.reconciliationIssue.create({ data: { kind: f.kind, severity: f.severity, refType: f.refType, refId: f.refId, dedupeKey: keyOf(f), details: f.details as Prisma.InputJsonValue } });
      created++;
    }
    // A condição deixou de existir por ação humana/fluxo normal: encerra o item, registrando que não foi correção automática de dados.
    for (const i of open) {
      if (!seen.has(i.dedupeKey)) { await this.prisma.reconciliationIssue.update({ where: { id: i.id }, data: { status: 'RESOLVIDA', resolvedAt: new Date(), resolvedBy: 'sistema', resolution: 'Divergência não detectada mais na varredura.' } }); closed++; }
    }
    await this.audit.record(actor, 'reconciliation.run', 'reconciliation', 'run', { found: found.length, created, refreshed, closed });
    return { found: found.length, created, refreshed, closed };
  }

  list(q: ListIssuesQuery) {
    return this.prisma.reconciliationIssue.findMany({ where: { status: q.status ?? 'ABERTA', ...(q.kind && { kind: q.kind }) }, orderBy: [{ severity: 'asc' }, { detectedAt: 'desc' }], take: 300 });
  }

  async resolve(id: string, resolution: string, actor: string) {
    const i = await this.prisma.reconciliationIssue.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Item de reconciliação não encontrado.');
    if (i.status === 'RESOLVIDA') throw new ConflictException('Este item já foi resolvido.');
    const upd = await this.prisma.reconciliationIssue.update({ where: { id }, data: { status: 'RESOLVIDA', resolvedAt: new Date(), resolvedBy: actor, resolution } });
    await this.audit.record(actor, 'reconciliation.resolved', 'reconciliation_issue', id, { kind: i.kind, resolution });
    return upd;
  }
}
