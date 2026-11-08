import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { OutboxService } from '../../integration/outbox.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import { BudgetsService } from '../budgets.service.js';
import type { BudgetInputs, BudgetResult } from '../budget-engine.js';
import { buildBidPlan, DEFAULT_ROLE_CODES, type BidHeaderProfile, type CableLineProfile } from './bid-plan.js';
import { fillBid } from './bid-fill.js';
import { XlsxEditor } from './xlsx-editor.js';
import { buildCoreQuoteBody, CORE_QUOTE_EVENT, type CoreQuoteMessage } from './core-quote.js';

export interface BidProfile {
  header: BidHeaderProfile;
  cables: Record<string, CableLineProfile>;
  roles: Record<string, string>;
}

export interface BidTemplateLine {
  row: number;
  code: string;
  description: string;
  category: string;
  subcategory: string;
  supplier: string | null;
  free: boolean;
}

/** Hoje em São Paulo (`AAAA-MM-DD`), a data de envio da proposta. */
export const todaySaoPaulo = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/**
 * Bid preenchida e devolução ao Core (PJ7, projetos-especificacao §7.4 e §13.1).
 * Aprovar o envio de uma revisão aws_sow passa por aqui: a Bid é gerada antes, e a gravação da Bid e da
 * mensagem do outbox entram na mesma transação da aprovação.
 */
