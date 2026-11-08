import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReplenishmentService } from '../replenishment/replenishment.service.js';
import { FulfillmentService } from '../fulfillment/fulfillment.service.js';
import { adaptMaterialRequestEvent } from './material-request.adapter.js';
import { adaptCorePurchase } from './core-purchase.adapter.js';

interface Envelope {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_SKEW_MS = 5 * 60_000;
/** Projetos nesses status deixam de ser destino de novas requisições. */
const INACTIVE_PROJECT_STATUS = ['cancelado', 'encerrado', 'arquivado'];

type Master = { kind: string; axisId: string; code?: string; name?: string; active?: boolean; data: Record<string, unknown> };

/**
 * Famílias do Core que a Logística recebe (assinatura do satélite, reenvio de cadastros) mas não usa: ficam registradas como
 * ignoradas, com o motivo, e nunca caem no adaptador de requisição de material.
 */
export const IGNORED_FAMILIES = ['job_title', 'holiday', 'certification', 'work_schedule', 'sector', 'request', 'sla', 'finance_request'];

/** Motivo gravado (em `lastError`) quando um evento é ignorado; null quando não há o que explicar (ping, tipo desconhecido). */
export function ignoredReason(eventType: string, p: Record<string, unknown>): string | null {
  const family = eventType.split('.')[0];
  if (family === 'purchase') {
    const mapped = adaptCorePurchase(eventType, p);
    return mapped.kind === 'ignored' ? mapped.reason : null;
  }
  if (IGNORED_FAMILIES.includes(family)) return `${eventType} não é usado pela Logística.`;
  return null;
}

/** `active` explícito do payload; senão, a regra de cada cadastro. `deleted: true` sempre inativa. */
const activeFrom = (p: Record<string, unknown>, fallback: boolean | undefined): boolean | undefined => {
  if (p['deleted'] === true) return false;
  if (typeof p['active'] === 'boolean') return p['active'];
  return fallback;
};

/**
 * Receptor do webhook do Axis (PLANNING.md 3.1/3.2, PLANNING_LOGISTICA.md 12.1/12.4):
 *  - assinatura HMAC-SHA256 do corpo bruto (`X-Axis-Signature: sha256=<hex>`), comparação em tempo constante;
 *  - proteção contra replay: janela de `occurred_at` + idempotência por `event_id`;
 *  - eventos fora de ordem não sobrescrevem versão mais nova do cache;
 *  - falha de processamento fica registrada e o evento pode ser reprocessado quando o Axis reentregar.
 */
@Injectable()
export class AxisWebhookService {
  private readonly logger = new Logger(AxisWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fulfillment: FulfillmentService,
    private readonly replenishment: ReplenishmentService,
  ) {}

  verifySignature(rawBody: Buffer | undefined, header: string | undefined) {
    const secret = this.config.get<string>('AXIS_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('Webhook do Axis não configurado (AXIS_WEBHOOK_SECRET).');
    if (!rawBody || !header?.startsWith('sha256=')) throw new UnauthorizedException('Assinatura ausente ou inválida.');
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
    const received = Buffer.from(header.slice('sha256='.length), 'utf8');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException('Assinatura ausente ou inválida.');
  }

  private parse(rawBody: Buffer): Envelope {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Corpo do evento não é um JSON válido.');
    }
    const e = body as Partial<Envelope>;
    if (!e || typeof e.event_id !== 'string' || !UUID.test(e.event_id)) throw new BadRequestException('event_id ausente ou inválido.');
    if (typeof e.event_type !== 'string' || e.event_type.length === 0 || e.event_type.length > 100) throw new BadRequestException('event_type ausente ou inválido.');
    if (typeof e.occurred_at !== 'string' || Number.isNaN(Date.parse(e.occurred_at))) throw new BadRequestException('occurred_at ausente ou inválido.');
    if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new BadRequestException('payload ausente ou inválido.');

    const occurred = Date.parse(e.occurred_at);
    // Retentativas do Axis podem chegar horas depois (backoff até ~2h); além da janela é replay.
    const configured = Number(this.config.get('WEBHOOK_MAX_AGE_HOURS') ?? 72);
    const maxAgeMs = (Number.isFinite(configured) && configured > 0 ? configured : 72) * 3_600_000; // configuração inválida nunca desliga a janela
    if (Date.now() - occurred > maxAgeMs) throw new BadRequestException('Evento fora da janela de validade (possível replay).');
    if (occurred - Date.now() > CLOCK_SKEW_MS) throw new BadRequestException('occurred_at no futuro.');
    return e as Envelope;
  }

