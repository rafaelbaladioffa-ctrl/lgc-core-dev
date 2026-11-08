import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { D, ZERO, parseDate, todaySaoPaulo, type Dec } from './cc-engine.js';

/**
 * Eventos do Core que viram fatos dos centros de custo (centros-de-custo-especificacao §2 e
 * docs/integracao-centros-de-custo.md §2–§3). Chamados pelo receptor do webhook dentro da transação dele.
 */

export const CC_EVENT_TYPES = [
  'collaborator.cost_center_changed',
  'purchase.approved',
  'purchase.order_registered',
  'purchase.delivery_received',
  'purchase.cancelled',
  'finance_request.approved',
] as const;

export const isCcEvent = (type: string) => (CC_EVENT_TYPES as readonly string[]).includes(type);

/** Lançamentos automáticos são do sistema; o ator gravado é a origem. */
const SYSTEM_ACTOR = 'sistema:core';
const STOCK_SUPPLIER = /^estoque$/i;

type Payload = Record<string, unknown>;

const str = (p: Payload, k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : null);
function required(p: Payload, k: string): string {
  const v = str(p, k);
  if (!v) throw new BadRequestException(`${k} ausente no evento.`);
  return v;
}
function amount(v: unknown, label: string): Dec {
  if (typeof v !== 'string' && typeof v !== 'number') throw new BadRequestException(`${label} ausente ou inválido.`);
  try {
    const d = new D(v);
    if (!d.isFinite()) throw new Error();
    return d.toDecimalPlaces(2);
  } catch {
    throw new BadRequestException(`${label} inválido.`);
  }
}
/** Instante do evento → data da competência em São Paulo. */
const competenceOf = (instant: string | null, fallback: string) => parseDate(todaySaoPaulo(new Date(instant && !Number.isNaN(Date.parse(instant)) ? instant : fallback)));

export interface PurchaseGroup {
  group_id: string;
  supplier: string;
  total: string;
  stock: boolean;
  received: boolean;
}

export function parseGroups(p: Payload): PurchaseGroup[] {
  const raw = Array.isArray(p['groups']) ? (p['groups'] as unknown[]) : [];
  return raw.map((g, i) => {
    const row = (g ?? {}) as Payload;
    const supplier = str(row, 'supplier') ?? 'Fornecedor';
    return {
      group_id: str(row, 'group_id') ?? String(i + 1),
      supplier,
      total: amount(row['total'] ?? '0', `total do grupo ${i + 1}`).toFixed(2),
      stock: STOCK_SUPPLIER.test(supplier.trim()),
      received: false,
    };
  });
}

const purchaseRef = (requestId: string, groupId: string) => `purchase:${requestId}:${groupId}`;

async function openCommitments(tx: Prisma.TransactionClient, ref: string) {
  return tx.ccEntry.findMany({ where: { sourceRef: ref, stage: 'comprometido', reversesId: null, reversedBy: { is: null } } });
}

/** Baixa do comprometido: estorno com a MESMA competência, para o mês original zerar. */
async function releaseCommitments(tx: Prisma.TransactionClient, ref: string, reason: string) {
  for (const e of await openCommitments(tx, ref)) {
    await tx.ccEntry.create({
      data: {
        costCenterAxisId: e.costCenterAxisId,
        projectAxisId: e.projectAxisId,
        competence: e.competence,
        kind: e.kind,
        category: e.category,
        stage: e.stage,
        source: e.source,
        amount: e.amount.negated(),
        description: e.description,
        reversesId: e.id,
        reason,
        createdBy: SYSTEM_ACTOR,
      },
    });
  }
}

async function commitGroups(tx: Prisma.TransactionClient, p: Payload, groups: PurchaseGroup[], competence: Date) {
  const requestId = required(p, 'request_id');
  const code = str(p, 'code') ?? requestId;
  for (const g of groups) {
    if (g.stock || g.received) continue;
    const ref = purchaseRef(requestId, g.group_id);
    const existing = await tx.ccEntry.findFirst({ where: { sourceRef: ref } });
    if (existing) continue; // já comprometido (ou já recebido) antes
    await tx.ccEntry.create({
      data: {
        costCenterAxisId: required(p, 'cost_center_id'),
        projectAxisId: str(p, 'project_id'),
        competence,
        kind: 'custo',
        category: 'compras',
        stage: 'comprometido',
        source: 'compra',
        amount: new D(g.total),
        description: `Compra ${code} — ${g.supplier}`,
        sourceRef: ref,
        createdBy: SYSTEM_ACTOR,
      },
    });
  }
}