@Injectable()
export class BidService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly budgets: BudgetsService,
  ) {}

  // -------------------------------------------------------------------------
  // Perfil
  // -------------------------------------------------------------------------

  async profile(): Promise<BidProfile> {
    const rows = await this.prisma.bidProfileEntry.findMany();
    const header = (rows.find((r) => r.kind === 'header' && r.key === 'vendor')?.value ?? {}) as Partial<BidHeaderProfile>;
    return {
      header: { vendorName: header.vendorName ?? null, pocName: header.pocName ?? null, pocEmail: header.pocEmail ?? null, leadTimeDays: header.leadTimeDays ?? 0 },
      cables: Object.fromEntries(rows.filter((r) => r.kind === 'cable').map((r) => [r.key, r.value as unknown as CableLineProfile])),
      roles: { ...DEFAULT_ROLE_CODES, ...Object.fromEntries(rows.filter((r) => r.kind === 'role').map((r) => [r.key, (r.value as { code: string }).code])) },
    };
  }

  /** Atualiza o que vier: cabeçalho, linhas de cabo e de função (`null` remove o mapeamento). */
  async updateProfile(
    dto: { header?: Partial<BidHeaderProfile>; cables?: Record<string, CableLineProfile | null>; roles?: Record<string, string | null> },
    user: AuthenticatedUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const put = (kind: string, key: string, value: Prisma.InputJsonValue) =>
        tx.bidProfileEntry.upsert({ where: { kind_key: { kind, key } }, create: { kind, key, value, updatedBy: user.userId }, update: { value, updatedBy: user.userId } });
      const del = (kind: string, key: string) => tx.bidProfileEntry.deleteMany({ where: { kind, key } });
      if (dto.header) {
        const current = (await tx.bidProfileEntry.findUnique({ where: { kind_key: { kind: 'header', key: 'vendor' } } }))?.value as Partial<BidHeaderProfile> | undefined;
        await put('header', 'vendor', { ...current, ...dto.header } as Prisma.InputJsonValue);
      }
      for (const [type, value] of Object.entries(dto.cables ?? {})) {
        if (value === null) await del('cable', type);
        else await put('cable', type, value as unknown as Prisma.InputJsonValue);
      }
      for (const [roleKey, code] of Object.entries(dto.roles ?? {})) {
        if (code === null) await del('role', roleKey);
        else await put('role', roleKey, { code });
      }
      await this.audit.record(user.userId, 'bid_profile.updated', 'bid_profile', 'aws', { header: !!dto.header, cables: Object.keys(dto.cables ?? {}), roles: Object.keys(dto.roles ?? {}) }, tx);
    });
    return this.profile();
  }

  // -------------------------------------------------------------------------
  // Linhas do modelo e plano
  // -------------------------------------------------------------------------

  private async template(revisionId: string): Promise<Buffer> {
    const row = await this.prisma.revisionBidTemplate.findUnique({ where: { revisionId }, select: { content: true } });
    if (!row) throw new BadRequestException('Importe o Bid Template do cliente nesta revisão.');
    return Buffer.from(row.content);
  }

  /** Linhas da aba Item Selection para escolher no mapeamento (cabos e mão de obra). */
  async templateLines(revisionId: string): Promise<BidTemplateLine[]> {
    const editor = await XlsxEditor.load(await this.template(revisionId));
    const rows = await editor.findRows('Item Selection', 'C', (v) => v.trim() !== '' && v !== 'AWS Part Number');
    const out: BidTemplateLine[] = [];
    for (const row of rows) {
      const category = (await editor.value('Item Selection', `Z${row}`)) ?? '';
      if (!category) continue;
      const code = ((await editor.value('Item Selection', `C${row}`)) ?? '').trim();
      const supplier = await editor.cell('Item Selection', `D${row}`);
      out.push({
        row,
        code,
        description: (await editor.value('Item Selection', `A${row}`)) ?? '',
        category,
        subcategory: (await editor.value('Item Selection', `AA${row}`)) ?? '',
        supplier: supplier && !supplier.f ? supplier.v : null,
        free: code.startsWith('free_'),
      });
    }
    return out;
  }

  /** Plano da Bid da revisão com o perfil atual; `blockers` explica o que falta. */
  async plan(revisionId: string, user: AuthenticatedUser, submissionDate = todaySaoPaulo()) {
    const rev = await this.budgets.loadRevisionFull(revisionId);
    if (rev.budget.model !== 'aws_sow') throw new BadRequestException('Só o modelo aws_sow gera Bid.');
    const project = await this.budgets.projectInfoOrNull(rev.budget.axisProjectId);
    const aws = this.budgets.awsInfo(rev, project);
    if (!aws?.quote) return { rev, project, aws, plan: null, blockers: aws?.blockers.length ? aws.blockers : ['A cotação AWS ainda não pode ser calculada.'], unmappedCables: [], unmappedRoles: [] };
    const result = rev.result as unknown as BudgetResult;
    const ids = result.materials.map((m) => m.materialId).filter((x): x is string => !!x);
    const catalog = new Map(
      (await this.prisma.budgetMaterial.findMany({ where: { id: { in: ids } }, select: { id: true, clientRef: true, manufacturer: true, partNumber: true, name: true, unit: true } })).map((m) => [m.id, m]),
    );
    const out = buildBidPlan({
      projectCode: rev.budget.projectCode,
      submissionDate,
      quote: aws.quote,
      hoursPerDay: rev.parameterSet.hoursPerDay ? Number(rev.parameterSet.hoursPerDay) : null,
      result,
      inputs: rev.inputs as unknown as BudgetInputs,
      catalog,
      profile: await this.profile(),
    });
    void user;
    return { rev, project, aws, ...out };
  }

  /** Prévia da Bid (rascunho ou em aprovação), sem gravar. */
  async preview(revisionId: string, user: AuthenticatedUser) {
    const { rev, plan, blockers } = await this.plan(revisionId, user);
    if (!plan) throw new BadRequestException(`Ainda não dá para gerar a Bid: ${blockers.join(' ')}`);
    return fillBid(await this.template(revisionId), plan, rev.number);
  }

  /** Bid gerada na aprovação do envio (a que foi para o Core). */
  async output(revisionId: string) {
    const row = await this.prisma.revisionBidOutput.findUnique({ where: { revisionId }, select: { filename: true, content: true, contentHash: true } });
    if (!row) throw new NotFoundException('Esta revisão ainda não tem Bid gerada.');
    return row;
  }

  // -------------------------------------------------------------------------
  // Aprovar envio
  // -------------------------------------------------------------------------

  /**
   * Aprovar o envio. No modelo aws_sow gera a Bid antes (falha aqui = revisão continua em aprovação, com o
   * motivo) e, na mesma transação da aprovação, grava a Bid e a mensagem do outbox para o Core.
   */
  async approveSend(revisionId: string, user: AuthenticatedUser) {
    const head = await this.prisma.budgetRevision.findUnique({ where: { id: revisionId }, select: { status: true, budget: { select: { model: true } } } });
    if (!head) throw new NotFoundException('Revisão de orçamento não encontrada.');
    if (head.budget.model !== 'aws_sow') return this.budgets.transition(revisionId, 'approve_send', user);
    if (head.status !== 'em_aprovacao') throw new ConflictException('Só uma revisão em aprovação pode ter o envio aprovado.');

    const { rev, project, plan, blockers } = await this.plan(revisionId, user);
    if (!plan) throw new BadRequestException(`Não dá para aprovar o envio: ${blockers.join(' ')}`);
    const bid = await fillBid(await this.template(revisionId), plan, rev.number);
    const result = rev.result as unknown as BudgetResult;
    const header = this.budgets.header(rev.budget, project);
    const sowDocumentId = rev.sow?.source === 'core_pdf' ? rev.sow.sowDocumentId : null;

    return this.budgets.transition(revisionId, 'approve_send', user, null, async (tx, approvedAt) => {
      await tx.revisionBidOutput.create({
        data: {
          revisionId,
          filename: bid.filename,
          content: bid.content,
          contentHash: createHash('sha256').update(bid.content).digest('hex'),
          writes: bid.writes as unknown as Prisma.InputJsonValue,
          generatedBy: user.userId,
        },
      });
      const message: CoreQuoteMessage = {
        axis_project_id: rev.budget.axisProjectId,
        revision_id: revisionId,
        quote: buildCoreQuoteBody({
          revisionId,
          revisionNumber: rev.number,
          approvedAt,
          approvedByEmail: user.email,
          sowDocumentId,
          schedule: { start: header.schedule.start.value, end: header.schedule.end.value },
          result,
        }),
      };
      await this.outbox.record(tx, CORE_QUOTE_EVENT, message as unknown as Record<string, unknown>);
      return { bidFilename: bid.filename };
    });
  }
}
