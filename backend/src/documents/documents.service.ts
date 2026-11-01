import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { RbacService } from '../rbac/rbac.service.js';
import { fmtDate, fmtDateTime } from '../labels/labels.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';

const brl = (v: { toString(): string } | number | null | undefined) => (v == null ? '—' : Number(v.toString()).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const num = (v: { toString(): string }) => Number(v.toString()).toLocaleString('pt-BR', { maximumFractionDigits: 6 });
const pad = (p: string, n: number) => `${p}-${String(n).padStart(8, '0')}`;

export interface Doc {
  title: string;
  number: string;
  generatedAt: string;
  generatedBy: string;
  header: Record<string, string>;
  table?: { columns: string[]; rows: string[][] };
  notes?: string[];
  signatures: string[];
}

/** Documentos operacionais (16.2) em estrutura pronta para impressão/PDF; datas DD/MM/AAAA HH:mm e moeda R$. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  private base(title: string, number: string, user: AuthenticatedUser, header: Record<string, string>, signatures: string[], table?: Doc['table'], notes?: string[]): Doc {
    return { title, number, generatedAt: fmtDateTime(new Date()), generatedBy: user.userId, header, table, notes, signatures };
  }

  private async materialMap(ids: string[]) {
    const ms = await this.prisma.material.findMany({ where: { id: { in: [...new Set(ids)] } }, include: { stockUom: true } });
    return new Map(ms.map((m) => [m.id, m]));
  }

  async receipt(id: string, user: AuthenticatedUser, divergenceOnly = false) {
    const r = await this.prisma.receipt.findUnique({ where: { id }, include: { items: true } });
    if (!r) throw new NotFoundException('Recebimento não encontrado.');
    await this.rbac.assertWarehouseAccess(user, r.warehouseId);
    if (divergenceOnly && !r.hasDivergence) throw new UnprocessableEntityException('Este recebimento não possui divergências.');
    const mats = await this.materialMap(r.items.map((i) => i.materialId));
    const canCost = user.permissions.includes('material:read_cost');
    const cols = ['Material', 'Descrição', 'Qtd.', 'UM', 'Lote', 'Validade', 'Séries', 'Situação', ...(canCost ? ['Custo unit.'] : [])];
    const header = { Recebimento: pad('REC', r.seq), 'Pedido Axis': r.axisPurchaseOrderId ?? `Exceção ${r.exceptionApprovalRef ?? '—'}`, Fornecedor: r.supplierAxisId ?? '—', 'Nota fiscal': r.invoiceNumber ?? '—', Veículo: r.vehicle ?? '—', Volumes: String(r.volumes ?? '—'), Situação: r.status, 'Concluído em': fmtDateTime(r.completedAt) };
    if (divergenceOnly) return this.base('Relatório de divergência de recebimento', pad('REC', r.seq), user, header, ['Conferente', 'Compras'], undefined, r.divergenceNotes as string[]);
    return this.base('Comprovante de recebimento', pad('REC', r.seq), user, header, ['Conferente', 'Transportador'],
      { columns: cols, rows: r.items.map((i) => { const m = mats.get(i.materialId)!; return [m.code, m.shortDescription, num(i.quantity), m.stockUom.code, i.lotNumber ?? '—', fmtDate(i.expiresAt), String(i.serials.length || '—'), i.status, ...(canCost ? [brl(i.unitCost)] : [])]; }) },
      r.hasDivergence ? (r.divergenceNotes as string[]) : undefined);
  }

  async picking(id: string, user: AuthenticatedUser) {
    const t = await this.prisma.pickingTask.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException('Tarefa de separação não encontrada.');
    await this.rbac.assertWarehouseAccess(user, t.warehouseId);
    const order = await this.prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: t.orderId } });
    const mats = await this.materialMap(t.items.map((i) => i.materialId));
    const locs = new Map((await this.prisma.location.findMany({ where: { id: { in: t.items.map((i) => i.locationId) } } })).map((l) => [l.id, l.code]));
    const lots = new Map((await this.prisma.lot.findMany({ where: { id: { in: t.items.flatMap((i) => (i.lotId ? [i.lotId] : [])) } } })).map((l) => [l.id, l]));
    return this.base('Lista de separação', pad('SEP', t.seq), user,
      { Ordem: pad('ATD', order.seq), Projeto: order.projectAxisId ?? '—', 'Necessário até': fmtDate(order.neededBy), Prioridade: String(t.priority), Conferência: t.requiresCheck ? 'Independente obrigatória' : 'Não exigida' }, ['Separador', 'Conferente'],
      { columns: ['Endereço', 'Material', 'Descrição', 'Lote', 'Validade', 'Planejado', 'Separado', 'UM'], rows: [...t.items].sort((a, b) => (locs.get(a.locationId) ?? '').localeCompare(locs.get(b.locationId) ?? '')).map((i) => { const m = mats.get(i.materialId)!; const lot = i.lotId ? lots.get(i.lotId) : undefined; return [locs.get(i.locationId) ?? '—', m.code, m.shortDescription, lot?.lotNumber ?? '—', fmtDate(lot?.expiresAt), num(i.quantityPlanned), num(i.quantityPicked), m.stockUom.code]; }) });
  }

  async shipment(id: string, user: AuthenticatedUser) {
    const s = await this.prisma.shipment.findUnique({ where: { id }, include: { packages: { include: { items: { include: { pickingItem: true } } }, orderBy: { seq: 'asc' } } } });
    if (!s) throw new NotFoundException('Expedição não encontrada.');
    const order = await this.prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: s.orderId } });
    if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);
    const mats = await this.materialMap(s.packages.flatMap((p) => p.items.map((i) => i.pickingItem.materialId)));
    const rows = s.packages.flatMap((p) => p.items.map((i) => { const m = mats.get(i.pickingItem.materialId)!; return [pad('VOL', p.seq), m.code, m.shortDescription, num(i.quantity), m.stockUom.code, p.weightKg ? `${num(p.weightKg)} kg` : '—', p.seal ?? '—']; }));
    return this.base('Romaneio de expedição', s.manifestCode ?? pad('EXP', s.seq), user,
      { Ordem: pad('ATD', order.seq), Destino: s.destination ?? '—', Transportador: s.carrier ?? '—', Rota: s.route ?? '—', Veículo: s.vehicle ?? '—', 'Expedido em': fmtDateTime(s.dispatchedAt), Volumes: String(s.packages.length) }, ['Expedição', 'Transportador', 'Recebedor'],
      { columns: ['Volume', 'Material', 'Descrição', 'Qtd.', 'UM', 'Peso', 'Lacre'], rows });
  }

  async delivery(shipmentId: string, user: AuthenticatedUser) {
    const s = await this.prisma.shipment.findUnique({ where: { id: shipmentId }, include: { proofs: { orderBy: { createdAt: 'asc' } } } });
    if (!s) throw new NotFoundException('Expedição não encontrada.');
    const order = await this.prisma.fulfillmentOrder.findUniqueOrThrow({ where: { id: s.orderId } });
    if (order.warehouseId) await this.rbac.assertWarehouseAccess(user, order.warehouseId);
    if (s.proofs.length === 0) throw new UnprocessableEntityException('Ainda não há comprovante de entrega para esta expedição.');
    return this.base('Comprovante de entrega', pad('EXP', s.seq), user, { Ordem: pad('ATD', order.seq), Situação: s.status, Projeto: order.projectAxisId ?? '—' }, ['Recebedor', 'Entregador'],
      { columns: ['Resultado', 'Recebedor', 'Entregue em', 'Volumes', 'Observações', 'Assinatura', 'Foto'], rows: s.proofs.map((p) => [p.outcome, p.receiverName, fmtDateTime(p.deliveredAt), String(p.packageIds.length), p.notes ?? '—', p.signatureRef ?? '—', p.photoRef ?? '—']) });
  }

  async transfer(id: string, user: AuthenticatedUser) {
    const t = await this.prisma.transfer.findUnique({ where: { id }, include: { items: true } });
    if (!t) throw new NotFoundException('Transferência não encontrada.');
    const wh = await this.rbac.accessibleWarehouseIds(user);
    if (wh !== 'ALL' && !wh.includes(t.fromWarehouseId) && !wh.includes(t.toWarehouseId)) throw new UnprocessableEntityException('Sem acesso a esta transferência.');
    const mats = await this.materialMap(t.items.map((i) => i.materialId));
    const whs = new Map((await this.prisma.warehouse.findMany({ where: { id: { in: [t.fromWarehouseId, t.toWarehouseId] } } })).map((w) => [w.id, w.name]));
    return this.base('Romaneio de transferência', pad('TRF', t.seq), user,
      { Origem: whs.get(t.fromWarehouseId) ?? '—', Destino: whs.get(t.toWarehouseId) ?? '—', Situação: t.status, Urgente: t.urgent ? 'Sim' : 'Não', Motivo: t.reason, 'Expedida em': fmtDateTime(t.dispatchedAt), 'Recebida em': fmtDateTime(t.receivedAt) }, ['Expedição', 'Transportador', 'Recebimento'],
      { columns: ['Material', 'Descrição', 'Expedido', 'Recebido', 'UM'], rows: t.items.map((i) => { const m = mats.get(i.materialId)!; return [m.code, m.shortDescription, num(i.quantity), num(i.receivedQty), m.stockUom.code]; }) },
      t.hasDivergence ? ['Há divergência entre expedido e recebido: tratar ocorrência.'] : undefined);
  }

  /** Termo de entrega e custódia (9.5): o próprio custodiante ou quem administra custódia/auditoria. */
  async custody(id: string, user: AuthenticatedUser) {
    const t = await this.prisma.custodyTerm.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Termo de custódia não encontrado.');
    if (t.custodianAxisId !== user.userId && !user.permissions.includes('custody:execute') && !user.permissions.includes('audit:read')) throw new UnprocessableEntityException('Sem acesso a este termo.');
    const m = await this.prisma.material.findUniqueOrThrow({ where: { id: t.materialId }, include: { stockUom: true } });
    const serial = t.serialId ? await this.prisma.serialNumber.findUnique({ where: { id: t.serialId } }) : null;
    const cust = await this.prisma.axisMasterCache.findFirst({ where: { axisId: t.custodianAxisId, kind: { in: ['COLLABORATOR', 'USER'] } } });
    return this.base('Termo de entrega e custódia', pad('CUS', t.seq), user,
      { Custodiante: cust?.name ?? t.custodianAxisId, Material: `${m.code} — ${m.shortDescription}`, Quantidade: `${num(t.quantity)} ${m.stockUom.code}`, Série: serial?.serial ?? '—', Patrimônio: serial?.assetTag ?? '—', 'Entregue em': fmtDateTime(t.deliveredAt), 'Devolução prevista': fmtDate(t.expectedReturnAt), Situação: t.status, 'Aceite/assinatura': t.acceptanceRef ?? '—' }, ['Custodiante', 'Almoxarife'], undefined,
      ['O custodiante declara ter recebido o item em bom estado e se responsabiliza por sua guarda e devolução.']);
  }

  /** Comprovante de devolução; para sucata/descarte vale como certificado, com a aprovação do Axis. */
  async returnDoc(id: string, user: AuthenticatedUser) {
    const r = await this.prisma.return.findUnique({ where: { id }, include: { items: true } });
    if (!r) throw new NotFoundException('Devolução não encontrada.');
    await this.rbac.assertWarehouseAccess(user, r.warehouseId);
    const mats = await this.materialMap(r.items.map((i) => i.materialId));
    const scrap = r.items.some((i) => i.disposition === 'SUCATA');
    return this.base(scrap ? 'Certificado de devolução/descarte' : 'Comprovante de devolução', pad('DEV', r.seq), user,
      { Tipo: r.type, 'Devolvido por': r.returnedByAxisId ?? '—', Projeto: r.projectAxisId ?? '—', Situação: r.status, 'Recebida em': fmtDateTime(r.createdAt) }, ['Quem devolveu', 'Inspeção', 'Almoxarife'],
      { columns: ['Material', 'Descrição', 'Qtd.', 'Destinação', 'Aprovação Axis', 'Parecer'], rows: r.items.map((i) => { const m = mats.get(i.materialId)!; return [m.code, m.shortDescription, num(i.quantity), i.disposition ?? 'PENDENTE', i.approvalRef ?? '—', i.notes ?? '—']; }) });
  }

  /** Relatório de inventário antes/depois (16.2, 9.8): saldo do sistema x apurado, com valor da divergência (R$) para quem vê custo. */
  async stockCount(id: string, user: AuthenticatedUser) {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, include: { lines: true } });
    if (!c) throw new NotFoundException('Inventário não encontrado.');
    await this.rbac.assertWarehouseAccess(user, c.warehouseId);
    const mats = await this.materialMap(c.lines.map((l) => l.materialId));
    const locs = new Map((await this.prisma.location.findMany({ where: { id: { in: c.lines.map((l) => l.locationId) } } })).map((l) => [l.id, l.code]));
    const canCost = user.permissions.includes('material:read_cost');
    const rows = [...c.lines].sort((a, b) => (locs.get(a.locationId) ?? '').localeCompare(locs.get(b.locationId) ?? '')).map((l) => {
      const m = mats.get(l.materialId)!;
      const value = l.varianceQty && l.unitCost ? brl(Number(l.varianceQty.toString()) * Number(l.unitCost.toString())) : '—';
      return [locs.get(l.locationId) ?? '—', m.code, m.shortDescription, num(l.systemQty), l.finalQty ? num(l.finalQty) : '—', l.varianceQty ? num(l.varianceQty) : '0', l.status, l.reason ?? '—', ...(canCost ? [value] : [])];
    });
    return this.base('Relatório de inventário', pad('INV', c.seq), user,
      { Tipo: c.type, Situação: c.status, 'Tolerância': `${Number(c.tolerancePct.toString()).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%`, 'Aprovação Axis': c.approvalRef ?? '—', 'Aberto em': fmtDateTime(c.createdAt), 'Concluído em': fmtDateTime(c.closedAt) }, ['Responsável pelo inventário', 'Gestor do almoxarifado'],
      { columns: ['Endereço', 'Material', 'Descrição', 'Antes (sistema)', 'Depois (apurado)', 'Divergência', 'Situação', 'Motivo', ...(canCost ? ['Valor divergência'] : [])], rows },
      c.actionPlan ? [`Plano de ação: ${c.actionPlan}`] : undefined);
  }

  /** Extrato de movimentações (16.2): período e filtros; custo só com material:read_cost. */
  async statement(q: { materialId?: string; locationId?: string; from?: string; to?: string }, user: AuthenticatedUser) {
    const wh = await this.rbac.accessibleWarehouseIds(user);
    const scope = wh === 'ALL' ? {} : { OR: [{ fromLocation: { warehouseId: { in: wh } } }, { toLocation: { warehouseId: { in: wh } } }] };
    const rows = await this.prisma.stockMovement.findMany({
      where: { AND: [scope, { ...(q.materialId && { materialId: q.materialId }), ...(q.locationId && { OR: [{ fromLocationId: q.locationId }, { toLocationId: q.locationId }] }), ...((q.from || q.to) && { effectiveAt: { ...(q.from && { gte: new Date(q.from) }), ...(q.to && { lte: new Date(q.to) }) } }) }] },
      orderBy: { seq: 'asc' }, take: 1000, include: { material: { include: { stockUom: true } } },
    });
    const canCost = user.permissions.includes('material:read_cost');
    return this.base('Extrato de movimentações', `EXT-${Date.now().toString(36).toUpperCase()}`, user, { Período: `${q.from ? fmtDateTime(new Date(q.from)) : 'início'} a ${q.to ? fmtDateTime(new Date(q.to)) : 'agora'}`, Registros: String(rows.length) }, ['Responsável'],
      { columns: ['Código', 'Data efetiva', 'Tipo', 'Material', 'Qtd.', 'UM', 'Motivo', ...(canCost ? ['Custo unit.'] : [])], rows: rows.map((m) => [pad('MOV', m.seq), fmtDateTime(m.effectiveAt), m.type, m.material.code, num(m.quantity), m.material.stockUom.code, m.reason, ...(canCost ? [brl(m.unitCost)] : [])]) },
      rows.length === 1000 ? ['Limite de 1.000 registros: refine o período.'] : undefined);
  }
}
