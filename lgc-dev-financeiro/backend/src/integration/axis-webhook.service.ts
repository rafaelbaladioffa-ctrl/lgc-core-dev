import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export interface Envelope {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface MasterRecord {
  kind: 'USER' | 'COLLABORATOR' | 'CLIENT' | 'PROJECT' | 'COST_CENTER';
  axisId: string;
  code?: string;
  name?: string;
  active?: boolean;
  data: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLOCK_SKEW_MS = 5 * 60_000;
/** Projeto encerrado deixa de aceitar novo rateio (ProjectStatus do Core). */
const INACTIVE_PROJECT_STATUS = ['encerrado'];

/**
 * Traduz um evento do Core em registro do cache de mestres. `null` = evento que o Financeiro não guarda
 * no cache (ex.: request.*, que serão tratados pelos módulos de domínio a partir da F4).
 */
export function toMasterRecord(env: Envelope): MasterRecord | null {
  const p = env.payload;
  const str = (k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : undefined);
  const required = (k: string) => {
    const v = str(k);
    if (!v) throw new BadRequestException(`${k} ausente.`);
    return v;
  };
  const [family, action] = env.event_type.split('.');
  switch (family) {
    case 'user':
      return { kind: 'USER', axisId: required('user_id'), name: str('email'), active: action !== 'disabled', data: p };
    case 'collaborator':
      return { kind: 'COLLABORATOR', axisId: required('collaborator_id'), name: str('name'), active: action === 'offboarded' ? false : undefined, data: p };
    case 'client':
      // O código do cliente no Core é numérico.
      return { kind: 'CLIENT', axisId: required('client_id'), code: typeof p['code'] === 'number' ? String(p['code']) : str('code'), name: str('name'), data: p };
    case 'project': {
      const status = str('status');
      return { kind: 'PROJECT', axisId: required('project_id'), code: str('code'), name: str('name'), active: status ? !INACTIVE_PROJECT_STATUS.includes(status) : undefined, data: p };
    }
    case 'cost_center':
      return { kind: 'COST_CENTER', axisId: required('cost_center_id'), code: str('code'), name: str('name'), active: typeof p['active'] === 'boolean' ? (p['active'] as boolean) : undefined, data: p };
    default:
      return null;
  }
}

/**
 * Receptor do webhook do Core (especificação §2.3):
 *  - assinatura HMAC-SHA256 do corpo bruto (`X-Axis-Signature: sha256=<hex>`), comparação em tempo constante;
 *  - anti-replay: janela de `occurred_at` + idempotência por `event_id`;
 *  - evento fora de ordem não sobrescreve versão mais nova do cache;
 *  - falha de processamento fica registrada e é reprocessada quando o Core reentregar.
 */
@Injectable()
export class AxisWebhookService {
  private readonly logger = new Logger(AxisWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  verifySignature(rawBody: Buffer | undefined, header: string | undefined) {
    const secret = this.config.get<string>('AXIS_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('Webhook do Axis não configurado (AXIS_WEBHOOK_SECRET).');
    if (!rawBody || !header?.startsWith('sha256=')) throw new UnauthorizedException('Assinatura ausente ou inválida.');
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'utf8');
    const received = Buffer.from(header.slice('sha256='.length), 'utf8');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new UnauthorizedException('Assinatura ausente ou inválida.');
  }

  parse(rawBody: Buffer, now = Date.now()): Envelope {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Corpo do evento não é um JSON válido.');
    }
    const e = (body ?? {}) as Partial<Envelope>;
    if (typeof e.event_id !== 'string' || !UUID.test(e.event_id)) throw new BadRequestException('event_id ausente ou inválido.');
    if (typeof e.event_type !== 'string' || e.event_type.length === 0 || e.event_type.length > 100) throw new BadRequestException('event_type ausente ou inválido.');
    if (typeof e.occurred_at !== 'string' || Number.isNaN(Date.parse(e.occurred_at))) throw new BadRequestException('occurred_at ausente ou inválido.');
    if (!e.payload || typeof e.payload !== 'object' || Array.isArray(e.payload)) throw new BadRequestException('payload ausente ou inválido.');

    const occurred = Date.parse(e.occurred_at);
    // O Core reentrega com espera de até ~2 h; além da janela é replay. Configuração inválida nunca desliga a janela.
    const configured = Number(this.config.get('WEBHOOK_MAX_AGE_HOURS') ?? 72);
    const maxAgeMs = (Number.isFinite(configured) && configured > 0 ? configured : 72) * 3_600_000;
    if (now - occurred > maxAgeMs) throw new BadRequestException('Evento fora da janela de validade (possível replay).');
    if (occurred - now > CLOCK_SKEW_MS) throw new BadRequestException('occurred_at no futuro.');
    return e as Envelope;
  }

  async receive(rawBody: Buffer | undefined, signature: string | undefined) {
    this.verifySignature(rawBody, signature);
    const env = this.parse(rawBody!);

    const existing = await this.prisma.integrationMessage.findUnique({ where: { direction_eventId: { direction: 'INBOUND', eventId: env.event_id } } });
    if (existing && existing.status !== 'FAILED') return { status: 'duplicate', event_id: env.event_id };

    const message =
      existing ??
      (await this.prisma.integrationMessage
        .create({
          data: { direction: 'INBOUND', eventId: env.event_id, eventType: env.event_type, occurredAt: new Date(env.occurred_at), payload: env.payload as Prisma.InputJsonValue, status: 'RECEIVED' },
        })
        .catch((e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null; // entrega simultânea do mesmo evento
          throw e;
        }));
    if (!message) return { status: 'duplicate', event_id: env.event_id };

    try {
      const outcome = await this.prisma.$transaction((tx) => this.handle(tx, env));
      await this.prisma.integrationMessage.update({
        where: { id: message.id },
        data: { status: outcome === 'ignored' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 }, lastError: outcome === 'out_of_order' ? 'out_of_order' : null },
      });
      return { status: outcome === 'ignored' ? 'ignored' : 'processed', event_id: env.event_id };
    } catch (err) {
      this.logger.error(`Falha ao processar ${env.event_type} ${env.event_id}: ${(err as Error).message}`);
      await this.prisma.integrationMessage.update({ where: { id: message.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) } });
      throw err; // 4xx/5xx: o Core reentrega e o evento é reprocessado
    }
  }

  private async handle(tx: Prisma.TransactionClient, env: Envelope): Promise<'processed' | 'ignored' | 'out_of_order'> {
    const master = toMasterRecord(env);
    if (!master) return 'ignored';
    return (await this.upsertMaster(tx, master, new Date(env.occurred_at))) ? 'processed' : 'out_of_order';
  }

  /** Aplica só se o evento for mais novo que o guardado; mescla campos parciais. Devolve false se descartado. */
  async upsertMaster(tx: Prisma.TransactionClient, m: MasterRecord, occurredAt: Date): Promise<boolean> {
    const current = await tx.axisMasterCache.findUnique({ where: { kind_axisId: { kind: m.kind, axisId: m.axisId } } });
    if (current && current.sourceOccurredAt > occurredAt) return false;
    const data = { ...(current?.data as Record<string, unknown> | undefined), ...m.data } as Prisma.InputJsonObject;
    const fields = {
      code: m.code ?? current?.code ?? null,
      name: m.name ?? current?.name ?? null,
      active: m.active ?? current?.active ?? true,
      data,
      sourceOccurredAt: occurredAt,
      syncedAt: new Date(),
    };
    await tx.axisMasterCache.upsert({ where: { kind_axisId: { kind: m.kind, axisId: m.axisId } }, create: { kind: m.kind, axisId: m.axisId, ...fields }, update: fields });
    return true;
  }
}
