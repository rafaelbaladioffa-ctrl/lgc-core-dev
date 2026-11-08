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
import { readBidTargets } from '../bid/bid-template-reader.js';
import { KPI_LABEL, type KpiKey } from '../bid/aws-quote.js';
import type { BudgetInputsDto } from '../budget-inputs.dto.js';
import type { BudgetInputs } from '../budget-engine.js';

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
    const out = { revisionId, sowImported: true, sowError: null as string | null, bidTemplateImported: true, bidTemplateError: null as string | null };
    // "Continuar cotação" num rascunho que já tem os documentos deste pedido não reimporta: preserva cabos
    // corrigidos, horas T e justificativas. Pedido diferente (ex.: SOW nova) reimporta.
    const [currentSow, currentBid] = await Promise.all([
      this.prisma.budgetRevisionSow.findUnique({ where: { revisionId }, select: { quoteRequestId: true } }),
      this.prisma.revisionBidTemplate.findUnique({ where: { revisionId }, select: { quoteRequestId: true } }),
    ]);
    if (currentSow?.quoteRequestId !== id) {
      try {
        await this.importFromCore(revisionId, { quoteRequestId: id }, user);
      } catch (e) {
        Object.assign(out, { sowImported: false, sowError: (e as Error).message });
      }
    }
    if (currentBid?.quoteRequestId !== id) {
      try {
        await this.importBidTemplate(revisionId, { quoteRequestId: id }, user);
      } catch (e) {
        Object.assign(out, { bidTemplateImported: false, bidTemplateError: (e as Error).message });
      }
    }
    // Revisão nova (equipe vazia) já nasce com a equipe alinhada às horas-meta da AWS.
    if (out.sowImported && out.bidTemplateImported) await this.applySuggestedTeam(revisionId, user, { onlyIfEmpty: true }).catch(() => undefined);
    return out;
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
    const request = await this.requestFor(rev.budget.axisProjectId, opts.quoteRequestId, 'Este projeto não tem pedido de cotação do Axis Core. Cole o texto da SOW.');
    const pdf = await this.core.download(request.axisProjectId, request.sowDocumentId, request.sowContentHash);
    const { text, pages } = await extractPdfText(pdf);
    if (!text.replace(/=== página \d+ ===/g, '').trim()) {
      throw new BadRequestException('O PDF da SOW não tem texto (provavelmente escaneado). Cole o texto da SOW.');
    }
    return this.save(revisionId, { source: 'core_pdf', text, pages, quoteRequestId: request.id, sowDocumentId: request.sowDocumentId, sowVersion: request.sowVersion }, user);
  }

  private async requestFor(axisProjectId: string, quoteRequestId: string | null | undefined, notFound: string) {
    const request = quoteRequestId
      ? await this.prisma.quoteRequest.findUnique({ where: { id: quoteRequestId } })
      : await this.prisma.quoteRequest.findFirst({ where: { axisProjectId }, orderBy: { requestedAt: 'desc' } });
    if (!request) throw new BadRequestException(notFound);
    if (request.axisProjectId !== axisProjectId) throw new BadRequestException('O pedido de cotação é de outro projeto.');
    return request;
  }

  /**
   * Bid Template do pedido (o informado ou o mais recente do projeto): baixa do Core, lê as metas do cluster e
   * guarda o arquivo na revisão, para a PJ7 preencher (§7.3–§7.4).
   */
  async importBidTemplate(revisionId: string, opts: { quoteRequestId?: string | null }, user: AuthenticatedUser) {
    const rev = await this.draftRevision(revisionId);
    const request = await this.requestFor(rev.budget.axisProjectId, opts.quoteRequestId, 'Este projeto não tem pedido de cotação do Axis Core.');
    if (!request.bidTemplateDocumentId || !request.bidTemplateContentHash || !request.bidTemplateVersion) {
      throw new BadRequestException('O pedido de cotação não trouxe o Bid Template. Anexe-o no projeto do Axis Core e peça a cotação de novo.');
    }
    const content = await this.core.download(request.axisProjectId, request.bidTemplateDocumentId, request.bidTemplateContentHash);
    const targets = await readBidTargets(content);
    const data = {
      quoteRequestId: request.id,
      documentId: request.bidTemplateDocumentId,
      version: request.bidTemplateVersion,
      filename: request.bidTemplateFilename ?? 'Bid Template.xlsm',
      contentHash: request.bidTemplateContentHash,
      content,
      targets: targets as unknown as Prisma.InputJsonValue,
      importedAt: new Date(),
      importedBy: user.userId,
    };
    await this.prisma.$transaction(async (tx) => {
      await tx.revisionBidTemplate.upsert({ where: { revisionId }, create: { revisionId, ...data }, update: data });
      await this.audit.record(
        user.userId,
        'budget_revision.bid_template_imported',
        'budget_revision',
        revisionId,
        { version: request.bidTemplateVersion, templateVersion: targets.templateVersion, cluster: targets.cluster, currency: targets.currency, warnings: targets.warnings.length } as unknown as Prisma.InputJsonValue,
        tx,
      );
    });
    return { version: data.version, filename: data.filename, targets };
  }

  /**
   * Equipe pela SOW e pelo Bid Template (pedido do dono em 2026-11-08): 1 encarregado e os técnicos e dias que
   * cobrem as horas-meta da AWS na janela da SOW. `onlyIfEmpty` não mexe numa equipe já preenchida.
   */
  async applySuggestedTeam(revisionId: string, user: AuthenticatedUser, opts: { onlyIfEmpty: boolean }) {
    const rev = await this.budgets.loadRevisionFull(revisionId);
    if (rev.status !== 'rascunho') throw new ConflictException(`A revisão R${rev.number} não está em rascunho.`);
    const aws = this.budgets.awsInfo(rev, await this.budgets.projectInfoOrNull(rev.budget.axisProjectId));
    const team = aws?.quote?.suggestedTeam;
    if (!team) throw new BadRequestException('Importe a SOW e o Bid Template para calcular a equipe pelas horas-meta da AWS.');
    const inputs = rev.inputs as unknown as BudgetInputs;
    const filled = (inputs.workDays ?? 0) > 0 || inputs.team.some((t) => (t.people ?? 0) > 0);
    if (opts.onlyIfEmpty && filled) return;
    const roles = new Set(rev.parameterSet.roles.map((r) => r.roleKey));
    if (!roles.has('tecnico') || !roles.has('encarregado')) throw new BadRequestException('Os parâmetros vigentes precisam das funções "tecnico" e "encarregado".');
    const people: Record<string, number> = { tecnico: team.technicians, encarregado: team.foremen };
    const nextTeam = inputs.team.map((t) => (t.roleKey in people ? { ...t, people: people[t.roleKey] } : t));
    for (const key of Object.keys(people)) if (!nextTeam.some((t) => t.roleKey === key)) nextTeam.push({ roleKey: key, people: people[key] });
    await this.budgets.updateRevision(revisionId, { inputs: { ...inputs, workDays: team.days, team: nextTeam } as unknown as BudgetInputsDto }, user);
    await this.audit.record(user.userId, 'budget_revision.team_suggested', 'budget_revision', revisionId, { ...team, onlyIfEmpty: opts.onlyIfEmpty });
  }

  /** Horas T à mão por tipo de cabo; `null` volta ao proporcional (§7.2). */
  async updateHours(revisionId: string, hours: Record<string, number | null>, user: AuthenticatedUser) {
    await this.draftRevision(revisionId);
    const row = await this.prisma.budgetRevisionSow.findUnique({ where: { revisionId }, select: { cables: true, fieldHoursOverrides: true } });
    if (!row) throw new BadRequestException('Importe a SOW antes de ajustar as horas por tipo de cabo.');
    const known = new Set((row.cables as unknown as SowCableLine[]).map((c) => c.type));
    const next: Record<string, number> = { ...(row.fieldHoursOverrides as Record<string, number>) };
    for (const [type, value] of Object.entries(hours)) {
      if (!known.has(type)) throw new BadRequestException(`Tipo de cabo que não está na SOW: ${type}.`);
      if (value === null) delete next[type];
      else if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new BadRequestException(`Horas inválidas para ${type}.`);
      else next[type] = Math.round(value * 100) / 100;
    }
    for (const type of Object.keys(next)) if (!known.has(type)) delete next[type];
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetRevisionSow.update({ where: { revisionId }, data: { fieldHoursOverrides: next, updatedBy: user.userId } });
      await this.audit.record(user.userId, 'budget_revision.hours_t_changed', 'budget_revision', revisionId, { before: row.fieldHoursOverrides as Prisma.InputJsonValue, after: next }, tx);
    });
  }

  /** Justificativas (em inglês, vão para a Bid) dos indicadores fora da meta; `null` ou vazio apaga. */
  async updateJustifications(revisionId: string, justifications: Record<string, string | null>, user: AuthenticatedUser) {
    await this.draftRevision(revisionId);
    const row = await this.prisma.budgetRevisionSow.findUnique({ where: { revisionId }, select: { kpiJustifications: true } });
    if (!row) throw new BadRequestException('Importe a SOW antes de justificar os indicadores.');
    const next: Record<string, string> = { ...(row.kpiJustifications as Record<string, string>) };
    for (const [key, value] of Object.entries(justifications)) {
      if (!(key in KPI_LABEL)) throw new BadRequestException(`Indicador desconhecido: ${key}.`);
      const textValue = typeof value === 'string' ? value.trim() : '';
      if (textValue.length > 2000) throw new BadRequestException(`Justificativa de "${KPI_LABEL[key as KpiKey]}": até 2000 caracteres.`);
      if (textValue) next[key] = textValue;
      else delete next[key];
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.budgetRevisionSow.update({ where: { revisionId }, data: { kpiJustifications: next, updatedBy: user.userId } });
      await this.audit.record(user.userId, 'budget_revision.kpi_justified', 'budget_revision', revisionId, { keys: Object.keys(next) }, tx);
    });
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
