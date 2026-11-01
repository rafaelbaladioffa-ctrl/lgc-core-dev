import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { StockService } from '../stock/stock.service.js';
import { orderCode } from '../fulfillment/fulfillment.service.js';
import { problem } from '../common/errors.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CheckDto, ConfirmDeliveryDto, DispatchDto, ListTasksQuery, PackDto, ReleasePickingDto, ScanDto } from './shipping.dto.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const isCustodyMaterial = (m: { returnable: boolean; assetTagged: boolean; serialControlled: boolean; type: string }) => m.returnable || m.assetTagged || m.serialControlled || ['EPI', 'FERRAMENTA', 'EQUIPAMENTO', 'ATIVO'].includes(m.type);
const pad = (prefix: string, n: number) => `${prefix}-${String(n).padStart(8, '0')}`;

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly stock: StockService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
  }

  private setOrder(tx: Tx, id: string, status: FulfillmentStatus, statusReason: string | null = null) {
    return tx.fulfillmentOrder.update({ where: { id }, data: { status, statusReason } });
  }

  // ---------------------------------------------------------------------------------------------
  // Liberação para separação
  // ---------------------------------------------------------------------------------------------

  async releasePicking(orderId: string, dto: ReleasePickingDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.fulfillmentOrder.findUnique({ where: { id: orderId }, include: { items: { include: { reservations: { where: { status: 'ATIVA' } } } } } });
      if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
      if (!order.warehouseId) throw new UnprocessableEntityException('Ordem sem almoxarifado de atendimento.');
      await this.rbac.assertWarehouseAccess(user, order.warehouseId);
      if (order.status === 'RESERVADA_PARCIAL' && !dto.acceptPartial) {
        throw new UnprocessableEntityException(problem('Atendimento parcial exige aceite explícito (acceptPartial) — a ordem manterá a pendência.', 'APPROVAL_REQUIRED'));
      }
      if (!['RESERVADA', 'RESERVADA_PARCIAL'].includes(order.status)) throw new ConflictException(`A ordem está em ${order.status} e não pode ser liberada para separação.`);

      const reservations = order.items.flatMap((i) => i.reservations.map((r) => ({ ...r, itemId: i.id })));
      if (reservations.length === 0) throw new UnprocessableEntityException('Não há reservas ativas para separar.');

      const materials = await tx.material.findMany({ where: { id: { in: [...new Set(reservations.map((r) => r.materialId))] } } });
      const needsCheck = dto.requireCheck === true || materials.some((m) => m.requiresAuthorization || m.serialControlled || m.criticality === 'A');

      const task = await tx.pickingTask.create({
        data: {
          orderId: order.id, warehouseId: order.warehouseId, priority: dto.priority ?? 0, requiresCheck: needsCheck, createdBy: user.userId,
          items: { create: reservations.map((r) => ({ reservationId: r.id, fulfillmentItemId: r.itemId, materialId: r.materialId, locationId: r.locationId, lotId: r.lotId, quantityPlanned: r.quantity })) },
        },
        include: { items: true },
      });
      await this.setOrder(tx, order.id, 'LIBERADA_SEPARACAO', order.status === 'RESERVADA_PARCIAL' ? 'Atendimento parcial aceito: pendência mantida.' : null);
      return { ...task, code: pad('SEP', task.seq) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Separação
  // ---------------------------------------------------------------------------------------------

  /** Serializa operações concorrentes sobre a mesma tarefa (dois dispositivos do mesmo usuário, p. ex.). */
  private lockTask(tx: Tx, id: string) {
    return tx.$queryRaw`SELECT id FROM picking_tasks WHERE id = ${id} FOR UPDATE`;
  }

  private async loadTask(tx: Tx | PrismaService, id: string) {
    const task = await tx.pickingTask.findUnique({ where: { id }, include: { items: true } });
    if (!task) throw new NotFoundException('Tarefa de separação não encontrada.');
    return task;
  }

  async listTasks(q: ListTasksQuery, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.pickingTask.findMany({
      where: { ...(q.status && { status: q.status }), ...(q.orderId && { orderId: q.orderId }), ...(wh !== 'ALL' && { warehouseId: { in: wh } }) },
      orderBy: [{ priority: 'desc' }, { seq: 'asc' }], take: 200, include: { items: true },
    });
    return rows.map((t) => ({ ...t, code: pad('SEP', t.seq) }));
  }

  async getTask(id: string, user: AuthenticatedUser) {
    const task = await this.loadTask(this.prisma, id);
    await this.rbac.assertWarehouseAccess(user, task.warehouseId);
    return { ...task, code: pad('SEP', task.seq) };
  }

  async start(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.loadTask(tx, id);
      await this.rbac.assertWarehouseAccess(user, task.warehouseId);
      if (task.status === 'EM_SEPARACAO' && task.pickedBy === user.userId) return { ...task, code: pad('SEP', task.seq) };
      if (task.status !== 'ABERTA') throw new ConflictException(`A tarefa está em ${task.status} e não pode ser iniciada.`);
      const updated = await tx.pickingTask.update({ where: { id }, data: { status: 'EM_SEPARACAO', pickedBy: user.userId }, include: { items: true } });
      await this.setOrder(tx, task.orderId, 'EM_SEPARACAO');
      await this.emit(tx, 'picking.started', { task_id: id, order_id: task.orderId });
      return { ...updated, code: pad('SEP', updated.seq) };
    });
  }

  async scan(id: string, dto: ScanDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.loadTask(tx, id);
      await this.rbac.assertWarehouseAccess(user, task.warehouseId);
      if (task.status !== 'EM_SEPARACAO') throw new ConflictException('A tarefa não está em separação.');
      if (task.pickedBy !== user.userId) throw new ForbiddenException('Esta tarefa está sendo separada por outro usuário.');
      const item = task.items.find((i) => i.id === dto.pickingItemId);
      if (!item) throw new NotFoundException('Item não pertence a esta tarefa.');
      if (item.status !== 'PENDENTE') throw new ConflictException('Este item já foi encerrado.');

      if (dto.locationId !== item.locationId) throw new UnprocessableEntityException(problem('Endereço lido diferente do endereço de separação.', 'INVALID_LOCATION'));

      if (dto.notFound) {
        if (!dto.divergenceReason) throw new BadRequestException('Divergência exige motivo (divergenceReason).');
        return tx.pickingItem.update({ where: { id: item.id }, data: { status: 'DIVERGENTE', divergenceReason: dto.divergenceReason } });
      }
      const material = await tx.material.findUniqueOrThrow({ where: { id: item.materialId }, include: { barcodes: true } });
      const readOk = dto.materialId === material.id || (dto.barcode && (dto.barcode === material.code || material.barcodes.some((b) => b.code === dto.barcode)));
      if (!readOk) throw new UnprocessableEntityException('O item lido não corresponde ao material da tarefa.');
      if (item.lotId && dto.lotId !== item.lotId) throw new UnprocessableEntityException('Lote lido diferente do lote reservado.');

      // Código de barras de embalagem converte pelo fator (ex.: 1 caixa = 12 UN).
      const packBarcode = !dto.materialId && dto.barcode && dto.barcode !== material.code ? material.barcodes.find((b) => b.code === dto.barcode) : undefined;
      const qty = D(dto.quantity).times(packBarcode?.factor ?? 1);
      const remaining = item.quantityPlanned.minus(item.quantityPicked);
      if (qty.gt(remaining)) throw new UnprocessableEntityException(`Quantidade acima do planejado (faltam ${remaining.toString()}).`);
      const uom = await tx.unitOfMeasure.findUniqueOrThrow({ where: { id: material.stockUomId } });
      if (qty.decimalPlaces() > uom.precision) throw new BadRequestException(problem(`A unidade ${uom.code} aceita no máximo ${uom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));

      let serialIds = item.serialIds;
      if (material.serialControlled) {
        if (!dto.serialId) throw new BadRequestException('Item seriado: leia o número de série.');
        if (!qty.equals(1)) throw new BadRequestException('Item seriado é separado de 1 em 1.');
        if (serialIds.includes(dto.serialId)) throw new ConflictException(problem('Esta série já foi lida nesta tarefa.', 'SERIAL_DUPLICATE'));
        const serial = await tx.serialNumber.findUnique({ where: { id: dto.serialId } });
        if (!serial || serial.materialId !== material.id || serial.currentLocationId !== item.locationId) throw new UnprocessableEntityException('A série lida não está no endereço de separação.');
        if (serial.condition === 'BAIXADO' || serial.condition === 'AVARIADO') throw new UnprocessableEntityException('A série lida não está em condição de uso.');
        const taken = await tx.pickingItem.count({ where: { serialIds: { has: dto.serialId }, task: { status: { in: ['ABERTA', 'EM_SEPARACAO', 'SEPARADA', 'EM_CONFERENCIA', 'CONFERIDA'] } } } });
        if (taken > 0) throw new ConflictException(problem('Esta série já está separada em outra tarefa.', 'SERIAL_DUPLICATE'));
        serialIds = [...serialIds, dto.serialId];
      } else if (dto.serialId) {
        throw new BadRequestException('Este material não é controlado por série.');
      }

      const picked = item.quantityPicked.plus(qty);
      let status: 'PENDENTE' | 'SEPARADO' | 'DIVERGENTE' = picked.equals(item.quantityPlanned) ? 'SEPARADO' : 'PENDENTE';
      if (status === 'PENDENTE' && dto.closeShort) {
        if (!dto.divergenceReason) throw new BadRequestException('Divergência exige motivo (divergenceReason).');
        status = 'DIVERGENTE';
      }
      return tx.pickingItem.update({ where: { id: item.id }, data: { quantityPicked: picked, serialIds, status, divergenceReason: status === 'DIVERGENTE' ? dto.divergenceReason : null } });
    });
  }

  async complete(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTask(tx, id);
      const task = await this.loadTask(tx, id);
      await this.rbac.assertWarehouseAccess(user, task.warehouseId);
      if (task.status !== 'EM_SEPARACAO') throw new ConflictException('A tarefa não está em separação.');
      if (task.pickedBy !== user.userId) throw new ForbiddenException('Esta tarefa está sendo separada por outro usuário.');
      const pending = task.items.filter((i) => i.status === 'PENDENTE');
      if (pending.length > 0) throw new UnprocessableEntityException(`Há ${pending.length} item(ns) sem separação concluída; separe ou encerre com divergência.`);

      // Falta: devolve ao disponível a parte reservada e não separada.
      let totalPicked = D(0);
      for (const it of task.items) {
        totalPicked = totalPicked.plus(it.quantityPicked);
        const short = it.quantityPlanned.minus(it.quantityPicked);
        if (short.lte(0)) continue;
        const r = await tx.reservation.findUniqueOrThrow({ where: { id: it.reservationId } });
        await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = GREATEST(reserved_qty - ${short.toString()}::numeric, 0), updated_at = now() WHERE id = ${r.balanceId}`;
        await tx.reservation.update({ where: { id: r.id }, data: it.quantityPicked.equals(0) ? { status: 'LIBERADA', releasedAt: new Date(), releaseReason: it.divergenceReason ?? 'Sem separação' } : { quantity: it.quantityPicked } });
      }

      const status = task.requiresCheck && totalPicked.gt(0) ? 'EM_CONFERENCIA' : 'SEPARADA';
      const updated = await tx.pickingTask.update({ where: { id }, data: { status, completedAt: new Date() }, include: { items: true } });
      if (totalPicked.equals(0)) await this.setOrder(tx, task.orderId, 'DIVERGENCIA', 'Nada foi separado.');
      else await this.setOrder(tx, task.orderId, status === 'EM_CONFERENCIA' ? 'EM_CONFERENCIA' : 'SEPARADA');
      await this.emit(tx, 'picking.completed', { task_id: id, order_id: task.orderId, picked: totalPicked.toString(), divergent: task.items.some((i) => i.status === 'DIVERGENTE') });
      return { ...updated, code: pad('SEP', updated.seq) };
    });
  }

  /** Conferência independente (9.4.5, 6): quem separou não confere. */
  async check(id: string, dto: CheckDto, user: AuthenticatedUser) {
    void dto;
    return this.prisma.$transaction(async (tx) => {
      const task = await this.loadTask(tx, id);
      await this.rbac.assertWarehouseAccess(user, task.warehouseId);
      if (task.status !== 'EM_CONFERENCIA') throw new ConflictException('A tarefa não está aguardando conferência.');
      if (task.pickedBy === user.userId) throw new ForbiddenException('Segregação de funções: quem separou não pode conferir a própria separação.');
      const updated = await tx.pickingTask.update({ where: { id }, data: { status: 'CONFERIDA', checkedBy: user.userId, checkedAt: new Date() }, include: { items: true } });
      await this.setOrder(tx, task.orderId, 'SEPARADA');
      return { ...updated, code: pad('SEP', updated.seq) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Embalagem e romaneio
  // ---------------------------------------------------------------------------------------------

  async pack(orderId: string, dto: PackDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.fulfillmentOrder.findUnique({ where: { id: orderId } });
      if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
      if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);
      const task = await tx.pickingTask.findFirst({ where: { orderId, status: { in: ['SEPARADA', 'CONFERIDA', 'EM_CONFERENCIA'] } }, orderBy: { seq: 'desc' }, include: { items: true } });
      if (!task) throw new ConflictException('Não há separação concluída para embalar.');
      if (task.status === 'EM_CONFERENCIA') throw new UnprocessableEntityException('Conferência independente pendente.');
      if (order.status !== 'SEPARADA') throw new ConflictException(`A ordem está em ${order.status} e não pode ser embalada.`);
      if (await tx.shipment.count({ where: { orderId, status: { not: 'RECUSADA' } } })) throw new ConflictException('Esta ordem já foi embalada.');

      // Todo o separado precisa estar em algum volume, e nada além disso.
      const packed = new Map<string, Prisma.Decimal>();
      for (const p of dto.packages) {
        for (const it of p.items) {
          const pi = task.items.find((x) => x.id === it.pickingItemId);
          if (!pi) throw new BadRequestException('Item de embalagem não pertence à separação desta ordem.');
          packed.set(pi.id, (packed.get(pi.id) ?? D(0)).plus(it.quantity));
        }
      }
      for (const pi of task.items) {
        if (pi.quantityPicked.equals(0)) continue;
        const got = packed.get(pi.id) ?? D(0);
        if (!got.equals(pi.quantityPicked)) throw new UnprocessableEntityException(`Item ${pi.id}: embalado ${got.toString()} de ${pi.quantityPicked.toString()} separado(s).`);
      }
      for (const id of packed.keys()) if (task.items.find((x) => x.id === id)!.quantityPicked.equals(0)) throw new UnprocessableEntityException('Item sem separação não pode ser embalado.');

      for (const [pid, q] of packed) {
        const pi = task.items.find((x) => x.id === pid)!;
        const mat = await tx.material.findUniqueOrThrow({ where: { id: pi.materialId }, include: { stockUom: true } });
        if (q.decimalPlaces() > mat.stockUom.precision) throw new UnprocessableEntityException(problem(`A unidade ${mat.stockUom.code} aceita no máximo ${mat.stockUom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
      }
      for (const p of dto.packages) for (const it of p.items) {
        const pi = task.items.find((x) => x.id === it.pickingItemId)!;
        const mat = await tx.material.findUniqueOrThrow({ where: { id: pi.materialId }, include: { stockUom: true } });
        if (D(it.quantity).decimalPlaces() > mat.stockUom.precision) throw new UnprocessableEntityException(problem(`A unidade ${mat.stockUom.code} aceita no máximo ${mat.stockUom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
      }

      const shipment = await tx.shipment.create({ data: { orderId, destination: dto.destination, createdBy: user.userId } });
      for (const p of dto.packages) {
        await tx.package.create({
          data: { shipmentId: shipment.id, orderId, weightKg: p.weightKg, lengthCm: p.lengthCm, widthCm: p.widthCm, heightCm: p.heightCm, seal: p.seal, items: { create: p.items.map((i) => ({ pickingItemId: i.pickingItemId, quantity: i.quantity })) } },
        });
      }
      await this.setOrder(tx, orderId, 'PRONTA_EXPEDICAO');
      return this.loadShipment(tx, shipment.id);
    });
  }

  private async loadShipment(tx: Tx | PrismaService, id: string) {
    const s = await tx.shipment.findUnique({ where: { id }, include: { packages: { include: { items: true }, orderBy: { seq: 'asc' } }, proofs: true } });
    if (!s) throw new NotFoundException('Expedição não encontrada.');
    return { ...s, code: pad('EXP', s.seq), packages: s.packages.map((p) => ({ ...p, code: pad('VOL', p.seq) })) };
  }

  async getShipment(id: string) {
    return this.loadShipment(this.prisma, id);
  }

  // ---------------------------------------------------------------------------------------------
  // Expedição
  // ---------------------------------------------------------------------------------------------

  async dispatch(id: string, dto: DispatchDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id } });
      if (!s) throw new NotFoundException('Expedição não encontrada.');
      if (s.status !== 'PRONTO') throw new ConflictException(`A expedição está em ${s.status} e não pode ser despachada.`);
      const order = await tx.fulfillmentOrder.findUniqueOrThrow({ where: { id: s.orderId } });
      if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);
      // Desligamento recebido do Axis bloqueia novas entregas (11.14).
      await this.assertRecipientActive(tx, order.recipientAxisId);

      await tx.shipment.update({ where: { id }, data: { status: 'EXPEDIDA', carrier: dto.carrier, route: dto.route, vehicle: dto.vehicle, destination: dto.destination ?? s.destination, manifestCode: pad('ROM', s.seq), dispatchedAt: new Date(), dispatchedBy: user.userId } });
      await tx.package.updateMany({ where: { shipmentId: id }, data: { status: 'EXPEDIDO' } });
      await this.setOrder(tx, s.orderId, 'EXPEDIDA');
      await this.emit(tx, 'shipment.dispatched', { shipment_id: id, order_id: s.orderId, order_code: orderCode(order.seq), manifest: pad('ROM', s.seq), carrier: dto.carrier });
      return this.loadShipment(tx, id);
    });
  }

  private async assertRecipientActive(tx: Tx, axisId?: string | null) {
    if (!axisId) return;
    const c = await tx.axisMasterCache.findFirst({ where: { axisId, kind: { in: ['COLLABORATOR', 'USER'] } } });
    if (c && !c.active) throw new UnprocessableEntityException(problem('Recebedor/destinatário desligado: novas entregas bloqueadas.', 'AXIS_REFERENCE_INVALID'));
  }

  // ---------------------------------------------------------------------------------------------
  // Entrega e consumo (9.5): a baixa do estoque só ocorre após a entrega confirmada
  // ---------------------------------------------------------------------------------------------

  async confirmDelivery(id: string, dto: ConfirmDeliveryDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const s = await tx.shipment.findUnique({ where: { id }, include: { packages: { include: { items: { include: { pickingItem: true } } } } } });
      if (!s) throw new NotFoundException('Expedição não encontrada.');
      if (!['EXPEDIDA', 'PARCIAL'].includes(s.status)) throw new ConflictException(`A expedição está em ${s.status} e não aceita confirmação de entrega.`);
      const order = await tx.fulfillmentOrder.findUniqueOrThrow({ where: { id: s.orderId } });
      if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);

      const pending = s.packages.filter((p) => p.status === 'EXPEDIDO');
      let delivering = pending;
      if (dto.outcome === 'PARCIAL') {
        if (!dto.packageIds?.length) throw new BadRequestException('Entrega parcial exige a lista de volumes entregues (packageIds).');
        delivering = pending.filter((p) => dto.packageIds!.includes(p.id));
        if (delivering.length !== new Set(dto.packageIds).size) throw new UnprocessableEntityException('Há volume informado que não está pendente de entrega nesta expedição.');
        if (delivering.length === pending.length) throw new BadRequestException('Todos os volumes foram entregues: use o resultado ENTREGUE.');
      } else if (dto.packageIds?.length) {
        throw new BadRequestException('packageIds só se aplica à entrega parcial.');
      }

      const proofBase = { shipmentId: id, outcome: dto.outcome, receiverName: dto.receiverName, receiverAxisId: dto.receiverAxisId, deliveredAt: dto.deliveredAt ? new Date(dto.deliveredAt) : new Date(), latitude: dto.latitude, longitude: dto.longitude, signatureRef: dto.signatureRef, photoRef: dto.photoRef, notes: dto.notes, registeredBy: user.userId };

      if (dto.outcome === 'RECUSADA') {
        if (!dto.notes) throw new BadRequestException('Recusa exige o motivo (notes).');
        await tx.deliveryProof.create({ data: { ...proofBase, packageIds: pending.map((p) => p.id) } });
        await tx.package.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { status: 'RECUSADO' } });
        await tx.shipment.update({ where: { id }, data: { status: 'RECUSADA' } });
        await this.setOrder(tx, s.orderId, 'DIVERGENCIA', `Entrega recusada: ${dto.notes}`);
        await this.emit(tx, 'delivery.refused', { shipment_id: id, order_id: s.orderId, reason: dto.notes });
        return this.loadShipment(tx, id);
      }

      // Custódia/EPI/ativo exige identificação do recebedor (11.13); desligado não recebe (11.14).
      const materials = await tx.material.findMany({ where: { id: { in: delivering.flatMap((p) => p.items.map((i) => i.pickingItem.materialId)) } } });
      const custody = materials.some((m) => isCustodyMaterial(m));
      if (custody && !dto.receiverAxisId) throw new UnprocessableEntityException(problem('Material em custódia (EPI, ferramenta, ativo ou seriado) exige a identificação do recebedor no Axis (receiverAxisId).', 'AXIS_REFERENCE_INVALID'));
      await this.assertRecipientActive(tx, dto.receiverAxisId);
      const matById = new Map(materials.map((m) => [m.id, m]));

      for (const pkg of delivering) {
        for (const pit of pkg.items) {
          const pi = pit.pickingItem;
          const material = matById.get(pi.materialId)!;
          const r = await tx.reservation.findUniqueOrThrow({ where: { id: pi.reservationId } });
          const qty = pit.quantity;
          // 1) a reserva deixa de comprometer o saldo; 2) o ledger baixa a quantidade.
          await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = GREATEST(reserved_qty - ${qty.toString()}::numeric, 0), updated_at = now() WHERE id = ${r.balanceId}`;
          const consumed = r.consumedQty.plus(qty);
          await tx.reservation.update({ where: { id: r.id }, data: { consumedQty: consumed, ...(consumed.gte(r.quantity) && { status: 'CONSUMIDA' as const }) } });

          const serialsLeft = material.serialControlled ? await tx.serialNumber.findMany({ where: { id: { in: pi.serialIds }, currentLocationId: r.locationId }, take: Number(qty) }) : [];
          if (material.serialControlled && serialsLeft.length !== Number(qty)) throw new UnprocessableEntityException('Séries separadas não estão mais no endereço de origem.');
          const lines = material.serialControlled ? serialsLeft.map((sn) => ({ serialId: sn.id, quantity: D(1), key: `delivery:${pit.id}:${sn.id}` })) : [{ serialId: undefined, quantity: qty, key: `delivery:${pit.id}` }];
          for (const line of lines) {
            await this.stock.applyInternal(tx, {
              type: 'SAIDA_ENTREGA', materialId: material.id, quantity: line.quantity, lotId: r.lotId ?? undefined, serialId: line.serialId, fromLocationId: r.locationId,
              reason: `Entrega ${orderCode(order.seq)} (${pad('EXP', s.seq)})`, axisDocumentRef: order.axisRequestId, logisticsDocumentRef: pad('ROM', s.seq),
              projectAxisId: order.projectAxisId ?? undefined, costCenterAxisId: order.costCenterAxisId ?? undefined,
              custodianAxisId: custody ? dto.receiverAxisId : undefined, correlationId: order.id, unitCost: material.averageCost ? Number(material.averageCost) : undefined, // custo histórico recebido do Axis
            }, line.key, user);
            // Termo de custódia (9.5): EPI, ferramenta, equipamento, ativo ou seriado ficam sob responsabilidade do recebedor.
            if (isCustodyMaterial(material) && dto.receiverAxisId) {
              const term = await tx.custodyTerm.create({
                data: { custodianAxisId: dto.receiverAxisId, materialId: material.id, serialId: line.serialId, lotId: r.lotId, quantity: line.quantity, orderId: order.id, shipmentId: id, projectAxisId: order.projectAxisId, acceptanceRef: dto.signatureRef, expectedReturnAt: dto.expectedReturnAt ? new Date(dto.expectedReturnAt) : undefined, createdBy: user.userId },
              });
              await this.emit(tx, 'asset.custody.changed', { custody_term_id: term.id, custodian_id: dto.receiverAxisId, material_id: material.id, serial_id: line.serialId ?? null, action: 'delivered' });
            }
          }
        }
      }

      await tx.deliveryProof.create({ data: { ...proofBase, packageIds: delivering.map((p) => p.id) } });
      await tx.package.updateMany({ where: { id: { in: delivering.map((p) => p.id) } }, data: { status: 'ENTREGUE' } });

      const left = pending.length - delivering.length;
      if (left === 0) {
        await tx.shipment.update({ where: { id }, data: { status: 'ENTREGUE' } });
        await this.setOrder(tx, s.orderId, 'ENTREGUE');
        await this.emit(tx, 'delivery.confirmed', { shipment_id: id, order_id: s.orderId, receiver: dto.receiverName });
      } else {
        await tx.shipment.update({ where: { id }, data: { status: 'PARCIAL' } });
        await this.setOrder(tx, s.orderId, 'EXPEDIDA', `Entrega parcial: ${left} volume(s) pendente(s).`);
        await this.emit(tx, 'delivery.partial', { shipment_id: id, order_id: s.orderId, pending_packages: left });
      }
      await this.emit(tx, 'availability.changed', { warehouse_id: order.warehouseId });
      return this.loadShipment(tx, id);
    });
  }
}
