import { Prisma } from '@prisma/client';
import type { OutboxService } from '../integration/outbox.service.js';

/**
 * Envio de material para obra (PT-06 do plano projeto aprovado → obra, docs/dominio/requisicoes-estado-atual.md §16).
 *
 * Requisição criada pelo servidor ao aprovar o projeto (`ProjectApprovalService`), aprovada pelo responsável do
 * centro de custo e enviada à Logística como `material_request.approved`. Este arquivo concentra o que o
 * `RequestsService` e a criação automática compartilham: constantes, o formato guardado em `formData.shipment` e os
 * eventos para a Logística. Funções puras ou que recebem o `tx` da transação de quem chama (regra do outbox).
 */

type Tx = Prisma.TransactionClient;

/** E-mail do usuário/colaborador de sistema "Axis (automático)" (migração 20261127000001 e seed). */
export const SYSTEM_ACTOR_EMAIL = 'axis-automatico@sistema.axis.local';
/** Categoria `envio_material` semeada pela migração 20261127000001. */
export const SHIPMENT_CATEGORY_CODE = 'LOG-ENVIO-OBRA';
/** `requests.origin` das requisições criadas ao aprovar o projeto; `source_ref` = id da cotação aceita. */
export const PROJECT_APPROVED_ORIGIN = 'projeto_aprovado';

export const MATERIAL_REQUEST_APPROVED_EVENT = 'material_request.approved';
export const MATERIAL_REQUEST_CANCEL_EVENT = 'material_request.cancel_requested';

/** Folga entre a chegada do material no site e o início previsto da cotação, em dias úteis (PA-10). */
export const DEFAULT_SHIPMENT_LEAD_BUSINESS_DAYS = 5;

export interface ShipmentItem {
  materialCode: string;
  logisticsMaterialId: string | null;
  description: string;
  unit: string;
  /** Texto decimal com 3 casas (`NUMERIC(14,3)`), como a Logística recebe. */
  quantity: string;
}

export interface ShipmentDestination {
  siteId: string;
  siteCode: string;
  siteName: string;
  /** Endereço em uma linha (rua, número, complemento, bairro e CEP). */
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Guardado em `Request.formData.shipment`: tudo o que a tela do envio mostra e o evento para a Logística usa. */
export interface ShipmentData {
  projectQuoteId: string;
  /** Colaborador responsável do projeto: recebe o material no site. */
  recipientCollaboratorId: string;
  /** Nome do recebedor, para a tela (o evento para a Logística leva só o id). */
  recipientName: string | null;
  /** `AAAA-MM-DD` ou `null` quando a cotação e o projeto não têm início previsto. */
  neededBy: string | null;
  destination: ShipmentDestination;
  items: ShipmentItem[];
  /** Avisos do servidor (ex.: Logística fora do ar na estimativa, material sem custo médio). */
  warnings: string[];
  /** Quando o `material_request.approved` foi enviado à Logística; nulo antes da aprovação. */
  approvedAt: string | null;
}

/** Lê `formData.shipment`; `null` se a requisição não é um envio de material. */
export function shipmentOf(formData: Prisma.JsonValue | null | undefined): ShipmentData | null {
  const shipment = (formData as { shipment?: unknown } | null | undefined)?.shipment;
  return shipment && typeof shipment === 'object' ? (shipment as ShipmentData) : null;
}

/**
 * Data de necessidade (PA-10): `start` (data de calendário em UTC, como as colunas `DATE`) menos `days` dias
 * úteis, pulando sábados, domingos e feriados cadastrados (`holidays`, chaves `AAAA-MM-DD`).
 */
export function subtractBusinessDays(start: Date, days: number, holidays: ReadonlySet<string>): Date {
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  let remaining = days;
  while (remaining > 0) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(cursor.toISOString().slice(0, 10))) remaining -= 1;
  }
  return cursor;
}

/** Endereço do site em uma linha para a Logística e a tela. */
export function formatSiteAddress(site: {
  addressStreet: string | null;
  addressNumber: string | null;
  addressComplement: string | null;
  addressDistrict: string | null;
  cep: string | null;
}): string | null {
  const street = [site.addressStreet, site.addressNumber].filter(Boolean).join(', ');
  const cep = site.cep ? `CEP ${site.cep.length === 8 ? `${site.cep.slice(0, 5)}-${site.cep.slice(5)}` : site.cep}` : null;
  const text = [street, site.addressComplement, site.addressDistrict, cep].filter((part) => part && part.length > 0).join(', ');
  return text || null;
}

