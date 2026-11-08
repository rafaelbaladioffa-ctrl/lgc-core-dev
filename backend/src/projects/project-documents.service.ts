import { createHash } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectDocumentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { validateAttachment } from '../requests/attachment-security.js';

/** Metadados devolvidos na lista (nunca o conteúdo). */
const METADATA_SELECT = {
  id: true,
  projectId: true,
  kind: true,
  version: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  contentHash: true,
  uploadedByUserId: true,
  createdAt: true,
} as const;

/** Evento que avisa os satélites de um documento novo; quem assina este evento pode baixar o
 * conteúdo pela API de integração (integration-query.controller.ts). */
export const PROJECT_DOCUMENT_EVENT = 'project.document_added';

/** Planilhas aceitas como Bid (modelo do RFQ e Bid preenchida): XLSX ou XLSM, ZIP por dentro. */
const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xlsm'];

/** Recusa o que não for planilha `.xlsx`/`.xlsm` (o tipo pelos bytes já foi conferido). */
export function assertSpreadsheet(filename: string, mimeType: string, label: string): void {
  if (mimeType !== 'application/zip' || !SPREADSHEET_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))) {
    throw new BadRequestException(`${label} deve ser uma planilha .xlsx ou .xlsm.`);
  }
}

/** Nome original só para exibição: sem caminho nem caracteres de controle. */
export function displayFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f"]/g, '').trim().slice(0, 255) || 'documento';
}

@Injectable()
export class ProjectDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Envia um documento. Mesmo tipo de novo = versão seguinte; nada é sobrescrito. */
  async add(projectId: string, kind: ProjectDocumentKind, filename: string, contentBase64: string, userId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true, code: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');

    const content = Buffer.from(contentBase64, 'base64');
    const name = displayFilename(filename);
    const mimeType = validateAttachment(content, name);
    if (kind === 'bid_template') assertSpreadsheet(name, mimeType, 'O Bid Template');
    const contentHash = createHash('sha256').update(content).digest('hex');

    return this.prisma.$transaction(async (tx) => {
      // Trava as versões do projeto para dois envios simultâneos não pegarem o mesmo número
      // (o índice único também barra, mas assim o segundo espera em vez de falhar).
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      const last = await tx.projectDocument.findFirst({
        where: { projectId, kind },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const document = await tx.projectDocument.create({
        data: {
          projectId,
          kind,
          version: (last?.version ?? 0) + 1,
          filename: name,
          mimeType,
          sizeBytes: content.length,
          contentHash,
          content,
          uploadedByUserId: userId,
        },
        select: METADATA_SELECT,
      });
      await this.outbox.record(tx, PROJECT_DOCUMENT_EVENT, {
        project_id: project.id,
        code: project.code,
        document_id: document.id,
        kind: document.kind,
        version: document.version,
        filename: document.filename,
        mime_type: document.mimeType,
        size_bytes: document.sizeBytes,
        content_hash: document.contentHash,
        uploaded_at: document.createdAt.toISOString(),
      });
      return document;
    });
  }

  /** Todas as versões, mais nova primeiro, sem conteúdo. */
  async list(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return this.prisma.projectDocument.findMany({
      where: { projectId },
      orderBy: [{ kind: 'asc' }, { version: 'desc' }],
      select: { ...METADATA_SELECT, uploadedBy: { select: { email: true } } },
    });
  }

  async getContent(projectId: string, documentId: string) {
    const document = await this.prisma.projectDocument.findFirst({
      where: { id: documentId, projectId },
      select: { filename: true, mimeType: true, content: true, contentHash: true },
    });
    if (!document) throw new NotFoundException('Documento não encontrado.');
    return document;
  }
}

/** Cabeçalho `Content-Disposition` com o nome original codificado (RFC 5987). */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
