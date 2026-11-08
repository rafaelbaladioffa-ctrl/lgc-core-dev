import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectDocumentsService, contentDisposition } from './project-documents.service.js';

/** SOW anexada ao projeto do Core, consumida pelo Financeiro. Prisma simulado. */

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('conteúdo fictício de SOW')]).toString('base64');

function fixture({ lastVersion = 0, project = { id: 'p-1', code: 'PROP-7.012-1126' } as { id: string; code: string } | null } = {}) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
    projectDocument: {
      findFirst: vi.fn().mockResolvedValue(lastVersion ? { version: lastVersion } : null),
      create: vi.fn(async ({ data }) => ({
        id: 'doc-1',
        projectId: data.projectId,
        kind: data.kind,
        version: data.version,
        filename: data.filename,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        contentHash: data.contentHash,
        uploadedByUserId: data.uploadedByUserId,
        createdAt: new Date('2026-11-07T15:00:00Z'),
      })),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'p-1' }]),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new ProjectDocumentsService(prisma, outbox as any), prisma, outbox };
}

describe('ProjectDocumentsService.add', () => {
  it('grava a primeira versão da SOW e emite project.document_added na mesma transação', async () => {
    const { service, prisma, outbox } = fixture();
    const doc = await service.add('p-1', 'sow', 'SOW Campinas.pdf', PDF, 'user-1');

    const data = prisma.projectDocument.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ projectId: 'p-1', kind: 'sow', version: 1, filename: 'SOW Campinas.pdf', mimeType: 'application/pdf', uploadedByUserId: 'user-1' });
    expect(data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(doc).not.toHaveProperty('content');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'project.document_added', expect.objectContaining({
      project_id: 'p-1',
      code: 'PROP-7.012-1126',
      document_id: 'doc-1',
      kind: 'sow',
      version: 1,
      mime_type: 'application/pdf',
      content_hash: data.contentHash,
      uploaded_at: '2026-11-07T15:00:00.000Z',
    }));
  });

  it('novo envio vira a versão seguinte, sem sobrescrever', async () => {
    const { service, prisma } = fixture({ lastVersion: 2 });
    await service.add('p-1', 'sow', 'SOW rev3.pdf', PDF, 'user-1');
    expect(prisma.projectDocument.create.mock.calls[0][0].data.version).toBe(3);
  });

  it('tira caminho do nome do arquivo', async () => {
    const { service, prisma } = fixture();
    await service.add('p-1', 'sow', 'C:\\Users\\x\\..\\SOW.pdf', PDF, 'user-1');
    expect(prisma.projectDocument.create.mock.calls[0][0].data.filename).toBe('SOW.pdf');
  });

  it('recusa executável disfarçado', async () => {
    const { service, outbox } = fixture();
    const exe = Buffer.from('MZ\x90\x00 fake').toString('base64');
    await expect(service.add('p-1', 'sow', 'sow.pdf', exe, 'user-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('projeto inexistente → 404', async () => {
    const { service } = fixture({ project: null });
    await expect(service.add('p-x', 'sow', 'sow.pdf', PDF, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('Bid Template só aceita planilha .xlsx ou .xlsm', async () => {
    const { service, prisma } = fixture();
    const xlsm = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('planilha fictícia')]).toString('base64');
    await service.add('p-1', 'bid_template', 'Bid Template 3.26.xlsm', xlsm, 'user-1');
    expect(prisma.projectDocument.create.mock.calls[0][0].data).toMatchObject({ kind: 'bid_template', mimeType: 'application/zip' });
    await expect(service.add('p-1', 'bid_template', 'Bid.pdf', PDF, 'user-1')).rejects.toThrow('planilha');
    await expect(service.add('p-1', 'bid_template', 'Bid.docx', xlsm, 'user-1')).rejects.toThrow('planilha');
  });
});

describe('contentDisposition', () => {
  it('mantém o nome com acento em filename* e troca por _ no fallback ASCII', () => {
    expect(contentDisposition('SOW São Paulo.pdf')).toBe(
      `attachment; filename="SOW S_o Paulo.pdf"; filename*=UTF-8''SOW%20S%C3%A3o%20Paulo.pdf`,
    );
  });
});
