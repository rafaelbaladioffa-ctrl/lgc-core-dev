import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AvailabilityService, todayBR } from '../stock/availability.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const suggestionCode = (seq: number) => `REP-${String(seq).padStart(8, '0')}`;
const WINDOW_DAYS = 90;
const DEFAULT_COVERAGE_DAYS = 30;

export class SetPolicyDto {
  @IsUUID('all', { message: 'Material inválido.' }) materialId!: string;
  @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'O mínimo não pode ser negativo.' }) minQty!: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'O máximo não pode ser negativo.' }) maxQty?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'O estoque de segurança não pode ser negativo.' }) safetyQty?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0, { message: 'O ponto de reposição não pode ser negativo.' }) @Max(1e12) reorderPoint?: number;
}

export class CalculateDto {
  @IsOptional() @IsUUID('all', { message: 'Almoxarifado inválido.' }) warehouseId?: string;
}

export class DiscardDto {
  @IsString({ message: 'Informe o motivo.' }) @MinLength(3, { message: 'O motivo deve ter ao menos 3 caracteres.' }) @MaxLength(300) reason!: string;
}

export class ListSuggestionsQuery {
  @IsOptional() @IsIn(['ABERTA', 'ENVIADA_AXIS', 'APROVADA_AXIS', 'ATENDIDA', 'DESCARTADA']) status?: string;
  @IsOptional() @IsUUID('all') warehouseId?: string;
}

