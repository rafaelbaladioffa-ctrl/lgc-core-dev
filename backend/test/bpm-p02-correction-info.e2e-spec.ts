/**
 * P02 integration tests: correction flow + information flow.
 *
 * Requires a provisioned *_bpm_test database with P02 migration applied.
 * Run with: BPM_TEST_DATABASE_URL=postgresql://localhost/axis_bpm_test npx vitest run test/bpm-p02-correction-info.e2e-spec.ts
 *
 * Never touches operational data or the default DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import { RequestRuntimeService } from '../src/request-runtime/request-runtime.service.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-request.js';

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'BPM P02 — correction + information flows',
  () => {
    let db: PrismaClient;
    let config: RequestProcessesService;
    let runtime: RequestRuntimeService;
    let author: AuthenticatedUser;
    let executor: AuthenticatedUser;
    let categoryId: string;
    const prefix = `bpm-p02-${randomUUID()}`;
    const enabled = { get: () => 'true' } as any;
    const cmd = (v: number) => ({
      expectedVersion: v,
      commandKey: randomUUID(),
      commandId: randomUUID(),
    });

    beforeAll(async () => {
      const url = requireBpmTestDatabaseUrl();
      db = new PrismaClient({ datasources: { db: { url } } });
      await db.$connect();
      config = new RequestProcessesService(db as any, enabled);
      runtime = new RequestRuntimeService(db as any, enabled);

      const sector = await db.sector.create({
        data: { code: prefix, name: prefix },
      });
      const job = await db.jobTitle.create({ data: { name: prefix } });
      const persona = async (name: string, permissions: string[]) => {
        const role = await db.role.create({
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
        const collab = await db.collaborator.create({
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
        const user = await db.user.create({
          data: {
            email: `${randomUUID()}@example.invalid`,
            passwordHash: 'synthetic-not-a-login',
            collaboratorId: collab.id,
            userRoles: { create: { roleId: role.id } },
          },
        });
        return {
          userId: user.id,
          email: user.email,
          mustChangePassword: false,
          collaboratorId: collab.id,
          permissions,
          roles: [],
        } as AuthenticatedUser;
      };

      author = await persona('author', [
        'request:create',
        'request:comment',
        'request:read',
      ]);
      executor = await persona('executor', [
        'request:read',
        'request:update',
        'request:comment',
      ]);

      const mgr = await persona('manager', [
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
      const queue = await config.createQueue(
        {
          sectorId: sector.id,
          name: prefix,
          members: [executor.collaboratorId!],
          managers: [mgr.collaboratorId!],
        },
        mgr,
      );
      const created = await config.createProcess(
        {
          code: prefix,
          name: prefix,
          description: 'P02 correction+info fixture',
          sectorId: sector.id,
          triageQueueId: queue.id,
          executionQueueId: queue.id,
          publisherUserIds: [mgr.userId],
        },
        mgr,
      );
      categoryId = created.id;
      // Patch the draft version to add a form field used in fixture data.
      const draftVersion = await db.categoryVersion.findUniqueOrThrow({
        where: { id: created.versionId },
      });
      const baseDef = draftVersion.bpmDefinition as Record<string, unknown>;
      await config.patchVersion(
        created.versionId,
        {
          expectedVersion: 0,
          definition: { ...baseDef, form: [{ key: 'sistema', label: 'Sistema', type: 'text' }] },
        },
        mgr,
      );
      const report = await config.validateVersion(created.versionId, 1, mgr);
      if (!('validatedHash' in report)) throw new Error('validation failed');
      await config.publishVersion(
        created.versionId,
        { expectedVersion: 1, validatedHash: report.validatedHash },
        mgr,
      );
      const category = await db.requestCategory.findUniqueOrThrow({
        where: { id: categoryId },
      });
      await config.enableProcess(
        categoryId,
        { expectedVersion: category.configRevision },
        mgr,
      );
    }, 30000);

    afterAll(async () => {
      await db?.$disconnect();
    });

    /** Helper: create a submitted request, triage-complete → execution-claim, returns { requestId, executionActivityId, version }. */
    async function setupExecutionActivity() {
      const req = await runtime.create(
        {
          categoryId,
          versionId: await db.requestCategory
            .findUniqueOrThrow({ where: { id: categoryId }, include: { versions: true } })
            .then((c) => c.versions.find((v) => v.bpmStatus === 'published')!.id),
          title: `P02 test ${randomUUID()}`,
          description: 'integration fixture',
          fields: { sistema: 'ERP' },
          commandKey: randomUUID(),
          commandId: randomUUID(),
        },
        author,
      );
      const requestId = req.id;
      let detail = await runtime.detail(requestId, author);
      // submit
      await runtime.submit(requestId, cmd(detail.currentVersion), author);
      detail = await runtime.detail(requestId, executor);
      // claim triage
      const triage = detail.activities.find((a: any) =>
        a.allowedActions.includes('claim'),
      );
      if (!triage) throw new Error('No claimable triage activity');
      await runtime.claim(triage.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimedTriage = detail.activities.find(
        (a: any) => a.state === 'claimed',
      );
      if (!claimedTriage) throw new Error('Triage not claimed');
      // complete triage → execution
      await runtime.complete(
        claimedTriage.id,
        { ...cmd(detail.currentVersion), resolution: 'triaged' },
        executor,
      );
      detail = await runtime.detail(requestId, executor);
      const execActivity = detail.activities.find((a: any) =>
        a.allowedActions.includes('claim'),
      );
      if (!execActivity) throw new Error('No execution activity created');
      await runtime.claim(execActivity.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimed = detail.activities.find((a: any) => a.state === 'claimed');
      if (!claimed) throw new Error('Execution activity not claimed');
      return { requestId, executionActivityId: claimed.id, version: detail.currentVersion };
    }

    it('B01 returnForCorrection sets status aguardando_correcao', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      await (runtime as any).returnForCorrection(
        executionActivityId,
        { ...cmd(version), reason: 'Por favor corrija o campo sistema' },
        executor,
      );
      const detail = await runtime.detail(requestId, author);
      expect((detail as any).status).toBe('aguardando_correcao');
      expect(detail.allowedActions).toContain('saveCorrection');
      expect(detail.allowedActions).toContain('resubmit');
    });

    it('B02 saveCorrection merges fields without changing status', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      await (runtime as any).returnForCorrection(
        executionActivityId,
        { ...cmd(version), reason: 'Correção necessária' },
        executor,
      );
      let detail = await runtime.detail(requestId, author);
      const v1 = detail.currentVersion;
      await (runtime as any).saveCorrection(
        requestId,
        { expectedVersion: v1, fields: { sistema: 'CRM_CORRIGIDO' } },
        author,
      );
      detail = await runtime.detail(requestId, author);
      expect((detail as any).fields?.sistema).toBe('CRM_CORRIGIDO');
      expect((detail as any).status).toBe('aguardando_correcao');
    });

    it('B03 resubmit sets status em_atendimento', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      await (runtime as any).returnForCorrection(
        executionActivityId,
        { ...cmd(version), reason: 'Precisa de revisão' },
        executor,
      );
      let detail = await runtime.detail(requestId, author);
      await (runtime as any).resubmit(
        requestId,
        cmd(detail.currentVersion),
        author,
      );
      detail = await runtime.detail(requestId, executor);
      expect((detail as any).status).toBe('em_atendimento');
      const execActivity = detail.activities.find((a: any) =>
        a.allowedActions.includes('claim'),
      );
      expect(execActivity).toBeDefined();
    });

    it('B04 requestInformation sets status aguardando_informacao', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      await (runtime as any).requestInformation(
        executionActivityId,
        {
          ...cmd(version),
          question: 'Qual é o número do contrato?',
        },
        executor,
      );
      const detail = await runtime.detail(requestId, author);
      expect((detail as any).status).toBe('aguardando_informacao');
      expect(detail.allowedActions).toContain('respondInformation');
      const activityWithQuestion = detail.activities.find(
        (a: any) => a.question,
      );
      expect(activityWithQuestion?.question).toBe('Qual é o número do contrato?');
    });

    it('B05 respondInformation sets status em_atendimento and stores answer', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      await (runtime as any).requestInformation(
        executionActivityId,
        { ...cmd(version), question: 'Qual é o prazo?' },
        executor,
      );
      let detail = await runtime.detail(requestId, author);
      await (runtime as any).respondInformation(
        requestId,
        {
          ...cmd(detail.currentVersion),
          answer: 'O prazo é 30 dias corridos.',
        },
        author,
      );
      detail = await runtime.detail(requestId, executor);
      expect((detail as any).status).toBe('em_atendimento');
      // answer stored in timeline
      const tl = await runtime.timeline(requestId, executor);
      const answerEvent = tl.find((e: any) => e.type === 'activity.information_responded');
      expect(answerEvent).toBeDefined();
    });

    it('B06 returnForCorrection with editableFieldKeys restricts correction', async () => {
      const { requestId, executionActivityId, version } = await setupExecutionActivity();
      // Return with restriction to only 'descricao' key (not 'sistema')
      await (runtime as any).returnForCorrection(
        executionActivityId,
        {
          ...cmd(version),
          reason: 'Descreva melhor o problema',
          editableFieldKeys: ['descricao'],
        },
        executor,
      );
      // Author attempts to edit 'sistema' — should be rejected
      let detail = await runtime.detail(requestId, author);
      await expect(
        (runtime as any).saveCorrection(
          requestId,
          {
            expectedVersion: detail.currentVersion,
            fields: { sistema: 'HACKEADO' },
          },
          author,
        ),
      ).rejects.toThrow();
    });
  },
);
