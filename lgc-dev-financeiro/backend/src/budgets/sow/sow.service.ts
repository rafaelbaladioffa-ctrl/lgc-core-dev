import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, QuoteRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../audit/audit.service.js';
import type { AuthenticatedUser } from '../../auth/authenticated-request.js';
import { BudgetsService } from '../budgets.service.js';
import { CoreDocumentsClient } from './core-documents.client.js';
import { extractPdfText } from './pdf-text.js';
import { normalizeType, parseSow, summarizeTypes, totalsOf, type SowCableLine } from './sow-parser.js';
import { presentSow } from './sow-view.js';

export interface SowCableInput {
  type: string;
  lengthM: number;
  quantity: number;
  /** Só para tipo não reconhecido ("outro"); fibra e cobre vêm do próprio tipo. */
  fibers?: number;
}

export type QuoteRequestStatus = 'pendente' | 'em_cotacao' | 'respondida';

/** Pendente até alguém iniciar; respondida quando uma revisão teve o envio aprovado depois do pedido. */
export function quoteRequestStatus(request: Pick<QuoteRequest, 'budgetId' | 'requestedAt'>, approvals: Array<Date | null>): QuoteRequestStatus {
  if (!request.budgetId) return 'pendente';
  return approvals.some((a) => a && a >= request.requestedAt) ? 'respondida' : 'em_cotacao';
}

/** Linhas de cabo corrigidas à mão → mesmas regras do parser (tipo normalizado, soma por tipo e comprimento). */
export function normalizeCables(input: SowCableInput[]): SowCableLine[] {
  const map = new Map<string, SowCableLine>();
  for (const line of input) {
    const t = normalizeType(line.type);
    const fibers = t.kind === 'outro' ? Math.max(0, Math.trunc(line.fibers ?? 0)) : t.fibers;
    const key = `${t.type}|${line.lengthM}`;
    const cur = map.get(key);
    if (cur) cur.quantity += line.quantity;
    else map.set(key, { type: t.type, kind: t.kind, fibers, lengthM: line.lengthM, quantity: line.quantity });
  }
  return [...map.values()].sort((a, b) => a.type.localeCompare(b.type) || a.lengthM - b.lengthM);
}

/**
 * Fila de pedidos de cotação do Core e SOW da revisão (PJ4, projetos-especificacao §7.1 e §13.1).
 */
