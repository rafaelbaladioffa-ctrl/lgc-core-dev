import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FulfillmentStatus, Prisma } from '@prisma/client';
import type { FulfillmentOrder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { problem } from '../common/errors.js';
import { resolveOwnIds } from '../common/axis-cache.js';
import { todayBR } from '../stock/availability.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CreateFulfillmentDto, ListFulfillmentQuery } from './fulfillment.dto.js';
import { emitOutbound, orderCode, orderEventBase, summarizeItems } from './order-events.js';

type Tx = Prisma.TransactionClient;
type Actor = { userId: string };

/** Ordens ainda sem separação iniciada: podem ser substituídas ou canceladas sem tarefa de retorno (11.9). */
const PRE_PICKING: FulfillmentStatus[] = ['RECEBIDA', 'EM_ANALISE', 'RESERVADA', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO', 'BLOQUEADA'];
const RESERVE_DAYS_AFTER_NEEDED = 7;
const RESERVE_DEFAULT_DAYS = 14;

export { orderCode };

/**
 * Escopo de quem só tem `fulfillment:read`: a ordem é "sua" se você é o solicitante (id de usuário do Axis)
 * ou o destinatário. O Core manda o destinatário como id de COLABORADOR (`recipient_id`), então ele casa com
 * `collaboratorId` do token (ou com o colaborador ligado ao usuário no cache `USER`: `resolveOwnIds`); o id de
 * usuário continua aceito para ordens antigas ou criadas manualmente.
 */
export function ownIds(user: Pick<AuthenticatedUser, 'userId' | 'collaboratorId'>): string[] {
  return [user.userId, user.collaboratorId].filter((id): id is string => !!id);
}

export function ownOrdersWhere(user: Pick<AuthenticatedUser, 'userId' | 'collaboratorId'>, ids = ownIds(user)): Prisma.FulfillmentOrderWhereInput {
  return { OR: [{ requesterAxisId: user.userId }, { recipientAxisId: { in: ids } }] };
}

export function isOwnOrder(order: Pick<FulfillmentOrder, 'requesterAxisId' | 'recipientAxisId'>, user: Pick<AuthenticatedUser, 'userId' | 'collaboratorId'>, ids = ownIds(user)): boolean {
  if (order.requesterAxisId === user.userId) return true;
  return order.recipientAxisId !== null && ids.includes(order.recipientAxisId);
}

/** Situações em que a ordem ainda aceita reserva e, portanto, a definição do almoxarifado. */
const ASSIGNABLE: FulfillmentStatus[] = ['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO'];

@Injectable()
export class FulfillmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return emitOutbound(tx, eventType, payload);
  }

  // ---------------------------------------------------------------------------------------------
  // Criação (material_request.approved)
  // ---------------------------------------------------------------------------------------------

  /** Idempotente por (axisRequestId, requestVersion). Versão maior substitui a anterior se ainda não houve separação. */
  async createFromRequest(tx: Tx, dto: CreateFulfillmentDto, actor: Actor, sourceEventId?: string): Promise<{ order: FulfillmentOrder; replayed: boolean }> {
    const version = dto.requestVersion ?? 1;
    const existing = await tx.fulfillmentOrder.findUnique({ where: { axisRequestId_requestVersion: { axisRequestId: dto.axisRequestId, requestVersion: version } } });
    if (existing) return { order: existing, replayed: true };

    const latest = await tx.fulfillmentOrder.findFirst({ where: { axisRequestId: dto.axisRequestId }, orderBy: { requestVersion: 'desc' } });
    if (latest && latest.requestVersion > version) {
      throw new ConflictException(problem(`Já existe a versão ${latest.requestVersion} desta requisição; a versão ${version} é mais antiga.`, 'REQUEST_VERSION_CONFLICT'));
    }

    // Resolução de materiais (por id ou código) — falha explícita, nunca correção silenciosa (12.4).
    const merged = new Map<string, { materialId: string; quantity: Prisma.Decimal; notes?: string; uomId: string }>();
    for (const [i, item] of dto.items.entries()) {
      if (!item.materialId && !item.materialCode) throw new BadRequestException(problem(`Item ${i + 1}: informe materialId ou materialCode.`, 'AXIS_REFERENCE_INVALID'));
      const material = await tx.material.findFirst({ where: item.materialId ? { id: item.materialId } : { code: item.materialCode } });
      if (!material) throw new UnprocessableEntityException(problem(`Item ${i + 1}: material ${item.materialCode ?? item.materialId} não encontrado no catálogo.`, 'AXIS_REFERENCE_INVALID'));
      if (material.status !== 'ATIVO') throw new UnprocessableEntityException(problem(`Item ${i + 1}: o material ${material.code} está inativo.`, 'AXIS_REFERENCE_INVALID'));
      const uom = await tx.unitOfMeasure.findUniqueOrThrow({ where: { id: material.stockUomId } });
      const qty = new Prisma.Decimal(item.quantity);
      if (qty.decimalPlaces() > uom.precision) throw new BadRequestException(problem(`Item ${i + 1}: a unidade ${uom.code} aceita no máximo ${uom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));
      const prev = merged.get(material.id);
      merged.set(material.id, { materialId: material.id, uomId: material.stockUomId, quantity: (prev?.quantity ?? new Prisma.Decimal(0)).plus(qty), notes: item.notes ?? prev?.notes });
    }

    // Referências do Axis conhecidas pelo cache.
    const warnings: string[] = [];
    let blockReason: string | undefined;
    if (dto.projectAxisId) {
      const project = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'PROJECT', axisId: dto.projectAxisId } } });
      if (!project) warnings.push(`Projeto ${dto.projectAxisId} ainda não sincronizado do Axis.`);
      else if (!project.active) throw new UnprocessableEntityException(problem(`O projeto ${project.code ?? dto.projectAxisId} não está ativo no Axis.`, 'AXIS_REFERENCE_INVALID'));
    }
    // Centro de custo e site de destino: o cache pode ainda não ter o cadastro (evento em trânsito); só avisa, nunca bloqueia.
    if (dto.costCenterAxisId) {
      const cc = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'COST_CENTER', axisId: dto.costCenterAxisId } } });
      if (!cc) warnings.push(`Centro de custo ${dto.costCenterAxisId} ainda não sincronizado do Axis.`);
      else if (!cc.active) warnings.push(`O centro de custo ${cc.code ?? dto.costCenterAxisId} está inativo no Axis.`);
    }
    if (dto.destinationSiteAxisId) {
      const site = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: 'SITE', axisId: dto.destinationSiteAxisId } } });
      if (!site) warnings.push(`Site de destino ${dto.destinationSiteAxisId} ainda não sincronizado do Axis.`);
      else if (!site.active) warnings.push(`O site de destino ${site.code ?? dto.destinationSiteAxisId} está inativo no Axis.`);
    }
    if (dto.recipientAxisId) {
      const collab = await tx.axisMasterCache.findFirst({ where: { axisId: dto.recipientAxisId, kind: { in: ['COLLABORATOR', 'USER'] } } });
      if (!collab) warnings.push(`Destinatário ${dto.recipientAxisId} ainda não sincronizado do Axis.`);
      else if (!collab.active) blockReason = 'Destinatário desligado: novas entregas bloqueadas (regra 14).';
    }

    // Almoxarifado de atendimento.
    const warehouse = await this.resolveWarehouse(tx, dto);

    // Versão anterior: substitui se ainda não houve separação; caso contrário exige análise (9.1).
    let needsAnalysis = false;
    if (latest && latest.status !== 'CANCELADA') {
      if (PRE_PICKING.includes(latest.status)) {
        await this.releaseOrderReservations(tx, latest.id, `Substituída pela versão ${version}`, 'LIBERADA');
        await tx.fulfillmentOrder.update({ where: { id: latest.id }, data: { status: 'CANCELADA', statusReason: `Substituída pela versão ${version} da requisição` } });
      } else {
        needsAnalysis = true;
      }
    }

    const order = await tx.fulfillmentOrder.create({
      data: {
        axisRequestId: dto.axisRequestId, requestVersion: version, sourceEventId, warehouseId: warehouse?.id,
        projectAxisId: dto.projectAxisId, costCenterAxisId: dto.costCenterAxisId, requesterAxisId: dto.requesterAxisId, recipientAxisId: dto.recipientAxisId,
        neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined, notes: dto.notes, referenceWarnings: warnings, createdBy: actor.userId,
        destinationSiteAxisId: dto.destinationSiteAxisId, destinationText: dto.destinationText, destinationLat: dto.destinationLat, destinationLng: dto.destinationLng,
        items: { create: [...merged.values()].map((m) => ({ materialId: m.materialId, requestedMaterialId: m.materialId, quantity: m.quantity, uomId: m.uomId, notes: m.notes })) },
      },
    });

    // Situação inicial: bloqueada, em análise, sem almoxarifado ou o resultado da reserva (AGUARDANDO_ESTOQUE quando falta material).
    const finalOrder = blockReason
      ? await this.setStatus(tx, order.id, 'BLOQUEADA', blockReason)
      : needsAnalysis
        ? await this.setStatus(tx, order.id, 'EM_ANALISE', `Versão ${version} recebida com separação já iniciada na versão anterior: requer análise.`)
        : !warehouse
          ? await this.setStatus(tx, order.id, 'AGUARDANDO_INFORMACAO', 'Almoxarifado de atendimento não definido.')
          : await this.reserve(tx, order.id);
    await this.emitCreated(tx, finalOrder);
    return { order: finalOrder, replayed: false };
  }

  /**
   * `fulfillment.created` (Logística → Core): confirma a ordem, com a situação já resolvida pela reserva e, por item, o
   * quanto está reservado e o que falta (a ordem fica AGUARDANDO_ESTOQUE enquanto faltar material: PA-11).
   */
  private async emitCreated(tx: Tx, order: FulfillmentOrder) {
    const items = await tx.fulfillmentItem.findMany({ where: { orderId: order.id }, include: { reservations: { where: { status: { in: ['ATIVA', 'CONSUMIDA'] } } } }, orderBy: { createdAt: 'asc' } });
    const rows = items.map((i) => {
      const reserved = i.reservations.reduce((s, r) => s.plus(r.quantity), new Prisma.Decimal(0));
      return { materialId: i.materialId, quantity: i.quantity, extra: { reserved: reserved.toString(), shortage: Prisma.Decimal.max(i.quantity.minus(reserved), 0).toString() } };
    });
    await this.emit(tx, 'fulfillment.created', { ...orderEventBase(order), items: await summarizeItems(tx, rows) });
  }

  private async resolveWarehouse(tx: Tx, dto: CreateFulfillmentDto) {
    const code = dto.warehouseCode ?? this.config.get<string>('DEFAULT_WAREHOUSE_CODE');
    const where = dto.warehouseId ? { id: dto.warehouseId } : code ? { code } : null;
    if (!where) return null;
    const wh = await tx.warehouse.findFirst({ where });
    if (dto.warehouseId || dto.warehouseCode) {
      if (!wh) throw new UnprocessableEntityException(problem('Almoxarifado de atendimento não encontrado.', 'AXIS_REFERENCE_INVALID'));
      if (wh.status !== 'ATIVO') throw new UnprocessableEntityException(problem('Almoxarifado de atendimento inativo.', 'AXIS_REFERENCE_INVALID'));
    }
    return wh?.status === 'ATIVO' ? wh : null;
  }

  private setStatus(tx: Tx, id: string, status: FulfillmentStatus, statusReason?: string) {
    return tx.fulfillmentOrder.update({ where: { id }, data: { status, statusReason: statusReason ?? null } });
  }

  // ---------------------------------------------------------------------------------------------
  // Reserva: FEFO/FIFO, atômica, sem comprometer lote bloqueado/vencido (11.5, 11.6)
  // ---------------------------------------------------------------------------------------------

  async reserve(tx: Tx, orderId: string): Promise<FulfillmentOrder> {
    const order = await tx.fulfillmentOrder.findUnique({ where: { id: orderId }, include: { items: { include: { reservations: { where: { status: 'ATIVA' } } } } } });
    if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
    if (!order.warehouseId) return this.setStatus(tx, order.id, 'AGUARDANDO_INFORMACAO', 'Almoxarifado de atendimento não definido.');
    if (!['RECEBIDA', 'EM_ANALISE', 'RESERVADA_PARCIAL', 'AGUARDANDO_ESTOQUE', 'AGUARDANDO_INFORMACAO'].includes(order.status)) {
      throw new ConflictException(`A ordem está em ${order.status} e não aceita nova reserva.`);
    }

    const today = todayBR();
    const base = order.neededBy ?? new Date(today.getTime() + RESERVE_DEFAULT_DAYS * 86_400_000);
    const expiresAt = new Date(base.getTime() + RESERVE_DAYS_AFTER_NEEDED * 86_400_000);

    let fully = 0, any = 0;
    for (const item of order.items) {
      let need = item.quantity.minus(item.reservations.reduce((s, r) => s.plus(r.quantity), new Prisma.Decimal(0)));
      if (need.lte(0)) { fully++; any++; continue; }

      // Até 3 passadas: se outra transação ocupar o saldo entre a leitura e o UPDATE guardado, relê e tenta de novo.
      let got = false;
      for (let pass = 0; pass < 3 && need.gt(0); pass++) {
        const candidates = await tx.stockBalance.findMany({
          where: { materialId: item.materialId, ownership: 'PROPRIO', condition: 'DISPONIVEL', quantity: { gt: 0 }, location: { warehouseId: order.warehouseId, status: 'ATIVO' } },
          include: { lot: true },
        });
        const usable = candidates
          .filter((b) => !b.lot || (b.lot.status === 'LIBERADO' && !(b.lot.expiresAt && b.lot.expiresAt < today)))
          .sort((a, b) => (a.lot?.expiresAt?.getTime() ?? Infinity) - (b.lot?.expiresAt?.getTime() ?? Infinity) || (a.lot?.createdAt.getTime() ?? 0) - (b.lot?.createdAt.getTime() ?? 0) || a.updatedAt.getTime() - b.updatedAt.getTime());

        let contended = false;
        for (const bal of usable) {
          if (need.lte(0)) break;
          const take = Prisma.Decimal.min(need, bal.quantity.minus(bal.reservedQty));
          if (take.lte(0)) continue;
          // Compromete só se ainda houver saldo livre (concorrência): quantity - reserved_qty >= take.
          const n = await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = reserved_qty + ${take.toString()}::numeric, updated_at = now() WHERE id = ${bal.id} AND quantity - reserved_qty >= ${take.toString()}::numeric`;
          if (n !== 1) { contended = true; continue; }
          await tx.reservation.create({ data: { itemId: item.id, materialId: item.materialId, balanceId: bal.id, locationId: bal.locationId, lotId: bal.lotId, quantity: take, version: order.requestVersion, expiresAt } });
          need = need.minus(take);
          got = true;
        }
        if (!contended) break;
      }
      if (got || need.lt(item.quantity)) any++;
      if (need.lte(0)) fully++;
    }

    const status: FulfillmentStatus = fully === order.items.length ? 'RESERVADA' : any > 0 ? 'RESERVADA_PARCIAL' : 'AGUARDANDO_ESTOQUE';
    const updated = await this.setStatus(tx, order.id, status, status === 'RESERVADA' ? undefined : status === 'RESERVADA_PARCIAL' ? 'Reserva parcial: há itens com falta de estoque.' : 'Sem estoque disponível para reservar.');
    await this.emit(tx, status === 'RESERVADA' ? 'reservation.confirmed' : status === 'RESERVADA_PARCIAL' ? 'reservation.partial' : 'reservation.failed', orderEventBase(updated));
    await this.emit(tx, 'availability.changed', { warehouse_id: order.warehouseId, material_ids: order.items.map((i) => i.materialId) });
    return updated;
  }

  /** Devolve às balanças o que as reservas ATIVAS da ordem comprometiam. */
  async releaseOrderReservations(tx: Tx, orderId: string, reason: string, finalStatus: 'LIBERADA' | 'EXPIRADA') {
    const reservations = await tx.reservation.findMany({ where: { item: { orderId }, status: 'ATIVA' } });
    for (const r of reservations) await this.release(tx, r.id, r.balanceId, r.quantity.minus(r.consumedQty), reason, finalStatus);
    return reservations.length;
  }

  private async release(tx: Tx, id: string, balanceId: string, qty: Prisma.Decimal, reason: string, status: 'LIBERADA' | 'EXPIRADA') {
    const marked = await tx.reservation.updateMany({ where: { id, status: 'ATIVA' }, data: { status, releasedAt: new Date(), releaseReason: reason } });
    if (marked.count !== 1) return; // outra transação já liberou
    await tx.$executeRaw`UPDATE stock_balances SET reserved_qty = GREATEST(reserved_qty - ${qty.toString()}::numeric, 0), updated_at = now() WHERE id = ${balanceId}`;
  }

  /** Reservas vencidas voltam ao disponível (9.1: reserva expira conforme data necessária). Chamado por rota/cron. */
  async expireReservations(now = new Date()) {
    const due = await this.prisma.reservation.findMany({ where: { status: 'ATIVA', expiresAt: { lt: now }, item: { order: { status: { in: PRE_PICKING } } } }, include: { item: { select: { orderId: true } } } });
    let expired = 0;
    for (const r of due) {
      await this.prisma.$transaction(async (tx) => {
        await this.release(tx, r.id, r.balanceId, r.quantity.minus(r.consumedQty), 'Reserva expirada', 'EXPIRADA');
        const left = await tx.reservation.count({ where: { item: { orderId: r.item.orderId }, status: 'ATIVA' } });
        if (left === 0) {
          const order = await tx.fulfillmentOrder.findUnique({ where: { id: r.item.orderId } });
          if (order && ['RESERVADA', 'RESERVADA_PARCIAL'].includes(order.status)) await this.setStatus(tx, order.id, 'AGUARDANDO_ESTOQUE', 'Reservas expiradas: aguardando nova análise.');
        }
      });
      expired++;
    }
    return { expired };
  }

  // ---------------------------------------------------------------------------------------------
  // Cancelamento (material_request.cancel_requested / 11.9)
  // ---------------------------------------------------------------------------------------------

  async cancelRequest(tx: Tx, orderId: string, reason: string): Promise<FulfillmentOrder> {
    const order = await tx.fulfillmentOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
    if (['CANCELADA', 'CANCELAMENTO_SOLICITADO'].includes(order.status)) return order;
    if (['ENTREGUE', 'ENCERRADA'].includes(order.status)) throw new ConflictException('Ordem já entregue/encerrada não pode ser cancelada; use devolução.');
    if (PRE_PICKING.includes(order.status)) {
      await this.releaseOrderReservations(tx, order.id, reason, 'LIBERADA');
      const updated = await this.setStatus(tx, order.id, 'CANCELADA', reason);
      await this.emit(tx, 'availability.changed', { warehouse_id: order.warehouseId });
      return updated;
    }
    // Separação/expedição já iniciadas: não desfaz sozinho; gera tarefa de retorno (a partir do Sprint 4).
    return this.setStatus(tx, order.id, 'CANCELAMENTO_SOLICITADO', reason);
  }

  async cancelByAxisRequest(tx: Tx, axisRequestId: string, reason: string) {
    const latest = await tx.fulfillmentOrder.findFirst({ where: { axisRequestId }, orderBy: { requestVersion: 'desc' } });
    if (!latest) throw new NotFoundException(`Nenhuma ordem de atendimento para a requisição ${axisRequestId}.`);
    return this.cancelRequest(tx, latest.id, reason);
  }

  // ---------------------------------------------------------------------------------------------
  // Consultas
  // ---------------------------------------------------------------------------------------------

  private present<T extends FulfillmentOrder>(o: T) {
    return { ...o, code: orderCode(o.seq) };
  }

  async create(dto: CreateFulfillmentDto, user: AuthenticatedUser) {
    const { order, replayed } = await this.prisma.$transaction((tx) => this.createFromRequest(tx, dto, user));
    return { ...(await this.load(order.id, null)), replayed };
  }

  /**
   * Almoxarifado de atendimento definido depois da criação (a ordem nasceu sem `warehouse_code` e sem
   * `DEFAULT_WAREHOUSE_CODE`). Troca só enquanto não há reserva ativa; em seguida roda a reserva normal.
   */
  async assignWarehouse(id: string, warehouseId: string) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.fulfillmentOrder.findUnique({ where: { id }, include: { items: { include: { reservations: { where: { status: 'ATIVA' } } } } } });
      if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
      if (!ASSIGNABLE.includes(order.status)) throw new ConflictException(`A ordem está em ${order.status}; o almoxarifado só pode ser definido antes da separação.`);
      if (order.warehouseId !== warehouseId && order.items.some((i) => i.reservations.length > 0)) {
        throw new ConflictException('A ordem já tem reserva em outro almoxarifado. Peça o cancelamento e reenvie a requisição para trocar.');
      }
      const wh = await tx.warehouse.findUnique({ where: { id: warehouseId } });
      if (!wh) throw new NotFoundException('Almoxarifado não encontrado.');
      if (wh.status !== 'ATIVO') throw new UnprocessableEntityException(`O almoxarifado ${wh.code} não está ativo.`);
      await tx.fulfillmentOrder.update({ where: { id }, data: { warehouseId } });
      await this.reserve(tx, id);
    });
    return this.load(id, null);
  }

  async reserveOrder(id: string) {
    await this.prisma.$transaction((tx) => this.reserve(tx, id));
    return this.load(id, null);
  }

  async cancelOrder(id: string, reason: string) {
    await this.prisma.$transaction((tx) => this.cancelRequest(tx, id, reason));
    return this.load(id, null);
  }

  private canSeeAll(user: AuthenticatedUser) {
    return user.permissions.includes('fulfillment:read_all');
  }

  async list(query: ListFulfillmentQuery, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.FulfillmentOrderWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.axisRequestId && { axisRequestId: query.axisRequestId }),
      ...(!this.canSeeAll(user) && ownOrdersWhere(user, await resolveOwnIds(this.prisma, user))),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.fulfillmentOrder.count({ where }),
      this.prisma.fulfillmentOrder.findMany({ where, orderBy: { seq: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map((o) => this.present(o)) };
  }

  async get(id: string, user: AuthenticatedUser) {
    return this.load(id, user);
  }

  /** `user` nulo = chamada interna já autorizada por permissão de escrita (create/manage); leitura aplica o escopo por solicitante. */
  private async load(id: string, user: AuthenticatedUser | null) {
    const order = await this.prisma.fulfillmentOrder.findUnique({ where: { id }, include: { items: { include: { reservations: true } } } });
    if (!order) throw new NotFoundException('Ordem de atendimento não encontrada.');
    if (user && !this.canSeeAll(user) && !isOwnOrder(order, user, await resolveOwnIds(this.prisma, user))) {
      throw new ForbiddenException('Sem acesso a esta ordem de atendimento.');
    }
    const items = order.items.map((i) => {
      const reserved = i.reservations.filter((r) => r.status === 'ATIVA' || r.status === 'CONSUMIDA').reduce((s, r) => s.plus(r.quantity), new Prisma.Decimal(0));
      return { ...i, reserved: reserved.toString(), shortage: Prisma.Decimal.max(i.quantity.minus(reserved), 0).toString() };
    });
    return { ...this.present(order), items };
  }
}
