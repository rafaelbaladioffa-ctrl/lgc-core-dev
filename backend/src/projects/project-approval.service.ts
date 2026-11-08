import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { findLatestPublishedVersion } from '../request-categories/category-kind.js';
import {
  DEFAULT_SHIPMENT_LEAD_BUSINESS_DAYS,
  PROJECT_APPROVED_ORIGIN,
  SHIPMENT_CATEGORY_CODE,
  SYSTEM_ACTOR_EMAIL,
  formatSiteAddress,
  resolveShipmentApprover,
  subtractBusinessDays,
  type ShipmentData,
} from '../requests/envio-material.js';
import { nextRequestCode } from '../requests/request-number.js';
import { LogisticsMaterialsClient, type LogisticsLookup } from './logistics-materials.client.js';
import { formatDateOnly, projectEventPayload } from './projects.service.js';
import type { ApproveProjectDto } from './dto/update-project-status.dto.js';

type Tx = Prisma.TransactionClient;

export const PROJECT_APPROVED_EVENT = 'project.approved';

const APPROVAL_INCLUDE = {
  costCenter: { select: { id: true, code: true, name: true } },
  site: true,
  responsibleCollaborator: { select: { id: true, fullName: true } },
} satisfies Prisma.ProjectInclude;

const QUOTE_INCLUDE = { materials: { orderBy: { materialCode: 'asc' } } } satisfies Prisma.ProjectQuoteInclude;
type QuoteWithMaterials = Prisma.ProjectQuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;
type ProjectForApproval = Prisma.ProjectGetPayload<{ include: typeof APPROVAL_INCLUDE }>;

/**
 * Aprovar o projeto (PT-06, PA-07/PA-09/PA-10; contrato em docs/dominio/cadastros.md §10 e
 * docs/integracao-core-financeiro.md §2): numa só transação muda o status para `aprovado`, grava o aceite
 * (`project_acceptances`), cria a requisição `envio_material` (se a cotação aceita tem materiais) e grava no
 * outbox `project.status_changed`, `project.approved` e `request.submitted`.
 */
