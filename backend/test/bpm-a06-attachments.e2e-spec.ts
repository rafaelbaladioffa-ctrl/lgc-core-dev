import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import { RequestRuntimeService } from '../src/request-runtime/request-runtime.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-request.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const pdf = Buffer.from('%PDF-1.7\nA06 replacement\n%%EOF\n');

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)('A06 — BPM attachments', () => {
  let prisma: PrismaClient;
  let config: RequestProcessesService;
  let runtime: RequestRuntimeService;
  let author: AuthenticatedUser;
  let categoryId: string;
  let versionId: string;
  const prefix = `a06-${randomUUID()}`;
  const enabled = { get: () => 'true' } as any;

  const command = (expectedVersion: number) => ({
    expectedVersion,
    commandKey: randomUUID(),
    commandId: randomUUID(),
  });

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: requireBpmTestDatabaseUrl() } },
    });
    await prisma.$connect();
    config = new RequestProcessesService(prisma as any, enabled);
    runtime = new RequestRuntimeService(prisma as any, enabled);

    const sector = await prisma.sector.create({ data: { code: prefix, name: prefix } });
    const job = await prisma.jobTitle.create({ data: { name: prefix } });
    const role = await prisma.role.create({
      data: {
        name: prefix,
        rolePermissions: {
          create: ['request:create', 'request:read', 'request:comment', 'request_process:model', 'request_process:publish', 'request_queue:manage', 'request_category:create'].map((permission) => {
            const [resource, action] = permission.split(':');
            return {
              permission: {
                connectOrCreate: {
                  where: { resource_action: { resource, action } },
                  create: { resource, action },
                },
              },
            };
          }),
        },
      },
    });
    const collaborator = await prisma.collaborator.create({
      data: {
        fullName: prefix,
        rgEnc: 'synthetic',
        cpfEnc: 'synthetic',
        cpfHash: randomUUID(),
        corporateEmail: `${randomUUID()}@example.invalid`,
        matricula: randomUUID(),
        sectorId: sector.id,
        jobTitleId: job.id,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'synthetic-not-a-login',
        collaboratorId: collaborator.id,
        userRoles: { create: { roleId: role.id } },
      },
    });
    author = {
      userId: user.id,
      email: user.email,
      mustChangePassword: false,
      collaboratorId: collaborator.id,
      permissions: ['request:create', 'request:read', 'request:comment', 'request_process:model', 'request_process:publish', 'request_queue:manage', 'request_category:create'],
      roles: [],
    } as AuthenticatedUser;

    const queue = await config.createQueue({
      sectorId: sector.id,
      name: prefix,
      members: [collaborator.id],
      managers: [collaborator.id],
    }, author);
    const process = await config.createProcess({
      code: prefix,
      name: prefix,
      description: 'A06 attachment fixture',
      sectorId: sector.id,
      triageQueueId: queue.id,
      executionQueueId: queue.id,
      publisherUserIds: [author.userId],
    }, author);
    categoryId = process.id;
    versionId = process.versionId;
    const validation = await config.validateVersion(versionId, 0, author);
    if (!('validatedHash' in validation)) throw new Error('A06 fixture version did not validate');
    await config.publishVersion(versionId, { expectedVersion: 0, validatedHash: validation.validatedHash }, author);
    const category = await prisma.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
    await config.enableProcess(categoryId, { expectedVersion: category.configRevision }, author);
  }, 30000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('stores real PDF/PNG bytes and hash, versions replacements, and rejects oversized/fake/cross-request access without effects', async () => {
    const first = await runtime.create({ categoryId, versionId, title: 'A06 first request', description: 'Attachment fixture' }, author);
    const second = await runtime.create({ categoryId, versionId, title: 'A06 second request', description: 'Attachment fixture' }, author);

    const firstUpload = await runtime.attachment(first.id, {
      ...command(0),
      filename: 'evidence.png',
      contentBase64: png.toString('base64'),
    }, author);
    const storedPng = await prisma.bpmRequestAttachment.findUniqueOrThrow({ where: { id: firstUpload.id } });
    expect(storedPng.mimeType).toBe('image/png');
    expect(storedPng.contentHash).toBe(createHash('sha256').update(png).digest('hex'));
    expect(Buffer.from(storedPng.content)).toEqual(png);
    expect((await runtime.download(first.id, firstUpload.id, author)).content).toEqual(png);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: first.id } })).lockVersion).toBe(1);

    const replacement = await runtime.attachment(first.id, {
      ...command(1),
      filename: 'evidence.pdf',
      contentBase64: pdf.toString('base64'),
      previousId: firstUpload.id,
    }, author);
    const storedPdf = await prisma.bpmRequestAttachment.findUniqueOrThrow({ where: { id: replacement.id } });
    expect(replacement.version).toBe(2);
    expect(storedPdf.previousId).toBe(firstUpload.id);
    expect(storedPdf.mimeType).toBe('application/pdf');
    expect(storedPdf.contentHash).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(Buffer.from(storedPdf.content)).toEqual(pdf);
    expect(Buffer.from((await runtime.download(first.id, firstUpload.id, author)).content)).toEqual(png);
    expect(Buffer.from((await runtime.download(first.id, replacement.id, author)).content)).toEqual(pdf);

    const countBeforeRejects = await prisma.bpmRequestAttachment.count({ where: { requestId: first.id } });
    await expect(runtime.attachment(first.id, {
      ...command(2),
      filename: 'fake.pdf',
      contentBase64: Buffer.from('this is not a PDF').toString('base64'),
    }, author)).rejects.toThrow();
    await expect(runtime.attachment(first.id, {
      ...command(2),
      filename: 'too-large.png',
      contentBase64: Buffer.alloc(25 * 1024 * 1024 + 1, 0).toString('base64'),
    }, author)).rejects.toThrow(/25 MB/);
    expect(await prisma.bpmRequestAttachment.count({ where: { requestId: first.id } })).toBe(countBeforeRejects);

    await expect(runtime.download(second.id, firstUpload.id, author)).rejects.toMatchObject({ status: 404 });
    await expect(runtime.attachment(second.id, {
      ...command(0),
      filename: 'cross-request.pdf',
      contentBase64: pdf.toString('base64'),
      previousId: firstUpload.id,
    }, author)).rejects.toThrow(/Anexo anterior inválido/);
    expect(await prisma.bpmRequestAttachment.count({ where: { requestId: second.id } })).toBe(0);
  }, 30000);
});
