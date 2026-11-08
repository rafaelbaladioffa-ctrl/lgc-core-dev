import { createHash } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { validateAttachment } from '../requests/attachment-security.js';
import { assertSpreadsheet, displayFilename } from './project-documents.service.js';
import { SNAPSHOT_INCLUDE, formatDateOnly, projectEventPayload, toDateOnly } from './projects.service.js';
import type { ProjectQuoteMaterialDto, ReceiveProjectQuoteDto, RequestProjectQuoteDto } from './dto/project-quote.dto.js';

/** Evento do pedido de cotação. Só o satélite que assina este evento pode devolver cotação. */
export const PROJECT_QUOTE_REQUESTED_EVENT = 'project.quote_requested';

/** Metadados da cotação (nunca o conteúdo da Bid). */
const QUOTE_SELECT = {
  id: true,
  projectId: true,
  externalRevisionId: true,
  revisionNumber: true,
  sowDocumentId: true,
  sowDocument: { select: { version: true } },
  workDays: true,
  plannedStartDate: true,
  plannedEndDate: true,
  team: true,
  fieldPeople: true,
  totalHours: true,
  approvedAt: true,
  approvedByEmail: true,
  bidFilename: true,
  bidMimeType: true,
  bidSizeBytes: true,
  bidContentHash: true,
  receivedAt: true,
  satellite: { select: { name: true } },
  materials: {
    orderBy: { materialCode: 'asc' },
    select: { id: true, materialCode: true, logisticsMaterialId: true, description: true, unit: true, quantity: true },
  },
} satisfies Prisma.ProjectQuoteSelect;

type QuoteRow = Prisma.ProjectQuoteGetPayload<{ select: typeof QUOTE_SELECT }>;

export type ProjectQuoteStatus = 'nao_solicitada' | 'aguardando' | 'recebida';

export interface ProjectQuoteTeamLine {
  role_key: string;
  role_name: string;
  field_role: boolean;
  people: number | null;
  days: number | null;
  hours: number;
}

/** Material da cotação como a tela mostra: quantidade em texto decimal, sem preço nem custo. */
export interface ProjectQuoteMaterialView {
  id: string;
  materialCode: string;
  logisticsMaterialId: string | null;
  description: string;
  unit: string;
  quantity: string;
}

function toQuoteView(row: QuoteRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    externalRevisionId: row.externalRevisionId,
    revisionNumber: row.revisionNumber,
    sowDocumentId: row.sowDocumentId,
    sowVersion: row.sowDocument?.version ?? null,
    workDays: row.workDays.toNumber(),
    plannedStartDate: formatDateOnly(row.plannedStartDate),
    plannedEndDate: formatDateOnly(row.plannedEndDate),
    team: row.team as unknown as ProjectQuoteTeamLine[],
    fieldPeople: row.fieldPeople,
    totalHours: row.totalHours.toNumber(),
    approvedAt: row.approvedAt,
    approvedByEmail: row.approvedByEmail,
    bidFilename: row.bidFilename,
    bidMimeType: row.bidMimeType,
    bidSizeBytes: row.bidSizeBytes,
    bidContentHash: row.bidContentHash,
    receivedAt: row.receivedAt,
    satelliteName: row.satellite.name,
    materials: row.materials.map(
      (m): ProjectQuoteMaterialView => ({
        id: m.id,
        materialCode: m.materialCode,
        logisticsMaterialId: m.logisticsMaterialId,
        description: m.description,
        unit: m.unit,
        quantity: m.quantity.toFixed(3),
      }),
    ),
  };
}

/**
 * Cotação do projeto pelo Financeiro (docs/integracao-core-financeiro.md §4):
 * o Core pede com a SOW vigente e o Financeiro devolve, por revisão aprovada para envio, a Bid
 * preenchida e a equipe orçada. Custo, salário e lucro ficam só no Financeiro.
 */