@Injectable()
export class SowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly budgets: BudgetsService,
    private readonly core: CoreDocumentsClient,
  ) {}

  // -------------------------------------------------------------------------
  // Fila
  // -------------------------------------------------------------------------

  async listQuoteRequests() {
    const requests = await this.prisma.quoteRequest.findMany({
      orderBy: { requestedAt: 'desc' },
      include: { budget: { include: { revisions: { select: { id: true, number: true, status: true, approvedAt: true }, orderBy: { number: 'desc' } } } } },
    });
    const projects = await this.prisma.axisMasterCache.findMany({ where: { kind: 'PROJECT', axisId: { in: [...new Set(requests.map((r) => r.axisProjectId))] } } });
    const byId = new Map(projects.map((p) => [p.axisId, p]));
    return requests.map((r) => {
      const draft = r.budget?.revisions.find((v) => v.status === 'rascunho');
      return {
        id: r.id,
        axisProjectId: r.axisProjectId,
        projectCode: r.projectCode,
        projectName: byId.get(r.axisProjectId)?.name ?? null,
        sowVersion: r.sowVersion,
        sowFilename: r.sowFilename,
        bidTemplateVersion: r.bidTemplateVersion,
        bidTemplateFilename: r.bidTemplateFilename,
        notes: r.notes,
        requestedByEmail: r.requestedByEmail,
        requestedAt: r.requestedAt,
        startedAt: r.startedAt,
        status: quoteRequestStatus(r, r.budget?.revisions.map((v) => v.approvedAt) ?? []),
        budgetId: r.budgetId,
        currentRevision: r.budget?.revisions[0] ? { id: r.budget.revisions[0].id, number: r.budget.revisions[0].number, status: r.budget.revisions[0].status } : null,
        draftRevisionId: draft?.id ?? null,
      };
    });
  }

  /**
   * "Iniciar cotação": usa o orçamento `aws_sow` do projeto (cria na primeira vez), abre o rascunho (ou uma
   * nova revisão) e importa a SOW do pedido. Se o download falhar, o rascunho fica pronto e a tela mostra o
   * erro para tentar de novo (ou colar o texto).
   */
  async startQuote(id: string, user: AuthenticatedUser) {
    const request = await this.prisma.quoteRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Pedido de cotação não encontrado.');
    const budget = await this.prisma.projectBudget.findUnique({
      where: { axisProjectId_model: { axisProjectId: request.axisProjectId, model: 'aws_sow' } },
      include: { revisions: { select: { id: true, status: true } } },
    });
    let revisionId: string;
    let budgetId: string;
    if (!budget) {
      const created = await this.budgets.createBudget({ axisProjectId: request.axisProjectId }, user, 'aws_sow');
      revisionId = created.revisionId;
      budgetId = created.budgetId;
    } else {
      budgetId = budget.id;
      revisionId = budget.revisions.find((r) => r.status === 'rascunho')?.id ?? (await this.budgets.newRevision(budget.id, user)).revisionId;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.quoteRequest.update({ where: { id }, data: { budgetId, ...(request.startedAt ? {} : { startedAt: new Date(), startedBy: user.userId }) } });
      await this.audit.record(user.userId, 'quote_request.started', 'quote_request', id, { project: request.projectCode, budgetId, revisionId }, tx);
    });
    try {
      await this.importFromCore(revisionId, { quoteRequestId: id }, user);
      return { revisionId, sowImported: true, sowError: null };
    } catch (e) {
      return { revisionId, sowImported: false, sowError: (e as Error).message };
    }
  }

  // -------------------------------------------------------------------------
  // SOW da revisão
  // -------------------------------------------------------------------------

  private async draftRevision(revisionId: string) {
    const rev = await this.prisma.budgetRevision.findUnique({ where: { id: revisionId }, include: { budget: true } });
    if (!rev) throw new NotFoundException('Revisão de orçamento não encontrada.');
    if (rev.status !== 'rascunho') throw new ConflictException(`A revisão R${rev.number} não está em rascunho; a SOW não pode mudar.`);
    return rev;
  }

  /** Baixa a SOW do pedido (o informado ou o mais recente do projeto), extrai o texto e lê. */
  async importFromCore(revisionId: string, opts: { quoteRequestId?: string | null }, user: AuthenticatedUser) {
    const rev = await this.draftRevision(revisionId);
    const request = opts.quoteRequestId
      ? await this.prisma.quoteRequest.findUnique({ where: { id: opts.quoteRequestId } })
      : await this.prisma.quoteRequest.findFirst({ where: { axisProjectId: rev.budget.axisProjectId }, orderBy: { requestedAt: 'desc' } });
    if (!request) throw new BadRequestException('Este projeto não tem pedido de cotação do Axis Core. Cole o texto da SOW.');
    if (request.axisProjectId !== rev.budget.axisProjectId) throw new BadRequestException('O pedido de cotação é de outro projeto.');
    const pdf = await this.core.download(request.axisProjectId, request.sowDocumentId, request.sowContentHash);
    const { text, pages } = await extractPdfText(pdf);
    if (!text.replace(/=== página \d+ ===/g, '').trim()) {
      throw new BadRequestException('O PDF da SOW não tem texto (provavelmente escaneado). Cole o texto da SOW.');
    }
    return this.save(revisionId, { source: 'core_pdf', text, pages, quoteRequestId: request.id, sowDocumentId: request.sowDocumentId, sowVersion: request.sowVersion }, user);
  }

  /** Alternativa ao PDF: o orçamentista cola o texto da SOW. */
  async importText(revisionId: string, text: string, user: AuthenticatedUser) {
    await this.draftRevision(revisionId);
    if (!text.trim()) throw new BadRequestException('Cole o texto da SOW.');
    return this.save(revisionId, { source: 'texto', text, pages: null, quoteRequestId: null, sowDocumentId: null, sowVersion: null }, user);
  }

  private async save(
    revisionId: string,
    src: { source: 'core_pdf' | 'texto'; text: string; pages: number | null; quoteRequestId: string | null; sowDocumentId: string | null; sowVersion: number | null },
    user: AuthenticatedUser,
  ) {
    const parsed = parseSow(src.text);
    const data = {
      quoteRequestId: src.quoteRequestId,
      source: src.source,
      sowDocumentId: src.sowDocumentId,
      sowVersion: src.sowVersion,
      pages: src.pages,
      rawText: src.text,
      header: parsed.header as unknown as Prisma.InputJsonValue,
      devices: parsed.devices as unknown as Prisma.InputJsonValue,
      parsedCables: parsed.cables as unknown as Prisma.InputJsonValue,
      cables: parsed.cables as unknown as Prisma.InputJsonValue,
      warnings: parsed.warnings as unknown as Prisma.InputJsonValue,
      importedAt: new Date(),
      importedBy: user.userId,
      updatedBy: user.userId,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetRevisionSow.upsert({ where: { revisionId }, create: { revisionId, ...data }, update: data });
      await this.audit.record(
        user.userId,
        'budget_revision.sow_imported',
        'budget_revision',
        revisionId,
        { source: src.source, sowVersion: src.sowVersion, cableSource: parsed.cableSource, totals: parsed.totals, devices: parsed.devices, warnings: parsed.warnings.length } as unknown as Prisma.InputJsonValue,
        tx,
      );
    });
    return this.get(revisionId);
  }

  /** Correção das linhas de cabo (a SOW original e o que o parser leu continuam guardados). */
  async updateCables(revisionId: string, cables: SowCableInput[], user: AuthenticatedUser) {
    await this.draftRevision(revisionId);
    const row = await this.prisma.budgetRevisionSow.findUnique({ where: { revisionId } });
    if (!row) throw new BadRequestException('Importe a SOW antes de corrigir os cabos.');
    const next = normalizeCables(cables);
    const before = totalsOf(summarizeTypes(row.cables as unknown as SowCableLine[]));
    const after = totalsOf(summarizeTypes(next));
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetRevisionSow.update({ where: { revisionId }, data: { cables: next as unknown as Prisma.InputJsonValue, updatedBy: user.userId } });
      await this.audit.record(user.userId, 'budget_revision.sow_cables_corrected', 'budget_revision', revisionId, { before, after, lines: next.length } as Prisma.InputJsonValue, tx);
    });
    return this.get(revisionId);
  }

  async get(revisionId: string) {
    return presentSow(await this.prisma.budgetRevisionSow.findUnique({ where: { revisionId } }));
  }

  /** Texto original da SOW (P-05: documento do cliente, só para quem orça). */
  async getText(revisionId: string, user: AuthenticatedUser) {
    const row = await this.prisma.budgetRevisionSow.findUnique({ where: { revisionId }, select: { rawText: true } });
    if (!row) throw new NotFoundException('Esta revisão não tem SOW importada.');
    await this.audit.record(user.userId, 'budget_revision.sow_text_read', 'budget_revision', revisionId);
    return { text: row.rawText };
  }
}