/** Payload do `material_request.approved` no formato do adaptador da Logística (§4.3 do plano). */
export function materialRequestApprovedPayload(request: {
  id: string;
  code: string;
  projectId: string | null;
  costCenterId: string | null;
}, shipment: ShipmentData): Record<string, unknown> {
  return {
    request_id: request.id,
    version: 1,
    code: request.code,
    project_id: request.projectId,
    cost_center_id: request.costCenterId,
    requester_id: null,
    recipient_id: shipment.recipientCollaboratorId,
    warehouse_code: null,
    needed_by: shipment.neededBy,
    destination: {
      site_id: shipment.destination.siteId,
      site_code: shipment.destination.siteCode,
      address: shipment.destination.address,
      city: shipment.destination.city,
      state: shipment.destination.state,
      latitude: shipment.destination.latitude,
      longitude: shipment.destination.longitude,
    },
    items: shipment.items.map((item) => ({ material_code: item.materialCode, quantity: item.quantity })),
  };
}

async function audit(tx: Tx, aggregateId: string, event: string, actorId: string | null, after: Record<string, unknown>): Promise<void> {
  await tx.auditEvent.create({
    data: { aggregateType: 'request', aggregateId, event, actorId, afterJson: after as Prisma.InputJsonValue, source: 'api' },
  });
}

/**
 * Responsável que aprova o envio (PA-09): o do centro de custo do projeto; sem ele (ou desligado), o do CC pai;
 * sem nenhum, `null` e a requisição fica aguardando aprovação com alerta ao admin de Requisições.
 */
export async function resolveShipmentApprover(
  tx: Tx,
  costCenterId: string,
): Promise<{ approverId: string; fallback: 'cc_pai' | null } | null> {
  const costCenter = await tx.costCenter.findUnique({
    where: { id: costCenterId },
    select: {
      responsibleCollaborator: { select: { id: true, status: true } },
      parentCostCenter: { select: { responsibleCollaborator: { select: { id: true, status: true } } } },
    },
  });
  const own = costCenter?.responsibleCollaborator;
  if (own && own.status !== 'desligado') return { approverId: own.id, fallback: null };
  const parent = costCenter?.parentCostCenter?.responsibleCollaborator;
  if (parent && parent.status !== 'desligado') return { approverId: parent.id, fallback: 'cc_pai' };
  return null;
}

/**
 * Aprovação final do envio: emite `material_request.approved` e leva a requisição a `em_atendimento` (a Logística
 * assume). Na mesma transação da aprovação. Os relógios de SLA são parados: o prazo passa a ser o `needed_by`.
 */
export async function sendShipmentToLogistics<
  R extends { id: string; code: string; projectId: string | null; costCenterId: string | null; formData: Prisma.JsonValue },
>(tx: Tx, outbox: Pick<OutboxService, 'record'>, request: R, actorId: string, now: Date = new Date()) {
  const shipment = shipmentOf(request.formData);
  if (!shipment) throw new Error(`Requisição ${request.code} não tem os dados do envio de material.`);
  await outbox.record(tx, MATERIAL_REQUEST_APPROVED_EVENT, materialRequestApprovedPayload(request, shipment));
  const formData = { ...(request.formData as Record<string, unknown>), shipment: { ...shipment, approvedAt: now.toISOString() } };
  await tx.slaClock.updateMany({ where: { requestId: request.id, stoppedAt: null }, data: { stoppedAt: now, breached: false } });
  const updated = await tx.request.update({
    where: { id: request.id },
    data: { status: 'em_atendimento', formData: formData as unknown as Prisma.InputJsonValue },
  });
  await audit(tx, request.id, 'request.shipment_sent_to_logistics', actorId, { status: 'em_atendimento', items: shipment.items.length });
  await outbox.record(tx, 'request.status_changed', { request_id: request.id, code: request.code, status: 'em_atendimento' });
  return updated;
}

/**
 * Cancelamento de um envio que a Logística já recebeu (`approvedAt` preenchido): emite
 * `material_request.cancel_requested`. Envio ainda não aprovado (ou reprovado) nunca chegou à Logística: não emite.
 */
export async function cancelShipmentInLogistics(
  tx: Tx,
  outbox: Pick<OutboxService, 'record'>,
  request: { id: string; code: string; projectId: string | null; costCenterId: string | null; formData: Prisma.JsonValue },
  reason: string | undefined,
): Promise<boolean> {
  const shipment = shipmentOf(request.formData);
  if (!shipment?.approvedAt) return false;
  await outbox.record(tx, MATERIAL_REQUEST_CANCEL_EVENT, {
    request_id: request.id,
    code: request.code,
    project_id: request.projectId,
    cost_center_id: request.costCenterId,
    reason: reason?.trim() ? reason.trim() : 'Requisição cancelada no Axis',
  });
  return true;
}