@Injectable()
export class ProjectQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * "Solicitar cotação": só proposta com SOW e Bid Template do RFQ. Pode ser repetido (ex.: SOW nova);
   * cada pedido fica no histórico com as versões vigentes dos dois documentos.
   */
  async request(projectId: string, dto: RequestProjectQuoteDto, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, include: SNAPSHOT_INCLUDE });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    if (project.status !== 'proposta') {
      throw new BadRequestException('Só é possível solicitar cotação de projeto em proposta.');
    }
    const [sow, bidTemplate] = await Promise.all([this.latestDocument(projectId, 'sow'), this.latestDocument(projectId, 'bid_template')]);
    if (!sow && !bidTemplate) throw new BadRequestException('Anexe a SOW e o Bid Template do cliente antes de solicitar a cotação.');
    if (!sow) throw new BadRequestException('Anexe a SOW do cliente antes de solicitar a cotação.');
    if (!bidTemplate) throw new BadRequestException('Anexe o Bid Template do cliente antes de solicitar a cotação.');

    return this.prisma.$transaction(async (tx) => {
      const request = await tx.projectQuoteRequest.create({
        data: { projectId, sowDocumentId: sow.id, bidTemplateDocumentId: bidTemplate.id, notes: dto.notes ?? null, requestedByUserId: userId },
        select: { id: true, createdAt: true, notes: true, requestedBy: { select: { email: true } } },
      });
      await this.outbox.record(tx, PROJECT_QUOTE_REQUESTED_EVENT, {
        ...projectEventPayload(project),
        quote_request_id: request.id,
        sow_document_id: sow.id,
        sow_version: sow.version,
        sow_filename: sow.filename,
        sow_content_hash: sow.contentHash,
        bid_template_document_id: bidTemplate.id,
        bid_template_version: bidTemplate.version,
        bid_template_filename: bidTemplate.filename,
        bid_template_content_hash: bidTemplate.contentHash,
        notes: request.notes,
        requested_by_user_id: userId,
        requested_by_email: request.requestedBy.email,
        requested_at: request.createdAt.toISOString(),
      });
      return {
        id: request.id,
        createdAt: request.createdAt,
        notes: request.notes,
        sowVersion: sow.version,
        bidTemplateVersion: bidTemplate.version,
        requestedByEmail: request.requestedBy.email,
      };
    });
  }

  /** Pedidos e cotações do projeto, mais recentes primeiro, com a situação atual. */
  async list(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    const [requests, quotes] = await Promise.all([
      this.prisma.projectQuoteRequest.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          createdAt: true,
          notes: true,
          requestedBy: { select: { email: true } },
          sowDocument: { select: { version: true } },
          bidTemplateDocument: { select: { version: true } },
        },
      }),
      this.prisma.projectQuote.findMany({ where: { projectId }, orderBy: [{ revisionNumber: 'desc' }, { receivedAt: 'desc' }], select: QUOTE_SELECT }),
    ]);
    return {
      status: quoteStatus(requests[0]?.createdAt ?? null, latestReceivedAt(quotes)),
      requests: requests.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        notes: r.notes,
        requestedByEmail: r.requestedBy.email,
        sowVersion: r.sowDocument.version,
        bidTemplateVersion: r.bidTemplateDocument?.version ?? null,
      })),
      quotes: quotes.map(toQuoteView),
    };
  }

  async getBid(projectId: string, quoteId: string) {
    const quote = await this.prisma.projectQuote.findFirst({
      where: { id: quoteId, projectId },
      select: { bidFilename: true, bidMimeType: true, bidContent: true, bidContentHash: true },
    });
    if (!quote) throw new NotFoundException('Cotação não encontrada.');
    return quote;
  }

  /**
   * Recebe a cotação do satélite. Reenviar a mesma revisão com a mesma Bid e os mesmos materiais devolve a
   * cotação já gravada (o satélite reenvia até receber resposta); com conteúdo diferente (Bid ou materiais) é
   * conflito, porque revisão aprovada não muda no Financeiro.
   */
  async receive(projectId: string, satelliteId: string, dto: ReceiveProjectQuoteDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');

    if (dto.sow_document_id) {
      const sow = await this.prisma.projectDocument.findFirst({
        where: { id: dto.sow_document_id, projectId, kind: 'sow' },
        select: { id: true },
      });
      if (!sow) throw new BadRequestException('A SOW informada não pertence a este projeto.');
    }
    if (dto.planned_start_date && dto.planned_end_date && dto.planned_end_date < dto.planned_start_date) {
      throw new BadRequestException('A conclusão prevista não pode ser antes do início.');
    }
    const team = normalizeTeam(dto);
    const materials = normalizeMaterials(dto.materials);

    const filename = displayFilename(dto.bid.filename);
    const content = Buffer.from(dto.bid.content_base64, 'base64');
    const mimeType = validateAttachment(content, filename);
    assertSpreadsheet(filename, mimeType, 'A Bid');
    const contentHash = createHash('sha256').update(content).digest('hex');

    const existing = await this.findExisting(satelliteId, dto.external_revision_id);
    if (existing) return this.resolveDuplicate(existing, projectId, contentHash, materials);

    try {
      const created = await this.prisma.projectQuote.create({
        data: {
          projectId,
          satelliteId,
          externalRevisionId: dto.external_revision_id,
          revisionNumber: dto.revision_number,
          sowDocumentId: dto.sow_document_id ?? null,
          workDays: new Prisma.Decimal(dto.work_days),
          plannedStartDate: toDateOnly(dto.planned_start_date ?? null),
          plannedEndDate: toDateOnly(dto.planned_end_date ?? null),
          team: team.lines as unknown as Prisma.InputJsonValue,
          fieldPeople: team.fieldPeople,
          totalHours: new Prisma.Decimal(team.totalHours),
          approvedAt: dto.approved_at ? new Date(dto.approved_at) : null,
          approvedByEmail: dto.approved_by_email ?? null,
          bidFilename: filename,
          bidMimeType: mimeType,
          bidSizeBytes: content.length,
          bidContentHash: contentHash,
          bidContent: content,
          materials: {
            create: materials.map((m) => ({ materialCode: m.material_code, description: m.description, unit: m.unit, quantity: new Prisma.Decimal(m.quantity) })),
          },
        },
        select: QUOTE_SELECT,
      });
      return toQuoteView(created);
    } catch (err) {
      // Dois envios simultâneos da mesma revisão: o segundo bate no índice único.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findExisting(satelliteId, dto.external_revision_id);
        if (raced) return this.resolveDuplicate(raced, projectId, contentHash, materials);
      }
      throw err;
    }
  }

  private latestDocument(projectId: string, kind: 'sow' | 'bid_template') {
    return this.prisma.projectDocument.findFirst({
      where: { projectId, kind },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, filename: true, contentHash: true },
    });
  }

  private findExisting(satelliteId: string, externalRevisionId: string) {
    return this.prisma.projectQuote.findUnique({
      where: { satelliteId_externalRevisionId: { satelliteId, externalRevisionId } },
      select: QUOTE_SELECT,
    });
  }

  private resolveDuplicate(existing: QuoteRow, projectId: string, contentHash: string, materials: NormalizedMaterial[]) {
    if (existing.projectId !== projectId || existing.bidContentHash !== contentHash || !sameMaterials(existing.materials, materials)) {
      throw new ConflictException('Esta revisão já foi recebida com outro conteúdo. Envie uma nova revisão.');
    }
    return toQuoteView(existing);
  }
}

