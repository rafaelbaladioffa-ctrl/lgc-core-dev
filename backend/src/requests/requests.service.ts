import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { createHash } from 'crypto';
import { validateAttachment, generateSafeFilename, MAX_REQUEST_TOTAL_BYTES } from './attachment-security.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { DelegationsService } from '../delegations/delegations.service.js';
import { ApprovalAuthorityRulesService } from '../approval-authority-rules/approval-authority-rules.service.js';
import { HolidaysService } from '../holidays/holidays.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { UpdateRequestDto } from './dto/update-request.dto.js';
import { TriageRequestDto } from './dto/triage-request.dto.js';
import { AssignRequestDto } from './dto/assign-request.dto.js';
import { PurchaseAnalysisDto } from './dto/purchase-analysis.dto.js';
import { PurchaseQuotationDto } from './dto/purchase-quotation.dto.js';
import { PurchaseQuotationSelectionDto } from './dto/purchase-quotation-selection.dto.js';
import { ApproveRequestDto, RejectRequestDto } from './dto/decision.dto.js';
import { RequestInformationDto, ResumeRequestDto, CompleteRequestDto, CancelRequestDto, ReopenRequestDto } from './dto/lifecycle.dto.js';
import { ManagementLevel, RequestApprovalCompletionRule, RequestStatus } from '@prisma/client';
import type { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

/** Ascending rank, used to walk the supervisor chain for `management_level` workflow steps. */
const LEVEL_RANK: Record<ManagementLevel, number> = {
  colaborador: 0,
  supervisor: 1,
  coordenador: 2,
  gerente: 3,
  diretor: 4,
};

/**
 * `category_version.workflow_schema` (§9.1). Um `stepOrder` com vários passos (vários
 * `approverId`/`collaboratorIds`) forma um nó paralelo — `completionRule` (default `todos`,
 * mesmo quando o nó resolve a um único aprovador) diz como ele se decide; `requiredCount` só
 * importa pra `n_de_m`. `gestor_direto`/`management_level` continuam resolvendo a partir da
 * hierarquia do solicitante (um aprovador cada); `collaboradores` é a forma explícita de montar
 * um nó com mais de um aprovador (ex.: Jurídico + Compliance + Financeiro em paralelo).
 */
interface WorkflowStep {
  stepOrder: number;
  approverRule: 'gestor_direto' | 'management_level' | 'colaboradores';
  requiredLevel?: ManagementLevel;
  collaboratorIds?: string[];
  completionRule?: 'todos' | 'qualquer_um' | 'n_de_m';
  requiredCount?: number;
}

interface ResolvedApproval {
  stepOrder: number;
  requiredLevel: ManagementLevel | null;
  approverId: string;
  completionRule: RequestApprovalCompletionRule;
  requiredCount: number | null;
  approvalSource?: string;
}

/** Requests still open after this many days past CONCLUIDA auto-close (§5.2 — simplified to
 * calendar days; the business-day calendar engine is Fase 2). */
const AUTO_CLOSE_AFTER_DAYS = 3;

const TERMINAL_STATUSES: RequestStatus[] = ['concluida', 'encerrada', 'cancelada', 'reprovada'];

/** Horário comercial único e global (§10.2) — Axis não modela empresa/unidade/turno como
 * entidades separadas ainda, então "por empresa/unidade"/plantões do documento não se aplicam
 * aqui; só um calendário (feriados cadastrados) + esta janela fixa 08h-18h, seg-sex. */
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;

const SLA_ALERT_THRESHOLDS = [50, 80, 100] as const;

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly delegations: DelegationsService,
    private readonly authorityRules: ApprovalAuthorityRulesService,
    private readonly holidays: HolidaysService,
  ) {}

  async create(requesterId: string, dto: CreateRequestDto) {
    const category = await this.prisma.requestCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category || !category.active) throw new BadRequestException('Categoria de requisição não encontrada ou inativa');
    // `bpmStatus` filtrava a versão BPM-only fora da criação legada — removido junto do resto do
    // módulo BPM (98dfce5); toda versão aqui já é legada.
    const categoryVersion = await this.prisma.categoryVersion.findFirst({ where: { categoryId: dto.categoryId }, orderBy: { version: 'desc' } });
    if (!categoryVersion) throw new BadRequestException('Categoria sem versão publicada');

    const requester = await this.prisma.collaborator.findUnique({ where: { id: requesterId } });
    if (!requester) throw new BadRequestException('Solicitante não encontrado');
    const beneficiaryId = dto.beneficiaryId ?? requesterId;
    if (dto.beneficiaryId) {
      const beneficiary = await this.prisma.collaborator.findUnique({ where: { id: dto.beneficiaryId } });
      if (!beneficiary) throw new BadRequestException('Beneficiário não encontrado');
    }

    const isPurchaseRequest = category.code === 'SUP-COMPRA' || category.name.toLowerCase() === 'compra de material';
    if (isPurchaseRequest) {
      this.assertPurchaseItems(dto.formData);
      if (!dto.costCenterId) throw new BadRequestException('Informe o centro de custo da compra.');
      const costCenter = await this.prisma.costCenter.findUnique({ where: { id: dto.costCenterId } });
      if (!costCenter) throw new BadRequestException('Centro de custo não encontrado.');
    }
    else {
      if (!dto.title) throw new BadRequestException('Informe o título da requisição');
      this.assertFormDataSatisfiesRequiredFields(categoryVersion.formSchema, dto.formData);
    }
    // Denúncia/relato ético (§7.3): `anonimo=true` no formulário oculta a identidade do
    // solicitante de todo participante do fluxo (ver maskIdentityIfAnonymous), sem jamais apagar
    // o requesterId em si — a trilha de auditoria técnica precisa dele.
    const anonymous = category.code === 'CMP-DENUNCIA' && dto.formData?.anonimo === true;
    if (dto.parentRequestId) await this.getOrThrow(dto.parentRequestId);

    return this.prisma.$transaction(async (tx) => {
      // A request always enters the sector's default queue. The seed repairs
      // old records, but this fallback also keeps the routing correct when a
      // new sector is created after the seed has already run.
      let queue = await tx.queue.findFirst({ where: { sectorId: category.sectorId }, orderBy: { createdAt: 'asc' } });
      if (!queue) {
        const sector = await tx.sector.findUniqueOrThrow({ where: { id: category.sectorId }, select: { name: true } });
        queue = await tx.queue.create({ data: { sectorId: category.sectorId, name: `Fila - ${sector.name}` } });
      }
      const code = await this.nextRequestCode(tx);
      const title = isPurchaseRequest ? await this.purchaseTitle(tx, requester.sectorId) : dto.title!;
      const purchaseTotal = isPurchaseRequest ? this.purchaseTotal(dto.formData) : undefined;

      const request = await tx.request.create({
        data: {
          code,
          categoryVersionId: categoryVersion.id,
          sectorId: category.sectorId,
          queueId: queue?.id,
          requesterId,
          beneficiaryId,
          title,
          description: dto.description,
          priority: dto.priority ?? 'normal',
          confidentiality: dto.confidentiality ?? category.confidentiality,
          anonymous,
          neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
          projectId: dto.projectId,
          costCenterId: dto.costCenterId,
          estimatedValue: purchaseTotal ?? dto.estimatedValue,
          formData: dto.formData as Prisma.InputJsonValue | undefined,
        },
      });
      if (dto.parentRequestId) {
        await tx.requestRelation.create({ data: { sourceId: request.id, targetId: dto.parentRequestId, relationType: 'subtarefa_de' } });
      }
      await this.audit(tx, { aggregateId: request.id, event: 'request.created', actorId: requesterId, after: { status: request.status, code: request.code, parentRequestId: dto.parentRequestId } });
      return request;
    });
  }

  private assertPurchaseItems(formData: Record<string, unknown> | undefined) {
    const items = formData?.purchaseItems;
    if (!Array.isArray(items) || items.length === 0) throw new BadRequestException('Inclua ao menos um item da Logística.');
    for (const item of items) {
      if (!item || typeof item !== 'object' || typeof (item as Record<string, unknown>).materialId !== 'string') throw new BadRequestException('Item de compra inválido.');
      const quantity = Number((item as Record<string, unknown>).quantity);
      const unitPrice = Number((item as Record<string, unknown>).unitPrice);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) throw new BadRequestException('Quantidade ou valor de item inválido.');
    }
  }

  private purchaseTotal(formData: Record<string, unknown> | undefined): string {
    const items = formData?.purchaseItems as Array<Record<string, unknown>>;
    return items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitPrice), 0).toFixed(2);
  }

  private async purchaseTitle(tx: TxClient, sectorId: string): Promise<string> {
    const sector = await tx.sector.findUnique({ where: { id: sectorId }, include: { parentSector: true } });
    if (!sector) throw new BadRequestException('Setor do solicitante não encontrado');
    const scope = sector.parentSector ? `${sector.parentSector.name}/${sector.name}` : sector.name;
    return `Compra de Materiais - ${scope}`;
  }

  async update(id: string, actorId: string, dto: UpdateRequestDto) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'rascunho') throw new BadRequestException('Só é possível editar uma requisição em rascunho');
    if (request.requesterId !== actorId) throw new ForbiddenException('Somente o solicitante pode editar o rascunho');

    return this.prisma.request.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        confidentiality: dto.confidentiality,
        neededBy: dto.neededBy ? new Date(dto.neededBy) : undefined,
        projectId: dto.projectId,
        costCenterId: dto.costCenterId,
        estimatedValue: dto.estimatedValue,
        formData: dto.formData as Prisma.InputJsonValue | undefined,
        lockVersion: { increment: 1 },
      },
    });
  }

  async submit(id: string, actorId: string) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'rascunho') throw new BadRequestException('Só é possível enviar uma requisição em rascunho');
    if (request.requesterId !== actorId) throw new ForbiddenException('Somente o solicitante pode enviar esta requisição');

    const categoryVersion = await this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId } });
    const requestData = (request.formData as Record<string, unknown> | null) ?? undefined;
    // Compras usam a estrutura própria purchaseItems; não devem ser validadas pelos
    // campos legados da categoria (itens/especificação, quantidade e valor).
    if (!Array.isArray(requestData?.purchaseItems)) {
      this.assertFormDataSatisfiesRequiredFields(categoryVersion.formSchema, requestData);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { status: 'enviada', submittedAt: new Date() } });
      await this.audit(tx, { aggregateId: id, event: 'request.submitted', actorId, before: { status: 'rascunho' }, after: { status: 'enviada' } });
      await this.outbox.record(tx, 'request.submitted', { request_id: id, code: updated.code });
      return updated;
    });
  }

  /** Triagem do setor: aceitar inicia a resolução de aprovação; devolver pede ajuste ao
   * solicitante; recategorizar troca de categoria (nova versão de formulário, mesmo pedido). */
  async triage(id: string, actorId: string, dto: TriageRequestDto, actorRoles: string[] = []) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'enviada') throw new BadRequestException('A requisição não está aguardando triagem');

    if (request.requesterId === actorId || request.beneficiaryId === actorId) {
      throw new ForbiddenException('O solicitante não pode realizar a triagem da própria requisição.');
    }

    const categoryVersion = await this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId }, include: { category: true } });
    const isPurchaseRequest = categoryVersion.category.code === 'SUP-COMPRA' || categoryVersion.category.name.toLowerCase() === 'compra de material';
    if (isPurchaseRequest && !actorRoles.includes('analista_suprimentos') && !actorRoles.includes('admin')) {
      throw new ForbiddenException('Somente o Suprimentos pode aceitar a triagem de uma compra.');
    }

    if (dto.action === 'devolver') {
      if (!dto.reason) throw new BadRequestException('Motivo é obrigatório para devolver');
      return this.transition(id, actorId, 'devolvida_ajuste', 'request.returned', { reason: dto.reason });
    }

    if (dto.action === 'recategorizar') {
      if (!dto.newCategoryId) throw new BadRequestException('Informe a nova categoria');
      const newVersion = await this.prisma.categoryVersion.findFirst({ where: { categoryId: dto.newCategoryId }, orderBy: { version: 'desc' } });
      if (!newVersion) throw new BadRequestException('Categoria sem versão publicada');
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.request.update({ where: { id }, data: { categoryVersionId: newVersion.id, status: 'devolvida_ajuste' } });
        await this.audit(tx, { aggregateId: id, event: 'request.recategorized', actorId, after: { categoryVersionId: newVersion.id } });
        return updated;
      });
    }

    // aceitar
    const requester = await this.prisma.collaborator.findUniqueOrThrow({ where: { id: request.requesterId } });
    if (isPurchaseRequest) {
      return this.prisma.$transaction(async (tx) => {
        const updated = await tx.request.update({ where: { id }, data: { status: 'em_atendimento', assigneeId: actorId } });
        await this.audit(tx, { aggregateId: id, event: 'request.purchase_triaged', actorId, after: { status: 'em_atendimento', assigneeId: actorId } });
        return updated;
      });
    }
    const dynamicAuthority = categoryVersion.category.useDynamicAuthority ? await this.resolveDynamicAuthoritySteps(request) : null;
    const steps = dynamicAuthority
      ? dynamicAuthority.steps
      : Array.isArray(categoryVersion.workflowSchema)
        ? (categoryVersion.workflowSchema as unknown as WorkflowStep[])
        : [];
    // Conflito de interesse (§4.2/§11): quem é solicitante ou beneficiário desta requisição
    // nunca entra como aprovador dela, mesmo que a hierarquia naturalmente levasse até ele —
    // sobe-se ao próximo nível acima em vez de bloquear o fluxo.
    const conflicted = new Set([request.requesterId, request.beneficiaryId]);
    const whistleblowerExclusions = await this.whistleblowerExclusions(this.prisma, request, categoryVersion.categoryId);
    if (whistleblowerExclusions.has(actorId)) {
      throw new ForbiddenException('Você está na cadeia do denunciado e não pode realizar esta triagem');
    }
    for (const excludedId of whistleblowerExclusions) conflicted.add(excludedId);

    return this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveApprovalChain(tx, requester.id, requester.managementLevel, steps, conflicted);
      const isPurchaseRequest = categoryVersion.category.code === 'SUP-COMPRA' || categoryVersion.category.name.toLowerCase() === 'compra de material';
      if (isPurchaseRequest) {
        if (!request.costCenterId) throw new BadRequestException('A compra precisa ter um centro de custo.');
        const costCenter = await tx.costCenter.findUnique({ where: { id: request.costCenterId }, select: { responsibleCollaboratorId: true } });
        if (!costCenter?.responsibleCollaboratorId) throw new BadRequestException('O centro de custo não possui responsável pela aprovação final.');
        const finalStep = Math.max(0, ...resolved.map((step) => step.stepOrder)) + 1;
        resolved.push({ stepOrder: finalStep, requiredLevel: null, approverId: costCenter.responsibleCollaboratorId, completionRule: 'todos', requiredCount: null, approvalSource: 'centro_custo' });
      }
      // Quem realiza a triagem passa a ser o responsável pela etapa. Isso evita
      // que o solicitante permaneça como executor quando a requisição chega à
      // fila de Suprimentos (ou de qualquer outro setor).
      const emTriagem = await tx.request.update({ where: { id }, data: { status: 'em_triagem', assigneeId: actorId } });
      await this.audit(tx, { aggregateId: id, event: 'request.triaged', actorId, after: { status: 'em_triagem' } });
      if (dynamicAuthority?.fractionationDetected) {
        await this.audit(tx, {
          aggregateId: id,
          event: 'request.fractionation_detected',
          actorId,
          after: { ownValue: Number(request.estimatedValue ?? 0), effectiveValue: dynamicAuthority.effectiveValue },
        });
      }

      if (resolved.length === 0) {
        return this.finalizeApproval(tx, id, categoryVersion, actorId);
      }

      await tx.requestApproval.createMany({
        data: resolved.map((s) => ({
          requestId: id,
          stepOrder: s.stepOrder,
          requiredLevel: s.requiredLevel,
          approverId: s.approverId,
          completionRule: s.completionRule,
          requiredCount: s.requiredCount,
          approvalSource: s.approvalSource ?? 'hierarquia',
        })),
      });
      const updated = await tx.request.update({ where: { id }, data: { status: 'aguardando_aprovacao' } });
      await this.audit(tx, { aggregateId: id, event: 'approval.requested', actorId, after: { status: 'aguardando_aprovacao' } });
      void emTriagem;
      return updated;
    });
  }

  async assign(id: string, actorId: string, dto: AssignRequestDto) {
    await this.getOrThrow(id);
    const updated = await this.prisma.request.update({ where: { id }, data: { assigneeId: dto.assigneeId, queueId: dto.queueId } });
    await this.prisma.auditEvent.create({ data: { aggregateType: 'request', aggregateId: id, event: 'request.assigned', actorId, afterJson: { assigneeId: dto.assigneeId } } });
    return updated;
  }

  async recordPurchaseAnalysis(id: string, actorId: string, dto: PurchaseAnalysisDto) {
    const request = await this.getOrThrow(id);
    const categoryVersion = await this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId }, include: { category: true } });
    const isPurchase = categoryVersion.category.code === 'SUP-COMPRA' || categoryVersion.category.name.toLowerCase() === 'compra de material';
    if (!isPurchase) throw new BadRequestException('Esta requisição não é de compras.');
    if (!['enviada', 'em_triagem', 'aguardando_aprovacao', 'aprovada', 'em_atendimento'].includes(request.status)) throw new BadRequestException('A requisição não está em uma etapa de análise.');
    const formData = (request.formData as Record<string, unknown> | null) ?? {};
    const purchaseItems = Array.isArray(formData.purchaseItems) ? formData.purchaseItems as Array<Record<string, unknown>> : [];
    if (dto.items.length !== purchaseItems.length || dto.items.some((row) => !purchaseItems.some((item) => item.materialId === row.materialId))) throw new BadRequestException('A análise deve conter todos os itens solicitados.');
    const updatedFormData = { ...formData, procurementAnalysis: { analystId: actorId, analyzedAt: new Date().toISOString(), notes: dto.notes ?? '', items: dto.items } };
    const updated = await this.prisma.request.update({ where: { id }, data: { formData: updatedFormData as unknown as Prisma.InputJsonValue, assigneeId: actorId } });
    await this.prisma.auditEvent.create({ data: { aggregateType: 'request', aggregateId: id, event: 'request.purchase_analysis_recorded', actorId, afterJson: { itemCount: dto.items.length } } });
    return updated;
  }

  async recordPurchaseQuotation(id: string, actorId: string, dto: PurchaseQuotationDto) {
    const request = await this.getOrThrow(id);
    const categoryVersion = await this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId }, include: { category: true } });
    const isPurchase = categoryVersion.category.code === 'SUP-COMPRA' || categoryVersion.category.name.toLowerCase() === 'compra de material';
    if (!isPurchase) throw new BadRequestException('Esta requisição não é de compras.');
    if (request.status !== 'em_atendimento') throw new BadRequestException('A cotação só pode ser registrada durante o atendimento do Suprimentos.');
    const formData = (request.formData as Record<string, unknown> | null) ?? {};
    if (!formData.procurementAnalysis) throw new BadRequestException('Registre a análise de estoque antes da cotação.');
    const totalValue = Number(dto.totalValue);
    if (!Number.isFinite(totalValue) || totalValue <= 0) throw new BadRequestException('Informe um valor total de cotação válido.');
    if (!request.costCenterId) throw new BadRequestException('A compra não possui centro de custo.');
    const costCenter = await this.prisma.costCenter.findUnique({ where: { id: request.costCenterId }, select: { responsibleCollaboratorId: true } });
    const responsibleCollaboratorId = costCenter?.responsibleCollaboratorId;
    if (!responsibleCollaboratorId) throw new BadRequestException('O centro de custo não possui responsável pela aprovação final.');
    const legacyQuotation = formData.procurementQuotation && typeof formData.procurementQuotation === 'object' ? formData.procurementQuotation as Record<string, unknown> : null;
    const existingQuotations = Array.isArray(formData.procurementQuotations) ? formData.procurementQuotations as Array<Record<string, unknown>> : legacyQuotation ? [{ ...legacyQuotation, quotationId: 'legacy-1' }] : [];
    const quotationId = dto.quotationId?.trim() || `cotacao-${Date.now()}`;
    const newQuotation = { quotationId, supplier: dto.supplier.trim(), quoteNumber: dto.quoteNumber?.trim() ?? '', totalValue: dto.totalValue, notes: dto.notes?.trim() ?? '', attachmentIds: dto.attachmentIds ?? [], selected: dto.selected ?? true, recordedBy: actorId, recordedAt: new Date().toISOString() };
    const quotations = existingQuotations.some((quotation) => quotation.quotationId === quotationId)
      ? existingQuotations.map((quotation) => quotation.quotationId === quotationId ? { ...quotation, ...newQuotation } : { ...quotation, selected: dto.selected ? false : quotation.selected })
      : [...existingQuotations.map((quotation) => dto.selected === false ? quotation : { ...quotation, selected: false }), newQuotation];
    const updatedFormData = { ...formData, procurementQuotations: quotations, procurementQuotation: newQuotation };
    const updated = await this.prisma.$transaction(async (tx) => {
      const existingCostCenterApproval = await tx.requestApproval.findFirst({ where: { requestId: id, approvalSource: 'centro_custo' }, select: { status: true } });
      const nextStatus = existingCostCenterApproval?.status === 'aprovado' ? request.status : 'aguardando_aprovacao';
      const saved = await tx.request.update({ where: { id }, data: { formData: updatedFormData as unknown as Prisma.InputJsonValue, estimatedValue: dto.totalValue, assigneeId: actorId, status: nextStatus } });
      if (!existingCostCenterApproval) {
        await tx.requestApproval.create({ data: { requestId: id, stepOrder: 1, approverId: responsibleCollaboratorId, completionRule: 'todos', approvalSource: 'centro_custo' } });
      }
      await this.audit(tx, { aggregateId: id, event: 'request.purchase_quotation_recorded', actorId, after: { supplier: dto.supplier, totalValue: dto.totalValue, status: nextStatus } });
      return saved;
    });
    return updated;
  }

  async selectPurchaseQuotation(id: string, actorId: string, dto: PurchaseQuotationSelectionDto) {
    const request = await this.getOrThrow(id);
    const costCenter = request.costCenterId
      ? await this.prisma.costCenter.findUnique({ where: { id: request.costCenterId }, select: { responsibleCollaboratorId: true } })
      : null;
    if (!costCenter?.responsibleCollaboratorId || costCenter.responsibleCollaboratorId !== actorId) {
      throw new ForbiddenException('Somente o responsável pelo centro de custo pode escolher a cotação.');
    }
    const formData = (request.formData as Record<string, unknown> | null) ?? {};
    const quotations = Array.isArray(formData.procurementQuotations) ? formData.procurementQuotations as Array<Record<string, unknown>> : [];
    if (quotations.length === 0) throw new BadRequestException('Não existem cotações para selecionar.');
    if (!quotations.some((quotation) => quotation.quotationId === dto.quotationId)) throw new BadRequestException('Cotação não encontrada nesta requisição.');
    const updatedQuotations = quotations.map((quotation) => ({ ...quotation, selected: quotation.quotationId === dto.quotationId }));
    const selected = quotations.find((quotation) => quotation.quotationId === dto.quotationId);
    const updatedFormData = { ...formData, procurementQuotations: updatedQuotations, procurementQuotation: selected, selectedQuotationId: dto.quotationId };
    const updated = await this.prisma.request.update({ where: { id }, data: { formData: updatedFormData as unknown as Prisma.InputJsonValue } });
    await this.prisma.auditEvent.create({ data: { aggregateType: 'request', aggregateId: id, event: 'request.purchase_quotation_selected', actorId, afterJson: { quotationId: dto.quotationId } } });
    return updated;
  }

  /** §9.1: a etapa ativa pode ter vários aprovadores em paralelo no mesmo stepOrder — `approve`
   * só avança pro próximo stepOrder (ou finaliza) quando a `completionRule` do nó for satisfeita
   * (todos aprovados / qualquer um / N de M); até lá, fica aguardando os demais do mesmo nó. */
  async approve(id: string, approverId: string, dto: ApproveRequestDto) {
    const request = await this.getPendingApproval(id);
    const stepRows = this.activeStepRows(request.approvals);
    const { row: myRow, onBehalfOf } = await this.findDecidableRow(stepRows, approverId, request.sectorId);
    if (myRow.approvalSource === 'centro_custo') {
      const formData = (request.formData as Record<string, unknown> | null) ?? {};
      if (!formData.procurementAnalysis) throw new BadRequestException('A análise de estoque/cotação do Suprimentos precisa ser registrada antes da aprovação final.');
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.requestApproval.update({ where: { id: myRow.id }, data: { status: 'aprovado', decidedAt: now, comment: dto.comment } });
      await this.audit(tx, {
        aggregateId: id,
        event: 'approval.decided',
        actorId: approverId,
        after: { stepOrder: myRow.stepOrder, decision: 'aprovado', onBehalfOf: onBehalfOf ? myRow.approverId : undefined },
      });

      const approvedInStep = stepRows.filter((r) => r.id === myRow.id || r.status === 'aprovado').length;
      const stepSatisfied = this.isStepSatisfied(myRow.completionRule, myRow.requiredCount, approvedInStep, stepRows.length);
      if (!stepSatisfied) return tx.request.findUniqueOrThrow({ where: { id } });

      // Nó satisfeito (ex.: QUALQUER_UM com 1 de 3): os demais pendentes deste stepOrder deixam
      // de ser necessários — marcados `devolvido`, não `aprovado` (eles não decidiram nada).
      await tx.requestApproval.updateMany({
        where: { requestId: id, stepOrder: myRow.stepOrder, status: 'pendente' },
        data: { status: 'devolvido', decidedAt: now },
      });

      const stillPending = request.approvals.some((a) => a.stepOrder !== myRow.stepOrder && a.status === 'pendente');
      if (stillPending) return tx.request.findUniqueOrThrow({ where: { id } });

      const categoryVersion = await tx.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId } });
      return this.finalizeApproval(tx, id, categoryVersion, approverId);
    });
  }

  /** Qualquer reprovação na etapa ativa reprova a requisição inteira, mesmo em nó paralelo —
   * não há "maioria reprova" nesta versão (simplificação documentada no hand-off). */
  async reject(id: string, approverId: string, dto: RejectRequestDto) {
    const request = await this.getPendingApproval(id);
    const stepRows = this.activeStepRows(request.approvals);
    const { row: myRow } = await this.findDecidableRow(stepRows, approverId, request.sectorId);

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.requestApproval.update({ where: { id: myRow.id }, data: { status: 'reprovado', decidedAt: now, comment: dto.comment } });
      await tx.requestApproval.updateMany({ where: { requestId: id, status: 'pendente' }, data: { status: 'devolvido', decidedAt: now } });
      const updated = await tx.request.update({ where: { id }, data: { status: 'reprovada' } });
      await this.audit(tx, { aggregateId: id, event: 'request.rejected', actorId: approverId, after: { status: 'reprovada', comment: dto.comment } });
      await this.outbox.record(tx, 'request.status_changed', { request_id: id, code: updated.code, status: updated.status });
      return updated;
    });
  }

  /** O início do atendimento é o "primeiro atendimento humano válido" (§10.1) para fins do
   * relógio de primeira resposta — encerra esse clock aqui (único lugar do fluxo onde ele era
   * criado e nunca parado). */
  async start(id: string, actorId: string) {
    const request = await this.getOrThrow(id);
    if (!['aprovada', 'planejada'].includes(request.status)) throw new BadRequestException('A requisição precisa estar aprovada para iniciar o atendimento');
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const clock = await tx.slaClock.findFirst({ where: { requestId: id, metric: 'primeira_resposta', stoppedAt: null } });
      if (clock) await tx.slaClock.update({ where: { id: clock.id }, data: { stoppedAt: now, breached: now > clock.targetAt } });
      return tx.request.update({ where: { id }, data: { status: 'em_atendimento', assigneeId: request.assigneeId ?? actorId } });
    });
  }

  async requestInformation(id: string, actorId: string, dto: RequestInformationDto) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'em_atendimento') throw new BadRequestException('Só é possível pedir informação durante o atendimento');

    return this.prisma.$transaction(async (tx) => {
      await tx.slaClock.updateMany({ where: { requestId: id, metric: 'solucao', stoppedAt: null }, data: { pausedAt: new Date() } });
      const updated = await tx.request.update({ where: { id }, data: { status: 'aguardando_solicitante' } });
      await tx.requestComment.create({ data: { requestId: id, authorId: actorId, visibility: 'publico', body: dto.question } });
      await this.audit(tx, { aggregateId: id, event: 'request.information_requested', actorId, after: { question: dto.question } });
      return updated;
    });
  }

  /** Resuming extends the solution clock's target by exactly how long it was paused, so the
   * pause never counts against SLA (§5.2: pendência pausa somente o SLA de solução). */
  async resume(id: string, actorId: string, dto: ResumeRequestDto) {
    const request = await this.getOrThrow(id);
    if (!['aguardando_solicitante', 'aguardando_terceiro'].includes(request.status)) throw new BadRequestException('Requisição não está pausada');

    return this.prisma.$transaction(async (tx) => {
      const clock = await tx.slaClock.findFirst({ where: { requestId: id, metric: 'solucao', stoppedAt: null } });
      if (clock?.pausedAt) {
        const pausedMs = Date.now() - clock.pausedAt.getTime();
        await tx.slaClock.update({ where: { id: clock.id }, data: { targetAt: new Date(clock.targetAt.getTime() + pausedMs), pausedAt: null } });
      }
      const updated = await tx.request.update({ where: { id }, data: { status: 'em_atendimento' } });
      if (dto.answer) await tx.requestComment.create({ data: { requestId: id, authorId: actorId, visibility: 'publico', body: dto.answer } });
      await this.audit(tx, { aggregateId: id, event: 'request.resumed', actorId });
      return updated;
    });
  }

  /** §11.4: uma requisição com subtarefas em aberto não pode ser concluída — barreira de
   * conclusão. Lê `request_relations` (relation_type = subtarefa_de, target = esta requisição).
   */
  async complete(id: string, actorId: string, dto: CompleteRequestDto) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'em_atendimento') throw new BadRequestException('Só é possível concluir durante o atendimento');

    const subtaskLinks = await this.prisma.requestRelation.findMany({
      where: { targetId: id, relationType: 'subtarefa_de' },
      include: { source: { select: { code: true, status: true } } },
    });
    const openSubtasks = subtaskLinks.filter((l) => !['concluida', 'encerrada', 'cancelada'].includes(l.source.status));
    if (openSubtasks.length > 0) {
      throw new BadRequestException(`Existem subtarefas em aberto: ${openSubtasks.map((l) => l.source.code).join(', ')}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const clock = await tx.slaClock.findFirst({ where: { requestId: id, metric: 'solucao', stoppedAt: null } });
      if (clock) await tx.slaClock.update({ where: { id: clock.id }, data: { stoppedAt: now, breached: now > clock.targetAt } });
      const updated = await tx.request.update({ where: { id }, data: { status: 'concluida' } });
      await tx.requestComment.create({ data: { requestId: id, authorId: actorId, visibility: 'publico', body: dto.resolution } });
      await this.audit(tx, { aggregateId: id, event: 'request.completed', actorId });
      await this.outbox.record(tx, 'request.completed', { request_id: id, code: updated.code });
      return updated;
    });
  }

  /** §15.2/§11: só o solicitante aceita, e só depois de CONCLUIDA — vira um pré-requisito de
   * close() nas categorias marcadas `requiresAcceptance` (entrega/mudança/serviço). */
  async accept(id: string, actorId: string) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'concluida') throw new BadRequestException('Só é possível aceitar uma requisição concluída');
    if (request.requesterId !== actorId) throw new ForbiddenException('Somente o solicitante pode aceitar a entrega');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { requesterAcceptedAt: new Date() } });
      await this.audit(tx, { aggregateId: id, event: 'request.accepted', actorId });
      return updated;
    });
  }

  async close(id: string, actorId: string | null) {
    const request = await this.getOrThrow(id);
    if (request.status !== 'concluida') throw new BadRequestException('Só é possível encerrar uma requisição concluída');
    const categoryVersion = await this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: request.categoryVersionId }, include: { category: true } });
    if (categoryVersion.category.requiresAcceptance && !request.requesterAcceptedAt) {
      throw new BadRequestException('Esta categoria exige aceite do solicitante antes de encerrar');
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { status: 'encerrada', closedAt: new Date() } });
      await this.audit(tx, { aggregateId: id, event: 'request.closed', actorId, source: actorId ? 'api' : 'auto' });
      return updated;
    });
  }

  /** `canManage` (request:update) covers the queue/fila side; the requester can always reopen
   * their own request regardless of that permission (§5.1 "Reabertura" doesn't require being the
   * attendant — only `request:create`, which every requesting role already has, gates the route).
   *
   * §5.2: reabertura só é permitida por 5 dias úteis depois de CONCLUIDA; passada a janela, cria
   * uma requisição nova vinculada por `origina` em vez de reabrir a antiga no lugar (a antiga
   * permanece como está). Reprovada não tem janela definida no documento — reabre direto.
   */
  async reopen(id: string, actorId: string, canManage: boolean, dto: ReopenRequestDto) {
    const request = await this.getOrThrow(id);
    if (!['concluida', 'encerrada', 'reprovada'].includes(request.status)) throw new BadRequestException('Esta requisição não pode ser reaberta');
    if (!canManage && request.requesterId !== actorId) throw new ForbiddenException('Somente o solicitante ou a gestão da fila pode reabrir esta requisição');

    if (request.status !== 'reprovada') {
      const reference = request.closedAt ?? request.updatedAt;
      const businessDaysSince = this.countBusinessDays(reference, new Date(), await this.loadHolidaySet());
      if (businessDaysSince > 5) {
        return this.prisma.$transaction(async (tx) => {
          const code = await this.nextRequestCode(tx);
          const created = await tx.request.create({
            data: {
              code,
              categoryVersionId: request.categoryVersionId,
              sectorId: request.sectorId,
              requesterId: request.requesterId,
              beneficiaryId: request.beneficiaryId,
              title: request.title,
              description: `[Reabertura fora da janela de ${request.code}] ${dto.reason}\n\n${request.description}`,
              priority: request.priority,
              confidentiality: request.confidentiality,
              projectId: request.projectId,
              costCenterId: request.costCenterId,
              estimatedValue: request.estimatedValue,
              formData: request.formData as Prisma.InputJsonValue | undefined,
            },
          });
          await tx.requestRelation.create({ data: { sourceId: request.id, targetId: created.id, relationType: 'origina' } });
          await this.audit(tx, { aggregateId: request.id, event: 'request.reopen_out_of_window', actorId, after: { reason: dto.reason, newRequestId: created.id } });
          return created;
        });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { status: 'em_triagem', closedAt: null } });
      await this.audit(tx, { aggregateId: id, event: 'request.reopened', actorId, after: { reason: dto.reason } });
      return updated;
    });
  }

  async cancel(id: string, actorId: string, dto: CancelRequestDto) {
    const request = await this.getOrThrow(id);
    if (['concluida', 'encerrada', 'cancelada'].includes(request.status)) throw new BadRequestException('Esta requisição não pode mais ser cancelada');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { status: 'cancelada' } });
      await this.audit(tx, { aggregateId: id, event: 'request.cancelled', actorId, after: { reason: dto.reason } });
      await this.outbox.record(tx, 'request.status_changed', { request_id: id, code: updated.code, status: updated.status });
      return updated;
    });
  }

  async addComment(requestId: string, authorId: string, body: string, visibility: 'publico' | 'interno' = 'publico') {
    await this.getOrThrow(requestId);
    return this.prisma.requestComment.create({ data: { requestId, authorId, body, visibility } });
  }

  /** §16: hash/MIME real/nome seguro/versionamento são aplicados aqui; o `content` ainda é
   * guardado como BYTEA no Postgres — solução temporária enquanto a infraestrutura de
   * armazenamento definitiva (e o motor de antimalware real) não é decidida (ver nota de
   * simplificação em `attachment-security.ts`). */
  async addAttachment(requestId: string, uploadedBy: string, filename: string, contentBase64: string, replacesAttachmentId?: string) {
    await this.getOrThrow(requestId);
    const buffer = Buffer.from(contentBase64, 'base64');
    const mimeType = validateAttachment(buffer, filename);

    const existingTotal = await this.prisma.requestAttachment.aggregate({ where: { requestId }, _sum: { sizeBytes: true } });
    if ((existingTotal._sum.sizeBytes ?? 0) + buffer.length > MAX_REQUEST_TOTAL_BYTES) {
      throw new BadRequestException(`Limite de ${MAX_REQUEST_TOTAL_BYTES / 1024 / 1024}MB por requisição excedido`);
    }

    let version = 1;
    if (replacesAttachmentId) {
      const previous = await this.prisma.requestAttachment.findUnique({ where: { id: replacesAttachmentId } });
      if (!previous || previous.requestId !== requestId) throw new BadRequestException('Anexo anterior não encontrado nesta requisição');
      version = previous.version + 1;
    }

    return this.prisma.requestAttachment.create({
      data: {
        requestId,
        uploadedBy,
        filename,
        safeFilename: generateSafeFilename(mimeType),
        mimeType,
        sizeBytes: buffer.length,
        contentHash: createHash('sha256').update(buffer).digest('hex'),
        content: buffer,
        version,
        previousVersionId: replacesAttachmentId,
      },
      select: { id: true, requestId: true, filename: true, safeFilename: true, mimeType: true, sizeBytes: true, contentHash: true, version: true, previousVersionId: true, uploadedBy: true, createdAt: true },
    });
  }

  /** Download autenticado direto — **não** é a "URL de download temporária" do §16, que
   * depende da infraestrutura de armazenamento definitiva (signed URL de object storage, ou um
   * token de curta duração se for disco). Protegido pela mesma permissão/visibilidade de
   * `findOne` (chamado antes deste método pelo controller). */
  async getAttachmentContent(requestId: string, attachmentId: string) {
    const attachment = await this.prisma.requestAttachment.findUnique({ where: { id: attachmentId } });
    if (!attachment || attachment.requestId !== requestId) throw new NotFoundException('Anexo não encontrado nesta requisição');
    return attachment;
  }

  async findOne(id: string, viewer: { collaboratorId: string | null; canViewWhistleblowerIdentity: boolean }) {
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        comments: { orderBy: { createdAt: 'asc' } },
        // Nunca `content` aqui — dump binário bloataria o payload do detalhe; baixado sob
        // demanda via getAttachmentContent().
        attachments: {
          select: { id: true, filename: true, safeFilename: true, mimeType: true, sizeBytes: true, contentHash: true, version: true, previousVersionId: true, uploadedBy: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
        approvals: { orderBy: { stepOrder: 'asc' }, include: { approver: { select: { id: true, fullName: true } } } },
        slaClocks: true,
        categoryVersion: { include: { category: true } },
        costCenter: { include: { responsibleCollaborator: { select: { id: true, fullName: true } } } },
        relationsAsTarget: { where: { relationType: 'subtarefa_de' }, include: { source: { select: { id: true, code: true, title: true, status: true } } } },
      },
    });
    if (!request) throw new NotFoundException('Requisição não encontrada');
    if (request.executionMode === 'bpm_v1') throw new ConflictException('WRONG_EXECUTOR');

    // Participante real desta requisição — nunca uma permissão genérica de papel (ter
    // `request:approve` não torna alguém aprovador desta requisição específica).
    const isParticipant = viewer.collaboratorId !== null && [request.requesterId, request.beneficiaryId, request.assigneeId].includes(viewer.collaboratorId);
    const isApprover = viewer.collaboratorId !== null && request.approvals.some((a) => a.approverId === viewer.collaboratorId);
    if (request.confidentiality === 'restrita' && !isParticipant && !isApprover) {
      throw new ForbiddenException('Requisição restrita — acesso não autorizado');
    }
    // Notas internas só aparecem para quem atende/aprova, nunca para o solicitante/beneficiário puro.
    const isExecutor = viewer.collaboratorId !== null && viewer.collaboratorId === request.assigneeId;
    if (!isApprover && !isExecutor && (!isParticipant || viewer.collaboratorId === request.requesterId || viewer.collaboratorId === request.beneficiaryId)) {
      request.comments = request.comments.filter((c) => c.visibility === 'publico');
    }
    return this.maskIdentityIfAnonymous(request, viewer.collaboratorId, viewer.canViewWhistleblowerIdentity);
  }

  /** §7.3: `requesterId` nunca é apagado (auditoria), mas é ocultado de todo mundo que não seja o
   * próprio solicitante nem tenha `request:view_whistleblower_identity` — devolvido como `null`
   * pra quem não pode ver, com `requesterDisplay: "Anônimo"` no lugar de um nome. */
  private maskIdentityIfAnonymous<T extends { requesterId: string; anonymous: boolean }>(request: T, viewerCollaboratorId: string | null, canView: boolean): T & { requesterDisplay: string | null } {
    const isSelf = viewerCollaboratorId !== null && viewerCollaboratorId === request.requesterId;
    if (!request.anonymous || canView || isSelf) {
      return { ...request, requesterDisplay: null };
    }
    return { ...request, requesterId: null as unknown as string, requesterDisplay: 'Anônimo' };
  }

  findMine(collaboratorId: string) {
    return this.prisma.request.findMany({
      where: { executionMode: 'legacy', OR: [{ requesterId: collaboratorId }, { beneficiaryId: collaboratorId }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findQueue(filters: { sectorId?: string; queueId?: string; status?: RequestStatus }, user?: { roles: string[]; collaboratorId: string | null }) {
    let sectorId = filters.sectorId;
    if (user?.roles.includes('analista_suprimentos')) {
      const collaborator = user.collaboratorId
        ? await this.prisma.collaborator.findUnique({ where: { id: user.collaboratorId }, select: { sectorId: true } })
        : null;
      sectorId = collaborator?.sectorId;
    }
    return this.prisma.request.findMany({
      where: { executionMode: 'legacy', sectorId, queueId: filters.queueId, status: filters.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Painel gerencial (§15.1 item 7, §19) — volume por status, backlog/aging, percentis de SLA
   * de solução (P50/P90/P95), taxas de devolução/reprovação/reabertura e carga por responsável.
   * Tudo calculado on-demand a partir de `requests`/`audit_events`, sem tabela de métricas
   * pré-agregada (aceitável no volume esperado nesta fase; revisar se crescer muito). */
  async dashboard() {
    const now = Date.now();
    const [byStatus, open, closedWithDuration, assigneeCounts, submittedCount, returnedCount, approvedCount, rejectedCount, completedCount, reopenedCount] = await Promise.all([
      this.prisma.request.groupBy({ by: ['status'], where: { executionMode: 'legacy' }, _count: { _all: true } }),
      this.prisma.request.findMany({ where: { executionMode: 'legacy', status: { notIn: TERMINAL_STATUSES } }, select: { createdAt: true } }),
      this.prisma.request.findMany({ where: { executionMode: 'legacy', status: { in: ['concluida', 'encerrada'] } }, select: { createdAt: true, closedAt: true, updatedAt: true } }),
      this.prisma.request.groupBy({ by: ['assigneeId'], where: { executionMode: 'legacy', status: { notIn: TERMINAL_STATUSES }, assigneeId: { not: null } }, _count: { _all: true } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: 'request.submitted' } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: 'request.returned' } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: 'request.approved' } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: 'request.rejected' } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: 'request.completed' } }),
      this.prisma.auditEvent.count({ where: { aggregateType: 'request', event: { in: ['request.reopened', 'request.reopen_out_of_window'] } } }),
    ]);

    const AGING_BUCKETS = [2, 5, 10] as const;
    const aging = { '0-2d': 0, '3-5d': 0, '6-10d': 0, '>10d': 0 };
    for (const r of open) {
      const days = (now - r.createdAt.getTime()) / 86_400_000;
      if (days <= AGING_BUCKETS[0]) aging['0-2d']++;
      else if (days <= AGING_BUCKETS[1]) aging['3-5d']++;
      else if (days <= AGING_BUCKETS[2]) aging['6-10d']++;
      else aging['>10d']++;
    }

    const resolutionHours = closedWithDuration
      .map((r) => ((r.closedAt ?? r.updatedAt).getTime() - r.createdAt.getTime()) / 3_600_000)
      .sort((a, b) => a - b);
    const percentile = (p: number) => {
      if (resolutionHours.length === 0) return null;
      const idx = Math.min(resolutionHours.length - 1, Math.ceil((p / 100) * resolutionHours.length) - 1);
      return Math.round(resolutionHours[Math.max(0, idx)] * 10) / 10;
    };

    return {
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count._all })),
      backlogOpen: open.length,
      aging,
      slaResolutionHours: { p50: percentile(50), p90: percentile(90), p95: percentile(95), sampleSize: resolutionHours.length },
      // devolução/reprovação/reabertura vêm inteiramente de audit_events (histórico,
      // append-only) — nunca misturadas com contagem pelo status ATUAL de `requests`. Um
      // reprovada reaberta sai do status `reprovada`, então contar o denominador pelo status
      // atual subcontava e fazia a taxa passar de 100% (bug reportado no teste deste
      // incremento) — ambos os lados da fração agora são sempre eventos, nunca estado.
      rates: {
        devolucao: submittedCount > 0 ? Math.round((returnedCount / submittedCount) * 1000) / 10 : null,
        reprovacao: approvedCount + rejectedCount > 0 ? Math.round((rejectedCount / (approvedCount + rejectedCount)) * 1000) / 10 : null,
        reabertura: completedCount + rejectedCount > 0 ? Math.round((reopenedCount / (completedCount + rejectedCount)) * 1000) / 10 : null,
      },
      loadByAssignee: assigneeCounts.map((g) => ({ assigneeId: g.assigneeId as string, count: g._count._all })),
    };
  }

  async myApprovals(collaboratorId: string, canViewWhistleblowerIdentity: boolean) {
    const mine = await this.prisma.requestApproval.findMany({
      where: {
        approverId: collaboratorId,
        status: 'pendente',
        request: { executionMode: 'legacy' },
      },
      include: { request: { include: { categoryVersion: { include: { category: true } }, requester: { select: { id: true, fullName: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const requestIds = [...new Set(mine.map((a) => a.requestId))];
    const allPending = await this.prisma.requestApproval.findMany({ where: { requestId: { in: requestIds }, status: 'pendente' }, select: { requestId: true, stepOrder: true } });
    const activeByRequest = new Map<string, number>();
    for (const a of allPending) {
      const current = activeByRequest.get(a.requestId);
      if (current === undefined || a.stepOrder < current) activeByRequest.set(a.requestId, a.stepOrder);
    }
    return mine
      .filter((a) => activeByRequest.get(a.requestId) === a.stepOrder)
      .map((a) => ({
        approvalId: a.id,
        requestId: a.requestId,
        code: a.request.code,
        stepOrder: a.stepOrder,
        requiredLevel: a.requiredLevel,
        title: a.request.title,
        categoryName: a.request.categoryVersion.category.name,
        requesterName: a.request.anonymous && !canViewWhistleblowerIdentity ? 'Anônimo' : a.request.requester.fullName,
        createdAt: a.createdAt,
      }));
  }

  /** "Minhas atividades" (tela inicial do módulo): tudo que precisa de uma ação da pessoa
   * logada, numa lista só — sem duplicar fila/aprovações/minhas requisições, que continuam
   * existindo como telas próprias pra quem quer o filtro completo.
   *
   * Quatro origens: (1) requisições próprias (ou em nome de quem é beneficiário) num status que
   * espera uma ação do solicitante — rascunho, devolvida para ajuste, aguardando resposta; (2) a
   * fila de triagem do setor do colaborador, só pra quem tem `request:update` (mesma permissão
   * exigida por `triage()`) — o setor "meu" aqui é o do colaborador, igual ao atalho já existente
   * pra analista_suprimentos em `findQueue`, não uma associação explícita de fila por usuário,
   * que o modelo legado não tem; (3) aprovações pendentes (reaproveita `myApprovals` tal qual,
   * sem duplicar a lógica de etapa ativa/paralela); (4) requisições já aprovadas atribuídas ao
   * colaborador como executor.
   *
   * O prazo (`dueAt`) e o balde de urgência (`bucket`) vêm do `SlaClock` de métrica `solucao`
   * ainda aberto, igual a `runSlaAlertsAndEscalation` (mesmos 80% de `SLA_ALERT_THRESHOLDS`) —
   * nunca de `request.slaDueResolutionAt` direto, que não reflete a extensão de um relógio
   * pausado e reaberto (ver `resume()`). Antes da aprovação (triagem/aprovação pendente) esse
   * relógio ainda não existe — `finalizeApproval` é quem cria os dois relógios —, então esses
   * itens sempre voltam "no prazo" aqui: não haveria base pra dizer que estão atrasados.
   */
  async myActivities(user: { collaboratorId: string; permissions: string[] }) {
    const include = { categoryVersion: { include: { category: true } }, slaClocks: true } satisfies Prisma.RequestInclude;
    const canTriage = user.permissions.includes('request:update');
    const collaborator = canTriage
      ? await this.prisma.collaborator.findUnique({ where: { id: user.collaboratorId }, select: { sectorId: true } })
      : null;

    const [mine, triagePool, approvals, executing] = await Promise.all([
      this.prisma.request.findMany({
        where: {
          executionMode: 'legacy',
          status: { in: ['rascunho', 'devolvida_ajuste', 'aguardando_solicitante'] },
          OR: [{ requesterId: user.collaboratorId }, { beneficiaryId: user.collaboratorId }],
        },
        include,
        orderBy: { createdAt: 'desc' },
      }),
      collaborator?.sectorId
        ? this.prisma.request.findMany({
            where: { executionMode: 'legacy', status: 'enviada', sectorId: collaborator.sectorId },
            include,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
      this.myApprovals(user.collaboratorId, user.permissions.includes('request:view_whistleblower_identity')),
      this.prisma.request.findMany({
        where: { executionMode: 'legacy', status: { in: ['aprovada', 'planejada', 'em_atendimento'] }, assigneeId: user.collaboratorId },
        include,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    type WithInclude = Prisma.RequestGetPayload<{ include: typeof include }>;
    type ActivityKind = 'minha_requisicao' | 'triagem' | 'aprovacao' | 'execucao';
    const toItem = (kind: ActivityKind, r: WithInclude) => {
      const clock = r.slaClocks.find((c) => c.metric === 'solucao' && c.stoppedAt === null);
      return {
        kind,
        requestId: r.id,
        code: r.code,
        title: r.title,
        status: r.status,
        categoryId: r.categoryVersion.categoryId,
        categoryName: r.categoryVersion.category.name,
        categoryVersionNumber: r.categoryVersion.version,
        dueAt: clock && !clock.pausedAt ? clock.targetAt : null,
        bucket: this.slaBucket(r.slaClocks),
        createdAt: r.createdAt,
      };
    };

    const approvalRequestIds = [...new Set(approvals.map((a) => a.requestId))];
    const approvalRequests = approvalRequestIds.length
      ? await this.prisma.request.findMany({ where: { id: { in: approvalRequestIds } }, include })
      : [];
    const approvalRequestById = new Map(approvalRequests.map((r) => [r.id, r]));

    return [
      ...mine.map((r) => toItem('minha_requisicao', r)),
      ...triagePool.map((r) => toItem('triagem', r)),
      ...approvals.flatMap((a) => {
        const r = approvalRequestById.get(a.requestId);
        return r ? [{ ...toItem('aprovacao' as const, r), approvalId: a.approvalId }] : [];
      }),
      ...executing.map((r) => toItem('execucao', r)),
    ];
  }

  /** Mesmo critério de `runSlaAlertsAndEscalation`: fração decorrida do relógio de `solucao`
   * ainda aberto e não pausado, contra os mesmos 80%/100% de `SLA_ALERT_THRESHOLDS`. */
  private slaBucket(clocks: Array<{ metric: string; stoppedAt: Date | null; pausedAt: Date | null; startedAt: Date; targetAt: Date }>): 'no_prazo' | 'em_alerta' | 'atrasado' {
    const clock = clocks.find((c) => c.metric === 'solucao' && c.stoppedAt === null);
    if (!clock || clock.pausedAt) return 'no_prazo';
    const totalMs = clock.targetAt.getTime() - clock.startedAt.getTime();
    if (totalMs <= 0) return 'no_prazo';
    const fraction = ((Date.now() - clock.startedAt.getTime()) / totalMs) * 100;
    if (fraction >= 100) return 'atrasado';
    if (fraction >= SLA_ALERT_THRESHOLDS[1]) return 'em_alerta';
    return 'no_prazo';
  }

  /** Auto-closes CONCLUIDA requests past the no-contestation window (§5.2, simplified to
   * calendar days — see class-level comment). */
  @Cron(CronExpression.EVERY_HOUR)
  async runAutoClose() {
    const cutoff = new Date(Date.now() - AUTO_CLOSE_AFTER_DAYS * 86_400_000);
    const due = await this.prisma.request.findMany({ where: { executionMode: 'legacy', status: 'concluida', updatedAt: { lt: cutoff } } });
    for (const request of due) {
      try {
        await this.close(request.id, null);
        this.logger.log(`request.closed (auto): ${request.code}`);
      } catch (err) {
        // Categorias com requiresAcceptance (§15.2) nunca encerram sozinhas sem o aceite do
        // solicitante — fica pendente até ele agir, mesmo passado o prazo de contestação.
        this.logger.warn(`request.closed (auto) adiado para ${request.code}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * §10.2: alertas em 50/80/100% do relógio ativo (nunca duplicados — `alertedThresholds`
   * guarda quais já disparou) e escalonamento automático de um passo (atendente → supervisor
   * dele) na primeira vez que o relógio estoura. Clocks pausados (`pausedAt` setado) não
   * alertam/escalam — a pausa já tira o SLA de solução da contagem (§5.2).
   *
   * Simplificação documentada: a cadeia completa do documento (atendente → gestor da fila →
   * gestor do setor → patrocinador) teria vários níveis progressivos ao longo do tempo; aqui é
   * só um passo, disparado no estouro — igual ao motor de escalonamento anterior desta
   * implementação, generalizando pra qualquer categoria via `sla_clocks` em vez de um campo
   * fixo em `tickets`.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runSlaAlertsAndEscalation() {
    const now = new Date();
    const openClocks = await this.prisma.slaClock.findMany({
      where: { stoppedAt: null, pausedAt: null, request: { executionMode: 'legacy' } },
      include: { request: { select: { id: true, code: true, sectorId: true, status: true, escalationLevel: true, assigneeId: true } } },
    });

    for (const clock of openClocks) {
      if (TERMINAL_STATUSES.includes(clock.request.status)) continue;
      const totalMs = clock.targetAt.getTime() - clock.startedAt.getTime();
      if (totalMs <= 0) continue;
      const fraction = ((now.getTime() - clock.startedAt.getTime()) / totalMs) * 100;

      const newThresholds = SLA_ALERT_THRESHOLDS.filter((t) => fraction >= t && !clock.alertedThresholds.includes(t));
      for (const threshold of newThresholds) {
        await this.prisma.$transaction(async (tx) => {
          await tx.slaClock.update({ where: { id: clock.id }, data: { alertedThresholds: { push: threshold } } });
          await this.audit(tx, { aggregateId: clock.request.id, event: 'sla.alert', actorId: null, after: { metric: clock.metric, threshold }, source: 'cron' });
          await this.outbox.record(tx, 'sla.warning', { request_id: clock.request.id, code: clock.request.code, metric: clock.metric, threshold });
        });
      }

      if (fraction >= 100 && !clock.breached && clock.metric === 'solucao' && clock.request.escalationLevel === 0) {
        const assignee = clock.request.assigneeId ? await this.prisma.collaborator.findUnique({ where: { id: clock.request.assigneeId }, select: { supervisorId: true } }) : null;
        const supervisorId = assignee?.supervisorId ?? null;
        await this.prisma.$transaction(async (tx) => {
          await tx.slaClock.update({ where: { id: clock.id }, data: { breached: true } });
          await tx.request.update({
            where: { id: clock.request.id },
            data: { escalationLevel: { increment: 1 }, escalatedAt: now, assigneeId: supervisorId ?? clock.request.assigneeId },
          });
          await this.audit(tx, {
            aggregateId: clock.request.id,
            event: 'sla.breached',
            actorId: null,
            after: { metric: clock.metric, reassignedTo: supervisorId },
            source: 'cron',
          });
          await this.outbox.record(tx, 'sla.breached', { request_id: clock.request.id, code: clock.request.code, reassigned_to: supervisorId });
        });
        this.logger.warn(`sla.breached: ${clock.request.code}` + (supervisorId ? `, reatribuída ao supervisor ${supervisorId}` : ', sem supervisor para reatribuir'));
      } else if (fraction >= 100 && !clock.breached) {
        await this.prisma.slaClock.update({ where: { id: clock.id }, data: { breached: true } });
      }
    }
  }

  // --- helpers -------------------------------------------------------------

  private async getOrThrow(id: string) {
    const request = await this.prisma.request.findUnique({ where: { id } });
    if (!request) throw new NotFoundException('Requisição não encontrada');
    if (request.executionMode === 'bpm_v1') throw new ConflictException('WRONG_EXECUTOR');
    return request;
  }

  private async getPendingApproval(id: string) {
    const request = await this.prisma.request.findUnique({ where: { id }, include: { approvals: true } });
    if (!request) throw new NotFoundException('Requisição não encontrada');
    if (request.executionMode === 'bpm_v1') throw new ConflictException('WRONG_EXECUTOR');
    if (request.status !== 'aguardando_aprovacao') throw new BadRequestException('A requisição não está aguardando aprovação');
    return request;
  }

  /** Todas as linhas pendentes do stepOrder ativo (o menor com alguma linha `pendente`) — um nó
   * paralelo (§9.1) tem mais de uma. */
  private activeStepRows<T extends { stepOrder: number; status: string }>(approvals: T[]): T[] {
    const pending = approvals.filter((a) => a.status === 'pendente');
    if (pending.length === 0) throw new BadRequestException('Não há etapa de aprovação pendente');
    const minStepOrder = Math.min(...pending.map((a) => a.stepOrder));
    return pending.filter((a) => a.stepOrder === minStepOrder);
  }

  /** `todos` exige que todas as linhas do nó estejam aprovadas; `qualquer_um` basta uma;
   * `n_de_m` exige pelo menos `requiredCount`. */
  private isStepSatisfied(rule: RequestApprovalCompletionRule, requiredCount: number | null, approvedCount: number, totalInStep: number): boolean {
    if (rule === 'qualquer_um') return approvedCount >= 1;
    if (rule === 'n_de_m') return approvedCount >= (requiredCount ?? totalInStep);
    return approvedCount >= totalInStep;
  }

  /** Acha, entre as linhas pendentes da etapa ativa, a que `actorId` pode decidir — ele mesmo,
   * ou um delegado ativo/dentro do escopo de quem é o aprovador daquela linha (§9.1/§21.2,
   * nunca retroativa por construção de DelegationsService.create). */
  private async findDecidableRow<T extends { id: string; approverId: string }>(
    stepRows: T[],
    actorId: string,
    sectorId: string,
  ): Promise<{ row: T; onBehalfOf: boolean }> {
    const own = stepRows.find((r) => r.approverId === actorId);
    if (own) return { row: own, onBehalfOf: false };
    for (const row of stepRows) {
      if (await this.delegations.findActiveDelegate(row.approverId, actorId, sectorId)) return { row, onBehalfOf: true };
    }
    throw new ForbiddenException('Você não é aprovador da etapa atual, nem delegado por nenhum aprovador dela');
  }

  /** §7.3: na categoria "Denúncia/relato ético", o denunciado (`formData.envolvido_id`) e toda a
   * sua cadeia de `supervisor_id` subindo até o topo nunca podem fazer a triagem nem entrar na
   * cadeia de aprovação desta requisição — reaproveita o mesmo princípio de conflito de
   * interesse, só que para um conjunto resolvido a partir de outra pessoa, não do solicitante. */
  private async whistleblowerExclusions(client: PrismaService | TxClient, request: { formData: Prisma.JsonValue }, categoryId: string): Promise<Set<string>> {
    const category = await client.requestCategory.findUnique({ where: { id: categoryId } });
    if (category?.code !== 'CMP-DENUNCIA') return new Set();
    const formData = request.formData as Record<string, unknown> | null;
    const envolvidoId = formData?.envolvido_id as string | undefined;
    if (!envolvidoId) return new Set();
    return new Set(await this.collaboratorChainUpward(client, envolvidoId));
  }

  private async collaboratorChainUpward(client: PrismaService | TxClient, collaboratorId: string): Promise<string[]> {
    const chain: string[] = [collaboratorId];
    let currentId = collaboratorId;
    while (true) {
      const current = await client.collaborator.findUnique({ where: { id: currentId }, select: { supervisorId: true } });
      if (!current?.supervisorId) break;
      chain.push(current.supervisorId);
      currentId = current.supervisorId;
    }
    return chain;
  }

  /**
   * America/Sao_Paulo é UTC-3 o ano todo (sem horário de verão desde 2019) — fixo, sem precisar
   * de biblioteca de fuso. Todo o cálculo de horário comercial abaixo opera num "espaço
   * deslocado": `toSp` desloca um instante real pra que seus getters UTC leiam como se fossem
   * hora de Brasília; `fromSp` desfaz o deslocamento pra voltar a um instante real (UTC) antes
   * de salvar no banco. **Correção de bug** (relatado pela sessão de testes): antes disso, o
   * horário comercial era lido com `getHours()`/`setHours()` — hora LOCAL DO PROCESSO, que no
   * contêiner é UTC, não America/Sao_Paulo; os prazos saíam 3h adiantados.
   */
  private readonly SP_OFFSET_MS = 3 * 60 * 60 * 1000;

  private toSp(date: Date): Date {
    return new Date(date.getTime() - this.SP_OFFSET_MS);
  }

  private fromSp(date: Date): Date {
    return new Date(date.getTime() + this.SP_OFFSET_MS);
  }

  /** Conta dias úteis (seg-sex, sem feriados cadastrados) entre duas datas — usado pela janela
   * de reabertura de 5 dias úteis. */
  private countBusinessDays(from: Date, to: Date, holidays: Set<string>): number {
    let count = 0;
    const cursor = this.toSp(from);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = this.toSp(to);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor < end) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (this.isBusinessDay(cursor, holidays)) count++;
    }
    return count;
  }

  /** `spDate` já deslocado por `toSp` — nunca um instante real (UTC puro). */
  private isBusinessDay(spDate: Date, holidays: Set<string>): boolean {
    const day = spDate.getUTCDay();
    if (day === 0 || day === 6) return false;
    return !holidays.has(this.dateKey(spDate));
  }

  /** Lê os campos como UTC — correto tanto pra uma data já deslocada por `toSp` (representa a
   * data "de parede" em Brasília) quanto pra uma coluna `DATE` pura do Postgres (sem hora, sem
   * fuso — `holidays.date`), que também deve ser lida literalmente, sem deslocamento. */
  private dateKey(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  private async loadHolidaySet(): Promise<Set<string>> {
    const holidays = await this.prisma.holiday.findMany({ select: { date: true } });
    return new Set(holidays.map((h) => this.dateKey(h.date)));
  }

  /** Avança `minutes` dentro do horário comercial (§10.2: 08h-18h, seg-sex, sem feriados
   * cadastrados, horário de Brasília) a partir de `start`, pulando fins de semana/feriados
   * inteiros de uma vez — é o que define `sla_due_*_at` (chamado só na aprovação, quando o SLA
   * começa a contar de verdade; §5.2 não corre durante `em_aprovacao`). */
  private addBusinessMinutes(start: Date, minutes: number, holidays: Set<string>): Date {
    let cursor = this.toSp(start);
    let remaining = minutes;

    // Se começar fora do expediente, avança pro próximo início de expediente.
    const jumpToNextBusinessStart = () => {
      cursor.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      while (!this.isBusinessDay(cursor, holidays)) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        cursor.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      }
    };

    if (!this.isBusinessDay(cursor, holidays) || cursor.getUTCHours() >= BUSINESS_END_HOUR) {
      cursor.setUTCDate(cursor.getUTCDate() + (this.isBusinessDay(cursor, holidays) ? 1 : 0));
      jumpToNextBusinessStart();
    } else if (cursor.getUTCHours() < BUSINESS_START_HOUR) {
      jumpToNextBusinessStart();
    }

    while (remaining > 0) {
      const endOfDay = new Date(cursor);
      endOfDay.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0);
      const minutesLeftToday = Math.max(0, (endOfDay.getTime() - cursor.getTime()) / 60_000);
      if (remaining <= minutesLeftToday) {
        cursor = new Date(cursor.getTime() + remaining * 60_000);
        remaining = 0;
      } else {
        remaining -= minutesLeftToday;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        jumpToNextBusinessStart();
      }
    }
    return this.fromSp(cursor);
  }

  private async transition(id: string, actorId: string, status: RequestStatus, event: string, extra?: Record<string, unknown>) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.request.update({ where: { id }, data: { status } });
      await this.audit(tx, { aggregateId: id, event, actorId, after: { status, ...extra } });
      return updated;
    });
  }

  private async finalizeApproval(tx: TxClient, id: string, categoryVersion: { slaFirstResponseMinutes: number; slaResolutionMinutes: number }, actorId: string) {
    const now = new Date();
    const holidaySet = await this.loadHolidaySet();
    const slaDueFirstResponseAt = this.addBusinessMinutes(now, categoryVersion.slaFirstResponseMinutes, holidaySet);
    const slaDueResolutionAt = this.addBusinessMinutes(now, categoryVersion.slaResolutionMinutes, holidaySet);
    const updated = await tx.request.update({ where: { id }, data: { status: 'aprovada', slaDueFirstResponseAt, slaDueResolutionAt } });
    await tx.slaClock.createMany({
      data: [
        { requestId: id, metric: 'primeira_resposta', targetAt: slaDueFirstResponseAt },
        { requestId: id, metric: 'solucao', targetAt: slaDueResolutionAt },
      ],
    });
    await this.audit(tx, { aggregateId: id, event: 'request.approved', actorId, after: { status: 'aprovada' } });
    await this.outbox.record(tx, 'request.status_changed', { request_id: id, status: 'aprovada' });
    return updated;
  }

  private assertFormDataSatisfiesRequiredFields(schema: Prisma.JsonValue, formData: Record<string, unknown> | undefined) {
    const fields = Array.isArray(schema) ? (schema as Array<Record<string, unknown>>) : [];
    const data = formData ?? {};
    for (const field of fields) {
      if (!field.required) continue;
      const key = field.key as string;
      const value = data[key];
      const isEmpty = value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0);
      if (isEmpty) throw new BadRequestException(`Campo obrigatório ausente: ${(field.label as string) ?? key}`);
    }
  }

  /** Reads `category_version.workflow_schema` as the approval template (REQUISICOES_SPEC.md §9):
   * `gestor_direto` resolves the requester's direct supervisor (skipped if none); `management_level`
   * walks the supervisor chain upward, matching ascending levels and skipping any level nobody
   * fills before a higher one is reached ("nível ausente", mesma lógica da implementação anterior).
   * `conflicted` (§4.2/§11 — conflito de interesse) removes candidates from consideration: for
   * `gestor_direto`, keeps climbing past a conflicted supervisor; for `management_level`, a
   * conflicted exact-rank match is skipped and the walk keeps going up looking for a substituto
   * independente, instead of leaving that level unfilled. */
  /**
   * §9.2 matriz de alçada dinâmica: resolve o(s) passo(s) de aprovação a partir de
   * `ApprovalAuthorityRule` (faixas administráveis via API, não fixas) em vez do
   * `workflowSchema` da categoria. "Calcular pelo valor total do compromisso" é simplificado
   * aqui a `estimatedValue` puro — este sistema não modela recorrência/impostos separadamente
   * ainda (documentado no hand-off). Detecção de fracionamento (§9.2): soma o valor de outras
   * requisições do mesmo solicitante nos últimos 30 dias (não canceladas/reprovadas/rascunho) e
   * usa o maior entre o valor próprio e o combinado pra escolher a faixa — nunca deixa alguém
   * abrir várias requisições pequenas pra escapar da alçada que a soma exigiria.
   */
  private async resolveDynamicAuthoritySteps(request: { id: string; requesterId: string; sectorId: string; estimatedValue: Prisma.Decimal | null }): Promise<{ steps: WorkflowStep[]; fractionationDetected: boolean; effectiveValue: number }> {
    const ownValue = Number(request.estimatedValue ?? 0);
    const windowStart = new Date(Date.now() - 30 * 86_400_000);
    const recent = await this.prisma.request.findMany({
      where: {
        id: { not: request.id },
        executionMode: 'legacy',
        requesterId: request.requesterId,
        createdAt: { gte: windowStart },
        status: { notIn: ['rascunho', 'cancelada', 'reprovada'] },
      },
      select: { estimatedValue: true },
    });
    const recentSum = recent.reduce((acc, r) => acc + Number(r.estimatedValue ?? 0), 0);
    const effectiveValue = ownValue + recentSum;
    const fractionationDetected = recentSum > 0 && effectiveValue > ownValue;

    const rule = await this.authorityRules.findApplicableRule(effectiveValue, request.sectorId);
    if (!rule) return { steps: [], fractionationDetected, effectiveValue };

    const steps: WorkflowStep[] = rule.levels.map((requiredLevel, i) => ({ stepOrder: i + 1, approverRule: 'management_level', requiredLevel }));
    return { steps, fractionationDetected, effectiveValue };
  }

  private async resolveApprovalChain(
    tx: TxClient,
    requesterId: string,
    requesterLevel: ManagementLevel,
    steps: WorkflowStep[],
    conflicted: Set<string> = new Set(),
  ): Promise<ResolvedApproval[]> {
    if (steps.length === 0) return [];
    if (steps[0].approverRule === 'gestor_direto') {
      let currentId = requesterId;
      while (true) {
        const current = await tx.collaborator.findUnique({ where: { id: currentId }, select: { supervisorId: true } });
        if (!current?.supervisorId) return [];
        if (!conflicted.has(current.supervisorId)) {
          return [{ stepOrder: 1, requiredLevel: null, approverId: current.supervisorId, completionRule: 'todos', requiredCount: null }];
        }
        currentId = current.supervisorId;
      }
    }

    // Nó(s) paralelo(s) com lista explícita de aprovadores (§9.1 TODOS/QUALQUER_UM/N_DE_M) —
    // não resolvido pela hierarquia do solicitante, então não entra no walk abaixo. Misturar
    // steps `colaboradores` com `management_level` no mesmo workflowSchema não é suportado
    // nesta versão (ver nota de simplificação no hand-off); um workflow é um ou outro.
    if (steps[0].approverRule === 'colaboradores') {
      const groups: ResolvedApproval[][] = [];
      for (const step of steps.sort((a, b) => a.stepOrder - b.stepOrder)) {
        const candidates = (step.collaboratorIds ?? []).filter((id) => !conflicted.has(id));
        if (candidates.length === 0) continue; // "nível ausente" generalizado: nó inteiro sem ninguém disponível
        const completionRule = step.completionRule ?? 'todos';
        const requiredCount = completionRule === 'n_de_m' ? (step.requiredCount ?? candidates.length) : null;
        groups.push(candidates.map((approverId) => ({ stepOrder: step.stepOrder, requiredLevel: null, approverId, completionRule, requiredCount })));
      }
      return groups.flatMap((group, i) => group.map((a) => ({ ...a, stepOrder: i + 1 })));
    }

    const pendingSteps = steps
      .filter((s) => s.requiredLevel && LEVEL_RANK[s.requiredLevel] > LEVEL_RANK[requesterLevel])
      .sort((a, b) => a.stepOrder - b.stepOrder);
    if (pendingSteps.length === 0) return [];

    const resolved: ResolvedApproval[] = [];
    let cursor = 0;
    let currentId = requesterId;
    while (cursor < pendingSteps.length) {
      const current = await tx.collaborator.findUnique({ where: { id: currentId }, select: { supervisorId: true } });
      if (!current?.supervisorId) break;
      const ancestor = await tx.collaborator.findUnique({ where: { id: current.supervisorId }, select: { id: true, managementLevel: true } });
      if (!ancestor) break;
      const ancestorRank = LEVEL_RANK[ancestor.managementLevel];
      while (cursor < pendingSteps.length && ancestorRank >= LEVEL_RANK[pendingSteps[cursor].requiredLevel as ManagementLevel]) {
        if (ancestorRank === LEVEL_RANK[pendingSteps[cursor].requiredLevel as ManagementLevel]) {
          if (conflicted.has(ancestor.id)) break; // sobe mais um nível em busca de substituto
          resolved.push({
            stepOrder: pendingSteps[cursor].stepOrder,
            requiredLevel: pendingSteps[cursor].requiredLevel as ManagementLevel,
            approverId: ancestor.id,
            completionRule: 'todos',
            requiredCount: null,
          });
        }
        cursor += 1;
      }
      currentId = ancestor.id;
    }
    return resolved.sort((a, b) => a.stepOrder - b.stepOrder).map((s, i) => ({ ...s, stepOrder: i + 1 }));
  }

  private async nextRequestCode(tx: TxClient): Promise<string> {
    const year = new Date().getFullYear();
    await tx.$executeRaw`INSERT INTO request_number_counters (year, last_value) VALUES (${year}, 0) ON CONFLICT (year) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`UPDATE request_number_counters SET last_value = last_value + 1 WHERE year = ${year} RETURNING last_value`;
    return `REQ-${year}-${String(rows[0].last_value).padStart(6, '0')}`;
  }

  private async audit(
    tx: TxClient,
    opts: { aggregateId: string; event: string; actorId: string | null; before?: Record<string, unknown>; after?: Record<string, unknown>; source?: string },
  ) {
    await tx.auditEvent.create({
      data: {
        aggregateType: 'request',
        aggregateId: opts.aggregateId,
        event: opts.event,
        actorId: opts.actorId,
        beforeJson: opts.before as Prisma.InputJsonValue | undefined,
        afterJson: opts.after as Prisma.InputJsonValue | undefined,
        source: opts.source ?? 'api',
      },
    });
  }
}
