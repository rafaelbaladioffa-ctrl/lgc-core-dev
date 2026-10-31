import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StockCondition } from '@prisma/client';
import type { StockMovement } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { ListBalancesQuery, ListMovementsQuery, PostMovementDto, ReverseMovementDto } from './stock.dto.js';

const ENTRY_TYPES = ['ENTRADA_RECEBIMENTO', 'ENTRADA_DEVOLUCAO', 'AJUSTE_POSITIVO'];
const EXIT_TYPES = ['SAIDA_ENTREGA', 'AJUSTE_NEGATIVO', 'BAIXA_PERDA', 'DESCARTE'];
/** Operações que exigem permissão específica e aprovação de alçada do Axis (11.12). */
const ADJUST_TYPES = ['AJUSTE_POSITIVO', 'AJUSTE_NEGATIVO', 'BAIXA_PERDA', 'DESCARTE'];
/** Saídas que consomem estoque utilizável: lote vencido/bloqueado não pode sair (11.6). */
const USABLE_EXIT_TYPES = ['SAIDA_ENTREGA', 'TRANSFERENCIA'];

export type MovementInput = Omit<PostMovementDto, 'quantity'> & { quantity: Prisma.Decimal; reversesMovementId?: string };

export const movementCode = (seq: number) => `MOV-${String(seq).padStart(8, '0')}`;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  private present(m: StockMovement, replayed = false) {
    return { ...m, code: movementCode(m.seq), replayed };
  }

  async post(dto: PostMovementDto, idempotencyKey: string, user: AuthenticatedUser) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new BadRequestException('Cabeçalho Idempotency-Key obrigatório (8 a 120 caracteres).');
    }
    const existing = await this.prisma.stockMovement.findUnique({ where: { idempotencyKey } });
    if (existing) return this.present(existing, true);

    const isAdjust = ADJUST_TYPES.includes(dto.type);
    const needed = isAdjust ? 'stock:adjust' : 'stock:post';
    if (!user.permissions.includes(needed)) throw new ForbiddenException(`Permissão insuficiente. Necessário: ${needed}.`);
    if (isAdjust && !dto.axisApprovalRef) throw new BadRequestException('Ajustes, perdas e descartes exigem a referência de aprovação do Axis (axisApprovalRef).');
    this.validateShape(dto);

    return this.run(() => this.prisma.$transaction((tx) => this.apply(tx, { ...dto, quantity: new Prisma.Decimal(dto.quantity) }, idempotencyKey, user, false)), idempotencyKey);
  }

  /** Lançamento interno (ex.: entrega confirmada): já autorizado pelo fluxo de origem; mantém escopo por almoxarifado. */
  applyInternal(tx: Prisma.TransactionClient, input: MovementInput, idempotencyKey: string, user: AuthenticatedUser) {
    return this.apply(tx, input, idempotencyKey, user, false);
  }

  /** Correção por movimento reverso vinculado (11.1): troca origem/destino e nunca altera o original. */
  async reverse(id: string, dto: ReverseMovementDto, idempotencyKey: string, user: AuthenticatedUser) {
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 120) {
      throw new BadRequestException('Cabeçalho Idempotency-Key obrigatório (8 a 120 caracteres).');
    }
    if (!user.permissions.includes('stock:reverse')) throw new ForbiddenException('Permissão insuficiente. Necessário: stock:reverse.');
    const replay = await this.prisma.stockMovement.findUnique({ where: { idempotencyKey } });
    if (replay) return this.present(replay, true);

    const original = await this.prisma.stockMovement.findUnique({ where: { id }, include: { reversedBy: { select: { id: true } } } });
    if (!original) throw new NotFoundException('Movimento não encontrado.');
    if (original.reversesMovementId) throw new BadRequestException('Um movimento de estorno não pode ser estornado; lance um novo movimento.');
    if (original.reversedBy) throw new ConflictException('Este movimento já foi estornado.');

    const input: MovementInput = {
      type: original.type,
      materialId: original.materialId,
      quantity: original.quantity,
      lotId: original.lotId ?? undefined,
      serialId: original.serialId ?? undefined,
      fromLocationId: original.toLocationId ?? undefined,
      toLocationId: original.fromLocationId ?? undefined,
      fromCondition: original.toCondition,
      toCondition: original.fromCondition,
      ownership: original.ownership,
      reason: `Estorno de ${movementCode(original.seq)}: ${dto.reason}`,
      axisApprovalRef: dto.axisApprovalRef,
      axisDocumentRef: original.axisDocumentRef ?? undefined,
      projectAxisId: original.projectAxisId ?? undefined,
      costCenterAxisId: original.costCenterAxisId ?? undefined,
      clientAxisId: original.clientAxisId ?? undefined,
      unitCost: original.unitCost ? Number(original.unitCost) : undefined,
      correlationId: original.correlationId,
      reversesMovementId: original.id,
    };
    return this.run(() => this.prisma.$transaction((tx) => this.apply(tx, input, idempotencyKey, user, true)), idempotencyKey);
  }

  /** Converte corrida de idempotência/estorno duplo (P2002) e CHECKs de saldo em respostas de negócio. */
  private async run(fn: () => Promise<StockMovement>, idempotencyKey: string) {
    try {
      return this.present(await fn());
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.stockMovement.findUnique({ where: { idempotencyKey } });
        if (again) return this.present(again, true);
        throw new ConflictException('Movimento já estornado ou conflito de concorrência.');
      }
      if (e instanceof Error && /stock_balances_(quantity_nonneg|reserved_range)/.test(e.message)) {
        throw new UnprocessableEntityException('Saldo insuficiente: o movimento deixaria o estoque negativo ou abaixo do reservado.');
      }
      throw e;
    }
  }

  private validateShape(dto: PostMovementDto) {
    const { type, fromLocationId: from, toLocationId: to } = dto;
    if (ENTRY_TYPES.includes(type)) {
      if (!to) throw new BadRequestException('Informe o endereço de destino.');
      if (from) throw new BadRequestException('Entradas não têm endereço de origem.');
    } else if (EXIT_TYPES.includes(type)) {
      if (!from) throw new BadRequestException('Informe o endereço de origem.');
      if (to) throw new BadRequestException('Saídas não têm endereço de destino.');
    } else {
      if (!from || !to) throw new BadRequestException('Transferência exige endereço de origem e de destino.');
      if (from === to && (dto.fromCondition ?? 'DISPONIVEL') === (dto.toCondition ?? 'DISPONIVEL')) {
        throw new BadRequestException('Origem e destino iguais com a mesma condição não geram movimento.');
      }
    }
  }

  private async apply(tx: Prisma.TransactionClient, input: MovementInput, idempotencyKey: string, user: AuthenticatedUser, isReversal: boolean) {
    const material = await tx.material.findUnique({ where: { id: input.materialId }, include: { stockUom: true } });
    if (!material) throw new BadRequestException('Material não encontrado.');
    if (material.status !== 'ATIVO' && !isReversal) throw new BadRequestException('Material inativo não recebe novas operações.');

    const qty = input.quantity;
    if (qty.decimalPlaces() > material.stockUom.precision) {
      throw new BadRequestException(`A unidade ${material.stockUom.code} aceita no máximo ${material.stockUom.precision} casa(s) decimal(is).`);
    }

    const fromCond = input.fromCondition ?? StockCondition.DISPONIVEL;
    const toCond = input.toCondition ?? StockCondition.DISPONIVEL;
    const ownership = input.ownership ?? 'PROPRIO';

    // Endereços: existência, status e escopo por almoxarifado.
    const locIds = [input.fromLocationId, input.toLocationId].filter((x): x is string => !!x);
    const locs = await tx.location.findMany({ where: { id: { in: locIds } }, include: { warehouse: true } });
    const loc = (id?: string) => (id ? locs.find((l) => l.id === id) : undefined);
    for (const id of locIds) {
      const l = loc(id);
      if (!l) throw new BadRequestException('Endereço não encontrado.');
      if (!l.isVirtual) await this.rbac.assertWarehouseAccess(user, l.warehouseId); // trânsito/quarentena virtual é compartilhado
      if (!isReversal && !ADJUST_TYPES.includes(input.type) && (l.status !== 'ATIVO' || l.warehouse.status !== 'ATIVO')) {
        throw new UnprocessableEntityException(`O endereço ${l.code} está bloqueado ou inativo.`);
      }
    }
    const dest = loc(input.toLocationId);
    if (dest && !isReversal && dest.allowedCategories.length > 0 && !dest.allowedCategories.includes(material.category)) {
      throw new UnprocessableEntityException(`O endereço ${dest.code} não aceita a categoria ${material.category}.`);
    }

    // Lote (11.5/11.6).
    let lot = null;
    if (material.lotControlled) {
      if (!input.lotId) throw new BadRequestException('Este material é controlado por lote: informe o lote.');
      lot = await tx.lot.findUnique({ where: { id: input.lotId } });
      if (!lot || lot.materialId !== material.id) throw new BadRequestException('Lote não pertence ao material informado.');
    } else if (input.lotId) {
      throw new BadRequestException('Este material não é controlado por lote.');
    }
    if (lot && !isReversal) {
      const expired = !!lot.expiresAt && lot.expiresAt < startOfToday();
      if (USABLE_EXIT_TYPES.includes(input.type) && fromCond === 'DISPONIVEL' && (expired || lot.status !== 'LIBERADO')) {
        throw new UnprocessableEntityException(`O lote ${lot.lotNumber} está ${expired ? 'vencido' : 'bloqueado/em quarentena'} e não pode ser expedido.`);
      }
      if (ENTRY_TYPES.includes(input.type)) {
        if (material.expiryControlled) {
          if (!lot.expiresAt) throw new BadRequestException(`O lote ${lot.lotNumber} não tem validade cadastrada.`);
          if (input.type === 'ENTRADA_RECEBIMENTO' && toCond === 'DISPONIVEL' && material.minShelfLifeDays != null) { // em quarentena/bloqueado a inspeção decide
            const days = Math.floor((lot.expiresAt.getTime() - startOfToday().getTime()) / 86_400_000);
            if (days < material.minShelfLifeDays) throw new UnprocessableEntityException(`Vida útil restante (${days} dias) menor que o mínimo de ${material.minShelfLifeDays} dias.`);
          }
        }
        if (toCond === 'DISPONIVEL' && (lot.status !== 'LIBERADO' || (lot.expiresAt && lot.expiresAt < startOfToday()))) {
          throw new UnprocessableEntityException(`O lote ${lot.lotNumber} não está liberado/válido: dê entrada em quarentena ou bloqueado.`);
        }
      }
    }

    // Quantidade inteira para itens unitários/seriados (11.3) e série única em um só local (11.7).
    if (material.serialControlled) {
      if (!input.serialId) throw new BadRequestException('Este material é controlado por série: informe o número de série.');
      if (!qty.equals(1)) throw new BadRequestException('Item seriado é movimentado de 1 em 1.');
      const serial = await tx.serialNumber.findUnique({ where: { id: input.serialId } });
      if (!serial || serial.materialId !== material.id) throw new BadRequestException('Número de série não pertence ao material informado.');
      if (input.fromLocationId && serial.currentLocationId !== input.fromLocationId) {
        throw new UnprocessableEntityException(`A série ${serial.serial} não está no endereço de origem informado.`);
      }
      if (!input.fromLocationId && serial.currentLocationId) {
        throw new UnprocessableEntityException(`A série ${serial.serial} já está em estoque; não pode existir em dois locais.`);
      }
      const nextLocation = input.toLocationId ?? null;
      const writeOff = ['BAIXA_PERDA', 'DESCARTE'].includes(input.type) && !isReversal;
      const restore = ['BAIXA_PERDA', 'DESCARTE'].includes(input.type) && isReversal; // estorno de baixa: série volta a ser utilizável
      const upd = await tx.serialNumber.updateMany({
        where: { id: serial.id, currentLocationId: serial.currentLocationId },
        data: { currentLocationId: nextLocation, ...(writeOff && { condition: 'BAIXADO' as const }), ...(restore && { condition: 'BOM' as const }) },
      });
      if (upd.count !== 1) throw new ConflictException('A série foi movimentada por outra operação; tente novamente.');
    } else if (input.serialId) {
      throw new BadRequestException('Este material não é controlado por série.');
    } else if (material.stockUom.precision === 0 && !qty.isInteger()) {
      throw new BadRequestException('Quantidade deve ser inteira para esta unidade.');
    }

    // Saldos: saída atômica (nunca negativo) e entrada por upsert.
    const lotKey = input.lotId ?? '';
    if (input.fromLocationId) {
      const dec = await tx.stockBalance.updateMany({
        where: { materialId: material.id, locationId: input.fromLocationId, lotKey, condition: fromCond, ownership, quantity: { gte: qty } },
        data: { quantity: { decrement: qty } },
      });
      if (dec.count !== 1) throw new UnprocessableEntityException('Saldo insuficiente no endereço de origem.');
    }
    if (input.toLocationId) {
      await tx.stockBalance.upsert({
        where: { materialId_locationId_lotKey_condition_ownership: { materialId: material.id, locationId: input.toLocationId, lotKey, condition: toCond, ownership } },
        create: { materialId: material.id, locationId: input.toLocationId, lotId: input.lotId, lotKey, condition: toCond, ownership, quantity: qty },
        update: { quantity: { increment: qty } },
      });
    }

    const movement = await tx.stockMovement.create({
      data: {
        type: input.type, materialId: material.id, quantity: qty, uomId: material.stockUomId,
        lotId: input.lotId, serialId: input.serialId, fromLocationId: input.fromLocationId, toLocationId: input.toLocationId,
        fromCondition: fromCond, toCondition: toCond, ownership, reason: input.reason,
        axisDocumentRef: input.axisDocumentRef, axisApprovalRef: input.axisApprovalRef, logisticsDocumentRef: input.logisticsDocumentRef,
        projectAxisId: input.projectAxisId, costCenterAxisId: input.costCenterAxisId, clientAxisId: input.clientAxisId, custodianAxisId: input.custodianAxisId,
        unitCost: input.unitCost, effectiveAt: input.effectiveAt ? new Date(input.effectiveAt) : new Date(),
        actorAxisId: user.userId, deviceId: input.deviceId, reversesMovementId: input.reversesMovementId,
        correlationId: input.correlationId ?? randomUUID(), idempotencyKey,
      },
    });

    // Outbox transacional (12.1): o evento nasce junto com o movimento.
    const eventType = isReversal ? 'stock.movement.reversed' : 'stock.movement.posted';
    await tx.integrationMessage.create({
      data: {
        direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: movement.registeredAt, status: 'PENDING', correlationId: movement.correlationId,
        payload: { movement_id: movement.id, code: movementCode(movement.seq), type: movement.type, material_id: movement.materialId, quantity: movement.quantity.toString(), from_location_id: movement.fromLocationId, to_location_id: movement.toLocationId, project_id: movement.projectAxisId, cost_center_id: movement.costCenterAxisId, reverses: movement.reversesMovementId },
      },
    });
    return movement;
  }

  async listMovements(query: ListMovementsQuery, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const scope: Prisma.StockMovementWhereInput = wh === 'ALL' ? {} : { OR: [{ fromLocation: { warehouseId: { in: wh } } }, { toLocation: { warehouseId: { in: wh } } }] };
    const where: Prisma.StockMovementWhereInput = {
      AND: [
        scope,
        {
          ...(query.materialId && { materialId: query.materialId }),
          ...(query.type && { type: query.type }),
          ...(query.locationId && { OR: [{ fromLocationId: query.locationId }, { toLocationId: query.locationId }] }),
          ...((query.from || query.to) && { effectiveAt: { ...(query.from && { gte: new Date(query.from) }), ...(query.to && { lte: new Date(query.to) }) } }),
        },
      ],
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({ where, orderBy: { seq: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    const canSeeCost = user.permissions.includes('material:read_cost');
    return { total, page, pageSize, items: items.map((m) => { const p = this.present(m); if (!canSeeCost) delete (p as { unitCost?: unknown }).unitCost; return p; }) };
  }

  /** Físico, reservado e disponível por dimensão (4). Disponível só conta condição DISPONIVEL em lote liberado e não vencido (11.6). */
  async listBalances(query: ListBalancesQuery, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const where: Prisma.StockBalanceWhereInput = {
      ...(query.materialId && { materialId: query.materialId }),
      ...(query.condition && { condition: query.condition }),
      ...(query.locationId && { locationId: query.locationId }),
      location: { ...(query.warehouseId && { warehouseId: query.warehouseId }), ...(wh !== 'ALL' && { warehouseId: query.warehouseId ? (wh.includes(query.warehouseId) ? query.warehouseId : '-') : { in: wh } }) },
      quantity: { gt: 0 },
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.stockBalance.count({ where }),
      this.prisma.stockBalance.findMany({ where, orderBy: [{ materialId: 'asc' }, { locationId: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, include: { lot: true, location: { select: { code: true, warehouseId: true } } } }),
    ]);
    const today = startOfToday();
    return {
      total, page, pageSize,
      items: rows.map((b) => {
        const usable = b.condition === 'DISPONIVEL' && b.ownership === 'PROPRIO' && (!b.lot || (b.lot.status === 'LIBERADO' && !(b.lot.expiresAt && b.lot.expiresAt < today)));
        return {
          materialId: b.materialId, locationId: b.locationId, locationCode: b.location.code, warehouseId: b.location.warehouseId,
          lotId: b.lotId, lotNumber: b.lot?.lotNumber ?? null, condition: b.condition, ownership: b.ownership,
          quantity: b.quantity.toString(), reserved: b.reservedQty.toString(),
          available: usable ? b.quantity.minus(b.reservedQty).toString() : '0',
        };
      }),
    };
  }
}

/** Hoje (00:00) no fuso America/Sao_Paulo, expresso em UTC para comparar com colunas DATE. */
function startOfToday() {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
