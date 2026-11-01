import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { StockService } from '../stock/stock.service.js';
import { problem } from '../common/errors.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { ClassifyDto, CloseCustodyDto, CreateReturnDto, ListCustodyQuery } from './returns.dto.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const returnCode = (seq: number) => `DEV-${String(seq).padStart(8, '0')}`;
export const custodyCode = (seq: number) => `CUS-${String(seq).padStart(8, '0')}`;

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly stock: StockService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
  }

  // ---------------------------------------------------------------------------------------------
  // Devolução: entrada em quarentena até a inspeção classificar (9.6)
  // ---------------------------------------------------------------------------------------------

  async create(dto: CreateReturnDto, user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, dto.warehouseId);
    return this.prisma.$transaction(async (tx) => {
      const loc = await tx.location.findFirst({ where: { id: dto.receivingLocationId, warehouseId: dto.warehouseId } });
      if (!loc || loc.status !== 'ATIVO') throw new UnprocessableEntityException(problem('Endereço de recebimento inexistente, inativo ou de outro almoxarifado.', 'INVALID_LOCATION'));

      const term = dto.custodyTermId ? await tx.custodyTerm.findUnique({ where: { id: dto.custodyTermId } }) : null;
      if (dto.custodyTermId && !term) throw new UnprocessableEntityException(problem('Termo de custódia não encontrado.', 'AXIS_REFERENCE_INVALID'));
      if (term && term.status !== 'ATIVO') throw new ConflictException('Este termo de custódia já foi encerrado.');

      const ret = await tx.return.create({
        data: { type: dto.type, warehouseId: dto.warehouseId, receivingLocationId: dto.receivingLocationId, returnedByAxisId: dto.returnedByAxisId ?? term?.custodianAxisId, projectAxisId: dto.projectAxisId ?? term?.projectAxisId ?? undefined, custodyTermId: dto.custodyTermId, notes: dto.notes, createdBy: user.userId },
      });

      const itemsInTerm = new Map<string, Prisma.Decimal>();
      for (const [i, it] of dto.items.entries()) {
        const m = await tx.material.findUnique({ where: { id: it.materialId }, include: { stockUom: true } });
        if (!m) throw new UnprocessableEntityException(problem(`Item ${i + 1}: material não encontrado.`, 'AXIS_REFERENCE_INVALID'));
        const qty = D(it.quantity);
        if (qty.decimalPlaces() > m.stockUom.precision) throw new BadRequestException(problem(`Item ${i + 1}: a unidade ${m.stockUom.code} aceita no máximo ${m.stockUom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
        if (m.lotControlled && !it.lotId) throw new BadRequestException(`Item ${i + 1}: informe o lote.`);
        if (!m.lotControlled && it.lotId) throw new BadRequestException(`Item ${i + 1}: material sem controle de lote.`);
        if (m.serialControlled) {
          if (!it.serialId || !qty.equals(1)) throw new BadRequestException(`Item ${i + 1}: item seriado exige a série e quantidade 1.`);
          const sn = await tx.serialNumber.findUnique({ where: { id: it.serialId } });
          if (!sn || sn.materialId !== m.id) throw new UnprocessableEntityException(problem(`Item ${i + 1}: série não pertence ao material.`, 'SERIAL_DUPLICATE'));
          if (sn.currentLocationId) throw new UnprocessableEntityException(problem(`Item ${i + 1}: a série já consta em estoque; não pode ser devolvida de novo.`, 'SERIAL_DUPLICATE'));
        } else if (it.serialId) {
          throw new BadRequestException(`Item ${i + 1}: material sem controle de série.`);
        }

        if (term) {
          if (term.materialId !== m.id || (term.serialId ?? null) !== (it.serialId ?? null)) throw new UnprocessableEntityException(problem(`Item ${i + 1}: não corresponde ao termo de custódia.`, 'AXIS_REFERENCE_INVALID'));
          const acc = (itemsInTerm.get(m.id) ?? D(0)).plus(qty);
          itemsInTerm.set(m.id, acc);
          if (acc.gt(term.quantity.minus(term.returnedQty))) throw new UnprocessableEntityException('Quantidade devolvida maior que a pendente no termo de custódia.');
        }

        await this.stock.applyInternal(tx, {
          type: 'ENTRADA_DEVOLUCAO', materialId: m.id, quantity: qty, lotId: it.lotId, serialId: it.serialId, toLocationId: dto.receivingLocationId, toCondition: 'QUARENTENA',
          reason: `Devolução ${returnCode(ret.seq)} (${dto.type})`, logisticsDocumentRef: returnCode(ret.seq), projectAxisId: ret.projectAxisId ?? undefined, custodianAxisId: ret.returnedByAxisId ?? undefined, correlationId: ret.id,
        }, `return:${ret.id}:${i}`, user);
        await tx.returnItem.create({ data: { returnId: ret.id, materialId: m.id, quantity: qty, lotId: it.lotId, serialId: it.serialId } });
      }

      // A custódia sai do colaborador na devolução física, mesmo antes da inspeção.
      if (term) {
        const returned = term.returnedQty.plus([...itemsInTerm.values()].reduce((s, v) => s.plus(v), D(0)));
        const done = returned.gte(term.quantity);
        await tx.custodyTerm.update({ where: { id: term.id }, data: { returnedQty: returned, ...(done && { status: 'DEVOLVIDO' as const, closedAt: new Date() }) } });
        await this.emit(tx, 'asset.custody.changed', { custody_term_id: term.id, custodian_id: term.custodianAxisId, material_id: term.materialId, action: done ? 'returned' : 'partially_returned' });
      }
      return this.get(ret.id, user, tx);
    });
  }

  async get(id: string, user: AuthenticatedUser, tx: Tx | PrismaService = this.prisma) {
    const r = await tx.return.findUnique({ where: { id }, include: { items: true } });
    if (!r) throw new NotFoundException('Devolução não encontrada.');
    await this.rbac.assertWarehouseAccess(user, r.warehouseId);
    return { ...r, code: returnCode(r.seq) };
  }

  async list(user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.return.findMany({ where: wh === 'ALL' ? {} : { warehouseId: { in: wh } }, orderBy: { seq: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, code: returnCode(r.seq) }));
  }

  /** Inspeção classifica o item devolvido (9.6). Sucata/descarte exige aprovação do Axis. */
  async classify(returnId: string, itemId: string, dto: ClassifyDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.returnItem.findFirst({ where: { id: itemId, returnId }, include: { return: true } });
      if (!item) throw new NotFoundException('Item de devolução não encontrado.');
      await this.rbac.assertWarehouseAccess(user, item.return.warehouseId);
      if (item.status !== 'PENDENTE_INSPECAO') throw new ConflictException('Este item já foi classificado.');
      if (dto.disposition === 'SUCATA' && !dto.approvalRef) throw new UnprocessableEntityException(problem('Sucata/descarte exige aprovação do Axis (approvalRef).', 'APPROVAL_REQUIRED'));

      const loc = item.return.receivingLocationId;
      const base = { materialId: item.materialId, quantity: item.quantity, lotId: item.lotId ?? undefined, serialId: item.serialId ?? undefined, correlationId: item.return.id };
      const reason = `Inspeção ${returnCode(item.return.seq)}: ${dto.disposition}`;
      const move = (toCondition: 'DISPONIVEL' | 'BLOQUEADO' | 'AVARIADO') =>
        this.stock.applyInternal(tx, { ...base, type: 'TRANSFERENCIA', fromLocationId: loc, toLocationId: loc, fromCondition: 'QUARENTENA', toCondition, reason }, `return-class:${item.id}`, user);

      switch (dto.disposition) {
        case 'DISPONIVEL':
          await move('DISPONIVEL');
          if (item.serialId) await tx.serialNumber.update({ where: { id: item.serialId }, data: { condition: 'BOM', custodianAxisId: null } });
          break;
        case 'MANUTENCAO': // limpeza/manutenção/calibração: fora do disponível até voltar
          await move('BLOQUEADO');
          if (item.serialId) await tx.serialNumber.update({ where: { id: item.serialId }, data: { condition: 'EM_MANUTENCAO' } });
          break;
        case 'AVARIADO_REPARO':
          await move('AVARIADO');
          if (item.serialId) await tx.serialNumber.update({ where: { id: item.serialId }, data: { condition: 'AVARIADO' } });
          break;
        case 'QUARENTENA':
          break; // permanece em quarentena
        case 'SUCATA':
          await this.stock.applyInternal(tx, { ...base, type: 'DESCARTE', fromLocationId: loc, fromCondition: 'QUARENTENA', reason, axisApprovalRef: dto.approvalRef }, `return-class:${item.id}`, user);
          break;
      }
      await tx.returnItem.update({ where: { id: item.id }, data: { status: 'CLASSIFICADO', disposition: dto.disposition, classifiedBy: user.userId, classifiedAt: new Date(), approvalRef: dto.approvalRef, notes: dto.notes } });
      const open = await tx.returnItem.count({ where: { returnId, status: 'PENDENTE_INSPECAO' } });
      if (open === 0) await tx.return.update({ where: { id: returnId }, data: { status: 'ENCERRADA' } });
      await this.emit(tx, 'availability.changed', { warehouse_id: item.return.warehouseId });
      return tx.returnItem.findUniqueOrThrow({ where: { id: item.id } });
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Custódia
  // ---------------------------------------------------------------------------------------------

  async listCustody(q: ListCustodyQuery, user: AuthenticatedUser) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const all = user.permissions.includes('custody:execute') || user.permissions.includes('audit:read');
    if (!all && q.custodianAxisId && q.custodianAxisId !== user.userId) throw new ForbiddenException('Você só pode consultar a própria custódia.');
    const where: Prisma.CustodyTermWhereInput = { ...(q.status && { status: q.status }), ...(all ? (q.custodianAxisId && { custodianAxisId: q.custodianAxisId }) : { custodianAxisId: user.userId }) };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.custodyTerm.count({ where }),
      this.prisma.custodyTerm.findMany({ where, orderBy: { seq: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map((t) => ({ ...t, code: custodyCode(t.seq) })) };
  }

  /** Pendências de devolução de colaboradores desligados (regra 14). */
  async offboardedPending() {
    const gone = await this.prisma.axisMasterCache.findMany({ where: { kind: { in: ['COLLABORATOR', 'USER'] }, active: false }, select: { axisId: true } });
    const rows = await this.prisma.custodyTerm.findMany({ where: { status: 'ATIVO', custodianAxisId: { in: gone.map((g) => g.axisId) } }, orderBy: { seq: 'asc' } });
    return rows.map((t) => ({ ...t, code: custodyCode(t.seq) }));
  }

  /** Extravio: encerra a custódia como PERDIDO e baixa a série (exige aprovação do Axis). */
  async markLost(id: string, dto: CloseCustodyDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.custodyTerm.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Termo de custódia não encontrado.');
      if (t.status !== 'ATIVO') throw new ConflictException('Este termo de custódia já foi encerrado.');
      if (t.serialId) await tx.serialNumber.update({ where: { id: t.serialId }, data: { condition: 'BAIXADO', custodianAxisId: null } });
      const updated = await tx.custodyTerm.update({ where: { id }, data: { status: 'PERDIDO', closedAt: new Date(), closeNotes: `${dto.notes} (aprovação ${dto.approvalRef})` } });
      await this.emit(tx, 'asset.custody.changed', { custody_term_id: id, custodian_id: t.custodianAxisId, material_id: t.materialId, action: 'lost', approval: dto.approvalRef });
      void user;
      return { ...updated, code: custodyCode(updated.seq) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Cancelamento / recusa depois da separação (11.9): tarefa de retorno
  // ---------------------------------------------------------------------------------------------

  /** Resolve CANCELAMENTO_SOLICITADO ou DIVERGENCIA (entrega recusada): o estoque nunca saiu, então libera as reservas. */
  async resolveCancellation(orderId: string, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.fulfillmentOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
      if (!['CANCELAMENTO_SOLICITADO', 'DIVERGENCIA'].includes(order.status)) throw new ConflictException(`A ordem está em ${order.status}; só cancelamentos solicitados ou divergências podem ser resolvidos.`);
      const inTransit = await tx.shipment.count({ where: { orderId, status: { in: ['EXPEDIDA', 'PARCIAL'] } } });
      if (inTransit > 0) throw new ConflictException('Há expedição em trânsito: aguarde a entrega/recusa ou a devolução dos volumes.');
      const delivered = await tx.stockMovement.count({ where: { correlationId: orderId, type: 'SAIDA_ENTREGA' } });
      if (delivered > 0) throw new ConflictException('Parte da ordem já foi entregue: use devolução para o que foi recebido.');

      const reservations = await tx.reservation.findMany({ where: { item: { orderId }, status: 'ATIVA' } });
      for (const r of reservations) {
        const left = r.quantity.minus(r.consumedQty);
        await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = GREATEST(reserved_qty - ${left.toString()}::numeric, 0), updated_at = now() WHERE id = ${r.balanceId}`;
        await tx.reservation.update({ where: { id: r.id }, data: { status: 'LIBERADA', releasedAt: new Date(), releaseReason: reason } });
      }
      await tx.pickingTask.updateMany({ where: { orderId, status: { notIn: ['CANCELADA'] } }, data: { status: 'CANCELADA' } });
      const shipments = await tx.shipment.findMany({ where: { orderId, status: 'PRONTO' } });
      for (const s of shipments) {
        await tx.shipment.update({ where: { id: s.id }, data: { status: 'RECUSADA' } });
        await tx.package.updateMany({ where: { shipmentId: s.id }, data: { status: 'RECUSADO' } });
      }
      const updated = await tx.fulfillmentOrder.update({ where: { id: orderId }, data: { status: 'CANCELADA', statusReason: reason } });
      await this.emit(tx, 'availability.changed', { warehouse_id: order.warehouseId });
      return { id: updated.id, status: updated.status, releasedReservations: reservations.length };
    });
  }
}