function latestReceivedAt(quotes: { receivedAt: Date }[]): Date | null {
  return quotes.reduce<Date | null>((max, q) => (!max || q.receivedAt > max ? q.receivedAt : max), null);
}

/** Aguardando = há pedido mais novo que a última cotação recebida. */
export function quoteStatus(lastRequestAt: Date | null, lastQuoteAt: Date | null): ProjectQuoteStatus {
  if (!lastRequestAt && !lastQuoteAt) return 'nao_solicitada';
  if (lastRequestAt && (!lastQuoteAt || lastRequestAt > lastQuoteAt)) return 'aguardando';
  return 'recebida';
}

/** Função de campo precisa de pessoas e dias; as horas vêm do Financeiro (fonte do cálculo). */
export function normalizeTeam(dto: Pick<ReceiveProjectQuoteDto, 'team'>) {
  const keys = new Set<string>();
  let fieldPeople = 0;
  let totalHours = 0;
  const lines: ProjectQuoteTeamLine[] = dto.team.map((line) => {
    if (keys.has(line.role_key)) throw new BadRequestException(`Função repetida na equipe: ${line.role_key}.`);
    keys.add(line.role_key);
    if (line.field_role && (line.people === undefined || line.days === undefined)) {
      throw new BadRequestException(`Informe pessoas e dias da função de campo ${line.role_name}.`);
    }
    if (line.field_role) fieldPeople += line.people ?? 0;
    totalHours += line.hours;
    return {
      role_key: line.role_key,
      role_name: line.role_name,
      field_role: line.field_role,
      people: line.people ?? null,
      days: line.days ?? null,
      hours: line.hours,
    };
  });
  return { lines, fieldPeople, totalHours: Math.round(totalHours * 100) / 100 };
}

export interface NormalizedMaterial {
  material_code: string;
  description: string;
  unit: string;
  /** Texto decimal com 3 casas. */
  quantity: string;
}

/**
 * Materiais da cotação: `material_code` repetido é erro do remetente (`400`) e a quantidade precisa ser
 * maior que zero. Ausente = lista vazia (cotações antigas, sem materiais).
 */
export function normalizeMaterials(materials: ProjectQuoteMaterialDto[] | undefined): NormalizedMaterial[] {
  const codes = new Set<string>();
  return (materials ?? []).map((m) => {
    const code = m.material_code.trim();
    if (codes.has(code)) throw new BadRequestException(`Material repetido na cotação: ${code}.`);
    codes.add(code);
    const quantity = new Prisma.Decimal(m.quantity);
    if (!quantity.gt(0)) throw new BadRequestException(`Quantidade do material ${code} deve ser maior que zero.`);
    return { material_code: code, description: m.description.trim(), unit: m.unit.trim(), quantity: quantity.toFixed(3) };
  });
}

/** Mesmos códigos, descrições, unidades e quantidades, na ordem que for. */
export function sameMaterials(stored: Array<{ materialCode: string; description: string; unit: string; quantity: Prisma.Decimal }>, incoming: NormalizedMaterial[]): boolean {
  if (stored.length !== incoming.length) return false;
  const key = (code: string, description: string, unit: string, quantity: string) => `${code}|${description}|${unit}|${quantity}`;
  const have = new Set(stored.map((m) => key(m.materialCode, m.description, m.unit, m.quantity.toFixed(3))));
  return incoming.every((m) => have.has(key(m.material_code, m.description, m.unit, m.quantity)));
}