@Injectable()
export class ProjectApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly logistics: LogisticsMaterialsClient,
    private readonly config: ConfigService,
  ) {}

  async approve(projectId: string, dto: ApproveProjectDto, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: APPROVAL_INCLUDE });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    this.assertApprovable(project);
    const quote = await this.resolveQuote(projectId, dto.acceptedQuoteId);

    // A consulta à Logística (custo médio para o valor estimado) fica fora da transação: nunca segura o banco
    // esperando HTTP e, se falhar, não impede a aprovação (valor 0 e aviso na requisição).
    const lookup = quote.materials.length > 0 ? await this.logistics.lookup(quote.materials.map((m) => m.materialCode)) : null;

    return this.prisma.$transaction(async (tx) => {
      // Dois cliques simultâneos: o segundo espera o primeiro e vê o projeto já aprovado.
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const current = await tx.project.findUnique({ where: { id: projectId }, include: APPROVAL_INCLUDE });
      if (!current) throw new NotFoundException('Projeto não encontrado.');
      this.assertApprovable(current);

      const now = new Date();
      const updated = await tx.project.update({ where: { id: projectId }, data: { status: 'aprovado' }, include: APPROVAL_INCLUDE });
      const acceptance = await tx.projectAcceptance.create({
        data: { projectId, projectQuoteId: quote.id, clientPoNumber: dto.clientPoNumber ?? null, acceptedByUserId: userId, acceptedAt: now },
      });
      const shipmentRequest = quote.materials.length > 0 ? await this.createShipmentRequest(tx, updated, quote, lookup, now) : null;

      await this.outbox.record(tx, 'project.status_changed', { ...projectEventPayload(updated), previous_status: 'proposta' });
      // Cotação sem SOW (ex.: modelo genérico do Financeiro, sem pedido de cotação): o Field ainda precisa
      // da SOW para gerar as tarefas, então vai a versão mais recente anexada ao projeto.
      const sowDocumentId = quote.sowDocumentId
        ?? (await tx.projectDocument.findFirst({ where: { projectId: updated.id, kind: 'sow' }, orderBy: { version: 'desc' }, select: { id: true } }))?.id
        ?? null;
      await this.outbox.record(tx, PROJECT_APPROVED_EVENT, projectApprovedPayload(updated, { ...quote, sowDocumentId }, {
        clientPoNumber: acceptance.clientPoNumber,
        materialRequestId: shipmentRequest?.id ?? null,
        approvedByUserId: userId,
        approvedAt: now,
      }));
      if (shipmentRequest) await this.outbox.record(tx, 'request.submitted', { request_id: shipmentRequest.id, code: shipmentRequest.code });

      return {
        ...updated,
        materialRequest: shipmentRequest ? { id: shipmentRequest.id, code: shipmentRequest.code, status: shipmentRequest.status } : null,
        withoutMaterials: !shipmentRequest,
      };
    });
  }

  /** Aceite do projeto e a requisição de envio gerada, para a tela do projeto. `acceptance: null` em proposta. */
  async getAcceptance(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    const acceptance = await this.prisma.projectAcceptance.findUnique({
      where: { projectId },
      include: { projectQuote: { select: { id: true, revisionNumber: true } }, acceptedBy: { select: { email: true } } },
    });
    if (!acceptance) return { acceptance: null, materialRequest: null };
    const request = await this.prisma.request.findUnique({
      where: { origin_sourceRef: { origin: PROJECT_APPROVED_ORIGIN, sourceRef: acceptance.projectQuoteId } },
      select: { id: true, code: true, status: true, estimatedValue: true, neededBy: true },
    });
    return {
      acceptance: {
        id: acceptance.id,
        projectQuoteId: acceptance.projectQuoteId,
        revisionNumber: acceptance.projectQuote.revisionNumber,
        clientPoNumber: acceptance.clientPoNumber,
        acceptedByEmail: acceptance.acceptedBy.email,
        acceptedAt: acceptance.acceptedAt,
      },
      materialRequest: request
        ? { id: request.id, code: request.code, status: request.status, estimatedValue: request.estimatedValue?.toFixed(2) ?? null, neededBy: formatDateOnly(request.neededBy) }
        : null,
    };
  }

  private assertApprovable(project: ProjectForApproval): void {
    if (project.status !== 'proposta') {
      throw new BadRequestException(`Não é possível mudar o projeto de "${project.status}" para "aprovado".`);
    }
    if (!project.siteId || !project.site) throw new BadRequestException('Informe o site do projeto antes de aprovar.');
    if (!project.site.active) throw new BadRequestException('O site do projeto está inativo. Reative o site ou escolha outro antes de aprovar.');
  }

  /** Cotação aceita: a informada (do próprio projeto) ou a vigente (maior revisão). Sem nenhuma, 400. */
  private async resolveQuote(projectId: string, acceptedQuoteId: string | undefined): Promise<QuoteWithMaterials> {
    if (acceptedQuoteId) {
      const quote = await this.prisma.projectQuote.findFirst({ where: { id: acceptedQuoteId, projectId }, include: QUOTE_INCLUDE });
      if (!quote) throw new BadRequestException('A cotação informada não pertence ao projeto.');
      return quote;
    }
    const current = await this.prisma.projectQuote.findFirst({ where: { projectId }, orderBy: { revisionNumber: 'desc' }, include: QUOTE_INCLUDE });
    if (!current) throw new BadRequestException('O projeto não tem cotação recebida do Financeiro. Solicite a cotação antes de aprovar.');
    return current;
  }

  /**
   * Requisição `envio_material` (PA-09): solicitante e "beneficiário" = colaborador de sistema, recebedor = responsável
   * do projeto, itens da cotação aceita, destino = site, `needed_by` = início previsto − 5 dias úteis, valor
   * estimado = Σ quantidade × custo médio da Logística. Nasce `aguardando_aprovacao`, com a linha `centro_custo`
   * do responsável do CC do projeto (ou do CC pai); sem nenhum, fica sem linha e o admin de Requisições é alertado
   * em Minhas atividades (`sem_aprovador`).
   */
  private async createShipmentRequest(tx: Tx, project: ProjectForApproval, quote: QuoteWithMaterials, lookup: LogisticsLookup | null, now: Date) {
    const site = project.site!;
    // Aprovar de novo não duplica: (origin, source_ref) é único.
    const existing = await tx.request.findUnique({ where: { origin_sourceRef: { origin: PROJECT_APPROVED_ORIGIN, sourceRef: quote.id } } });
    if (existing) return existing;

    const system = await tx.collaborator.findUnique({ where: { corporateEmail: SYSTEM_ACTOR_EMAIL }, select: { id: true } });
    const category = await tx.requestCategory.findUnique({ where: { code: SHIPMENT_CATEGORY_CODE } });
    const version = category ? await findLatestPublishedVersion(tx, category.id) : null;
    if (!system || !category || !version) {
      throw new InternalServerErrorException('O envio de material não está configurado (usuário de sistema ou categoria ausentes). Aplique as migrações do Core e rode o seed.');
    }

    const warnings: string[] = [];
    const estimate = this.estimate(quote, lookup, warnings);
    const neededBy = await this.neededBy(tx, quote.plannedStartDate ?? project.plannedStartDate);
    const approver = await resolveShipmentApprover(tx, project.costCenterId);
    if (!approver) {
      warnings.push('Sem responsável no centro de custo do projeto nem no centro de custo pai: cadastre o responsável e use "Reavaliar aprovador".');
    }

    // Resolve `logistics_material_id` no servidor (nulo desde o PT-05), só quando a consulta à Logística respondeu.
    if (lookup?.ok) {
      for (const material of quote.materials) {
        const found = lookup.materials.get(material.materialCode);
        if (found && material.logisticsMaterialId !== found.id) {
          await tx.projectQuoteMaterial.update({ where: { id: material.id }, data: { logisticsMaterialId: found.id } });
        }
      }
    }

    const shipment: ShipmentData = {
      projectQuoteId: quote.id,
      recipientCollaboratorId: project.responsibleCollaboratorId,
      recipientName: project.responsibleCollaborator?.fullName ?? null,
      neededBy,
      destination: {
        siteId: site.id,
        siteCode: site.code,
        siteName: site.name,
        address: formatSiteAddress(site),
        city: site.addressCity,
        state: site.addressState,
        latitude: site.latitude,
        longitude: site.longitude,
      },
      items: quote.materials.map((m) => ({
        materialCode: m.materialCode,
        logisticsMaterialId: (lookup?.ok ? lookup.materials.get(m.materialCode)?.id : undefined) ?? m.logisticsMaterialId,
        description: m.description,
        unit: m.unit,
        quantity: m.quantity.toFixed(3),
      })),
      warnings,
      approvedAt: null,
    };

    let queue = await tx.queue.findFirst({ where: { sectorId: category.sectorId }, orderBy: { createdAt: 'asc' } });
    if (!queue) {
      const sector = await tx.sector.findUniqueOrThrow({ where: { id: category.sectorId }, select: { name: true } });
      queue = await tx.queue.create({ data: { sectorId: category.sectorId, name: `Fila - ${sector.name}` } });
    }

    const projectLabel = project.name ? `${project.code} — ${project.name}` : project.code;
    const code = await nextRequestCode(tx);
    const request = await tx.request.create({
      data: {
        code,
        categoryVersionId: version.id,
        sectorId: category.sectorId,
        queueId: queue.id,
        requesterId: system.id,
        beneficiaryId: system.id,
        title: `Envio de material para obra - ${site.code}`.slice(0, 120),
        description: `Envio dos materiais da cotação (revisão ${quote.revisionNumber}) do projeto ${projectLabel} para o site ${site.code} — ${site.name}.`,
        priority: 'normal',
        confidentiality: category.confidentiality,
        status: 'aguardando_aprovacao',
        neededBy: neededBy ? new Date(`${neededBy}T00:00:00Z`) : undefined,
        projectId: project.id,
        costCenterId: project.costCenterId,
        estimatedValue: estimate,
        formData: { shipment } as unknown as Prisma.InputJsonValue,
        origin: PROJECT_APPROVED_ORIGIN,
        sourceRef: quote.id,
        submittedAt: now,
      },
    });
    if (approver) {
      await tx.requestApproval.create({
        data: { requestId: request.id, stepOrder: 1, approverId: approver.approverId, completionRule: 'todos', approvalSource: 'centro_custo' },
      });
    }
    await this.audit(tx, request.id, 'request.created', system.id, { status: 'aguardando_aprovacao', code, origin: PROJECT_APPROVED_ORIGIN, projectId: project.id });
    await this.audit(tx, request.id, 'request.submitted', system.id, {
      status: 'aguardando_aprovacao',
      approverId: approver?.approverId ?? null,
      ...(approver?.fallback ? { approverFallback: approver.fallback } : {}),
    });
    if (!approver) await this.audit(tx, request.id, 'request.shipment_without_approver', system.id, { costCenterId: project.costCenterId });
    return request;
  }

  /** Σ quantidade × custo médio; a Logística fora do ar (ou material sem custo) dá 0 e um aviso, nunca erro. */
  private estimate(quote: QuoteWithMaterials, lookup: LogisticsLookup | null, warnings: string[]): Prisma.Decimal {
    if (!lookup) return new Prisma.Decimal(0);
    if (!lookup.ok) {
      warnings.push(`Valor estimado não calculado (ficou em R$ 0,00): ${lookup.reason}`);
      return new Prisma.Decimal(0);
    }
    const missing: string[] = [];
    const withoutCost: string[] = [];
    let total = new Prisma.Decimal(0);
    for (const material of quote.materials) {
      const found = lookup.materials.get(material.materialCode);
      if (!found) {
        missing.push(material.materialCode);
      } else if (found.averageCost === null) {
        withoutCost.push(material.materialCode);
      } else {
        total = total.plus(material.quantity.times(found.averageCost));
      }
    }
    if (missing.length > 0) {
      warnings.push(`Material não encontrado ou inativo na Logística: ${missing.join(', ')}. A Logística recusará a ordem até o cadastro ser corrigido.`);
    }
    if (withoutCost.length > 0) {
      warnings.push(`Sem custo médio na Logística (contam como zero no valor estimado): ${withoutCost.join(', ')}.`);
    }
    return total.toDecimalPlaces(2);
  }

  /** Início previsto menos a folga em dias úteis (padrão 5, `SHIPMENT_LEAD_BUSINESS_DAYS`), `AAAA-MM-DD` ou `null`. */
  private async neededBy(tx: Tx, plannedStart: Date | null): Promise<string | null> {
    if (!plannedStart) return null;
    const configured = Number(this.config.get<string>('SHIPMENT_LEAD_BUSINESS_DAYS'));
    const lead = Number.isInteger(configured) && configured >= 0 ? configured : DEFAULT_SHIPMENT_LEAD_BUSINESS_DAYS;
    const from = new Date(plannedStart.getTime() - 90 * 24 * 60 * 60 * 1000);
    const holidays = await tx.holiday.findMany({ where: { date: { gte: from, lte: plannedStart } }, select: { date: true } });
    const set = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));
    return formatDateOnly(subtractBusinessDays(plannedStart, lead, set));
  }

  private async audit(tx: Tx, aggregateId: string, event: string, actorId: string, after: Record<string, unknown>): Promise<void> {
    await tx.auditEvent.create({
      data: { aggregateType: 'request', aggregateId, event, actorId, afterJson: after as Prisma.InputJsonValue, source: 'api' },
    });
  }
}

