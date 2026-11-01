import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StockCondition } from '@prisma/client';
import type { Location, Material, PutawayTask } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { StockService } from '../stock/stock.service.js';
import { todayBR } from '../stock/availability.service.js';
import { problem } from '../common/errors.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { ConfirmPutawayDto, CreateReceiptDto, InspectDto, ScanReceiptItemDto } from './receiving.dto.js';

type Tx = Prisma.TransactionClient;
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const receiptCode = (seq: number) => `REC-${String(seq).padStart(8, '0')}`;

@Injectable()
export class ReceivingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly stock: StockService,
  ) {}

  private emit(tx: Tx, eventType: string, payload: Record<string, unknown>) {
    return tx.integrationMessage.create({ data: { direction: 'OUTBOUND', eventId: randomUUID(), eventType, occurredAt: new Date(), status: 'PENDING', payload: payload as Prisma.InputJsonValue } });
  }

  private async resolveMaterial(tx: Tx | PrismaService, ref: { materialId?: string; materialCode?: string; barcode?: string }) {
    const where: Prisma.MaterialWhereInput = ref.materialId ? { id: ref.materialId } : ref.materialCode ? { code: ref.materialCode } : ref.barcode ? { OR: [{ code: ref.barcode }, { barcodes: { some: { code: ref.barcode } } }] } : { id: '-' };
    return tx.material.findFirst({ where });
  }

  // ---------------------------------------------------------------------------------------------
  // Recebimento
  // ---------------------------------------------------------------------------------------------

  async create(dto: CreateReceiptDto, user: AuthenticatedUser) {
    await this.rbac.assertWarehouseAccess(user, dto.warehouseId);
    if (!dto.axisPurchaseOrderId && !dto.exceptionApprovalRef) {
      throw new UnprocessableEntityException(problem('Recebimento sem pedido do Axis exige exceção aprovada (exceptionApprovalRef).', 'APPROVAL_REQUIRED'));
    }
    const loc = await this.prisma.location.findFirst({ where: { id: dto.receivingLocationId, warehouseId: dto.warehouseId } });
    if (!loc || loc.status !== 'ATIVO') throw new UnprocessableEntityException(problem('Endereço de recebimento inexistente, inativo ou de outro almoxarifado.', 'INVALID_LOCATION'));

    const expected: Array<{ materialId: string; quantity: string }> = [];
    for (const [i, e] of (dto.expectedItems ?? []).entries()) {
      const m = await this.resolveMaterial(this.prisma, e);
      if (!m) throw new UnprocessableEntityException(problem(`Item previsto ${i + 1}: material não encontrado.`, 'AXIS_REFERENCE_INVALID'));
      expected.push({ materialId: m.id, quantity: String(e.quantity) });
    }
    const r = await this.prisma.receipt.create({
      data: { warehouseId: dto.warehouseId, receivingLocationId: dto.receivingLocationId, axisPurchaseOrderId: dto.axisPurchaseOrderId, supplierAxisId: dto.supplierAxisId, invoiceNumber: dto.invoiceNumber, vehicle: dto.vehicle, volumes: dto.volumes, exceptionApprovalRef: dto.exceptionApprovalRef, expectedItems: expected, createdBy: user.userId },
    });
    return { ...r, code: receiptCode(r.seq) };
  }

  async list(user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.receipt.findMany({ where: wh === 'ALL' ? {} : { warehouseId: { in: wh } }, orderBy: { seq: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...r, code: receiptCode(r.seq) }));
  }

  async get(id: string, user: AuthenticatedUser) {
    const r = await this.prisma.receipt.findUnique({ where: { id }, include: { items: { include: { inspections: true, putaways: true } } } });
    if (!r) throw new NotFoundException('Recebimento não encontrado.');
    await this.rbac.assertWarehouseAccess(user, r.warehouseId);
    return { ...r, code: receiptCode(r.seq) };
  }

  /** Conferência física item a item (leitura por SKU/código de barras). */
  async scanItem(id: string, dto: ScanReceiptItemDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.receipt.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Recebimento não encontrado.');
      await this.rbac.assertWarehouseAccess(user, r.warehouseId);
      if (!['AGENDADO', 'EM_CONFERENCIA'].includes(r.status)) throw new ConflictException(`O recebimento está em ${r.status} e não aceita novas leituras.`);

      const m = await this.resolveMaterial(tx, dto);
      if (!m) throw new UnprocessableEntityException(problem('Material não encontrado.', 'AXIS_REFERENCE_INVALID'));
      if (m.status !== 'ATIVO') throw new UnprocessableEntityException(problem(`O material ${m.code} está inativo.`, 'AXIS_REFERENCE_INVALID'));
      const uom = await tx.unitOfMeasure.findUniqueOrThrow({ where: { id: m.stockUomId } });
      const qty = D(dto.quantity);
      if (qty.decimalPlaces() > uom.precision) throw new BadRequestException(problem(`A unidade ${uom.code} aceita no máximo ${uom.precision} casa(s) decimal(is).`, 'UNIT_CONVERSION_ERROR'));

      if (m.lotControlled && !dto.lotNumber) throw new BadRequestException('Material controlado por lote: informe o número do lote.');
      if (!m.lotControlled && (dto.lotNumber || dto.expiresAt || dto.manufacturedAt)) throw new BadRequestException('Este material não é controlado por lote.');
      if (m.expiryControlled && !dto.expiresAt) throw new BadRequestException('Material com controle de validade: informe a validade.');
      if (dto.expiresAt && dto.manufacturedAt && dto.expiresAt < dto.manufacturedAt) throw new BadRequestException('A validade não pode ser anterior à fabricação.');

      if (m.serialControlled) {
        const serials = dto.serials ?? [];
        if (!qty.isInteger() || serials.length !== Number(qty)) throw new BadRequestException('Item seriado: informe exatamente uma série por unidade recebida.');
        if (new Set(serials).size !== serials.length) throw new ConflictException(problem('Séries repetidas na mesma leitura.', 'SERIAL_DUPLICATE'));
        const existing = await tx.serialNumber.count({ where: { materialId: m.id, serial: { in: serials } } });
        const inReceipts = await tx.receiptItem.count({ where: { materialId: m.id, serials: { hasSome: serials }, receipt: { status: { notIn: ['REJEITADO', 'DEVOLVIDO_FORNECEDOR'] } } } });
        if (existing + inReceipts > 0) throw new ConflictException(problem('Há série já cadastrada ou já lida em outro recebimento.', 'SERIAL_DUPLICATE'));
      } else if (dto.serials?.length) {
        throw new BadRequestException('Este material não é controlado por série.');
      }

      // Inspeção (9.2): certificado/CA/calibração, risco/químico, ou exigência do conferente.
      const reasons: string[] = [];
      if (m.requiresCertificate) reasons.push('certificado');
      if (m.requiresCa) reasons.push('CA');
      if (m.requiresCalibration) reasons.push('calibração');
      if (m.type === 'QUIMICO' || m.riskClass) reasons.push('risco/químico');
      if (dto.forceInspection) reasons.push('solicitada pelo conferente');
      if (m.expiryControlled && dto.expiresAt && m.minShelfLifeDays != null) {
        const days = Math.floor((new Date(dto.expiresAt).getTime() - todayBR().getTime()) / 86_400_000);
        if (days < m.minShelfLifeDays) reasons.push(`validade mínima (${days} < ${m.minShelfLifeDays} dias)`);
      }

      await tx.receipt.update({ where: { id }, data: { status: 'EM_CONFERENCIA' } });
      return tx.receiptItem.create({
        data: {
          receiptId: id, materialId: m.id, quantity: qty, lotNumber: dto.lotNumber, manufacturedAt: dto.manufacturedAt ? new Date(dto.manufacturedAt) : undefined,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined, serials: dto.serials ?? [], damaged: dto.damaged ?? false, unitCost: dto.unitCost,
          photoRefs: dto.photoRefs ?? [], certificateRef: dto.certificateRef, notes: dto.notes, inspectionRequired: reasons.length > 0, inspectionReason: reasons.join('; ') || null,
        },
      });
    });
  }

  /** Encerra a conferência: confronta com o pedido, dá entrada no ledger e abre inspeção/armazenagem. */
  async complete(id: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.receipt.findUnique({ where: { id }, include: { items: true } });
      if (!r) throw new NotFoundException('Recebimento não encontrado.');
      await this.rbac.assertWarehouseAccess(user, r.warehouseId);
      if (r.status !== 'EM_CONFERENCIA') throw new ConflictException(`O recebimento está em ${r.status} e não pode ser concluído.`);
      if (r.items.length === 0) throw new UnprocessableEntityException('Nenhum item foi conferido.');

      // Divergências: quantidade a maior/menor, item não previsto, item previsto não recebido.
      const notes: string[] = [];
      const expected = (r.expectedItems as Array<{ materialId: string; quantity: string }>) ?? [];
      if (expected.length > 0) {
        const got = new Map<string, Prisma.Decimal>();
        for (const it of r.items) got.set(it.materialId, (got.get(it.materialId) ?? D(0)).plus(it.quantity));
        for (const e of expected) {
          const g = got.get(e.materialId) ?? D(0);
          if (!g.equals(e.quantity)) notes.push(`Material ${e.materialId}: previsto ${e.quantity}, recebido ${g.toString()}.`);
        }
        for (const mid of got.keys()) if (!expected.some((e) => e.materialId === mid)) notes.push(`Material ${mid}: recebido sem constar no pedido.`);
      }
      for (const it of r.items) if (it.damaged) notes.push(`Item ${it.id}: recebido com avaria.`);

      const today = todayBR();
      for (const it of r.items) {
        const m = await tx.material.findUniqueOrThrow({ where: { id: it.materialId } });
        const expired = !!it.expiresAt && it.expiresAt < today;
        let condition: StockCondition = 'DISPONIVEL';
        let status: 'LIBERADO' | 'EM_INSPECAO' | 'REJEITADO' = 'LIBERADO';
        if (expired) { condition = 'BLOQUEADO'; status = 'REJEITADO'; notes.push(`Item ${it.id}: lote vencido no recebimento.`); }
        else if (it.inspectionRequired) { condition = 'QUARENTENA'; status = 'EM_INSPECAO'; }
        else if (it.damaged) condition = 'AVARIADO';

        // Lote (cria/reaproveita) e séries.
        let lotId: string | undefined;
        if (m.lotControlled) {
          const lotStatus = expired ? 'BLOQUEADO' : it.inspectionRequired ? 'QUARENTENA' : 'LIBERADO';
          const existing = await tx.lot.findUnique({ where: { materialId_lotNumber: { materialId: m.id, lotNumber: it.lotNumber! } } });
          if (existing && existing.expiresAt?.getTime() !== it.expiresAt?.getTime()) {
            throw new UnprocessableEntityException(`O lote ${it.lotNumber} já existe com outra validade; confira o lote recebido.`);
          }
          const lot = existing ?? (await tx.lot.create({ data: { materialId: m.id, lotNumber: it.lotNumber!, manufacturedAt: it.manufacturedAt, expiresAt: it.expiresAt, status: lotStatus, supplierAxisId: r.supplierAxisId, createdBy: user.userId } }));
          if (existing && lotStatus !== 'LIBERADO' && existing.status === 'LIBERADO') await tx.lot.update({ where: { id: existing.id }, data: { status: lotStatus, statusReason: 'Novo recebimento exige inspeção/bloqueio' } });
          lotId = lot.id;
        }
        const serialIds: string[] = [];
        for (const sn of it.serials) {
          const s = await tx.serialNumber.create({ data: { materialId: m.id, serial: sn, lotId, condition: it.damaged ? 'AVARIADO' : 'NOVO', createdBy: user.userId } });
          serialIds.push(s.id);
        }

        const lines = serialIds.length > 0 ? serialIds.map((sid) => ({ serialId: sid, quantity: D(1) })) : [{ serialId: undefined, quantity: it.quantity }];
        for (const [i, line] of lines.entries()) {
          await this.stock.applyInternal(tx, {
            type: 'ENTRADA_RECEBIMENTO', materialId: m.id, quantity: line.quantity, lotId, serialId: line.serialId, toLocationId: r.receivingLocationId, toCondition: condition,
            reason: `Recebimento ${receiptCode(r.seq)}`, axisDocumentRef: r.axisPurchaseOrderId ?? r.exceptionApprovalRef ?? undefined, logisticsDocumentRef: receiptCode(r.seq),
            unitCost: it.unitCost ? Number(it.unitCost) : undefined, correlationId: r.id,
          }, `receipt:${it.id}:${i}`, user);
        }
        await tx.receiptItem.update({ where: { id: it.id }, data: { status, lotId, serialIds } });

        if (status === 'LIBERADO') await this.openPutaway(tx, { ...it, lotId, serialIds }, m, r.warehouseId, r.receivingLocationId, condition);
      }

      // Recebimento contra pedido aprovado no Axis atende a sugestão de reposição correspondente.
      if (r.axisPurchaseOrderId) await tx.replenishmentSuggestion.updateMany({ where: { axisPurchaseOrderId: r.axisPurchaseOrderId, warehouseId: r.warehouseId, status: 'APROVADA_AXIS' }, data: { status: 'ATENDIDA' } });
      const pending = await tx.receiptItem.count({ where: { receiptId: id, status: 'EM_INSPECAO' } });
      const status = notes.length > 0 ? 'DIVERGENTE' : pending > 0 ? 'RECEBIDO_PENDENTE_INSPECAO' : 'LIBERADO';
      const updated = await tx.receipt.update({ where: { id }, data: { status, hasDivergence: notes.length > 0, divergenceNotes: notes, completedBy: user.userId, completedAt: new Date() } });
      await this.emit(tx, notes.length > 0 ? 'receipt.divergent' : 'receipt.confirmed', { receipt_id: id, code: receiptCode(r.seq), purchase_order_id: r.axisPurchaseOrderId, supplier_id: r.supplierAxisId, invoice: r.invoiceNumber, divergences: notes });
      await this.emit(tx, 'availability.changed', { warehouse_id: r.warehouseId });
      return { ...updated, code: receiptCode(r.seq) };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Inspeção
  // ---------------------------------------------------------------------------------------------

  async inspect(receiptId: string, itemId: string, dto: InspectDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.receiptItem.findFirst({ where: { id: itemId, receiptId }, include: { receipt: true } });
      if (!item) throw new NotFoundException('Item de recebimento não encontrado.');
      await this.rbac.assertWarehouseAccess(user, item.receipt.warehouseId);
      if (item.status !== 'EM_INSPECAO') throw new ConflictException('Este item não está aguardando inspeção.');
      const m = await tx.material.findUniqueOrThrow({ where: { id: item.materialId } });
      const certificate = dto.certificateRef ?? item.certificateRef;

      if (dto.decision === 'APROVADO') {
        if (m.requiresCertificate && !certificate) throw new UnprocessableEntityException(problem('Material exige certificado: informe certificateRef antes de liberar.', 'INSPECTION_REQUIRED'));
        if (item.expiresAt && item.expiresAt < todayBR()) throw new UnprocessableEntityException(problem('Lote vencido não pode ser liberado.', 'LOT_BLOCKED'));
        if (m.expiryControlled && item.expiresAt && m.minShelfLifeDays != null) {
          const days = Math.floor((item.expiresAt.getTime() - todayBR().getTime()) / 86_400_000);
          if (days < m.minShelfLifeDays) throw new UnprocessableEntityException(problem(`Validade mínima não atendida (${days} < ${m.minShelfLifeDays} dias): só é possível reprovar.`, 'INSPECTION_REQUIRED'));
        }
        // Quarentena → disponível no mesmo endereço (ledger), lote liberado, tarefa de armazenagem.
        if (item.lotId) await tx.lot.update({ where: { id: item.lotId }, data: { status: 'LIBERADO', statusReason: null } });
        const lines = item.serialIds.length > 0 ? item.serialIds.map((sid) => ({ serialId: sid, quantity: D(1) })) : [{ serialId: undefined, quantity: item.quantity }];
        for (const [i, line] of lines.entries()) {
          await this.stock.applyInternal(tx, {
            type: 'TRANSFERENCIA', materialId: m.id, quantity: line.quantity, lotId: item.lotId ?? undefined, serialId: line.serialId, fromLocationId: item.receipt.receivingLocationId, toLocationId: item.receipt.receivingLocationId,
            fromCondition: 'QUARENTENA', toCondition: 'DISPONIVEL', reason: `Liberação na inspeção ${receiptCode(item.receipt.seq)}`, correlationId: item.receipt.id,
          }, `inspect:${item.id}:${i}`, user);
        }
        await tx.receiptItem.update({ where: { id: item.id }, data: { status: 'LIBERADO', certificateRef: certificate } });
        await this.openPutaway(tx, item, m, item.receipt.warehouseId, item.receipt.receivingLocationId, 'DISPONIVEL');
        if (item.lotId) await this.emit(tx, 'lot.released', { lot_id: item.lotId, material_id: m.id });
      } else {
        // Reprovado: permanece bloqueado na área de recebimento até devolução/descarte (via ajuste com aprovação).
        if (item.lotId) await tx.lot.update({ where: { id: item.lotId }, data: { status: 'BLOQUEADO', statusReason: `Reprovado na inspeção: ${dto.notes}` } });
        const lines = item.serialIds.length > 0 ? item.serialIds.map((sid) => ({ serialId: sid, quantity: D(1) })) : [{ serialId: undefined, quantity: item.quantity }];
        for (const [i, line] of lines.entries()) {
          await this.stock.applyInternal(tx, {
            type: 'TRANSFERENCIA', materialId: m.id, quantity: line.quantity, lotId: item.lotId ?? undefined, serialId: line.serialId, fromLocationId: item.receipt.receivingLocationId, toLocationId: item.receipt.receivingLocationId,
            fromCondition: 'QUARENTENA', toCondition: 'BLOQUEADO', reason: `Reprovação na inspeção ${receiptCode(item.receipt.seq)}`, correlationId: item.receipt.id,
          }, `inspect:${item.id}:${i}`, user);
        }
        await tx.receiptItem.update({ where: { id: item.id }, data: { status: 'REJEITADO' } });
        if (item.lotId) await this.emit(tx, 'lot.blocked', { lot_id: item.lotId, material_id: m.id, reason: dto.notes });
      }
      await tx.inspectionResult.create({ data: { receiptItemId: item.id, decision: dto.decision, checklist: (dto.checklist ?? {}) as Prisma.InputJsonValue, certificateRef: certificate, notes: dto.notes, inspectedBy: user.userId } });
      await this.refreshReceiptStatus(tx, receiptId);
      return tx.receiptItem.findUniqueOrThrow({ where: { id: item.id }, include: { inspections: true, putaways: true } });
    });
  }

  private async refreshReceiptStatus(tx: Tx, receiptId: string) {
    const r = await tx.receipt.findUniqueOrThrow({ where: { id: receiptId }, include: { items: true } });
    if (r.status === 'EM_CONFERENCIA') return;
    const items = r.items;
    let status = r.status;
    if (items.some((i) => i.status === 'EM_INSPECAO')) status = r.hasDivergence ? 'DIVERGENTE' : 'RECEBIDO_PENDENTE_INSPECAO';
    else if (items.every((i) => i.status === 'REJEITADO')) status = 'REJEITADO';
    else if (items.every((i) => ['ARMAZENADO', 'REJEITADO'].includes(i.status))) status = 'ARMAZENADO';
    else if (!r.hasDivergence) status = 'LIBERADO';
    if (status !== r.status) await tx.receipt.update({ where: { id: receiptId }, data: { status } });
  }

  // ---------------------------------------------------------------------------------------------
  // Armazenagem (9.3)
  // ---------------------------------------------------------------------------------------------

  private async openPutaway(tx: Tx, item: { id: string; materialId: string; quantity: Prisma.Decimal; lotId?: string | null; serialIds: string[] }, m: Material, warehouseId: string, fromLocationId: string, condition: StockCondition) {
    const suggested = condition === 'DISPONIVEL' ? await this.suggestLocation(tx, m, warehouseId, fromLocationId, item.quantity) : null;
    return tx.putawayTask.create({
      data: { receiptItemId: item.id, warehouseId, materialId: item.materialId, lotId: item.lotId, serialIds: item.serialIds, quantity: item.quantity, fromLocationId, suggestedLocationId: suggested?.id, condition },
    });
  }

  /** Valida categoria, risco, mistura incompatível, status e capacidade do endereço de destino (9.3). */
  private async checkLocationFit(tx: Tx | PrismaService, loc: Location, m: Material, qty: Prisma.Decimal): Promise<string | null> {
    if (loc.isVirtual) return 'endereço virtual';
    if (loc.status !== 'ATIVO') return 'endereço bloqueado ou inativo';
    if (loc.allowedCategories.length > 0 && !loc.allowedCategories.includes(m.category)) return `categoria ${m.category} não aceita`;
    if (m.riskClass && loc.allowedRiskClasses.length > 0 && !loc.allowedRiskClasses.includes(m.riskClass)) return `classe de risco ${m.riskClass} não aceita`;
    if (!m.riskClass && loc.allowedRiskClasses.length > 0) return 'endereço restrito a classes de risco';

    const held = await tx.stockBalance.findMany({ where: { locationId: loc.id, quantity: { gt: 0 } }, include: { material: { select: { riskClass: true, weightKg: true } } } });
    if (m.riskClass && held.some((b) => b.material.riskClass && b.material.riskClass !== m.riskClass)) return 'mistura incompatível de classes de risco';
    if (loc.capacityKind && loc.capacityValue) {
      if (loc.capacityKind === 'QUANTIDADE') {
        const used = held.reduce((s, b) => s.plus(b.quantity), D(0));
        if (used.plus(qty).gt(loc.capacityValue)) return 'capacidade (quantidade) excedida';
      } else if (loc.capacityKind === 'PESO') {
        if (!m.weightKg) return 'material sem peso cadastrado para validar capacidade';
        const used = held.reduce((s, b) => s.plus(b.quantity.times(b.material.weightKg ?? 0)), D(0));
        if (used.plus(m.weightKg.times(qty)).gt(loc.capacityValue)) return 'capacidade (peso) excedida';
      }
    }
    return null;
  }

  /** Sugestão: endereços compatíveis; prefere quem já guarda o mesmo material (consolidação), depois o código. */
  private async suggestLocation(tx: Tx, m: Material, warehouseId: string, receivingId: string, qty: Prisma.Decimal): Promise<Location | null> {
    const candidates = await tx.location.findMany({ where: { warehouseId, id: { not: receivingId }, isVirtual: false, status: 'ATIVO', level: { in: ['POSICAO', 'NIVEL', 'ESTANTE', 'CORREDOR', 'AREA'] } }, orderBy: { code: 'asc' } });
    const holding = new Set((await tx.stockBalance.findMany({ where: { materialId: m.id, quantity: { gt: 0 }, location: { warehouseId } }, select: { locationId: true } })).map((b) => b.locationId));
    const ranked = [...candidates].sort((a, b) => Number(holding.has(b.id)) - Number(holding.has(a.id)));
    for (const loc of ranked) if ((await this.checkLocationFit(tx, loc, m, qty)) === null) return loc;
    return null;
  }

  async listPutaway(user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const rows = await this.prisma.putawayTask.findMany({ where: { status: 'ABERTA', ...(wh !== 'ALL' && { warehouseId: { in: wh } }) }, orderBy: { seq: 'asc' }, take: 200 });
    return rows.map((t) => ({ ...t, code: `ARM-${String(t.seq).padStart(8, '0')}` }));
  }

  async confirmPutaway(id: string, dto: ConfirmPutawayDto, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.putawayTask.findUnique({ where: { id }, include: { item: { include: { receipt: true } } } });
      if (!t) throw new NotFoundException('Tarefa de armazenagem não encontrada.');
      await this.rbac.assertWarehouseAccess(user, t.warehouseId);
      if (t.status !== 'ABERTA') throw new ConflictException('Esta tarefa já foi concluída.');
      const loc = await tx.location.findFirst({ where: { id: dto.locationId, warehouseId: t.warehouseId } });
      if (!loc) throw new UnprocessableEntityException(problem('Endereço não pertence ao almoxarifado da tarefa.', 'INVALID_LOCATION'));
      if (loc.id === t.fromLocationId) throw new UnprocessableEntityException(problem('O endereço de destino é a própria área de recebimento.', 'INVALID_LOCATION'));
      const m = await tx.material.findUniqueOrThrow({ where: { id: t.materialId } });
      if (t.condition === 'DISPONIVEL') {
        const why = await this.checkLocationFit(tx, loc, m, t.quantity);
        if (why) throw new UnprocessableEntityException(problem(`Endereço ${loc.code} não pode receber o item: ${why}.`, 'INVALID_LOCATION'));
      }
      const lines = t.serialIds.length > 0 ? t.serialIds.map((sid) => ({ serialId: sid, quantity: D(1) })) : [{ serialId: undefined, quantity: t.quantity }];
      for (const [i, line] of lines.entries()) {
        await this.stock.applyInternal(tx, {
          type: 'TRANSFERENCIA', materialId: t.materialId, quantity: line.quantity, lotId: t.lotId ?? undefined, serialId: line.serialId, fromLocationId: t.fromLocationId, toLocationId: loc.id,
          fromCondition: t.condition, toCondition: t.condition, reason: `Armazenagem ${receiptCode(t.item.receipt.seq)}`, correlationId: t.item.receipt.id,
        }, `putaway:${t.id}:${i}`, user);
      }
      const done: PutawayTask = await tx.putawayTask.update({ where: { id }, data: { status: 'CONCLUIDA', confirmedLocationId: loc.id, confirmedBy: user.userId, confirmedAt: new Date() } });
      const open = await tx.putawayTask.count({ where: { receiptItemId: t.receiptItemId, status: 'ABERTA' } });
      if (open === 0) await tx.receiptItem.update({ where: { id: t.receiptItemId }, data: { status: 'ARMAZENADO' } });
      await this.refreshReceiptStatus(tx, t.item.receiptId);
      return done;
    });
  }
}