const groupsJson = (groups: PurchaseGroup[]) => groups as unknown as Prisma.InputJsonValue;
const totalOf = (groups: PurchaseGroup[]) => groups.reduce((s, g) => s.plus(g.total), ZERO);

export async function handleCcEvent(tx: Prisma.TransactionClient, eventType: string, eventId: string, occurredAt: string, p: Payload): Promise<'processed' | 'ignored'> {
  switch (eventType) {
    case 'collaborator.cost_center_changed':
      return applyAllocation(tx, eventId, p);
    case 'purchase.approved':
    case 'purchase.order_registered':
      return registerPurchase(tx, eventType, occurredAt, p);
    case 'purchase.delivery_received':
      return receivePurchase(tx, occurredAt, p);
    case 'purchase.cancelled':
      return cancelPurchase(tx, occurredAt, p);
    case 'finance_request.approved':
      return approveFinanceRequest(tx, occurredAt, p);
    default:
      return 'ignored';
  }
}

/** Fecha a vigência aberta do colaborador em `valid_from` e abre a nova (se houver CC). */
async function applyAllocation(tx: Prisma.TransactionClient, eventId: string, p: Payload): Promise<'processed'> {
  const collaboratorAxisId = required(p, 'collaborator_id');
  const validFrom = parseDate(required(p, 'valid_from'), 'valid_from');
  const costCenterAxisId = str(p, 'cost_center_id');
  const open = await tx.ccAllocation.findMany({ where: { collaboratorAxisId, validTo: null } });
  for (const a of open) {
    // Mesmo início: a alocação é substituída (correção do dia).
    if (a.validFrom >= validFrom) await tx.ccAllocation.delete({ where: { id: a.id } });
    else await tx.ccAllocation.update({ where: { id: a.id }, data: { validTo: validFrom } });
  }
  if (costCenterAxisId) await tx.ccAllocation.create({ data: { collaboratorAxisId, costCenterAxisId, validFrom, sourceEventId: eventId } });
  return 'processed';
}

async function registerPurchase(tx: Prisma.TransactionClient, eventType: string, occurredAt: string, p: Payload): Promise<'processed'> {
  const requestAxisId = required(p, 'request_id');
  const costCenterAxisId = required(p, 'cost_center_id');
  const approved = eventType === 'purchase.approved';
  const instant = str(p, approved ? 'approved_at' : 'ordered_at') ?? occurredAt;
  const incoming = parseGroups(p);
  const current = await tx.ccPurchase.findUnique({ where: { requestAxisId } });
  // Grupos já recebidos mantêm a marca; os demais vêm do evento.
  const known = new Map(((current?.groups as unknown as PurchaseGroup[] | undefined) ?? []).map((g) => [g.group_id, g]));
  const groups = incoming.length > 0 ? incoming.map((g) => ({ ...g, received: known.get(g.group_id)?.received ?? false })) : [...known.values()];
  const total = p['total'] !== undefined ? amount(p['total'], 'total') : totalOf(groups);
  const date = new Date(instant);
  const status = current && ['recebida_parcial', 'recebida', 'cancelada'].includes(current.status) ? current.status : approved && current?.status !== 'pedido' ? 'aprovada' : 'pedido';
  const data = {
    code: str(p, 'code') ?? requestAxisId,
    costCenterAxisId,
    projectAxisId: str(p, 'project_id'),
    total,
    status,
    groups: groupsJson(groups),
    ...(approved ? { approvedAt: date } : { orderedAt: date }),
  } as const;
  await tx.ccPurchase.upsert({ where: { requestAxisId }, create: { requestAxisId, ...data }, update: data });
  if (status !== 'cancelada') {
    const approvedAt = approved ? date : (current?.approvedAt ?? date);
    await commitGroups(tx, p, groups, competenceOf(approvedAt.toISOString(), occurredAt));
  }
  return 'processed';
}

