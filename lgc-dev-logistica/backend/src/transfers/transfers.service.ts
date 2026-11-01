import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { AuditService } from '../audit/audit.service.js';
import { StockService } from '../stock/stock.service.js';
import { problem } from '../common/errors.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CancelTransferDto, CreateTransferDto, ReceiveTransferDto } from './transfers.dto.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const transferCode = (seq: number) => `TRF-${String(seq).padStart(8, '0')}`;
const TRANSIT_CODE = 'TRANSITO';

@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
    private readonly stock: StockService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
  }

  /** Estoque em trânsito vive num endereço virtual compartilhado, em condição BLOQUEADO (fora do disponível). */
  private async transitLocation(tx: Tx) {
    const wh = await tx.warehouse.upsert({ where: { code: TRANSIT_CODE }, update: {}, create: { code: TRANSIT_CODE, name: 'Em trânsito (virtual)', type: 'VIRTUAL', createdBy: 'system' } });
    return tx.location.upsert({ where: { warehouseId_code: { warehouseId: wh.id, code: TRANSIT_CODE } }, update: {}, create: { warehouseId: wh.id, code: TRANSIT_CODE, level: 'AREA', name: 'Em trânsito', isVirtual: true } });
  }

  private present<T extends { seq: number }>(t: T) {
    return { ...t, code: transferCode(t.seq) };
  }

  private async load(tx: Tx | PrismaService, id: string) {
    const t = await tx.transfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException('Transferência não encontrada.');
    return t;
  }

  async create(dto: CreateTransferDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const to = await tx.warehouse.findUnique({ where: { id: dto.toWarehouseId } });
      if (!to || to.status !== 'ATIVO' || to.type === 'VIRTUAL') throw new UnprocessableEntityException(problem('Almoxarifado de destino inexistente ou inativo.', 'INVALID_LOCATION'));

      const items: Prisma.TransferItemUncheckedCreateWithoutTransferInput[] = [];
      let fromWarehouseId: string | undefined;
      for (const [i, it] of dto.items.entries()) {
        const m = await tx.material.findFirst({ where: it.materialId ? { id: it.materialId } : { code: it.materialCode ?? '-' } });
        if (!m || m.status !== 'ATIVO') throw new UnprocessableEntityException(problem(`Item ${i + 1}: material inexistente ou inativo.`, 'AXIS_REFERENCE_INVALID'));
        const loc = await tx.location.findUnique({ where: { id: it.fromLocationId } });
        if (!loc || loc.isVirtual || loc.status !== 'ATIVO') throw new UnprocessableEntityException(problem(`Item ${i + 1}: endereço de origem inválido.`, 'INVALID_LOCATION'));
        if (fromWarehouseId && fromWarehouseId !== loc.warehouseId) throw new BadRequestException('Todos os itens devem sair do mesmo almoxarifado.');
        fromWarehouseId = loc.warehouseId;
        if (m.lotControlled && !it.lotId) throw new BadRequestException(`Item ${i + 1}: informe o lote.`);
        if (m.serialControlled && (!it.serialId || it.quantity !== 1)) throw new BadRequestException(`Item ${i + 1}: item seriado exige a série e quantidade 1.`);
        if (!m.serialControlled && it.serialId) throw new BadRequestException(`Item ${i + 1}: material sem controle de série.`);
        const uom = await tx.unitOfMeasure.findUniqueOrThrow({ where: { id: m.stockUomId } });
        if (D(it.quantity).decimalPlaces() > uom.precision) throw new BadRequestException(problem(`Item ${i + 1}: a unidade ${uom.code} aceita no máximo ${uom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
        items.push({ materialId: m.id, fromLocationId: loc.id, lotId: it.lotId, serialId: it.serialId, quantity: D(it.quantity) });
      }
      if (fromWarehouseId === dto.toWarehouseId) throw new BadRequestException('Origem e destino são o mesmo almoxarifado: use movimentação interna.');
      await this.rbac.assertWarehouseAccess(user, fromWarehouseId!);

      const t = await tx.transfer.create({ data: { fromWarehouseId: fromWarehouseId!, toWarehouseId: dto.toWarehouseId, urgent: dto.urgent ?? false, reason: dto.reason, requestedBy: user.userId, items: { create: items } }, include: { items: true } });
      return this.present(t);
    });
  }

  async list(user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.transfer.findMany({ where: wh === 'ALL' ? {} : { OR: [{ fromWarehouseId: { in: wh } }, { toWarehouseId: { in: wh } }] }, orderBy: { seq: 'desc' }, take: 100 });
    return rows.map((t) => this.present(t));
  }

  async get(id: string, user: AuthenticatedUser) {
    const t = await this.load(this.prisma, id);
    const wh = await this.rbac.accessibleWarehouseIds(user);
    if (wh !== 'ALL' && !wh.includes(t.fromWarehouseId) && !wh.includes(t.toWarehouseId)) throw new ForbiddenException('Sem acesso a esta transferência.');
    return this.present(t);
  }

  /** Aprova e reserva o saldo na origem (9.7). Solicitante não aprova a própria transferência. */
  async approve(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, id);
      await this.rbac.assertWarehouseAccess(user, t.fromWarehouseId);
      if (t.status !== 'SOLICITADA') throw new ConflictException(`A transferência está em ${t.status} e não pode ser aprovada.`);
      if (t.requestedBy === user.userId) throw new ForbiddenException('Segregação de funções: quem solicitou não pode aprovar a própria transferência.');
      for (const it of t.items) {
        const lotKey = it.lotId ?? '';
        const bal = await tx.stockBalance.findUnique({ where: { materialId_locationId_lotKey_condition_ownership: { materialId: it.materialId, locationId: it.fromLocationId, lotKey, condition: 'DISPONIVEL', ownership: 'PROPRIO' } } });
        const n = bal ? await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = reserved_qty + ${it.quantity.toString()}::numeric, updated_at = now() WHERE id = ${bal.id} AND quantity - reserved_qty >= ${it.quantity.toString()}::numeric` : 0;
        if (n !== 1) throw new UnprocessableEntityException(problem('Saldo disponível insuficiente na origem para reservar a transferência.', 'INSUFFICIENT_STOCK'));
        await tx.transferItem.update({ where: { id: it.id }, data: { balanceId: bal!.id, reservedQty: it.quantity } });
      }
      const updated = await tx.transfer.update({ where: { id }, data: { status: 'APROVADA', approvedBy: user.userId }, include: { items: true } });
      await this.emit(tx, 'availability.changed', { warehouse_id: t.fromWarehouseId });
      return this.present(updated);
    });
  }

  async startPicking(id: string, user: AuthenticatedUser) {
    const t = await this.load(this.prisma, id);
    await this.rbac.assertWarehouseAccess(user, t.fromWarehouseId);
    if (t.status !== 'APROVADA') throw new ConflictException(`A transferência está em ${t.status}; somente as aprovadas entram em separação.`);
    return this.present(await this.prisma.transfer.update({ where: { id }, data: { status: 'SEPARANDO', separatedBy: user.userId }, include: { items: true } }));
  }

  private async releaseReservations(tx: Tx, t: { items: Array<{ id: string; balanceId: string | null; reservedQty: Prisma.Decimal }> }) {
    for (const it of t.items) {
      if (!it.balanceId || it.reservedQty.lte(0)) continue;
      await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = GREATEST(reserved_qty - ${it.reservedQty.toString()}::numeric, 0), updated_at = now() WHERE id = ${it.balanceId}`;
      await tx.transferItem.update({ where: { id: it.id }, data: { reservedQty: 0 } });
    }
  }

  /** Expede: baixa da origem e entra em trânsito no mesmo ato — nunca origem sem documento de trânsito (9.7). */
  async dispatch(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, id);
      await this.rbac.assertWarehouseAccess(user, t.fromWarehouseId);
      if (t.status === 'APROVADA' && !t.urgent) throw new ConflictException('Transferência não urgente deve passar pela separação antes de expedir.');
      if (!['SEPARANDO', 'APROVADA'].includes(t.status)) throw new ConflictException(`A transferência está em ${t.status} e não pode ser expedida.`);
      const transit = await this.transitLocation(tx);
      await this.releaseReservations(tx, t);
      for (const it of t.items) {
        await this.stock.applyInternal(tx, {
          type: 'TRANSFERENCIA', materialId: it.materialId, quantity: it.quantity, lotId: it.lotId ?? undefined, serialId: it.serialId ?? undefined, fromLocationId: it.fromLocationId, toLocationId: transit.id,
          fromCondition: 'DISPONIVEL', toCondition: 'BLOQUEADO', reason: `Expedição ${transferCode(t.seq)}`, logisticsDocumentRef: transferCode(t.seq), correlationId: t.id,
        }, `transfer-out:${it.id}`, user);
      }
      const updated = await tx.transfer.update({ where: { id }, data: { status: 'EM_TRANSITO', dispatchedBy: user.userId, dispatchedAt: new Date() }, include: { items: true } });
      if (t.urgent && t.status === 'APROVADA') await this.audit.record(user.userId, 'transfer.urgent_dispatch', 'transfer', id, { code: transferCode(t.seq), reason: t.reason }, tx);
      await this.emit(tx, 'transfer.dispatched', { transfer_id: id, code: transferCode(t.seq), from_warehouse_id: t.fromWarehouseId, to_warehouse_id: t.toWarehouseId });
      await this.emit(tx, 'availability.changed', { warehouse_id: t.fromWarehouseId });
      return this.present(updated);
    });
  }

  /** Recebe no destino e encerra o trânsito. Diferença vira divergência (evento), nunca ajuste automático. */
  async receive(id: string, dto: ReceiveTransferDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, id);
      await this.rbac.assertWarehouseAccess(user, t.toWarehouseId);
      if (t.status !== 'EM_TRANSITO') throw new ConflictException(`A transferência está em ${t.status} e não está em trânsito.`);
      const ids = new Set(dto.items.map((i) => i.itemId));
      if (ids.size !== dto.items.length || t.items.some((i) => !ids.has(i.id)) || dto.items.some((i) => !t.items.find((x) => x.id === i.itemId))) {
        throw new BadRequestException('Informe o recebimento de todos os itens da transferência, sem repetir.');
      }
      const transit = await this.transitLocation(tx);
      let divergence = false;
      for (const r of dto.items) {
        const it = t.items.find((x) => x.id === r.itemId)!;
        const got = D(r.receivedQty);
        if (got.gt(it.quantity)) throw new UnprocessableEntityException('Quantidade recebida maior que a expedida: abra uma ocorrência em vez de receber a mais.');
        const m = await tx.material.findUniqueOrThrow({ where: { id: it.materialId } });
        if (m.serialControlled && !got.equals(0) && !got.equals(1)) throw new BadRequestException('Item seriado: recebido 0 ou 1.');
        const dest = await tx.location.findFirst({ where: { id: r.toLocationId, warehouseId: t.toWarehouseId } });
        if (!dest) throw new UnprocessableEntityException(problem('Endereço de destino não pertence ao almoxarifado de destino.', 'INVALID_LOCATION'));
        if (got.gt(0)) {
          await this.stock.applyInternal(tx, {
            type: 'TRANSFERENCIA', materialId: it.materialId, quantity: got, lotId: it.lotId ?? undefined, serialId: it.serialId ?? undefined, fromLocationId: transit.id, toLocationId: dest.id,
            fromCondition: 'BLOQUEADO', toCondition: 'DISPONIVEL', reason: `Recebimento ${transferCode(t.seq)}`, logisticsDocumentRef: transferCode(t.seq), correlationId: t.id,
          }, `transfer-in:${it.id}`, user);
        }
        if (!got.equals(it.quantity)) divergence = true;
        await tx.transferItem.update({ where: { id: it.id }, data: { receivedQty: got, toLocationId: dest.id } });
      }
      const updated = await tx.transfer.update({ where: { id }, data: { status: 'RECEBIDA', receivedBy: user.userId, receivedAt: new Date(), hasDivergence: divergence }, include: { items: true } });
      if (divergence) await this.emit(tx, 'transfer.divergent', { transfer_id: id, code: transferCode(t.seq) });
      await this.emit(tx, 'availability.changed', { warehouse_id: t.toWarehouseId });
      return this.present(updated);
    });
  }

  async close(id: string, user: AuthenticatedUser) {
    const t = await this.load(this.prisma, id);
    await this.rbac.assertWarehouseAccess(user, t.toWarehouseId);
    if (t.status !== 'RECEBIDA') throw new ConflictException(`A transferência está em ${t.status}.`);
    if (t.hasDivergence) throw new UnprocessableEntityException('Há divergência em aberto: trate a ocorrência (ajuste com aprovação do Axis) antes de encerrar.');
    return this.present(await this.prisma.transfer.update({ where: { id }, data: { status: 'ENCERRADA' }, include: { items: true } }));
  }

  async cancel(id: string, dto: CancelTransferDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await this.load(tx, id);
      await this.rbac.assertWarehouseAccess(user, t.fromWarehouseId);
      if (t.status === 'CANCELADA') return this.present(t);
      if (!['SOLICITADA', 'APROVADA', 'SEPARANDO'].includes(t.status)) throw new ConflictException(`A transferência está em ${t.status} e não pode mais ser cancelada.`);
      await this.releaseReservations(tx, t);
      const updated = await tx.transfer.update({ where: { id }, data: { status: 'CANCELADA' }, include: { items: true } });
      await this.audit.record(user.userId, 'transfer.cancelled', 'transfer', id, { reason: dto.reason }, tx);
      return this.present(updated);
    });
  }
}