  async receive(rawBody: Buffer | undefined, signature: string | undefined) {
    this.verifySignature(rawBody, signature);
    const env = this.parse(rawBody!);

    const existing = await this.prisma.integrationMessage.findUnique({ where: { direction_eventId: { direction: 'INBOUND', eventId: env.event_id } } });
    if (existing && existing.status !== 'FAILED') return { status: 'duplicate', event_id: env.event_id };

    const message =
      existing ??
      (await this.createInbox(env).catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // corrida: outra entrega simultânea
        throw e;
      }));
    if (!message) return { status: 'duplicate', event_id: env.event_id };

    try {
      const outcome = await this.prisma.$transaction((tx) => this.handle(tx, env));
      const ignored = outcome === 'ignored';
      await this.prisma.integrationMessage.update({
        where: { id: message.id },
        // lastError guarda a nota do processamento: evento fora de ordem ou o motivo de um evento ignorado.
        data: { status: ignored ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 }, lastError: outcome === 'out_of_order' ? 'out_of_order' : ignored ? ignoredReason(env.event_type, env.payload) : null },
      });
      return { status: ignored ? 'ignored' : 'processed', event_id: env.event_id };
    } catch (err) {
      this.logger.error(`Falha ao processar ${env.event_type} ${env.event_id}: ${(err as Error).message}`);
      await this.prisma.integrationMessage.update({ where: { id: message.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) } });
      throw err; // 5xx: o Axis reentrega e o evento é reprocessado
    }
  }

  private createInbox(env: Envelope) {
    return this.prisma.integrationMessage.create({
      data: { direction: 'INBOUND', eventId: env.event_id, eventType: env.event_type, occurredAt: new Date(env.occurred_at), payload: env.payload as Prisma.InputJsonValue, status: 'RECEIVED' },
    });
  }

  private async handle(tx: Prisma.TransactionClient, env: Envelope): Promise<'processed' | 'ignored' | 'out_of_order'> {
    const p = env.payload;
    const str = (k: string) => (typeof p[k] === 'string' && (p[k] as string).length > 0 ? (p[k] as string) : undefined);
    const [family, action] = env.event_type.split('.');
    const occurredAt = new Date(env.occurred_at);

    let master: Master | null = null;
    switch (family) {
      case 'user': {
        // Contrato V1 (mapa §6): user_id, email, name (colaborador ou e-mail), status active|disabled, active, collaborator_id, roles.
        if (!str('user_id')) throw new BadRequestException('user_id ausente.');
        const active = action === 'disabled' ? false : activeFrom(p, str('status') ? str('status') !== 'disabled' : true);
        master = { kind: 'USER', axisId: str('user_id')!, name: str('name') ?? str('email'), active, data: p };
        break;
      }
      case 'collaborator': {
        // `active` do payload; senão `status` (desligado = inativo). Sem nenhum dos dois (ex.: cost_center_changed), mantém o que havia.
        if (!str('collaborator_id')) throw new BadRequestException('collaborator_id ausente.');
        const byStatus = str('status') ? str('status') !== 'desligado' : undefined;
        const active = action === 'offboarded' ? false : activeFrom(p, byStatus);
        master = { kind: 'COLLABORATOR', axisId: str('collaborator_id')!, name: str('name'), active, data: p };
        break;
      }
      case 'client':
        if (!str('client_id')) throw new BadRequestException('client_id ausente.');
        master = { kind: 'CLIENT', axisId: str('client_id')!, code: typeof p['code'] === 'number' || typeof p['code'] === 'string' ? String(p['code']) : undefined, name: str('name') ?? str('legal_name') ?? str('trade_name'), active: activeFrom(p, undefined), data: p };
        break;
      case 'project':
        if (!str('project_id')) throw new BadRequestException('project_id ausente.');
        master = { kind: 'PROJECT', axisId: str('project_id')!, code: str('code'), name: str('name'), active: activeFrom(p, str('status') ? !INACTIVE_PROJECT_STATUS.includes(str('status')!) : undefined), data: p };
        break;
      case 'cost_center':
        // Cadastro de centro de custo (cache): a ordem de atendimento o valida sem bloquear (PT-04).
        if (!str('cost_center_id')) throw new BadRequestException('cost_center_id ausente.');
        master = { kind: 'COST_CENTER', axisId: str('cost_center_id')!, code: str('code'), name: str('name'), active: activeFrom(p, undefined), data: p };
        break;
      case 'site': {
        // Site (obra/endereço de entrega) do Core: destino das ordens de envio de material (PT-04).
        const siteId = str('site_id');
        if (!siteId) throw new BadRequestException('site_id ausente.');
        master = { kind: 'SITE', axisId: siteId, code: str('code') ?? str('site_code'), name: str('name'), active: activeFrom(p, undefined), data: p };
        break;
      }
      case 'purchase_order':
        // Pedido aprovado/alterado no Axis (9.9): registra previsão e evita nova sugestão equivalente.
        if (action !== 'approved' && action !== 'changed') return 'ignored';
        await this.replenishment.registerPurchase(tx, p);
        return 'processed';
      case 'purchase': {
        // Compras do Core (purchase.approved / order_registered): só entram na reposição quando destinadas a um almoxarifado.
        const mapped = adaptCorePurchase(env.event_type, p);
        if (mapped.kind === 'ignored') return 'ignored'; // motivo gravado em lastError (ignoredReason)
        await this.replenishment.registerPurchase(tx, mapped.payload);
        return 'processed';
      }
      default: {
        if (IGNORED_FAMILIES.includes(family)) return 'ignored';
        // Adaptador 0.4: ticket.status_changed (legado) / material_request.* → evento de domínio.
        const domain = adaptMaterialRequestEvent(env.event_type, p);
        if (!domain) return 'ignored'; // ping e eventos que Logística ainda não consome
        const actor = { userId: 'axis-integration' };
        if (domain.kind === 'approved') await this.fulfillment.createFromRequest(tx, domain.order, actor, env.event_id);
        else await this.fulfillment.cancelByAxisRequest(tx, domain.axisRequestId, domain.reason);
        return 'processed';
      }
    }
    return (await this.upsertMaster(tx, master, occurredAt)) ? 'processed' : 'out_of_order';
  }

  /** Aplica só se o evento for mais novo que o já guardado (12.4); mescla campos parciais. Retorna false se descartado. */
  async upsertMaster(tx: Prisma.TransactionClient | PrismaService, m: Master, occurredAt: Date): Promise<boolean> {
    const current = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: m.kind, axisId: m.axisId } } });
    if (current && current.sourceOccurredAt > occurredAt) return false;
    const data = { ...(current?.data as Record<string, unknown> | undefined), ...m.data } as Prisma.InputJsonObject;
    const fields = { code: m.code ?? current?.code ?? null, name: m.name ?? current?.name ?? null, active: m.active ?? current?.active ?? true, data, sourceOccurredAt: occurredAt, syncedAt: new Date() };
    await tx.axisMasterCache.upsert({ where: { kind_axisId: { kind: m.kind, axisId: m.axisId } }, create: { kind: m.kind, axisId: m.axisId, ...fields }, update: fields });
    return true;
  }
}
