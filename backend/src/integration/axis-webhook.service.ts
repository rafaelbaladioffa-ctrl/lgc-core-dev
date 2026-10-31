import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';

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
    const maxAgeMs = Number(this.config.get('WEBHOOK_MAX_AGE_HOURS') ?? 72) * 3_600_000;
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
      await this.prisma.integrationMessage.update({
        where: { id: message.id },
        data: { status: outcome === 'ignored' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 }, lastError: outcome === 'out_of_order' ? 'out_of_order' : null },
      });
      return { status: outcome === 'ignored' ? 'ignored' : 'processed', event_id: env.event_id };
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
    const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : undefined);
    const [family, action] = env.event_type.split('.');
    const occurredAt = new Date(env.occurred_at);

    let master: Master | null = null;
    switch (family) {
      case 'user':
        if (!str('user_id')) throw new BadRequestException('user_id ausente.');
        master = { kind: 'USER', axisId: str('user_id')!, name: str('email'), active: action !== 'disabled', data: p };
        break;
      case 'collaborator':
        if (!str('collaborator_id')) throw new BadRequestException('collaborator_id ausente.');
        master = { kind: 'COLLABORATOR', axisId: str('collaborator_id')!, name: str('name'), active: action !== 'offboarded', data: p };
        break;
      case 'client':
        if (!str('client_id')) throw new BadRequestException('client_id ausente.');
        master = { kind: 'CLIENT', axisId: str('client_id')!, code: p['code'] != null ? String(p['code']) : undefined, name: str('name'), data: p };
        break;
      case 'project':
        if (!str('project_id')) throw new BadRequestException('project_id ausente.');
        master = { kind: 'PROJECT', axisId: str('project_id')!, code: str('code'), name: str('name'), active: str('status') ? !INACTIVE_PROJECT_STATUS.includes(str('status')!) : undefined, data: p };
        break;
      default:
        return 'ignored'; // ping e eventos que Logística ainda não consome
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