/**
 * Payload do `project.approved` (§4.2 do plano): estado completo do projeto (como todo `project.*`) mais `site`,
 * `accepted_quote`, `client_po_number`, `material_request_id`, `approved_by_user_id` e `approved_at`. Assinantes: Financeiro e Field.
 */
export function projectApprovedPayload(
  project: ProjectForApproval,
  quote: Pick<QuoteWithMaterials, 'id' | 'externalRevisionId' | 'revisionNumber' | 'workDays' | 'plannedStartDate' | 'plannedEndDate' | 'team' | 'sowDocumentId'>,
  extra: { clientPoNumber: string | null; materialRequestId: string | null; approvedByUserId: string; approvedAt: Date },
): Record<string, unknown> {
  const site = project.site!;
  return {
    ...projectEventPayload(project),
    site: {
      site_id: site.id,
      code: site.code,
      name: site.name,
      cep: site.cep,
      address_street: site.addressStreet,
      address_number: site.addressNumber,
      address_complement: site.addressComplement,
      address_district: site.addressDistrict,
      address_city: site.addressCity,
      address_state: site.addressState,
      latitude: site.latitude,
      longitude: site.longitude,
    },
    accepted_quote: {
      project_quote_id: quote.id,
      external_revision_id: quote.externalRevisionId,
      revision_number: quote.revisionNumber,
      work_days: quote.workDays.toNumber(),
      planned_start_date: formatDateOnly(quote.plannedStartDate),
      planned_end_date: formatDateOnly(quote.plannedEndDate),
      team: quote.team,
      sow_document_id: quote.sowDocumentId,
    },
    client_po_number: extra.clientPoNumber,
    material_request_id: extra.materialRequestId,
    approved_by_user_id: extra.approvedByUserId,
    approved_at: extra.approvedAt.toISOString(),
  };
}