@Injectable()
export class ReplenishmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly availability: AvailabilityService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // Parâmetros por material e almoxarifado
  // ---------------------------------------------------------------------------------------------

  async setPolicy(dto: SetPolicyDto, user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, dto.warehouseId);
    if (dto.maxQty != null && dto.maxQty < dto.minQty) throw new BadRequestException('O máximo não pode ser menor que o mínimo.');
    const m = await this.prisma.material.findUnique({ where: { id: dto.materialId }, include: { stockUom: true } });
    if (!m) throw new NotFoundException('Material não encontrado.');
    for (const v of [dto.minQty, dto.maxQty, dto.safetyQty, dto.reorderPoint]) {
      if (v != null && D(v).decimalPlaces() > m.stockUom.precision) throw new BadRequestException(`A unidade ${m.stockUom.code} aceita no máximo ${m.stockUom.precision} casa(s) decimal(is).`);
    }
    const data = { minQty: dto.minQty, maxQty: dto.maxQty ?? null, safetyQty: dto.safetyQty ?? 0, reorderPoint: dto.reorderPoint ?? null, updatedBy: user.userId };
    return this.prisma.stockPolicy.upsert({ where: { materialId_warehouseId: { materialId: dto.materialId, warehouseId: dto.warehouseId } }, create: { materialId: dto.materialId, warehouseId: dto.warehouseId, ...data }, update: data });
  }

  async listPolicies(warehouseId: string | undefined, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    return this.prisma.stockPolicy.findMany({ where: { ...(warehouseId && { warehouseId }), ...(wh !== 'ALL' && { warehouseId: { in: wh } }) }, orderBy: { materialId: 'asc' }, take: 500 });
  }

  // ---------------------------------------------------------------------------------------------
  // Cálculo (9.9): consumo, lead time, segurança, demanda aprovada futura, compras/transferências em aberto
  // ---------------------------------------------------------------------------------------------

  private async consumptionPerDay(materialId: string, warehouseId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const base = { materialId, effectiveAt: { gte: since }, type: 'SAIDA_ENTREGA' as const };
    const out = await this.prisma.stockMovement.aggregate({ where: { ...base, reversesMovementId: null, fromLocation: { warehouseId } }, _sum: { quantity: true } });
    const back = await this.prisma.stockMovement.aggregate({ where: { ...base, reversesMovementId: { not: null }, toLocation: { warehouseId } }, _sum: { quantity: true } });
    return D(out._sum.quantity ?? 0).minus(back._sum.quantity ?? 0).div(days);
  }

  async calculate(dto: CalculateDto, user: AuthenticatedUser) {
    if (dto.warehouseId) await this.rbac.assertWarehouseAccess(user, dto.warehouseId);
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const policies = await this.prisma.stockPolicy.findMany({ where: { ...(dto.warehouseId && { warehouseId: dto.warehouseId }), ...(wh !== 'ALL' && { warehouseId: { in: wh } }) }, take: 1000 });
    const result: Array<{ id: string; code: string; materialId: string; warehouseId: string; suggestedQty: string; action: 'criada' | 'atualizada' }> = [];
    let skipped = 0;
    let superseded = 0;

    for (const p of policies) {
      const m = await this.prisma.material.findUnique({ where: { id: p.materialId } });
      const open = await this.prisma.replenishmentSuggestion.findFirst({ where: { materialId: p.materialId, warehouseId: p.warehouseId, status: 'ABERTA' } });
      if (!m || m.status !== 'ATIVO') { skipped++; continue; }

      const leadDays = m.leadTimeDays ?? 0;
      const avgDaily = await this.consumptionPerDay(p.materialId, p.warehouseId, WINDOW_DAYS);
      const horizon = new Date(todayBR().getTime() + leadDays * 86_400_000);
      const [av] = await this.availability.compute([p.materialId], { warehouseId: p.warehouseId, neededBy: horizon });

      // Compras/transferências em aberto: não sugerir de novo o que já está a caminho (9.9).
      const purchases = await this.prisma.replenishmentSuggestion.findMany({ where: { materialId: p.materialId, warehouseId: p.warehouseId, status: { in: ['ENVIADA_AXIS', 'APROVADA_AXIS'] } } });
      const buying = purchases.reduce((s, x) => s.plus(x.status === 'APROVADA_AXIS' ? (x.approvedQty ?? x.suggestedQty) : x.suggestedQty), D(0));
      const inbound = await this.prisma.transferItem.aggregate({ where: { materialId: p.materialId, transfer: { toWarehouseId: p.warehouseId, status: 'EM_TRANSITO' } }, _sum: { quantity: true } });
      const incoming = buying.plus(inbound._sum.quantity ?? 0);

      const reorderPoint = p.reorderPoint ?? avgDaily.times(leadDays).plus(p.safetyQty).ceil();
      const position = D(av.projected_on_needed_by).plus(incoming);
      const needs = position.lte(reorderPoint) || position.lt(p.minQty);
      if (!needs) {
        if (open) { await this.prisma.replenishmentSuggestion.update({ where: { id: open.id }, data: { status: 'DESCARTADA', discardReason: 'Necessidade superada no recálculo' } }); superseded++; }
        skipped++;
        continue;
      }
      const target = p.maxQty ?? reorderPoint.plus(avgDaily.times(Math.max(leadDays, DEFAULT_COVERAGE_DAYS)).ceil());
      let qty = target.minus(position);
      if (m.purchaseMultiple && m.purchaseMultiple.gt(0)) qty = qty.div(m.purchaseMultiple).ceil().times(m.purchaseMultiple);
      if (qty.lte(0)) { skipped++; continue; }

      // Evidências: demanda aprovada ainda sem cobertura, consolidada por projeto e data.
      const items = await this.prisma.fulfillmentItem.findMany({ where: { materialId: p.materialId, order: { warehouseId: p.warehouseId, status: { in: ['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE'] } } }, include: { order: true, reservations: { where: { status: { in: ['ATIVA', 'CONSUMIDA'] } } } } });
      const demand = new Map<string, { project: string | null; neededBy: string | null; qty: Prisma.Decimal }>();
      for (const it of items) {
        const openQty = Prisma.Decimal.max(it.quantity.minus(it.reservations.reduce((s, r) => s.plus(r.quantity), D(0))), 0);
        if (openQty.lte(0)) continue;
        const key = `${it.order.projectAxisId ?? '-'}|${it.order.neededBy?.toISOString().slice(0, 10) ?? '-'}`;
        const cur = demand.get(key) ?? { project: it.order.projectAxisId, neededBy: it.order.neededBy?.toISOString().slice(0, 10) ?? null, qty: D(0) };
        demand.set(key, { ...cur, qty: cur.qty.plus(openQty) });
      }
      const justification = {
        available: av.available, projectedOnHorizon: av.projected_on_needed_by, incoming: incoming.toString(), avgDailyConsumption: avgDaily.toFixed(6), windowDays: WINDOW_DAYS,
        leadTimeDays: leadDays, safetyQty: p.safetyQty.toString(), reorderPoint: reorderPoint.toString(), minQty: p.minQty.toString(), maxQty: p.maxQty?.toString() ?? null, target: target.toString(),
        purchaseMultiple: m.purchaseMultiple?.toString() ?? null, approvedDemand: [...demand.values()].map((d) => ({ project: d.project, neededBy: d.neededBy, qty: d.qty.toString() })),
      };
      const data = { suggestedQty: qty, justification: justification as Prisma.InputJsonValue, calculatedAt: new Date() };
      // Cálculos simultâneos do mesmo item/almoxarifado são serializados: nunca duas sugestões ABERTAS.
      const { row, updated } = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rep:${p.materialId}:${p.warehouseId}`}))`;
        const cur = await tx.replenishmentSuggestion.findFirst({ where: { materialId: p.materialId, warehouseId: p.warehouseId, status: 'ABERTA' } });
        return cur ? { row: await tx.replenishmentSuggestion.update({ where: { id: cur.id }, data }), updated: true } : { row: await tx.replenishmentSuggestion.create({ data: { materialId: p.materialId, warehouseId: p.warehouseId, ...data } }), updated: false };
      });
      result.push({ id: row.id, code: suggestionCode(row.seq), materialId: row.materialId, warehouseId: row.warehouseId, suggestedQty: qty.toString(), action: updated ? 'atualizada' : 'criada' });
    }
    return { calculated: policies.length, suggestions: result, skipped, superseded };
  }

  async list(q: ListSuggestionsQuery, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.replenishmentSuggestion.findMany({ where: { ...(q.status && { status: q.status as never }), ...(q.warehouseId && { warehouseId: q.warehouseId }), ...(wh !== 'ALL' && { warehouseId: { in: wh } }) }, orderBy: { seq: 'desc' }, take: 200 });
    return rows.map((r) => ({ ...r, code: suggestionCode(r.seq) }));
  }

  private async load(id: string, user: AuthenticatedUser) {
    const s = await this.prisma.replenishmentSuggestion.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    await this.rbac.assertWarehouseAccess(user, s.warehouseId);
    return s;
  }

  /** Envia ao Axis a solicitação de compra com justificativa e evidências; não gera pedido financeiro (9.9). */
  async send(id: string, user: AuthenticatedUser) {
    const s = await this.load(id, user);
    if (s.status !== 'ABERTA') throw new ConflictException(`A sugestão está em ${s.status} e não pode ser enviada.`);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.replenishmentSuggestion.update({ where: { id }, data: { status: 'ENVIADA_AXIS', sentAt: new Date() } });
      const m = await tx.material.findUniqueOrThrow({ where: { id: s.materialId }, include: { stockUom: true } });
      await tx.integrationMessage.create({
        data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType: 'replenishment.suggested', occurredAt: new Date(), status: 'PENDING', correlationId: id,
          payload: { suggestion_id: id, code: suggestionCode(s.seq), warehouse_id: s.warehouseId, material_id: s.materialId, material_code: m.code, uom: m.stockUom.code, quantity: s.suggestedQty.toString(), justification: s.justification as Prisma.InputJsonValue } },
      });
      return { ...updated, code: suggestionCode(updated.seq) };
    });
  }

  async discard(id: string, reason: string, user: AuthenticatedUser) {
    const s = await this.load(id, user);
    if (!['ABERTA', 'ENVIADA_AXIS'].includes(s.status)) throw new ConflictException(`A sugestão está em ${s.status} e não pode ser descartada.`);
    return this.prisma.replenishmentSuggestion.update({ where: { id }, data: { status: 'DESCARTADA', discardReason: reason } });
  }

  // ---------------------------------------------------------------------------------------------
  // Retorno do Axis: pedido aprovado e previsão (purchase_order.approved / .changed)
  // ---------------------------------------------------------------------------------------------

  /**
   * Pedido aprovado no Axis: registra a previsão e evita nova sugestão equivalente. Itens por `material_code` ou `material_id`
   * (id da Logística). Também recebe as compras do Core já traduzidas por `core-purchase.adapter.ts`.
   */
  async registerPurchase(tx: Tx, p: Record<string, unknown>) {
    const poId = typeof p['purchase_order_id'] === 'string' ? p['purchase_order_id'] : undefined;
    if (!poId) throw new BadRequestException('purchase_order_id ausente.');
    const whCode = typeof p['warehouse_code'] === 'string' ? p['warehouse_code'] : undefined;
    const wh = whCode ? await tx.warehouse.findUnique({ where: { code: whCode } }) : null;
    if (!wh) throw new BadRequestException('Almoxarifado de destino do pedido não encontrado.');
    const expected = typeof p['expected_date'] === 'string' && !Number.isNaN(Date.parse(p['expected_date'])) ? new Date(p['expected_date']) : undefined;
    const items = Array.isArray(p['items']) ? (p['items'] as Array<Record<string, unknown>>) : [];
    if (items.length === 0) throw new BadRequestException('Pedido sem itens.');
    // Itens repetidos do mesmo material somam; o último não sobrescreve os anteriores.
    const merged = new Map<string, { ref: { code?: string; id?: string }; quantity: number; suggestion_id?: string }>();
    for (const it of items) {
      const code = typeof it['material_code'] === 'string' && it['material_code'] ? it['material_code'] : undefined;
      const id = !code && typeof it['material_id'] === 'string' && it['material_id'] ? it['material_id'] : undefined;
      const key = code ? `c:${code}` : `i:${id ?? ''}`;
      const q = Number(it['quantity']);
      if (!Number.isFinite(q) || q <= 0) throw new BadRequestException('Item do pedido com quantidade inválida.');
      const prev = merged.get(key);
      merged.set(key, { ref: { code, id }, quantity: (prev?.quantity ?? 0) + q, suggestion_id: prev?.suggestion_id ?? (typeof it['suggestion_id'] === 'string' ? it['suggestion_id'] : undefined) });
    }
    for (const it of merged.values()) {
      const qty = Number(it.quantity);
      if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('Item do pedido com quantidade inválida.');
      const m = it.ref.code ? await tx.material.findFirst({ where: { code: it.ref.code } }) : it.ref.id ? await tx.material.findUnique({ where: { id: it.ref.id } }) : null;
      if (!m) throw new BadRequestException(`Material ${it.ref.code ?? it.ref.id ?? '(sem código)'} não encontrado.`);
      const bySuggestion = it.suggestion_id ? await tx.replenishmentSuggestion.findUnique({ where: { id: it.suggestion_id } }) : null;
      const target = bySuggestion ?? (await tx.replenishmentSuggestion.findFirst({ where: { materialId: m.id, warehouseId: wh.id, status: { in: ['ENVIADA_AXIS', 'APROVADA_AXIS'] } }, orderBy: { seq: 'desc' } }));
      if (target) await tx.replenishmentSuggestion.update({ where: { id: target.id }, data: { status: 'APROVADA_AXIS', approvedQty: qty, expectedAt: expected, axisPurchaseOrderId: poId } });
      else await tx.replenishmentSuggestion.create({ data: { materialId: m.id, warehouseId: wh.id, status: 'APROVADA_AXIS', suggestedQty: qty, approvedQty: qty, expectedAt: expected, axisPurchaseOrderId: poId, justification: { origem: 'pedido do Axis sem sugestão prévia' } } });
    }
  }
}

