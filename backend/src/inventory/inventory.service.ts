import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StockCountLine } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { StockService } from '../stock/stock.service.js';
import { problem } from '../common/errors.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { ApplyAdjustmentsDto, CreateCountDto, ListCountsQuery, SubmitCountDto } from './inventory.dto.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const countCode = (seq: number) => `INV-${String(seq).padStart(8, '0')}`;
const ACTIVE = ['ABERTA', 'EM_CONTAGEM', 'EM_RECONTAGEM', 'APURADA'] as const;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly stock: StockService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
  }

  private async load(tx: Tx | PrismaService, id: string, user: AuthenticatedUser) {
    const c = await tx.stockCount.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Inventário não encontrado.');
    await this.rbac.assertWarehouseAccess(user, c.warehouseId);
    return c;
  }

  // ---------------------------------------------------------------------------------------------
  // Abertura: escopo → retrato do saldo (snapshot) → congelamento
  // ---------------------------------------------------------------------------------------------

  async create(dto: CreateCountDto, user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, dto.warehouseId);
    const scope = dto.scope ?? {};
    return this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!wh || wh.status !== 'ATIVO' || wh.type === 'VIRTUAL') throw new UnprocessableEntityException(problem('Almoxarifado inexistente ou inativo.', 'INVALID_LOCATION'));

      const need = { ENDERECO: scope.locationIds?.length, ITEM: scope.materialIds?.length, LOTE: scope.lotIds?.length, ROTATIVO_ABC: scope.criticality, AMOSTRAGEM: scope.sampleSize } as Record<string, unknown>;
      if (dto.type in need && !need[dto.type]) throw new BadRequestException(`O inventário ${dto.type} exige o escopo correspondente (locationIds, materialIds, lotIds, criticality ou sampleSize).`);
      if (dto.type === 'PROJETO' && !wh.projectAxisId) throw new UnprocessableEntityException('Inventário por projeto exige almoxarifado/estoque de projeto.');

      const where: Prisma.StockBalanceWhereInput = {
        quantity: { gt: 0 }, location: { warehouseId: dto.warehouseId },
        ...(dto.type === 'ENDERECO' && { locationId: { in: scope.locationIds } }),
        ...(dto.type === 'ITEM' && { materialId: { in: scope.materialIds } }),
        ...(dto.type === 'LOTE' && { lotId: { in: scope.lotIds } }),
        ...(dto.type === 'ROTATIVO_ABC' && { material: { criticality: scope.criticality } }),
      };
      let balances = await tx.stockBalance.findMany({ where, include: { material: { select: { averageCost: true, serialControlled: true } } }, orderBy: [{ locationId: 'asc' }, { materialId: 'asc' }] });
      if (dto.type === 'AMOSTRAGEM') balances = [...balances].sort(() => Math.random() - 0.5).slice(0, scope.sampleSize);
      if (balances.length === 0) throw new UnprocessableEntityException('O escopo informado não possui saldo para inventariar.');

      // Um inventário ativo por endereço: evita contagens concorrentes sobre o mesmo saldo.
      const clash = await tx.stockCountLine.count({ where: { locationId: { in: [...new Set(balances.map((b) => b.locationId))] }, count: { status: { in: [...ACTIVE] } } } });
      if (clash > 0) throw new ConflictException('Há endereço do escopo em outro inventário ativo.');

      const count = await tx.stockCount.create({ data: { type: dto.type, warehouseId: dto.warehouseId, scope: scope as Prisma.InputJsonValue, tolerancePct: dto.tolerancePct ?? 0, frozen: dto.frozen ?? true, createdBy: user.userId } });
      const lines: Prisma.StockCountLineCreateManyInput[] = [];
      for (const b of balances) {
        if (b.material.serialControlled) {
          const serials = await tx.serialNumber.findMany({ where: { materialId: b.materialId, currentLocationId: b.locationId } });
          for (const s of serials) lines.push({ countId: count.id, materialId: b.materialId, locationId: b.locationId, lotId: b.lotId, serialId: s.id, condition: b.condition, ownership: b.ownership, systemQty: 1, unitCost: b.material.averageCost });
        } else {
          lines.push({ countId: count.id, materialId: b.materialId, locationId: b.locationId, lotId: b.lotId, condition: b.condition, ownership: b.ownership, systemQty: b.quantity, unitCost: b.material.averageCost });
        }
      }
      await tx.stockCountLine.createMany({ data: lines });
      return { ...count, code: countCode(count.seq), lines: lines.length };
    });
  }

  async list(q: ListCountsQuery, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.stockCount.findMany({ where: { ...(q.status && { status: q.status }), ...(q.warehouseId && { warehouseId: q.warehouseId }), ...(wh !== 'ALL' && { warehouseId: { in: wh } }) }, orderBy: { seq: 'desc' }, take: 100 });
    return rows.map((c) => ({ ...c, code: countCode(c.seq) }));
  }

  /** Visão de gestão: inclui saldo do sistema. */
  async get(id: string, user: AuthenticatedUser) {
    const c = await this.load(this.prisma, id, user);
    const lines = await this.prisma.stockCountLine.findMany({ where: { countId: id }, orderBy: [{ locationId: 'asc' }, { materialId: 'asc' }] });
    return { ...c, code: countCode(c.seq), lines };
  }

  /** Folha do contador: contagem cega — nunca expõe saldo do sistema nem resultados de outras rodadas. */
  async sheet(id: string, user: AuthenticatedUser) {
    const c = await this.load(this.prisma, id, user);
    if (!['EM_CONTAGEM', 'EM_RECONTAGEM'].includes(c.status)) throw new ConflictException('O inventário não está em contagem.');
    const round = c.status === 'EM_CONTAGEM' ? 1 : 2;
    const lines = await this.prisma.stockCountLine.findMany({
      where: { countId: id, status: round === 1 ? 'PENDENTE' : 'RECONTAR', ...(round === 2 && { count1By: { not: user.userId } }) },
      select: { id: true, materialId: true, locationId: true, lotId: true, serialId: true, condition: true, ownership: true }, orderBy: [{ locationId: 'asc' }, { materialId: 'asc' }],
    });
    return { id: c.id, code: countCode(c.seq), round, lines };
  }

  async start(id: string, user: AuthenticatedUser) {
    const c = await this.load(this.prisma, id, user);
    if (c.status !== 'ABERTA') throw new ConflictException(`O inventário está em ${c.status} e não pode ser iniciado.`);
    return this.prisma.stockCount.update({ where: { id }, data: { status: 'EM_CONTAGEM' } });
  }

  // ---------------------------------------------------------------------------------------------
  // Contagens
  // ---------------------------------------------------------------------------------------------

  async submit(id: string, dto: SubmitCountDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.load(tx, id, user);
      if (!['EM_CONTAGEM', 'EM_RECONTAGEM'].includes(c.status)) throw new ConflictException('O inventário não está em contagem.');
      const line = await tx.stockCountLine.findFirst({ where: { id: dto.lineId, countId: id } });
      if (!line) throw new NotFoundException('Linha não pertence a este inventário.');
      const m = await tx.material.findUniqueOrThrow({ where: { id: line.materialId }, include: { stockUom: true } });
      const qty = D(dto.quantity);
      if (qty.decimalPlaces() > m.stockUom.precision) throw new BadRequestException(problem(`A unidade ${m.stockUom.code} aceita no máximo ${m.stockUom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
      if (line.serialId && !(qty.equals(0) || qty.equals(1))) throw new BadRequestException('Item seriado: contagem 0 ou 1.');

      if (c.status === 'EM_CONTAGEM') {
        if (line.status !== 'PENDENTE') throw new ConflictException('Esta linha já teve a primeira contagem.');
        await tx.stockCountLine.update({ where: { id: line.id }, data: { count1Qty: qty, count1By: user.userId, count1At: new Date(), status: 'CONTADO', notes: dto.notes } });
      } else {
        if (line.status !== 'RECONTAR') throw new ConflictException('Esta linha não está marcada para recontagem.');
        if (line.count1By === user.userId) throw new ForbiddenException('Segregação: a recontagem deve ser feita por operador diferente do da primeira contagem.');
        await tx.stockCountLine.update({ where: { id: line.id }, data: { count2Qty: qty, count2By: user.userId, count2At: new Date(), notes: dto.notes ?? line.notes } });
      }
      return { lineId: line.id, recorded: true }; // sem devolver o saldo do sistema (cega)
    });
  }

  /** Encerra a rodada: 1ª → confere/aceita/manda recontar; 2ª → apura o resultado final. */
  async closeRound(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.load(tx, id, user);
      const lines = await tx.stockCountLine.findMany({ where: { countId: id } });

      if (c.status === 'EM_CONTAGEM') {
        const pending = lines.filter((l) => l.status === 'PENDENTE');
        if (pending.length > 0) throw new UnprocessableEntityException(`Há ${pending.length} linha(s) sem contagem.`);
        let recount = 0;
        for (const l of lines) {
          const diff = l.count1Qty!.minus(l.systemQty);
          if (diff.equals(0)) await tx.stockCountLine.update({ where: { id: l.id }, data: { status: 'CONFERIDO', finalQty: l.count1Qty, varianceQty: 0 } });
          else if (diff.abs().div(l.systemQty.equals(0) ? 1 : l.systemQty).times(100).lte(c.tolerancePct)) await tx.stockCountLine.update({ where: { id: l.id }, data: { status: 'DIVERGENTE', finalQty: l.count1Qty, varianceQty: diff } }); // dentro da tolerância: aceita
          else { await tx.stockCountLine.update({ where: { id: l.id }, data: { status: 'RECONTAR' } }); recount++; }
        }
        if (recount > 0) return { status: (await tx.stockCount.update({ where: { id }, data: { status: 'EM_RECONTAGEM' } })).status, recount };
        return this.finishCounting(tx, c.id, c.warehouseId);
      }

      if (c.status === 'EM_RECONTAGEM') {
        const missing = lines.filter((l) => l.status === 'RECONTAR' && l.count2Qty == null);
        if (missing.length > 0) throw new UnprocessableEntityException(`Há ${missing.length} linha(s) sem recontagem.`);
        for (const l of lines.filter((x) => x.status === 'RECONTAR')) {
          const diff = l.count2Qty!.minus(l.systemQty);
          await tx.stockCountLine.update({ where: { id: l.id }, data: { status: diff.equals(0) ? 'CONFERIDO' : 'DIVERGENTE', finalQty: l.count2Qty, varianceQty: diff } });
        }
        return this.finishCounting(tx, c.id, c.warehouseId);
      }
      throw new ConflictException(`O inventário está em ${c.status} e não tem rodada aberta.`);
    });
  }

  private async finishCounting(tx: Tx, id: string, warehouseId: string) {
    const diverging = await tx.stockCountLine.count({ where: { countId: id, status: 'DIVERGENTE' } });
    if (diverging === 0) {
      await tx.stockCount.update({ where: { id }, data: { status: 'CONCLUIDA', closedAt: new Date() } }); // nada a ajustar: libera o congelamento
      return { status: 'CONCLUIDA', variances: 0 };
    }
    await tx.stockCount.update({ where: { id }, data: { status: 'APURADA' } });
    await this.emit(tx, 'inventory.variance_detected', { count_id: id, warehouse_id: warehouseId, lines: diverging });
    return { status: 'APURADA', variances: diverging };
  }

  // ---------------------------------------------------------------------------------------------
  // Relatório antes/depois, recorrência e plano de ação
  // ---------------------------------------------------------------------------------------------

  async report(id: string, user: AuthenticatedUser) {
    const c = await this.load(this.prisma, id, user);
    const lines = await this.prisma.stockCountLine.findMany({ where: { countId: id, status: 'DIVERGENTE' }, orderBy: { locationId: 'asc' } });
    const canCost = user.permissions.includes('material:read_cost');
    const previous = await this.prisma.stockCountLine.findMany({ where: { countId: { not: id }, status: 'DIVERGENTE', OR: lines.map((l) => ({ materialId: l.materialId, locationId: l.locationId })) }, select: { materialId: true, locationId: true } });
    const recurrent = new Set(previous.map((p) => `${p.materialId}:${p.locationId}`));
    let total = D(0);
    const items = lines.map((l) => {
      const value = l.unitCost && l.varianceQty ? l.varianceQty.times(l.unitCost) : null;
      if (value) total = total.plus(value);
      return { lineId: l.id, materialId: l.materialId, locationId: l.locationId, lotId: l.lotId, serialId: l.serialId, before: l.systemQty.toString(), after: l.finalQty?.toString(), variance: l.varianceQty?.toString(), recurrent: recurrent.has(`${l.materialId}:${l.locationId}`), reason: l.reason, ...(canCost && { variance_value: value?.toString() ?? null }) };
    });
    const totals = await this.prisma.stockCountLine.groupBy({ by: ['status'], where: { countId: id }, _count: { _all: true } });
    return { id: c.id, code: countCode(c.seq), status: c.status, type: c.type, summary: Object.fromEntries(totals.map((t) => [t.status, t._count._all])), ...(canCost && { totalVarianceValue: total.toString() }), actionPlan: c.actionPlan, recurrentCount: items.filter((i) => i.recurrent).length, items };
  }

  async setActionPlan(id: string, text: string, user: AuthenticatedUser) {
    await this.load(this.prisma, id, user);
    return this.prisma.stockCount.update({ where: { id }, data: { actionPlan: text } });
  }

  // ---------------------------------------------------------------------------------------------
  // Ajuste somente após aprovação do Axis
  // ---------------------------------------------------------------------------------------------

  async applyAdjustments(id: string, dto: ApplyAdjustmentsDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const c = await this.load(tx, id, user);
      if (c.status !== 'APURADA') throw new ConflictException(`O inventário está em ${c.status}; só inventários apurados podem ser ajustados.`);
      const lines = await tx.stockCountLine.findMany({ where: { countId: id, status: 'DIVERGENTE' } });
      const given = new Map(dto.lines.map((l) => [l.lineId, l]));
      if (given.size !== dto.lines.length) throw new BadRequestException('Linhas repetidas.');
      const missing = lines.filter((l) => !given.has(l.id));
      if (missing.length > 0) throw new UnprocessableEntityException(problem(`Faltam motivos para ${missing.length} divergência(s).`, 'APPROVAL_REQUIRED'));
      if (dto.lines.some((l) => !lines.find((x) => x.id === l.lineId))) throw new BadRequestException('Há linha que não é uma divergência deste inventário.');

      for (const l of lines) {
        const adj = given.get(l.id)!;
        const delta = l.finalQty!.minus(l.systemQty);
        const base = { materialId: l.materialId, lotId: l.lotId ?? undefined, serialId: l.serialId ?? undefined, quantity: delta.abs(), reason: `Inventário ${countCode(c.seq)}: ${adj.reason}${adj.notes ? ` — ${adj.notes}` : ''}`, axisApprovalRef: dto.approvalRef, logisticsDocumentRef: countCode(c.seq), correlationId: c.id, bypassFreeze: true, ownership: l.ownership };
        const mv = delta.gt(0)
          ? await this.stock.applyInternal(tx, { ...base, type: 'AJUSTE_POSITIVO', toLocationId: l.locationId, toCondition: l.condition }, `inv:${l.id}`, user)
          : await this.stock.applyInternal(tx, { ...base, type: 'AJUSTE_NEGATIVO', fromLocationId: l.locationId, fromCondition: l.condition }, `inv:${l.id}`, user);
        await tx.stockCountLine.update({ where: { id: l.id }, data: { reason: adj.reason, adjustmentMovementId: mv.id } });
      }
      await tx.stockCount.update({ where: { id }, data: { status: 'CONCLUIDA', approvalRef: dto.approvalRef, closedAt: new Date() } });
      await this.emit(tx, 'availability.changed', { warehouse_id: c.warehouseId });
      return { status: 'CONCLUIDA', adjusted: lines.length };
    });
  }

  async cancel(id: string, reason: string, user: AuthenticatedUser) {
    const c = await this.load(this.prisma, id, user);
    if (['CONCLUIDA', 'CANCELADA'].includes(c.status)) throw new ConflictException(`O inventário já está ${c.status}.`);
    return this.prisma.stockCount.update({ where: { id }, data: { status: 'CANCELADA', closedAt: new Date(), actionPlan: c.actionPlan ?? `Cancelado: ${reason}` } });
  }
}

export type { StockCountLine };
