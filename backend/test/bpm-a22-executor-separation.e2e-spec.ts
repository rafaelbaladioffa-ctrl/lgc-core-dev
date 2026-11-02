import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { RequestCategoriesService } from '../src/request-categories/request-categories.service.js';
import { RequestsService } from '../src/requests/requests.service.js';
import { RequestRuntimeService } from '../src/request-runtime/request-runtime.service.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)('A22 executor separation on PostgreSQL', () => {
  let prisma: PrismaClient;
  let legacy: RequestsService;
  let runtime: RequestRuntimeService;
  let categoryService: RequestCategoriesService;
  let sectorId: string;
  let requesterId: string;
  let legacyRequestId: string;
  let bpmRequestId: string;
  const prefix = `a22-${randomUUID()}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: requireBpmTestDatabaseUrl() } } });
    await prisma.$connect();

    const sector = await prisma.sector.create({ data: { code: prefix, name: prefix } });
    sectorId = sector.id;
    const job = await prisma.jobTitle.create({ data: { name: prefix } });
    const requester = await prisma.collaborator.create({
      data: {
        fullName: prefix,
        rgEnc: 'synthetic',
        cpfEnc: 'synthetic',
        cpfHash: randomUUID(),
        corporateEmail: `${prefix}@example.invalid`,
        matricula: randomUUID(),
        sectorId,
        jobTitleId: job.id,
      },
    });
    requesterId = requester.id;
    const category = await prisma.requestCategory.create({
      data: {
        code: prefix,
        name: `${prefix} mista`,
        sectorId,
        useDynamicAuthority: true,
        versions: {
          create: [
            {
              version: 1,
              formSchema: [],
              workflowSchema: [],
              slaFirstResponseMinutes: 60,
              slaResolutionMinutes: 120,
            },
            {
              version: 2,
              formSchema: [],
              workflowSchema: [],
              slaFirstResponseMinutes: 60,
              slaResolutionMinutes: 120,
              bpmStatus: 'published',
              bpmDefinition: { graph: 'start-triage-execution-end' },
            },
          ],
        },
      },
      include: { versions: true },
    });
    const legacyVersion = category.versions.find((version) => version.bpmStatus === null)!;
    const bpmVersion = category.versions.find((version) => version.bpmStatus === 'published')!;
    const queue = await prisma.queue.create({ data: { sectorId, name: prefix } });
    const makeRequest = (code: string, categoryVersionId: string, executionMode: 'legacy' | 'bpm_v1', estimatedValue: number) =>
      prisma.request.create({
        data: {
          code,
          categoryVersionId,
          sectorId,
          queueId: queue.id,
          requesterId,
          beneficiaryId: requesterId,
          title: `${prefix} request`,
          description: 'synthetic A22 fixture',
          status: 'enviada',
          executionMode,
          estimatedValue,
        },
      });
    const legacyRequest = await makeRequest(`${prefix}-legacy`, legacyVersion.id, 'legacy', 100);
    legacyRequestId = legacyRequest.id;
    await makeRequest(`${prefix}-legacy-recent`, legacyVersion.id, 'legacy', 50);
    const bpmRequest = await makeRequest(`${prefix}-bpm`, bpmVersion.id, 'bpm_v1', 900);
    bpmRequestId = bpmRequest.id;

    // This clock is intentionally attached to BPM. A legacy cron query that
    // drops executionMode would mutate alertedThresholds on this row.
    await prisma.slaClock.create({
      data: {
        requestId: bpmRequest.id,
        metric: 'primeira_resposta',
        startedAt: new Date(Date.now() - 3_600_000),
        targetAt: new Date(Date.now() - 1_800_000),
      },
    });

    const authorityRules = { findApplicableRule: vi.fn().mockResolvedValue({ levels: ['gerente'] }) };
    legacy = new RequestsService(prisma as any, { record: vi.fn() } as any, {} as any, authorityRules as any, {} as any);
    runtime = new RequestRuntimeService(prisma as any, { get: vi.fn(() => 'true') } as any);
    categoryService = new RequestCategoriesService(prisma as any);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('returns WRONG_EXECUTOR in both directions for existing records', async () => {
    await expect((runtime as any).requestAccess(legacyRequestId, { userId: 'a22', collaboratorId: requesterId }))
      .rejects.toMatchObject({ response: { message: 'WRONG_EXECUTOR' } });
    await expect(legacy.findOne(bpmRequestId, { collaboratorId: requesterId, canViewWhistleblowerIdentity: false }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps the mixed category visible through its legacy version only', async () => {
    const catalog = await categoryService.findAllCatalog(sectorId);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].currentVersion).toMatchObject({ bpmStatus: null, version: 1 });
  });

  it('does not select BPM rows in the legacy SLA job or authority fractionation', async () => {
    await legacy.runSlaAlertsAndEscalation();
    const bpmClock = await prisma.slaClock.findFirstOrThrow({ where: { requestId: bpmRequestId } });
    expect(bpmClock.alertedThresholds).toEqual([]);

    const request = await prisma.request.findUniqueOrThrow({ where: { id: legacyRequestId } });
    const authority = await (legacy as any).resolveDynamicAuthoritySteps(request);
    expect(authority.effectiveValue).toBe(150);
    expect(authority.fractionationDetected).toBe(true);
  });
});
