import { BadRequestException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from './outbox.service.js';
import { handleCcEvent, isCcEvent } from '../cost-centers/cc-events.js';
import { refreshBudgetStatus } from '../cost-centers/cc-budget-status.js';
import { todaySaoPaulo } from '../cost-centers/cc-engine.js';
import { winRevisionFromCore, type ProjectApproval } from '../budgets/revision-won.js';
import { UnprocessableEventError } from './unprocessable-event.error.js';
import { missingFromCache, type MasterKind } from './master-cache.js';

export interface Envelope {
  event_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
}

export interface MasterRecord {
  kind: MasterKind;
  axisId: string;
  code?: string;
  name?: string;
  active?: boolean;
  data: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_SKEW_MS = 5 * 60_000;
/** Projeto encerrado deixa de aceitar novo rateio (ProjectStatus do Core). */
const INACTIVE_PROJECT_STATUS = ['encerrado'];

/**
 * Traduz um evento do Core em registro do cache de mestres. `null` = evento que o Financeiro não guarda
 * no cache (ex.: request.*, que serão tratados pelos módulos de domínio a partir da F4).
 *
 * Contrato V1 do Core (mapa-interoperabilidade §6): todo evento de cadastro leva o estado completo, `name` e
 * `active`. Evento antigo sem `active` cai na regra de antes (ação `disabled`/`offboarded`/`deleted`, status).
 */
export function toMasterRecord(env: Envelope): MasterRecord | null {
  const p = env.payload;
  const str = (k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : undefined);
  const bool = (k: string) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : undefined);
  const required = (k: string) => {
    const v = str(k);
    if (!v) throw new BadRequestException(`${k} ausente.`);
    return v;
  };
  const [family, action] = env.event_type.split('.');
  switch (family) {
    case 'user': {
      // user.disabled sempre bloqueia; nos demais vale `active` e, sem ele, `status` (`active`/`disabled`).
      const status = str('status');
      const active = action === 'disabled' ? false : (bool('active') ?? (status ? status !== 'disabled' : true));
      return { kind: 'USER', axisId: required('user_id'), code: str('email'), name: str('name') ?? str('email'), active, data: p };
    }
    case 'collaborator': {
      // F6: desligado = inativo também no `updated` (não só no `offboarded`).
      const status = str('status');
      const active = action === 'offboarded' ? false : (bool('active') ?? (status ? status !== 'desligado' : undefined));
      return { kind: 'COLLABORATOR', axisId: required('collaborator_id'), code: str('matricula'), name: str('name'), active, data: p };
    }
    case 'client':
      // O código do cliente no Core é numérico; `name` é a razão social (evento antigo só tinha `legal_name` ou nada).
      return {
        kind: 'CLIENT',
        axisId: required('client_id'),
        code: typeof p['code'] === 'number' ? String(p['code']) : str('code'),
        name: str('name') ?? str('legal_name'),
        active: action === 'deleted' ? false : bool('active'),
        data: p,
      };
    case 'project': {
      const status = str('status');
      return { kind: 'PROJECT', axisId: required('project_id'), code: str('code'), name: str('name'), active: status ? !INACTIVE_PROJECT_STATUS.includes(status) : undefined, data: p };
    }
    case 'cost_center':
      return { kind: 'COST_CENTER', axisId: required('cost_center_id'), code: str('code'), name: str('name'), active: bool('active'), data: p };
    case 'site':
      return { kind: 'SITE', axisId: required('site_id'), code: str('code'), name: str('name'), active: bool('active'), data: p };
    case 'job_title':
      return { kind: 'JOB_TITLE', axisId: required('job_title_id'), name: str('name'), active: action === 'deleted' ? false : (bool('active') ?? true), data: p };
    case 'holiday': {
      // A data do feriado vai em `code` (`AAAA-MM-DD`): é por ela que o cálculo de dias úteis procura.
      const date = required('date').slice(0, 10);
      if (!DATE_ONLY.test(date)) throw new BadRequestException('date inválida no feriado (use AAAA-MM-DD).');
      return { kind: 'HOLIDAY', axisId: required('holiday_id'), code: date, name: str('name'), active: action === 'deleted' ? false : (bool('active') ?? true), data: p };
    }
    default:
      return null;
  }
}

/** Chaves do estado do projeto em `project.*` (cadastros §10 do Core); o resto do payload não vai para o cache. */
const PROJECT_STATE_KEYS = [
  'project_id',
  'code',
  'name',
  'status',
  'client_id',
  'cost_center_id',
  'cost_center_code',
  'cost_center_name',
  'site_id',
  'site_code',
  'site_name',
  'responsible_collaborator_id',
  'planned_start_date',
  'planned_end_date',
];

/**
 * F5: ids do Core citados por compra, reembolso, adiantamento ou alocação que o cache ainda não conhece. O
 * lançamento é gravado assim mesmo (dado financeiro não se perde); o aviso fica no inbox e no log, e some quando o
 * cadastro chegar (o cache é por id). Ex.: centro de custo criado no Core antes de o Financeiro assinar `cost_center.*`.
 */
export async function unknownReferences(tx: Pick<Prisma.TransactionClient, 'axisMasterCache'>, p: Record<string, unknown>): Promise<string[]> {
  const id = (k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : null);
  const checks: Array<[MasterKind, string | null, string]> = [
    ['COST_CENTER', id('cost_center_id'), 'centro de custo'],
    ['PROJECT', id('project_id'), 'projeto'],
  ];
  const out: string[] = [];
  for (const [kind, value, label] of checks) {
    if (value && (await missingFromCache(tx, kind, [value])).length > 0) out.push(`${label} ${value} não está no cache do Core.`);
  }
  return out;
}

/** Pedido de cotação do Core (integracao-core-financeiro §4) → linha da fila do orçamentista. */
export function toQuoteRequest(env: Envelope) {
  const p = env.payload;
  const str = (k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : null);
  const int = (k: string) => (typeof p[k] === 'number' && Number.isInteger(p[k]) ? (p[k] as number) : null);
  const required = <T>(k: string, v: T | null): T => {
    if (v === null) throw new BadRequestException(`${k} ausente no pedido de cotação.`);
    return v;
  };
  const requestedAt = str('requested_at');
  return {
    axisQuoteRequestId: required('quote_request_id', str('quote_request_id')),
    axisProjectId: required('project_id', str('project_id')),
    projectCode: required('code', str('code')),
    sowDocumentId: required('sow_document_id', str('sow_document_id')),
    sowVersion: required('sow_version', int('sow_version')),
    sowFilename: str('sow_filename') ?? 'SOW',
    sowContentHash: required('sow_content_hash', str('sow_content_hash')),
    bidTemplateDocumentId: str('bid_template_document_id'),
    bidTemplateVersion: int('bid_template_version'),
    bidTemplateFilename: str('bid_template_filename'),
    bidTemplateContentHash: str('bid_template_content_hash'),
    notes: str('notes'),
    requestedByEmail: str('requested_by_email'),
    requestedAt: requestedAt && !Number.isNaN(Date.parse(requestedAt)) ? new Date(requestedAt) : new Date(env.occurred_at),
    eventId: env.event_id,
  };
}

/**
 * Aprovação do projeto no Core (plano ponta a ponta §4.2) → revisão aceita. Só o que o Financeiro usa:
 * o projeto (`project_id`, `cost_center_id`), a revisão (`accepted_quote.external_revision_id`), o instante da
 * aprovação e o PO. Campo que falta vira erro legível no evento (`UnprocessableEventError`), não 400.
 */
export function toProjectApproval(env: Envelope): ProjectApproval {
  const p = env.payload;
  const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' && o[k] !== '' ? (o[k] as string) : null);
  const projectAxisId = str(p, 'project_id');
  if (!projectAxisId) throw new UnprocessableEventError('project.approved sem project_id.');
  const quote = p['accepted_quote'];
  const revisionId = quote && typeof quote === 'object' && !Array.isArray(quote) ? str(quote as Record<string, unknown>, 'external_revision_id') : null;
  if (!revisionId) throw new UnprocessableEventError('project.approved sem accepted_quote.external_revision_id: não dá para saber qual revisão o cliente aceitou.');
  const approvedAt = str(p, 'approved_at');
  return {
    projectAxisId,
    revisionId,
    approvedAt: new Date(approvedAt && !Number.isNaN(Date.parse(approvedAt)) ? approvedAt : env.occurred_at),
    costCenterAxisId: str(p, 'cost_center_id'),
    clientPoNumber: str(p, 'client_po_number'),
    eventId: env.event_id,
  };
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
    private readonly outbox: OutboxService = new OutboxService(),
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
      const warnings: string[] = [];
      const outcome = await this.prisma.$transaction((tx) => this.handle(tx, env, warnings));
      // Aviso (F5): o evento foi aplicado, mas citou id que o cache não conhece. Fica no inbox e no log.
      const warning = warnings.length ? `aviso: ${warnings.join(' ')}`.slice(0, 500) : null;
      if (warning) this.logger.warn(`Evento ${env.event_type} ${env.event_id} aplicado com ${warning}`);
      await this.prisma.integrationMessage.update({
        where: { id: message.id },
        data: { status: outcome === 'ignored' ? 'IGNORED' : 'PROCESSED', processedAt: new Date(), attempts: { increment: 1 }, lastError: outcome === 'out_of_order' ? 'out_of_order' : warning },
      });
      return { status: outcome === 'ignored' ? 'ignored' : 'processed', event_id: env.event_id, ...(warning ? { warning } : {}) };
    } catch (err) {
      if (err instanceof UnprocessableEventError) {
        // Nada a reentregar: a transação foi desfeita, o evento fica FAILED com a causa legível e o Core recebe 200.
        this.logger.warn(`Evento ${env.event_type} ${env.event_id} não aplicado: ${err.message}`);
        await this.prisma.integrationMessage.update({ where: { id: message.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: err.message.slice(0, 500) } });
        return { status: 'failed', event_id: env.event_id, error: err.message };
      }
      this.logger.error(`Falha ao processar ${env.event_type} ${env.event_id}: ${(err as Error).message}`);
      await this.prisma.integrationMessage.update({ where: { id: message.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) } });
      throw err; // 4xx/5xx: o Core reentrega e o evento é reprocessado
    }
  }

  private async handle(tx: Prisma.TransactionClient, env: Envelope, warnings: string[] = []): Promise<'processed' | 'ignored' | 'out_of_order'> {
    // Documento novo: o Financeiro baixa quando precisa (pelo pedido de cotação); não é estado do projeto.
    if (env.event_type === 'project.document_added') return 'ignored';
    if (env.event_type === 'project.quote_requested') return this.handleQuoteRequested(tx, env);
    if (env.event_type === 'project.approved') return this.handleProjectApproved(tx, env);
    if (isCcEvent(env.event_type)) return this.handleCostCenterEvent(tx, env, warnings);
    const master = toMasterRecord(env);
    if (!master) return 'ignored';
    if (!(await this.upsertMaster(tx, master, new Date(env.occurred_at)))) return 'out_of_order';
    // F2: o mapa cargo → função mostra o nome do cargo do Core; renomear no Core renomeia aqui.
    if (master.kind === 'JOB_TITLE' && master.name) await tx.jobTitleRoleMap.updateMany({ where: { axisJobTitleId: master.axisId, jobTitleName: { not: master.name } }, data: { jobTitleName: master.name } });
    return 'processed';
  }

  /**
   * Pedido de cotação: atualiza o projeto no cache (o evento traz o estado completo) e põe o pedido na fila.
   * Reentrega do mesmo pedido não duplica (único por `axis_quote_request_id`).
   */
  private async handleQuoteRequested(tx: Prisma.TransactionClient, env: Envelope): Promise<'processed'> {
    const request = toQuoteRequest(env);
    const state = Object.fromEntries(Object.entries(env.payload).filter(([k]) => PROJECT_STATE_KEYS.includes(k)));
    const master = toMasterRecord({ ...env, event_type: 'project.updated', payload: state });
    if (master) await this.upsertMaster(tx, master, new Date(env.occurred_at));
    await tx.quoteRequest.upsert({ where: { axisQuoteRequestId: request.axisQuoteRequestId }, create: request, update: {} });
    return 'processed';
  }

  /**
   * Projeto aprovado no Core: atualiza o projeto no cache (o evento traz o estado completo) e passa a revisão aceita
   * a `ganha`, com o comprometido no CC do projeto (`winRevisionFromCore`). Idempotente por `event_id` (inbox) e por
   * revisão (já ganha não muda nem lança de novo). Outra revisão já ganha no orçamento, ou revisão que não está
   * `enviada`, vira alerta no orçamento sem alterar nada; revisão que não existe volta como erro legível.
   */
  private async handleProjectApproved(tx: Prisma.TransactionClient, env: Envelope): Promise<'processed'> {
    const approval = toProjectApproval(env);
    const state = Object.fromEntries(Object.entries(env.payload).filter(([k]) => PROJECT_STATE_KEYS.includes(k)));
    const master = toMasterRecord({ ...env, event_type: 'project.updated', payload: state });
    if (master) await this.upsertMaster(tx, master, new Date(env.occurred_at));
    await winRevisionFromCore(tx, approval);
    return 'processed';
  }

  /**
   * Compras, reembolsos, adiantamentos e alocação (centros-de-custo-especificacao §2): viram lançamentos e
   * vigências; a alocação também atualiza o colaborador no cache. Depois, a faixa do orçamento do CC.
   */
  private async handleCostCenterEvent(tx: Prisma.TransactionClient, env: Envelope, warnings: string[] = []): Promise<'processed' | 'ignored'> {
    const outcome = await handleCcEvent(tx, env.event_type, env.event_id, env.occurred_at, env.payload);
    if (outcome === 'processed') warnings.push(...(await unknownReferences(tx, env.payload)));
    if (env.event_type === 'collaborator.cost_center_changed') {
      const master = toMasterRecord(env);
      if (master) await this.upsertMaster(tx, master, new Date(env.occurred_at));
      return outcome;
    }
    const cc = typeof env.payload['cost_center_id'] === 'string' ? (env.payload['cost_center_id'] as string) : null;
    if (outcome === 'processed' && cc) await refreshBudgetStatus(tx, this.outbox, cc, Number(todaySaoPaulo().slice(0, 4)));
    return outcome;
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
