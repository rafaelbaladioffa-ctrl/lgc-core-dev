import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import { RequestRuntimeService } from '../src/request-runtime/request-runtime.service.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-request.js';

// Explicitly provision a dedicated migrated *_bpm_test database before enabling.
// Every fixture is unique to this run. History remains in the disposable test DB;
// no operational seed, reset, migration or shared record is changed by this suite.
describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'BPM services with two PostgreSQL clients',
  () => {
    let first: PrismaClient,
      second: PrismaClient,
      config: RequestProcessesService,
      runtime: RequestRuntimeService,
      other: RequestRuntimeService;
    let author: AuthenticatedUser,
      cancellationAuthor: AuthenticatedUser,
      manager: AuthenticatedUser,
      noGrantPublisher: AuthenticatedUser,
      beneficiary: AuthenticatedUser,
      outsider: AuthenticatedUser,
      executors: AuthenticatedUser[];
    let categoryId: string, versionId: string;
    const prefix = `bpm-test-${randomUUID()}`;
    const enabled = { get: () => 'true' } as any;
    const command = (expectedVersion: number) => ({
      expectedVersion,
      commandKey: randomUUID(),
      commandId: randomUUID(),
    });
    beforeAll(async () => {
      const url = requireBpmTestDatabaseUrl();
      first = new PrismaClient({ datasources: { db: { url } } });
      second = new PrismaClient({ datasources: { db: { url } } });
      await Promise.all([first.$connect(), second.$connect()]);
      config = new RequestProcessesService(first as any, enabled);
      runtime = new RequestRuntimeService(first as any, enabled);
      other = new RequestRuntimeService(second as any, enabled);
      const sector = await first.sector.create({
        data: { code: prefix, name: prefix },
      });
      const job = await first.jobTitle.create({ data: { name: prefix } });
      const persona = async (name: string, permissions: string[]) => {
        const role = await first.role.create({
          data: {
            name: `${prefix}-${name}`,
            rolePermissions: {
              create: permissions.map((p) => {
                const [resource, action] = p.split(':');
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
        const collaborator = await first.collaborator.create({
          data: {
            fullName: `${prefix}-${name}`,
            rgEnc: 'synthetic',
            cpfEnc: 'synthetic',
            cpfHash: randomUUID(),
            corporateEmail: `${randomUUID()}@example.invalid`,
            matricula: randomUUID(),
            sectorId: sector.id,
            jobTitleId: job.id,
          },
        });
        const user = await first.user.create({
          data: {
            email: `${randomUUID()}@example.invalid`,
            passwordHash: 'synthetic-not-a-login',
            collaboratorId: collaborator.id,
            userRoles: { create: { roleId: role.id } },
          },
        });
        return {
          userId: user.id,
          email: user.email,
          mustChangePassword: false,
          collaboratorId: collaborator.id,
          permissions,
          roles: [],
        } as AuthenticatedUser;
      };
      author = await persona('author', [
        'request:create',
        'request:comment',
        'request:read',
      ]);
      cancellationAuthor = await persona('cancellation-author', [
        'request:create',
        'request:comment',
        'request:read',
      ]);
      beneficiary = await persona('beneficiary', ['request:read']);
      outsider = await persona('outsider', ['request:read']);
      executors = await Promise.all([
        persona('one', ['request:read', 'request:update', 'request:comment']),
        persona('two', ['request:read', 'request:update', 'request:comment']),
      ]);
      manager = await persona('manager', [
        'request:create',
        'request:read',
        'request:update',
        'request:comment',
        'request:assign',
        'request_queue:manage',
        'request_process:model',
        'request_process:publish',
        'request_category:create',
      ]);
      noGrantPublisher = await persona('no-grant-publisher', [
        'request_process:publish',
      ]);
      const queue = await config.createQueue(
        {
          sectorId: sector.id,
          name: prefix,
          members: executors.map((u) => u.collaboratorId!),
          managers: [manager.collaboratorId!],
        },
        manager,
      );
      await first.holiday.upsert({
        where: { date: new Date('2026-11-09T00:00:00.000Z') },
        update: {},
        create: {
          date: new Date('2026-11-09T00:00:00.000Z'),
          name: 'P01 synthetic holiday 2026-11-09',
        },
      });
      const created = await config.createProcess(
        {
          code: prefix,
          name: prefix,
          description: 'Synthetic BPM integration fixture',
          sectorId: sector.id,
          triageQueueId: queue.id,
          executionQueueId: queue.id,
          publisherUserIds: [manager.userId],
        },
        manager,
      );
      categoryId = created.id;
      versionId = created.versionId;
      const report = await config.validateVersion(versionId, 0, manager);
      expect(report.valid).toBe(true);
      if (!('validatedHash' in report))
        throw new Error('Fixture definition did not validate');
      await config.publishVersion(
        versionId,
        { expectedVersion: 0, validatedHash: report.validatedHash },
        manager,
      );
      const category = await first.requestCategory.findUniqueOrThrow({
        where: { id: categoryId },
      });
      await config.enableProcess(
        categoryId,
        { expectedVersion: category.configRevision },
        manager,
      );
    }, 30000);
    afterAll(async () => {
      await first?.$disconnect();
      await second?.$disconnect();
    });
    it('A04 keeps an incomplete draft resumable only by its author', async () => {
      const draft = await runtime.create(
        {
          categoryId,
          versionId,
          title: 'Draft A04',
          description: '',
          commandKey: randomUUID(),
          commandId: randomUUID(),
        },
        author,
      );
      await first.request.update({
        where: { id: draft.id },
        data: { beneficiaryId: beneficiary.collaboratorId! },
      });

      const authorView = await runtime.detail(draft.id, author);
      expect(authorView).toMatchObject({
        id: draft.id,
        code: draft.code,
        title: 'Draft A04',
        description: '',
        fields: {},
        status: 'rascunho',
        version: 1,
      });
      expect(authorView.allowedActions).toEqual(
        expect.arrayContaining(['saveDraft', 'submit']),
      );

      const queueView = await runtime.list(executors[0], { view: 'queue' });
      expect(queueView.items.some((item: any) => item.id === draft.id)).toBe(
        false,
      );
      await expect(runtime.detail(draft.id, executors[0])).rejects.toMatchObject(
        { status: 404 },
      );
      const beneficiaryView = await runtime.list(beneficiary, { view: 'mine' });
      expect(
        beneficiaryView.items.some((item: any) => item.id === draft.id),
      ).toBe(false);
      await expect(runtime.detail(draft.id, beneficiary)).rejects.toMatchObject(
        { status: 404 },
      );
      const outsiderView = await runtime.list(outsider, { view: 'mine' });
      expect(outsiderView.items.some((item: any) => item.id === draft.id)).toBe(
        false,
      );
      await expect(runtime.detail(draft.id, outsider)).rejects.toMatchObject({
        status: 404,
      });

      expect(
        await first.processInstance.count({ where: { requestId: draft.id } }),
      ).toBe(0);
      expect(
        await first.requestRuntimeEvent.count({ where: { requestId: draft.id } }),
      ).toBe(0);
      expect(
        await first.requestSlaClock.count({ where: { requestId: draft.id } }),
      ).toBe(0);

      const resumed = await runtime.detail(draft.id, author);
      expect(resumed).toMatchObject({
        id: draft.id,
        code: draft.code,
        title: 'Draft A04',
        fields: {},
        status: 'rascunho',
      });
    });
    it('commits one submit/claim, rolls back all effects at a failpoint, resumes after reconnect and closes', async () => {
      const draft = await runtime.create(
        {
          categoryId,
          versionId,
          title: 'Synthetic integration request',
          description: 'Complete journey',
          commandKey: randomUUID(),
          commandId: randomUUID(),
        },
        author,
      );
      await runtime.saveDraft(
        draft.id,
        { ...command(0), title: 'Updated integration request' },
        author,
      );
      const submit = command(1);
      const responses = await Promise.all([
        runtime.submit(draft.id, submit, author),
        other.submit(draft.id, submit, author),
      ]);
      expect(responses).toHaveLength(2);
      expect(responses.filter((response) => (response as any).replay)).toHaveLength(1);
      expect(
        await first.requestCommandReceipt.count({
          where: { requestId: draft.id, key: submit.commandKey },
        }),
      ).toBe(1);
      expect(
        await first.processInstance.count({ where: { requestId: draft.id } }),
      ).toBe(1);
      expect(
        await first.requestSlaClock.count({ where: { requestId: draft.id } }),
      ).toBe(2);
      expect(
        await first.requestRuntimeEvent.count({
          where: { requestId: draft.id, type: 'request.submitted' },
        }),
      ).toBe(1);
      let activity = await first.activityInstance.findFirstOrThrow({
        where: { instance: { requestId: draft.id }, phase: 'triage' },
      });
      const claims = await Promise.allSettled([
        runtime.claim(activity.id, command(2), executors[0]),
        other.claim(activity.id, command(2), executors[1]),
      ]);
      expect(claims.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      activity = await first.activityInstance.findUniqueOrThrow({
        where: { id: activity.id },
      });
      const winner = executors.find(
        (u) => u.collaboratorId === activity.assigneeId,
      )!;
      await runtime.complete(
        activity.id,
        { ...command(3), resolution: 'Triage completed' },
        winner,
      );
      activity = await first.activityInstance.findFirstOrThrow({
        where: { instance: { requestId: draft.id }, phase: 'execution' },
      });
      await runtime.claim(activity.id, command(4), winner);
      const failing = new RequestRuntimeService(first as any, enabled);
      (failing as any).event = async () => {
        throw new Error('fixture failpoint after activity/clock writes');
      };
      const complete = { ...command(5), resolution: 'Execution completed' };
      await expect(
        failing.complete(activity.id, complete, winner),
      ).rejects.toThrow('fixture failpoint');
      expect(
        (await first.request.findUniqueOrThrow({ where: { id: draft.id } }))
          .lockVersion,
      ).toBe(5);
      expect(
        (
          await first.activityInstance.findUniqueOrThrow({
            where: { id: activity.id },
          })
        ).state,
      ).toBe('claimed');
      expect(
        await first.requestCommandReceipt.count({
          where: { key: complete.commandKey },
        }),
      ).toBe(0);
      expect(
        (
          await first.requestSlaClock.findFirstOrThrow({
            where: { requestId: draft.id, metric: 'resolution' },
          })
        ).stoppedAt,
      ).toBeNull();
      await second.$disconnect();
      await second.$connect();
      await other.complete(activity.id, complete, winner);
      await runtime.close(
        draft.id,
        { ...command(6), reason: 'Manager confirmed closure' },
        manager,
      );
      expect(
        (await first.request.findUniqueOrThrow({ where: { id: draft.id } }))
          .status,
      ).toBe('encerrada');
      const events = await first.requestRuntimeEvent.findMany({
        where: { requestId: draft.id },
        orderBy: { sequence: 'asc' },
      });
      expect(events.map((e) => e.sequence)).toEqual(
        events.map((_, i) => i + 1),
      );
    }, 30000);
    it('A11 rejects the losing save/submit mutation at one draft version across two PostgreSQL clients without partial effects', async () => {
      const draft = await runtime.create({
        categoryId,
        versionId,
        title: 'Concurrent draft serialization',
        description: 'One command must win without partial effects',
      }, manager);
      const outcomes = await Promise.allSettled([
        runtime.saveDraft(draft.id, {
          ...command(0),
          title: 'Concurrent draft saved',
        }, manager),
        other.submit(draft.id, command(0), manager),
      ]);
      expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ status: 409 });
      const row = await first.request.findUniqueOrThrow({ where: { id: draft.id } });
      const receipts = await first.requestCommandReceipt.findMany({ where: { requestId: draft.id } });
      expect(receipts).toHaveLength(1);
      expect(row.lockVersion).toBe(1);
      if (row.status === 'rascunho') {
        expect(row.title).toBe('Concurrent draft saved');
        expect(await first.processInstance.count({ where: { requestId: draft.id } })).toBe(0);
        expect(await first.requestSlaClock.count({ where: { requestId: draft.id } })).toBe(0);
      } else {
        expect(row.status).toBe('enviada');
        expect(await first.processInstance.count({ where: { requestId: draft.id } })).toBe(1);
        expect(await first.requestSlaClock.count({ where: { requestId: draft.id } })).toBe(2);
      }
    }, 30000);
    it('A19 uses Friday/night/weekend/holiday vectors and only human completion stops the clocks', async () => {
      vi.useFakeTimers({ now: new Date('2026-11-06T20:30:00.000Z') });
      try {
        const draft = await runtime.create({
          categoryId,
          versionId,
          title: 'Persisted SLA vector request',
          description: 'Friday weekend and holiday semantics are persisted',
        }, manager);
        await runtime.submit(draft.id, command(0), manager);
        const beforeClaim = await first.requestSlaClock.findMany({ where: { requestId: draft.id }, orderBy: { metric: 'asc' } });
        expect(beforeClaim.map((clock) => [clock.metric, clock.originalTargetAt?.toISOString()])).toEqual([
          ['first_response', '2026-11-10T14:30:00.000Z'],
          ['resolution', '2026-11-16T18:30:00.000Z'],
        ]);
        const snapshot = beforeClaim.map((clock) => ({ metric: clock.metric, budgetSeconds: clock.budgetSeconds, originalTargetAt: clock.originalTargetAt, targetAt: clock.targetAt }));
        let triage = await first.activityInstance.findFirstOrThrow({ where: { instance: { requestId: draft.id }, phase: 'triage' } });
        await runtime.claim(triage.id, command(1), executors[0]);
        const afterClaim = await first.requestSlaClock.findMany({ where: { requestId: draft.id }, orderBy: { metric: 'asc' } });
        expect(afterClaim.map((clock) => ({ metric: clock.metric, budgetSeconds: clock.budgetSeconds, originalTargetAt: clock.originalTargetAt, targetAt: clock.targetAt }))).toEqual(snapshot);
        expect(afterClaim.every((clock) => clock.stoppedAt === null)).toBe(true);
        const commented = await runtime.comment(draft.id, { ...command(2), body: 'Comentário não altera o prazo', visibility: 'publico' }, manager);
        const afterComment = await first.requestSlaClock.findMany({ where: { requestId: draft.id }, orderBy: { metric: 'asc' } });
        expect(afterComment.map((clock) => ({ metric: clock.metric, budgetSeconds: clock.budgetSeconds, originalTargetAt: clock.originalTargetAt, targetAt: clock.targetAt }))).toEqual(snapshot);
        triage = await first.activityInstance.findUniqueOrThrow({ where: { id: triage.id } });
        await runtime.complete(triage.id, { ...command(commented.currentVersion), resolution: 'Triagem concluída' }, executors[0]);
        const afterTriage = await first.requestSlaClock.findMany({ where: { requestId: draft.id }, orderBy: { metric: 'asc' } });
        expect(afterTriage.find((clock) => clock.metric === 'first_response')?.stoppedAt).toEqual(new Date('2026-11-06T20:30:00.000Z'));
        expect(afterTriage.find((clock) => clock.metric === 'resolution')?.stoppedAt).toBeNull();
        const execution = await first.activityInstance.findFirstOrThrow({ where: { instance: { requestId: draft.id }, phase: 'execution' } });
        await runtime.claim(execution.id, command(commented.currentVersion + 1), executors[0]);
        const executionClaimed = await first.request.findUniqueOrThrow({ where: { id: draft.id } });
        await runtime.complete(execution.id, { ...command(executionClaimed.lockVersion), resolution: 'Execução concluída' }, executors[0]);
        const afterResolution = await first.requestSlaClock.findFirstOrThrow({ where: { requestId: draft.id, metric: 'resolution' } });
        expect(afterResolution.stoppedAt).toEqual(new Date('2026-11-06T20:30:00.000Z'));
        expect(afterResolution.budgetSeconds).toBe(snapshot.find((clock) => clock.metric === 'resolution')?.budgetSeconds);
      } finally {
        vi.useRealTimers();
      }
    }, 30000);
    it('replays identical draft creation once and rejects key reuse with a changed body', async () => {
      const commandKey = randomUUID();
      const commandId = randomUUID();
      const body = { categoryId, versionId, title: 'Idempotent draft fixture', description: 'Same intent replay' };
      const firstResult = await runtime.create({ ...body, commandKey, commandId }, manager);
      const replay = await runtime.create({ ...body, commandKey, commandId }, manager);
      expect(replay.id).toBe(firstResult.id);
      expect(replay.code).toBe(firstResult.code);
      expect(await first.request.count({ where: { id: firstResult.id, executionMode: 'bpm_v1' } })).toBe(1);
      await expect(runtime.create({ ...body, title: 'Changed intent', commandKey, commandId }, manager)).rejects.toMatchObject({ status: 409, response: { message: 'IDEMPOTENCY_KEY_REUSED' } });
      expect(await first.request.count({ where: { id: firstResult.id, executionMode: 'bpm_v1' } })).toBe(1);
      expect(await first.request.count({ where: { id: firstResult.id, title: { in: [body.title, 'Changed intent'] }, executionMode: 'bpm_v1' } })).toBe(1);
    }, 30000);
    it('stores and downloads real PDF bytes by hash and denies unrelated access', async () => {
      const draft = await runtime.create({ categoryId, versionId, title: 'Attachment access test', description: 'Small PDF upload' }, manager);
      const bytes = Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');
      const commandKey = randomUUID();
      const uploaded = await runtime.attachment(draft.id, {
        filename: 'small.pdf',
        contentBase64: bytes.toString('base64'),
        expectedVersion: 0,
        commandKey,
        commandId: randomUUID(),
      }, manager);
      const stored = await first.bpmRequestAttachment.findUniqueOrThrow({ where: { id: uploaded.id } });
      expect(stored.contentHash).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(Buffer.from(stored.content as any)).toEqual(bytes);
      const downloaded = await runtime.download(draft.id, uploaded.id, manager);
      expect(Buffer.from(downloaded.content)).toEqual(bytes);
      await expect(runtime.download(draft.id, uploaded.id, executors[0])).rejects.toThrow();
      const outsideSector = await first.sector.create({
        data: { code: `${prefix}-outside`, name: `${prefix}-outside` },
      });
      const outsideJob = await first.jobTitle.create({
        data: { name: `${prefix}-outside` },
      });
      const outsiderRole = await first.role.create({
        data: {
          name: `${prefix}-outside-account`,
          rolePermissions: {
            create: [
              {
                permission: {
                  connectOrCreate: {
                    where: {
                      resource_action: { resource: 'request', action: 'read' },
                    },
                    create: { resource: 'request', action: 'read' },
                  },
                },
              },
            ],
          },
        },
      });
      const outsideCollaborator = await first.collaborator.create({
        data: {
          fullName: `${prefix}-outsider`,
          rgEnc: 'synthetic',
          cpfEnc: 'synthetic',
          cpfHash: randomUUID(),
          corporateEmail: `${randomUUID()}@example.invalid`,
          matricula: randomUUID(),
          sectorId: outsideSector.id,
          jobTitleId: outsideJob.id,
        },
      });
      const outsideAccount = await first.user.create({
        data: {
          email: `${randomUUID()}@example.invalid`,
          passwordHash: 'synthetic-not-a-login',
          collaboratorId: outsideCollaborator.id,
          userRoles: { create: { roleId: outsiderRole.id } },
        },
      });
      const outsider = {
        userId: outsideAccount.id,
        email: outsideAccount.email,
        mustChangePassword: false,
        collaboratorId: outsideCollaborator.id,
        permissions: ['request:read'],
        roles: [],
      } as AuthenticatedUser;
      const outsiderList = await runtime.list(outsider);
      expect(outsiderList.items.some((item: any) => item.id === draft.id)).toBe(false);
      await expect(runtime.detail(draft.id, outsider)).rejects.toMatchObject({ status: 404 });
      await expect(runtime.timeline(draft.id, outsider)).rejects.toMatchObject({ status: 404 });
      await expect(runtime.download(draft.id, uploaded.id, outsider)).rejects.toMatchObject({ status: 404 });

      const count = await first.bpmRequestAttachment.count({ where: { requestId: draft.id } });
      await expect(runtime.attachment(draft.id, {
        filename: 'fake.pdf',
        contentBase64: Buffer.from('not a pdf').toString('base64'),
        expectedVersion: 1,
        commandKey: randomUUID(),
        commandId: randomUUID(),
      }, manager)).rejects.toThrow();
      expect(await first.bpmRequestAttachment.count({ where: { requestId: draft.id } })).toBe(count);
    }, 30000);
    it('enforces snapshot/operational-history immutability and current account revocation', async () => {
      await expect(
        first.categoryVersion.update({
          where: { id: versionId },
          data: { bpmDefinition: { tampered: true } },
        }),
      ).rejects.toThrow();
      const draft = await runtime.create(
        {
          categoryId,
          versionId,
          title: 'Revocation integration fixture',
          description: 'Synthetic',
        },
        author,
      );
      await expect(
        first.request.delete({ where: { id: draft.id } }),
      ).rejects.toThrow();
      await first.user.update({
        where: { id: author.userId },
        data: { status: 'disabled' },
      });
      await expect(runtime.detail(draft.id, author)).rejects.toThrow(
        'Permissão atual insuficiente',
      );
    });
    it('A03 HTTP publication contract: rejects stale validated hash, serializes concurrent publishers, and freezes one pointer', async () => {
      const created = await config.createProcess(
        {
          code: `${prefix}-race`,
          name: `${prefix} race publication`,
          description: 'Concurrent publication fixture',
          sectorId: (await first.collaborator.findUniqueOrThrow({ where: { id: manager.collaboratorId! } })).sectorId,
          triageQueueId: (await first.queue.findFirstOrThrow({ where: { name: prefix } })).id,
          executionQueueId: (await first.queue.findFirstOrThrow({ where: { name: prefix } })).id,
          publisherUserIds: [manager.userId],
        },
        manager,
      );
      const validation = await config.validateVersion(created.versionId, 0, manager);
      expect(validation.valid).toBe(true);
      if (!('validatedHash' in validation)) throw new Error('Missing validation hash');
      const staleHash = validation.validatedHash;
      await config.patchVersion(
        created.versionId,
        {
          expectedVersion: 0,
          definition: {
            ...(await first.categoryVersion.findUniqueOrThrow({ where: { id: created.versionId } })).bpmDefinition as object,
            sla: { firstResponseMinutes: 241, resolutionMinutes: 2880 },
          },
        },
        manager,
      );
      await expect(
        config.publishVersion(
          created.versionId,
          { expectedVersion: 1, validatedHash: staleHash },
          manager,
        ),
      ).rejects.toMatchObject({ status: 409 });

      const refreshed = await config.validateVersion(created.versionId, 1, manager);
      expect(refreshed.valid).toBe(true);
      if (!('validatedHash' in refreshed)) throw new Error('Missing refreshed validation hash');
      const command = { expectedVersion: 1, validatedHash: refreshed.validatedHash };
      const results = await Promise.allSettled([
        config.publishVersion(created.versionId, command, manager),
        new RequestProcessesService(second as any, enabled).publishVersion(created.versionId, command, manager),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason.getStatus?.()).toBe(409);
      const category = await first.requestCategory.findUniqueOrThrow({ where: { id: created.id } });
      expect(category.publishedBpmVersionId).toBe(created.versionId);
      expect(
        await first.categoryVersion.count({
          where: { categoryId: created.id, bpmStatus: 'published' },
        }),
      ).toBe(1);
      const published = await first.categoryVersion.findUniqueOrThrow({ where: { id: created.versionId } });
      expect(published.bpmContentHash).toBe(refreshed.validatedHash);
      await expect(first.categoryVersion.update({ where: { id: created.versionId }, data: { bpmDefinition: { changed: true } } })).rejects.toThrow();
      expect((await first.categoryVersion.findUniqueOrThrow({ where: { id: created.versionId } })).bpmDefinition).toEqual(published.bpmDefinition);
    }, 30000);
    it('requires a process publisher grant in addition to publish permission', async () => {
      const before = await first.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
      const queue = await first.queue.findFirstOrThrow({ where: { name: prefix } });
      const draft = await config.createProcess({
        code: `${prefix}-no-grant`,
        name: `${prefix} no grant publisher`,
        description: 'A15 grant boundary',
        sectorId: (await first.collaborator.findUniqueOrThrow({ where: { id: manager.collaboratorId! } })).sectorId,
        triageQueueId: queue.id,
        executionQueueId: queue.id,
        publisherUserIds: [],
      }, manager);
      const validation = await config.validateVersion(draft.versionId, 0, manager);
      expect(validation.valid).toBe(true);
      if (!('validatedHash' in validation)) throw new Error('Missing validation hash');
      await expect(config.publishVersion(draft.versionId, { expectedVersion: 0, validatedHash: validation.validatedHash }, noGrantPublisher)).rejects.toMatchObject({ status: 403 });
      const version = await first.categoryVersion.findUniqueOrThrow({ where: { id: draft.versionId } });
      const after = await first.requestCategory.findUniqueOrThrow({ where: { id: draft.id } });
      expect(version.bpmStatus).toBe('draft');
      expect(after.publishedBpmVersionId).toBeNull();
      expect(before.publishedBpmVersionId).toBe(versionId);
      const roleLink = await first.userRole.findFirstOrThrow({
        where: { userId: noGrantPublisher.userId },
        select: { roleId: true },
      });
      const permission = await first.permission.findUniqueOrThrow({
        where: { resource_action: { resource: 'request_process', action: 'publish' } },
      });
      await first.rolePermission.deleteMany({
        where: { roleId: roleLink.roleId, permissionId: permission.id },
      });
      const receiptCount = await first.requestCommandReceipt.count({ where: { actorUserId: noGrantPublisher.userId } });
      await expect(config.publishVersion(draft.versionId, { expectedVersion: 0, validatedHash: validation.validatedHash }, noGrantPublisher)).rejects.toMatchObject({ status: 403, response: { message: 'Permissão atual insuficiente' } });
      expect(await first.requestCommandReceipt.count({ where: { actorUserId: noGrantPublisher.userId } })).toBe(receiptCount);
      expect((await first.categoryVersion.findUniqueOrThrow({ where: { id: draft.versionId } })).bpmStatus).toBe('draft');
      expect((await first.requestCategory.findUniqueOrThrow({ where: { id: draft.id } })).publishedBpmVersionId).toBeNull();
    }, 30000);
    it('persists a no-candidate incident, repairs queue membership and resolves the same activity once', async () => {
      const sectorId = (await first.collaborator.findUniqueOrThrow({
        where: { id: manager.collaboratorId! },
        select: { sectorId: true },
      })).sectorId;
      const emptyQueue = await config.createQueue(
        {
          sectorId,
          name: `${prefix}-empty-queue`,
          members: [executors[0].collaboratorId!],
          managers: [manager.collaboratorId!],
        },
        manager,
      );
      const created = await config.createProcess(
        {
          code: `${prefix}-no-candidates`,
          name: `${prefix} no candidates`,
          description: 'No eligible assignee integration fixture',
          sectorId,
          triageQueueId: emptyQueue.id,
          executionQueueId: emptyQueue.id,
          publisherUserIds: [manager.userId],
        },
        manager,
      );
      const validation = await config.validateVersion(created.versionId, 0, manager);
      expect(validation.valid).toBe(true);
      if (!('validatedHash' in validation)) throw new Error('Missing validation hash');
      await config.publishVersion(
        created.versionId,
        { expectedVersion: 0, validatedHash: validation.validatedHash },
        manager,
      );
      await config.enableProcess(
        created.id,
        { expectedVersion: 1 },
        manager,
      );
      await config.updateQueue(
        emptyQueue.id,
        {
          expectedVersion: 0,
          sectorId,
          name: `${prefix}-empty-queue`,
          members: [],
          managers: [manager.collaboratorId!],
        },
        manager,
      );

      const draft = await runtime.create(
        {
          categoryId: created.id,
          versionId: created.versionId,
          title: 'No eligible assignee fixture',
          description: 'The queue starts without an eligible member',
        },
        cancellationAuthor,
      );
      const submitted = await runtime.submit(draft.id, command(0), cancellationAuthor);
      const triage = await first.activityInstance.findFirstOrThrow({
        where: { instance: { requestId: draft.id }, phase: 'triage' },
        include: { candidates: true },
      });
      expect(submitted.activityId).toBe(triage.id);
      expect(triage.candidates).toHaveLength(0);
      expect(await first.activityInstance.count({ where: { instance: { requestId: draft.id } } })).toBe(1);
      expect(await first.requestRuntimeIncident.count({
        where: { requestId: draft.id, type: 'NO_ELIGIBLE_ASSIGNEE', state: 'open' },
      })).toBe(1);

      const repaired = await config.updateQueue(
        emptyQueue.id,
        {
          expectedVersion: 1,
          sectorId,
          name: `${prefix}-repaired-queue`,
          members: [executors[0].collaboratorId!],
          managers: [manager.collaboratorId!],
        },
        manager,
      );
      expect(repaired.revision).toBe(2);
      const reassign = {
        ...command(submitted.currentVersion),
        reason: 'Fila corrigida e responsável definido',
        assigneeId: executors[0].collaboratorId!,
      };
      const assigned = await runtime.reassign(triage.id, reassign, manager);
      expect(assigned.currentVersion).toBe(2);
      const replay = await runtime.reassign(triage.id, reassign, manager);
      expect(replay.replay).toBe(true);
      expect(replay.currentVersion).toBe(2);
      expect(await first.activityInstance.count({ where: { instance: { requestId: draft.id } } })).toBe(1);
      expect(await first.activityCandidate.count({ where: { activityId: triage.id } })).toBe(1);
      expect(await first.activityAssignment.count({ where: { activityId: triage.id } })).toBe(1);
      expect(await first.requestRuntimeIncident.count({
        where: { requestId: draft.id, type: 'NO_ELIGIBLE_ASSIGNEE', state: 'open' },
      })).toBe(0);
      expect(await first.requestRuntimeIncident.count({
        where: { requestId: draft.id, type: 'NO_ELIGIBLE_ASSIGNEE', state: 'resolved' },
      })).toBe(1);
      const resolved = await first.requestRuntimeIncident.findFirstOrThrow({
        where: { requestId: draft.id, type: 'NO_ELIGIBLE_ASSIGNEE' },
      });
      expect(resolved.resolution).toBe(reassign.reason);
      expect(resolved.resolvedBy).toBe(manager.userId);

      await runtime.complete(
        triage.id,
        { ...command(2), resolution: 'Triagem concluída após reatribuição' },
        executors[0],
      );
      expect(await first.activityInstance.count({ where: { instance: { requestId: draft.id } } })).toBe(2);
      expect(await first.activityInstance.count({ where: { instance: { requestId: draft.id }, phase: 'execution' } })).toBe(1);
    }, 30000);
    it('cancels before execution, blocks the author after execution starts and lets the manager cancel idempotently', async () => {
      const draft = await runtime.create(
        {
          categoryId,
          versionId,
          title: 'Author cancellation fixture',
          description: 'Cancellation before execution starts',
        },
        cancellationAuthor,
      );
      const draftCancel = {
        ...command(0),
        reason: 'Solicitação retirada pelo autor',
      };
      const cancelledDraft = await runtime.cancel(
        draft.id,
        draftCancel,
        cancellationAuthor,
      );
      expect(cancelledDraft.status).toBe('cancelada');
      const cancelledDraftRow = await first.request.findUniqueOrThrow({ where: { id: draft.id } });
      expect(cancelledDraftRow.status).toBe('cancelada');
      expect(cancelledDraftRow.closedAt).not.toBeNull();
      expect(await first.requestRuntimeEvent.count({ where: { requestId: draft.id, type: 'request.cancelled' } })).toBe(1);
      const cancelledDraftReplay = await runtime.cancel(
        draft.id,
        draftCancel,
        cancellationAuthor,
      );
      expect(cancelledDraftReplay.replay).toBe(true);
      expect(await first.requestRuntimeEvent.count({ where: { requestId: draft.id, type: 'request.cancelled' } })).toBe(1);

      const active = await runtime.create(
        {
          categoryId,
          versionId,
          title: 'Execution cancellation fixture',
          description: 'Author cannot cancel after execution starts',
        },
        cancellationAuthor,
      );
      const submitted = await runtime.submit(active.id, command(0), cancellationAuthor);
      const triage = await first.activityInstance.findUniqueOrThrow({ where: { id: submitted.activityId } });
      await runtime.claim(triage.id, command(1), executors[0]);
      const triageAfterClaim = await first.request.findUniqueOrThrow({ where: { id: active.id } });
      await runtime.complete(
        triage.id,
        { ...command(triageAfterClaim.lockVersion), resolution: 'Triagem abriu a execução' },
        executors[0],
      );
      const execution = await first.activityInstance.findFirstOrThrow({
        where: { instance: { requestId: active.id }, phase: 'execution' },
      });
      const executionRow = await first.request.findUniqueOrThrow({ where: { id: active.id } });
      await expect(runtime.cancel(
        active.id,
        { ...command(executionRow.lockVersion), reason: 'Autor tentando cancelar tarde' },
        cancellationAuthor,
      )).rejects.toThrow('Autor não pode cancelar após abrir execução');
      expect((await first.request.findUniqueOrThrow({ where: { id: active.id } })).status).toBe('em_atendimento');

      const managerCancel = {
        ...command(executionRow.lockVersion),
        reason: 'Gestor cancelou por encerramento operacional',
      };
      const cancelled = await runtime.cancel(active.id, managerCancel, manager);
      expect(cancelled.status).toBe('cancelada');
      const managerReplay = await runtime.cancel(active.id, managerCancel, manager);
      expect(managerReplay.replay).toBe(true);
      expect(await first.requestRuntimeEvent.count({ where: { requestId: active.id, type: 'request.cancelled' } })).toBe(1);
      expect(await first.activityInstance.count({ where: { instance: { requestId: active.id }, state: 'cancelled' } })).toBe(1);
      expect(await first.executionToken.count({ where: { instance: { requestId: active.id }, state: 'cancelled' } })).toBe(1);
      expect((await first.processInstance.findFirstOrThrow({ where: { requestId: active.id } })).state).toBe('cancelled');
      expect((await first.requestSlaClock.findMany({ where: { requestId: active.id } })).every((clock) => clock.stoppedAt !== null)).toBe(true);
      expect(execution.id).not.toBe(triage.id);
    }, 30000);
    it('filters public/internal comments and masked fields/files, then revalidates every surface after participant removal', async () => {
      const sectorId = (await first.collaborator.findUniqueOrThrow({
        where: { id: manager.collaboratorId! },
        select: { sectorId: true },
      })).sectorId;
      const queue = await config.createQueue(
        {
          sectorId,
          name: `${prefix}-privacy-queue`,
          members: [executors[0].collaboratorId!, executors[1].collaboratorId!],
          managers: [manager.collaboratorId!],
        },
        manager,
      );
      const created = await config.createProcess(
        {
          code: `${prefix}-privacy`,
          name: `${prefix} privacy`,
          description: 'Privacy projection integration fixture',
          sectorId,
          triageQueueId: queue.id,
          executionQueueId: queue.id,
          publisherUserIds: [manager.userId],
        },
        manager,
      );
      const definition = structuredClone(
        (await first.categoryVersion.findUniqueOrThrow({
          where: { id: created.versionId },
        })).bpmDefinition as any,
      );
      definition.form = [
        {
          key: 'sensitive_document',
          label: 'Documento sensível',
          type: 'attachment',
          required: false,
        },
      ];
      definition.nodes = definition.nodes.map((node: any) =>
        node.id === 'triage'
          ? { ...node, formAccess: { sensitive_document: 'hidden' } }
          : node,
      );
      const patched = await config.patchVersion(
        created.versionId,
        { expectedVersion: 0, definition },
        manager,
      );
      const validation = await config.validateVersion(
        created.versionId,
        patched.bpmRevision,
        manager,
      );
      expect(validation.valid).toBe(true);
      if (!('validatedHash' in validation)) throw new Error('Missing validation hash');
      await config.publishVersion(
        created.versionId,
        {
          expectedVersion: patched.bpmRevision,
          validatedHash: validation.validatedHash,
        },
        manager,
      );
      await config.enableProcess(created.id, { expectedVersion: 1 }, manager);

      const draft = await runtime.create(
        {
          categoryId: created.id,
          versionId: created.versionId,
          title: 'Privacy projection fixture',
          description: 'Author and queue participant visibility',
        },
        cancellationAuthor,
      );
      const bytes = Buffer.from('%PDF-1.7\nprivacy\n%%EOF\n');
      const uploaded = await runtime.attachment(
        draft.id,
        {
          filename: 'sensitive.pdf',
          fieldKey: 'sensitive_document',
          contentBase64: bytes.toString('base64'),
          expectedVersion: 0,
          commandKey: randomUUID(),
          commandId: randomUUID(),
        },
        cancellationAuthor,
      );
      const saved = await runtime.saveDraft(
        draft.id,
        {
          ...command(uploaded.currentVersion),
          fields: { sensitive_document: [uploaded.id] },
        },
        cancellationAuthor,
      );
      const submitted = await runtime.submit(
        draft.id,
        command(saved.currentVersion),
        cancellationAuthor,
      );
      const publicComment = await runtime.comment(
        draft.id,
        {
          ...command(submitted.currentVersion),
          body: 'Atualização pública ao solicitante',
          visibility: 'publico',
        },
        manager,
      );
      const internalComment = await runtime.comment(
        draft.id,
        {
          ...command(publicComment.currentVersion),
          body: 'Nota interna da fila',
          visibility: 'interno',
        },
        manager,
      );
      const participantComment = await runtime.comment(
        draft.id,
        {
          ...command(internalComment.currentVersion),
          body: 'Nota interna do participante',
          visibility: 'interno',
        },
        executors[0],
      );
      const authorDetail = await runtime.detail(draft.id, cancellationAuthor);
      expect(authorDetail.fields.sensitive_document).toEqual([uploaded.id]);
      expect(authorDetail.attachments.map((a: any) => a.id)).toContain(uploaded.id);
      expect(authorDetail.comments.map((c: any) => c.id)).toContain(publicComment.commentId);
      expect(authorDetail.comments.map((c: any) => c.id)).not.toContain(internalComment.commentId);
      expect(authorDetail.comments.map((c: any) => c.id)).not.toContain(participantComment.commentId);
      expect((await runtime.download(draft.id, uploaded.id, cancellationAuthor)).content).toEqual(bytes);
      const authorTimeline = await runtime.timeline(draft.id, cancellationAuthor);
      const authorTimelineCommentIds = authorTimeline
        .map((event: any) => event.summary?.commentId)
        .filter(Boolean);
      expect(authorTimelineCommentIds).toContain(publicComment.commentId);
      expect(authorTimelineCommentIds).not.toContain(internalComment.commentId);
      expect(authorTimelineCommentIds).not.toContain(participantComment.commentId);

      const participantDetail = await runtime.detail(draft.id, executors[0]);
      expect(participantDetail.fields).not.toHaveProperty('sensitive_document');
      expect(participantDetail.attachments).toHaveLength(0);
      expect(participantDetail.comments.map((c: any) => c.id)).toContain(internalComment.commentId);
      expect(participantDetail.comments.map((c: any) => c.id)).toContain(participantComment.commentId);
      await expect(runtime.download(draft.id, uploaded.id, executors[0])).rejects.toMatchObject({ status: 404 });
      const participantTimeline = await runtime.timeline(draft.id, executors[0]);
      const participantTimelineCommentIds = participantTimeline
        .map((event: any) => event.summary?.commentId)
        .filter(Boolean);
      expect(participantTimelineCommentIds).toContain(internalComment.commentId);
      expect(participantTimelineCommentIds).toContain(participantComment.commentId);

      await config.updateQueue(
        queue.id,
        {
          expectedVersion: 0,
          sectorId,
          name: `${prefix}-privacy-queue-repaired`,
          members: [executors[1].collaboratorId!],
          managers: [manager.collaboratorId!],
        },
        manager,
      );
      await expect(runtime.detail(draft.id, executors[0])).rejects.toMatchObject({ status: 404 });
      await expect(runtime.timeline(draft.id, executors[0])).rejects.toMatchObject({ status: 404 });
      await expect(runtime.download(draft.id, uploaded.id, executors[0])).rejects.toMatchObject({ status: 404 });
      expect((await runtime.list(executors[0], { view: 'queue' })).items.some((item: any) => item.id === draft.id)).toBe(false);

      const managerDetail = await runtime.detail(draft.id, manager);
      expect(managerDetail.fields).not.toHaveProperty('sensitive_document');
      expect(managerDetail.attachments).toHaveLength(0);
      await expect(runtime.download(draft.id, uploaded.id, manager)).rejects.toMatchObject({ status: 404 });
      const authorAfterRemoval = await runtime.detail(draft.id, cancellationAuthor);
      expect(authorAfterRemoval.fields.sensitive_document).toEqual([uploaded.id]);
      expect(await runtime.timeline(draft.id, cancellationAuthor)).toEqual(authorTimeline);
      expect((await runtime.download(draft.id, uploaded.id, cancellationAuthor)).content).toEqual(bytes);
      expect(submitted.activityId).toBeTruthy();
    }, 30000);
    it('keeps the published v1 snapshot unchanged when v2 is cloned and published', async () => {
      const v1Before = await first.categoryVersion.findUniqueOrThrow({ where: { id: versionId } });
      const oldDraft = await runtime.create({ categoryId, versionId, title: 'Draft pinned to v1', description: 'Created before v2 publication' }, manager);
      const pinnedBefore = await first.request.findUniqueOrThrow({ where: { id: oldDraft.id } });
      expect(pinnedBefore.categoryVersionId).toBe(versionId);
      const categoryBefore = await first.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
      const v2 = await config.createVersion(
        categoryId,
        { expectedVersion: categoryBefore.configRevision, cloneVersionId: v1Before.version },
        manager,
      );
      const v2Definition = structuredClone(v1Before.bpmDefinition as any);
      v2Definition.form = [{ key: 'new_field', label: 'Novo campo', type: 'text', required: false }];
      v2Definition.sla = { firstResponseMinutes: 60, resolutionMinutes: 720 };
      const patched = await config.patchVersion(v2.id, { expectedVersion: v2.bpmRevision, definition: v2Definition }, manager);
      const validation = await config.validateVersion(v2.id, patched.bpmRevision, manager);
      expect(validation.valid).toBe(true);
      if (!('validatedHash' in validation)) throw new Error('Missing v2 validation hash');
      await config.publishVersion(v2.id, { expectedVersion: patched.bpmRevision, validatedHash: validation.validatedHash }, manager);

      const [v1After, v2After, categoryAfter] = await Promise.all([
        first.categoryVersion.findUniqueOrThrow({ where: { id: versionId } }),
        first.categoryVersion.findUniqueOrThrow({ where: { id: v2.id } }),
        first.requestCategory.findUniqueOrThrow({ where: { id: categoryId } }),
      ]);
      expect(v1After.bpmDefinition).toEqual(v1Before.bpmDefinition);
      expect(v1After.bpmContentHash).toBe(v1Before.bpmContentHash);
      expect(v1After.slaFirstResponseMinutes).toBe(v1Before.slaFirstResponseMinutes);
      expect(v1After.slaResolutionMinutes).toBe(v1Before.slaResolutionMinutes);
      expect(v2After.bpmDefinition).toEqual(v2Definition);
      expect(v2After.bpmContentHash).toBe(validation.validatedHash);
      expect(v2After.slaFirstResponseMinutes).toBe(60);
      expect(v2After.slaResolutionMinutes).toBe(720);
      expect(categoryAfter.publishedBpmVersionId).toBe(v2.id);
      const pinnedAfter = await first.request.findUniqueOrThrow({ where: { id: oldDraft.id } });
      expect(pinnedAfter.categoryVersionId).toBe(versionId);
      const submitted = await runtime.submit(oldDraft.id, command(pinnedAfter.lockVersion), manager);
      expect(submitted.currentVersion).toBe(pinnedAfter.lockVersion + 1);
      const instance = await first.processInstance.findFirstOrThrow({ where: { requestId: oldDraft.id } });
      expect(instance.categoryVersionId).toBe(versionId);
      expect(instance.definitionSnapshot).toEqual(v1Before.bpmDefinition);
    }, 30000);
    it('validates typed fields on PostgreSQL without creating runtime effects before submit', async () => {
      const created = await config.createProcess({
        code: `${prefix}-typed-fields`,
        name: `${prefix} typed fields`,
        description: 'Typed field validation fixture',
        sectorId: (await first.collaborator.findUniqueOrThrow({ where: { id: manager.collaboratorId! } })).sectorId,
        triageQueueId: (await first.queue.findFirstOrThrow({ where: { name: prefix } })).id,
        executionQueueId: (await first.queue.findFirstOrThrow({ where: { name: prefix } })).id,
        publisherUserIds: [manager.userId],
      }, manager);
      const source = await first.categoryVersion.findUniqueOrThrow({ where: { id: created.versionId } });
      const definition = structuredClone(source.bpmDefinition as any);
      definition.form = [
        { key: 'flag', label: 'Flag', type: 'boolean', required: false },
        { key: 'count', label: 'Count', type: 'integer', required: false },
        { key: 'amount', label: 'Amount', type: 'decimal', required: false },
        { key: 'day', label: 'Day', type: 'date', required: false },
        { key: 'kind', label: 'Kind', type: 'select', options: [{ id: 'a', label: 'A' }], required: false },
        { key: 'required_note', label: 'Required note', type: 'text', required: true },
      ];
      const patched = await config.patchVersion(created.versionId, { expectedVersion: source.bpmRevision, definition }, manager);
      const validation = await config.validateVersion(created.versionId, patched.bpmRevision, manager);
      if (!('validatedHash' in validation)) throw new Error('Missing typed-fields validation hash');
      await config.publishVersion(created.versionId, { expectedVersion: patched.bpmRevision, validatedHash: validation.validatedHash }, manager);
      const createdCategory = await first.requestCategory.findUniqueOrThrow({ where: { id: created.id } });
      await config.enableProcess(created.id, { expectedVersion: createdCategory.configRevision }, manager);

      const draft = await runtime.create({
        categoryId: created.id,
        versionId: created.versionId,
        title: 'Typed field validation request',
        description: 'Partial draft accepts false and zero',
        fields: { flag: false, count: 0 },
      }, manager);
      const invalidCases = [
        { field: 'day', value: '2026-02-30' },
        { field: 'amount', value: '1.23456' },
        { field: 'kind', value: 'unknown' },
        { field: 'unknown_field', value: 'x' },
      ];
      for (const invalid of invalidCases) {
        await expect(runtime.saveDraft(draft.id, { expectedVersion: 0, fields: { [invalid.field]: invalid.value } }, manager)).rejects.toMatchObject({
          response: { fields: { [invalid.field]: expect.any(String) } },
        });
      }
      const validDraft = await runtime.saveDraft(draft.id, {
        expectedVersion: 0,
        fields: { flag: false, count: 0, amount: '1.2300', day: '2026-02-28', kind: 'a' },
      }, manager);
      expect(validDraft.currentVersion).toBe(1);
      await expect(runtime.submit(draft.id, command(1), manager)).rejects.toMatchObject({
        response: { fields: { required_note: 'Campo obrigatório' } },
      });
      expect(await first.processInstance.count({ where: { requestId: draft.id } })).toBe(0);
      expect(await first.requestSlaClock.count({ where: { requestId: draft.id } })).toBe(0);
      expect(await first.requestRuntimeEvent.count({ where: { requestId: draft.id, type: 'request.submitted' } })).toBe(0);
      const completedDraft = await runtime.saveDraft(draft.id, { expectedVersion: 1, fields: { required_note: 'ok' } }, manager);
      const submitted = await runtime.submit(draft.id, command(completedDraft.currentVersion), manager);
      expect(submitted.currentVersion).toBe(completedDraft.currentVersion + 1);
      expect(await first.processInstance.count({ where: { requestId: draft.id } })).toBe(1);
      expect(await first.requestSlaClock.count({ where: { requestId: draft.id } })).toBe(2);
      expect(await first.requestRuntimeEvent.count({ where: { requestId: draft.id, type: 'request.submitted' } })).toBe(1);
    }, 30000);
    it('rejects cyclic, unknown-node and unsupported-approval definitions without moving the published pointer', async () => {
      const baseline = await first.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
      const source = await first.categoryVersion.findUniqueOrThrow({ where: { id: versionId } });
      const invalidCases = [
        { path: 'edges', mutate: (d: any) => d.edges.push({ from: 'end', to: 'triage' }) },
        { path: 'nodes', mutate: (d: any) => d.nodes.push({ id: 'mystery', type: 'unknown' }) },
        { path: 'capabilities', mutate: (d: any) => { d.capabilities.push('approval'); } },
      ];
      for (const [index, testCase] of invalidCases.entries()) {
        const created = await config.createVersion(categoryId, { expectedVersion: baseline.configRevision + index, cloneVersionId: source.version }, manager);
        const definition = structuredClone(source.bpmDefinition as any);
        testCase.mutate(definition);
        let rejection: any;
        try {
          await config.patchVersion(created.id, { expectedVersion: created.bpmRevision, definition }, manager);
        } catch (error) { rejection = error; }
        expect(rejection?.getStatus?.()).toBe(422);
        expect(JSON.stringify(rejection?.response)).toContain(testCase.path);
        const unchanged = await first.categoryVersion.findUniqueOrThrow({ where: { id: created.id } });
        expect(unchanged.bpmRevision).toBe(created.bpmRevision);
        expect(unchanged.bpmDefinition).toEqual(source.bpmDefinition);
        await expect(config.publishVersion(created.id, { expectedVersion: created.bpmRevision, validatedHash: 'invalid-hash' }, manager)).rejects.toMatchObject({ status: 409 });
        const afterPublishAttempt = await first.categoryVersion.findUniqueOrThrow({ where: { id: created.id } });
        expect(afterPublishAttempt.bpmRevision).toBe(created.bpmRevision);
        expect(afterPublishAttempt.bpmDefinition).toEqual(source.bpmDefinition);
        const current = await first.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
        expect(current.publishedBpmVersionId).toBe(baseline.publishedBpmVersionId);
      }
    }, 30000);
  },
);
