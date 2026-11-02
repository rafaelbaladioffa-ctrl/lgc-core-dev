/**
 * P03 integration tests: parallel gateways (AND-split/join) and XOR routing.
 *
 * Run with:
 *   BPM_TEST_DATABASE_URL=postgresql://axis:axis@localhost:5432/lgc_bpm_test \
 *   npx vitest run --config vitest.config.e2e.ts "bpm-p03"
 *
 * Never touches the operational DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import { RequestRuntimeService } from '../src/request-runtime/request-runtime.service.js';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-request.js';

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'BPM P03 — parallel gateways and XOR routing',
  () => {
    let db: PrismaClient;
    let config: RequestProcessesService;
    let runtime: RequestRuntimeService;
    let author: AuthenticatedUser;
    let executor: AuthenticatedUser;
    let mgr: AuthenticatedUser;
    let triageQueueId: string;
    let branchAQueueId: string;
    let branchBQueueId: string;
    let sectorId: string;
    const prefix = `bpm-p03-${randomUUID()}`;
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

      const sector = await db.sector.create({ data: { code: prefix, name: prefix } });
      sectorId = sector.id;
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

      mgr = await persona('manager', [
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
      author = await persona('author', ['request:create', 'request:read', 'request:comment']);
      executor = await persona('executor', ['request:read', 'request:update', 'request:comment']);

      const queueA = await config.createQueue(
        { sectorId: sector.id, name: `${prefix}-A`, members: [executor.collaboratorId!], managers: [mgr.collaboratorId!] },
        mgr,
      );
      const queueB = await config.createQueue(
        { sectorId: sector.id, name: `${prefix}-B`, members: [executor.collaboratorId!], managers: [mgr.collaboratorId!] },
        mgr,
      );
      const queueTriage = await config.createQueue(
        { sectorId: sector.id, name: `${prefix}-triage`, members: [executor.collaboratorId!], managers: [mgr.collaboratorId!] },
        mgr,
      );
      triageQueueId = queueTriage.id;
      branchAQueueId = queueA.id;
      branchBQueueId = queueB.id;
    }, 30_000);

    afterAll(async () => {
      await db?.$disconnect();
    });

    /**
     * Build and publish a P03 process with the given BPM definition override.
     * Returns the categoryId (requestCategory.id).
     */
    async function publishProcess(defOverride: Record<string, unknown>) {
      const created = await config.createProcess(
        {
          code: randomUUID(),
          name: `${prefix}-${randomUUID()}`,
          description: 'P03 fixture',
          sectorId,
          triageQueueId,
          executionQueueId: branchAQueueId,
          publisherUserIds: [mgr.userId],
        },
        mgr,
      );
      const draftVersion = await db.categoryVersion.findUniqueOrThrow({ where: { id: created.versionId } });
      const baseDef = draftVersion.bpmDefinition as Record<string, unknown>;
      await config.patchVersion(
        created.versionId,
        { expectedVersion: 0, definition: { ...baseDef, ...defOverride } },
        mgr,
      );
      const report = await config.validateVersion(created.versionId, 1, mgr);
      if (!('validatedHash' in report)) throw new Error(`P03 validation failed: ${JSON.stringify(report)}`);
      await config.publishVersion(
        created.versionId,
        { expectedVersion: 1, validatedHash: report.validatedHash },
        mgr,
      );
      const category = await db.requestCategory.findUniqueOrThrow({ where: { id: created.id } });
      await config.enableProcess(created.id, { expectedVersion: category.configRevision }, mgr);
      return created.id;
    }

    /** Submit a new request through triage and return the claimable execution activity. */
    async function runTriage(categoryId: string) {
      const versionId = await db.requestCategory
        .findUniqueOrThrow({ where: { id: categoryId }, include: { versions: true } })
        .then((c) => c.versions.find((v) => v.bpmStatus === 'published')!.id);
      const req = await runtime.create(
        { categoryId, versionId, title: `P03 test ${randomUUID()}`, description: 'fixture', fields: {}, commandKey: randomUUID(), commandId: randomUUID() },
        author,
      );
      const requestId = req.id;
      let detail = await runtime.detail(requestId, author);
      await runtime.submit(requestId, cmd(detail.currentVersion), author);
      detail = await runtime.detail(requestId, executor);
      const triage = detail.activities.find((a: any) => a.allowedActions.includes('claim'));
      if (!triage) throw new Error('no triage activity');
      await runtime.claim(triage.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimed = detail.activities.find((a: any) => a.state === 'claimed');
      if (!claimed) throw new Error('triage not claimed');
      await runtime.complete(claimed.id, { ...cmd(detail.currentVersion), resolution: 'triaged' }, executor);
      detail = await runtime.detail(requestId, executor);
      return { requestId, detail };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C01: XOR gateway routes to the correct branch based on a field value.
    // ─────────────────────────────────────────────────────────────────────────
    it('C01 XOR gateway routes to correct branch', async () => {
      const categoryId = await publishProcess({
        form: [{ key: 'urgency', label: 'Urgência', type: 'text' }],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'triage', type: 'human', phase: 'triage', queueId: triageQueueId },
          { id: 'xor1', type: 'gateway_xor', conditions: [
            { condition: { op: 'eq', left: { path: 'fields.urgency' }, right: { literal: 'high' } }, targetNodeId: 'exec_high' },
            { targetNodeId: 'exec_normal' },
          ]},
          { id: 'exec_high', type: 'human', phase: 'execution', queueId: branchAQueueId },
          { id: 'exec_normal', type: 'human', phase: 'execution', queueId: branchBQueueId },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'triage' },
          { from: 'triage', to: 'xor1' },
          { from: 'xor1', to: 'exec_high' },
          { from: 'xor1', to: 'exec_normal' },
          { from: 'exec_high', to: 'end' },
          { from: 'exec_normal', to: 'end' },
        ],
      });

      // Submit with urgency=high — should route to exec_high (branchA queue)
      const versionId = await db.requestCategory
        .findUniqueOrThrow({ where: { id: categoryId }, include: { versions: true } })
        .then((c) => c.versions.find((v) => v.bpmStatus === 'published')!.id);
      const req = await runtime.create(
        { categoryId, versionId, title: `C01 high ${randomUUID()}`, description: 'fixture', fields: { urgency: 'high' }, commandKey: randomUUID(), commandId: randomUUID() },
        author,
      );
      const requestId = req.id;
      let detail = await runtime.detail(requestId, author);
      await runtime.submit(requestId, cmd(detail.currentVersion), author);
      detail = await runtime.detail(requestId, executor);
      const triage = detail.activities.find((a: any) => a.allowedActions.includes('claim'));
      await runtime.claim(triage!.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimed = detail.activities.find((a: any) => a.state === 'claimed');
      await runtime.complete(claimed!.id, { ...cmd(detail.currentVersion), resolution: 'triaged' }, executor);

      detail = await runtime.detail(requestId, executor);
      const execActivities = detail.activities.filter((a: any) => a.phase === 'execution');
      expect(execActivities).toHaveLength(1);
      // The activity should be in the high-queue (branchA)
      const act = await db.activityInstance.findUniqueOrThrow({ where: { id: execActivities[0].id } });
      expect(act.nodeId).toBe('exec_high');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C02: XOR default branch (no condition) fires when no condition matches.
    // ─────────────────────────────────────────────────────────────────────────
    it('C02 XOR default branch fires when no condition matches', async () => {
      const categoryId = await publishProcess({
        form: [{ key: 'urgency', label: 'Urgência', type: 'text' }],
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'triage', type: 'human', phase: 'triage', queueId: triageQueueId },
          { id: 'xor1', type: 'gateway_xor', conditions: [
            { condition: { op: 'eq', left: { path: 'fields.urgency' }, right: { literal: 'high' } }, targetNodeId: 'exec_high' },
            { targetNodeId: 'exec_normal' },
          ]},
          { id: 'exec_high', type: 'human', phase: 'execution', queueId: branchAQueueId },
          { id: 'exec_normal', type: 'human', phase: 'execution', queueId: branchBQueueId },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'triage' },
          { from: 'triage', to: 'xor1' },
          { from: 'xor1', to: 'exec_high' },
          { from: 'xor1', to: 'exec_normal' },
          { from: 'exec_high', to: 'end' },
          { from: 'exec_normal', to: 'end' },
        ],
      });

      const versionId = await db.requestCategory
        .findUniqueOrThrow({ where: { id: categoryId }, include: { versions: true } })
        .then((c) => c.versions.find((v) => v.bpmStatus === 'published')!.id);
      const req = await runtime.create(
        { categoryId, versionId, title: `C02 normal ${randomUUID()}`, description: 'fixture', fields: { urgency: 'low' }, commandKey: randomUUID(), commandId: randomUUID() },
        author,
      );
      const requestId = req.id;
      let detail = await runtime.detail(requestId, author);
      await runtime.submit(requestId, cmd(detail.currentVersion), author);
      detail = await runtime.detail(requestId, executor);
      const triage = detail.activities.find((a: any) => a.allowedActions.includes('claim'));
      await runtime.claim(triage!.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimed = detail.activities.find((a: any) => a.state === 'claimed');
      await runtime.complete(claimed!.id, { ...cmd(detail.currentVersion), resolution: 'triaged' }, executor);

      detail = await runtime.detail(requestId, executor);
      const execActivities = detail.activities.filter((a: any) => a.phase === 'execution');
      expect(execActivities).toHaveLength(1);
      const act = await db.activityInstance.findUniqueOrThrow({ where: { id: execActivities[0].id } });
      expect(act.nodeId).toBe('exec_normal');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C03: AND-split creates two parallel activities.
    // ─────────────────────────────────────────────────────────────────────────
    it('C03 AND-split creates two parallel activities', async () => {
      const categoryId = await publishProcess({
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'triage', type: 'human', phase: 'triage', queueId: triageQueueId },
          { id: 'and_split', type: 'gateway_and' },
          { id: 'branch_a', type: 'human', phase: 'execution', queueId: branchAQueueId },
          { id: 'branch_b', type: 'human', phase: 'execution', queueId: branchBQueueId },
          { id: 'and_join', type: 'gateway_and' },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'triage' },
          { from: 'triage', to: 'and_split' },
          { from: 'and_split', to: 'branch_a' },
          { from: 'and_split', to: 'branch_b' },
          { from: 'branch_a', to: 'and_join' },
          { from: 'branch_b', to: 'and_join' },
          { from: 'and_join', to: 'end' },
        ],
      });

      const { requestId, detail: d } = await runTriage(categoryId);
      const detail = await runtime.detail(requestId, executor);
      const execActivities = detail.activities.filter((a: any) => a.phase === 'execution');
      expect(execActivities).toHaveLength(2);
      const nodeIds = execActivities.map((a: any) =>
        db.activityInstance.findUniqueOrThrow({ where: { id: a.id } }).then((ai) => ai.nodeId),
      );
      const resolved = await Promise.all(nodeIds);
      expect(resolved.sort()).toEqual(['branch_a', 'branch_b']);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C04: AND-join waits until both branches complete before concluding.
    // ─────────────────────────────────────────────────────────────────────────
    it('C04 AND-join waits for all branches', async () => {
      const categoryId = await publishProcess({
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'triage', type: 'human', phase: 'triage', queueId: triageQueueId },
          { id: 'and_split', type: 'gateway_and' },
          { id: 'branch_a', type: 'human', phase: 'execution', queueId: branchAQueueId },
          { id: 'branch_b', type: 'human', phase: 'execution', queueId: branchBQueueId },
          { id: 'and_join', type: 'gateway_and' },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'triage' },
          { from: 'triage', to: 'and_split' },
          { from: 'and_split', to: 'branch_a' },
          { from: 'and_split', to: 'branch_b' },
          { from: 'branch_a', to: 'and_join' },
          { from: 'branch_b', to: 'and_join' },
          { from: 'and_join', to: 'end' },
        ],
      });

      const { requestId } = await runTriage(categoryId);
      let detail = await runtime.detail(requestId, executor);
      const execActivities = detail.activities.filter((a: any) => a.phase === 'execution');
      expect(execActivities).toHaveLength(2);

      // Claim and complete first branch
      const first = execActivities[0];
      await runtime.claim(first.id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimedFirst = detail.activities.find((a: any) => a.state === 'claimed');
      await runtime.complete(claimedFirst!.id, { ...cmd(detail.currentVersion), resolution: 'done' }, executor);

      // Should still be em_atendimento (join not satisfied)
      detail = await runtime.detail(requestId, executor);
      expect((detail as any).status).toBe('em_atendimento');
      const stillOpen = detail.activities.filter((a: any) => a.state !== 'completed');
      expect(stillOpen).toHaveLength(1);

      // Complete second branch
      await runtime.claim(stillOpen[0].id, cmd(detail.currentVersion), executor);
      detail = await runtime.detail(requestId, executor);
      const claimedSecond = detail.activities.find((a: any) => a.state === 'claimed');
      await runtime.complete(claimedSecond!.id, { ...cmd(detail.currentVersion), resolution: 'done' }, executor);

      // Now should be concluded
      detail = await runtime.detail(requestId, author);
      expect((detail as any).status).toBe('concluida');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // C05: Timeline contains gateway events (split, joined).
    // ─────────────────────────────────────────────────────────────────────────
    it('C05 timeline contains gateway events', async () => {
      const categoryId = await publishProcess({
        nodes: [
          { id: 'start', type: 'start' },
          { id: 'triage', type: 'human', phase: 'triage', queueId: triageQueueId },
          { id: 'and_split', type: 'gateway_and' },
          { id: 'branch_a', type: 'human', phase: 'execution', queueId: branchAQueueId },
          { id: 'branch_b', type: 'human', phase: 'execution', queueId: branchBQueueId },
          { id: 'and_join', type: 'gateway_and' },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { from: 'start', to: 'triage' },
          { from: 'triage', to: 'and_split' },
          { from: 'and_split', to: 'branch_a' },
          { from: 'and_split', to: 'branch_b' },
          { from: 'branch_a', to: 'and_join' },
          { from: 'branch_b', to: 'and_join' },
          { from: 'and_join', to: 'end' },
        ],
      });

      const { requestId } = await runTriage(categoryId);
      let detail = await runtime.detail(requestId, executor);
      const acts = detail.activities.filter((a: any) => a.phase === 'execution');

      // Complete both branches
      for (const act of acts) {
        detail = await runtime.detail(requestId, executor);
        const targetAct = detail.activities.find((a: any) => a.id === act.id && a.state !== 'completed');
        if (!targetAct) continue;
        await runtime.claim(targetAct.id, cmd(detail.currentVersion), executor);
        detail = await runtime.detail(requestId, executor);
        const claimed = detail.activities.find((a: any) => a.id === act.id && a.state === 'claimed');
        if (!claimed) continue;
        await runtime.complete(claimed.id, { ...cmd(detail.currentVersion), resolution: 'done' }, executor);
      }

      const tl = await runtime.timeline(requestId, author);
      const eventTypes = tl.map((e: any) => e.type);
      expect(eventTypes).toContain('gateway.split');
      expect(eventTypes).toContain('gateway.joined');
    });
  },
);