async function receivePurchase(tx: Prisma.TransactionClient, occurredAt: string, p: Payload): Promise<'processed'> {
  const requestAxisId = required(p, 'request_id');
  const receivedAt = str(p, 'received_at') ?? occurredAt;
  const competence = competenceOf(receivedAt, occurredAt);
  const received = parseGroups(p);
  const current = await tx.ccPurchase.findUnique({ where: { requestAxisId } });
  const groups = new Map(((current?.groups as unknown as PurchaseGroup[] | undefined) ?? []).map((g) => [g.group_id, g]));
  const costCenterAxisId = str(p, 'cost_center_id') ?? current?.costCenterAxisId;
  if (!costCenterAxisId) throw new BadRequestException('cost_center_id ausente no evento.');
  const code = str(p, 'code') ?? current?.code ?? requestAxisId;
  for (const g of received) {
    const known = groups.get(g.group_id);
    const group = { ...(known ?? g), total: known?.total ?? g.total, stock: known?.stock ?? g.stock, received: true };
    groups.set(g.group_id, group);
    if (group.stock) continue;
    const ref = purchaseRef(requestAxisId, g.group_id);
    if (await tx.ccEntry.findFirst({ where: { sourceRef: ref, stage: 'realizado' } })) continue; // reentrega
    await releaseCommitments(tx, ref, 'Recebimento confirmado');
    await tx.ccEntry.create({
      data: {
        costCenterAxisId,
        projectAxisId: str(p, 'project_id') ?? current?.projectAxisId ?? null,
        competence,
        kind: 'custo',
        category: 'compras',
        stage: 'realizado',
        source: 'compra',
        amount: new D(group.total),
        description: `Compra ${code} — ${group.supplier} (recebida)`,
        sourceRef: ref,
        createdBy: SYSTEM_ACTOR,
      },
    });
  }
  const list = [...groups.values()];
  const allReceived = p['all_received'] === true || (list.length > 0 && list.every((g) => g.received));
  const data = { status: allReceived ? 'recebida' : 'recebida_parcial', receivedAt: new Date(receivedAt), groups: groupsJson(list) } as const;
  if (current) await tx.ccPurchase.update({ where: { requestAxisId }, data });
  else await tx.ccPurchase.create({ data: { requestAxisId, code, costCenterAxisId, projectAxisId: str(p, 'project_id'), total: totalOf(list), ...data } });
  return 'processed';
}

async function cancelPurchase(tx: Prisma.TransactionClient, occurredAt: string, p: Payload): Promise<'processed'> {
  const requestAxisId = required(p, 'request_id');
  const current = await tx.ccPurchase.findUnique({ where: { requestAxisId } });
  for (const g of (current?.groups as unknown as PurchaseGroup[] | undefined) ?? []) await releaseCommitments(tx, purchaseRef(requestAxisId, g.group_id), 'Compra cancelada no Core');
  const cancelledAt = new Date(str(p, 'cancelled_at') ?? occurredAt);
  if (current) await tx.ccPurchase.update({ where: { requestAxisId }, data: { status: 'cancelada', cancelledAt } });
  else
    await tx.ccPurchase.create({
      data: { requestAxisId, code: str(p, 'code') ?? requestAxisId, costCenterAxisId: required(p, 'cost_center_id'), projectAxisId: str(p, 'project_id'), total: ZERO, status: 'cancelada', cancelledAt },
    });
  return 'processed';
}

async function approveFinanceRequest(tx: Prisma.TransactionClient, occurredAt: string, p: Payload): Promise<'processed' | 'ignored'> {
  const kind = str(p, 'kind');
  if (kind !== 'reembolso' && kind !== 'adiantamento') return 'ignored';
  const requestAxisId = required(p, 'request_id');
  const code = str(p, 'code') ?? requestAxisId;
  const costCenterAxisId = required(p, 'cost_center_id');
  const collaboratorAxisId = required(p, 'collaborator_id');
  const value = amount(p['amount'], 'amount');
  const approvedAt = str(p, 'approved_at') ?? occurredAt;
  const ref = `${kind}:${requestAxisId}`;
  if (await tx.ccEntry.findFirst({ where: { sourceRef: ref } })) return 'processed'; // reentrega
  await tx.ccEntry.create({
    data: {
      costCenterAxisId,
      projectAxisId: str(p, 'project_id'),
      competence: competenceOf(approvedAt, occurredAt),
      kind: 'custo',
      category: 'despesas_campo',
      stage: kind === 'reembolso' ? 'realizado' : 'comprometido',
      source: kind,
      amount: value,
      description: `${kind === 'reembolso' ? 'Reembolso' : 'Adiantamento'} ${code}`,
      sourceRef: ref,
      createdBy: SYSTEM_ACTOR,
    },
  });
  if (kind === 'adiantamento') {
    await tx.ccAdvance.upsert({
      where: { requestAxisId },
      create: { requestAxisId, requestCode: code, collaboratorAxisId, costCenterAxisId, projectAxisId: str(p, 'project_id'), amount: value, approvedAt: new Date(approvedAt) },
      update: {},
    });
  }
  return 'processed';
}

export const advanceRef = (requestAxisId: string) => `adiantamento:${requestAxisId}`;
export { releaseCommitments };
