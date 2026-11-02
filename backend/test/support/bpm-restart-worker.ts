import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { RequestProcessesService } from '../../src/request-processes/request-processes.service.js';
import { RequestRuntimeService } from '../../src/request-runtime/request-runtime.service.js';
import type { AuthenticatedUser } from '../../src/auth/authenticated-request.js';

const url = process.env.BPM_TEST_DATABASE_URL;
if (!url) throw new Error('BPM_TEST_DATABASE_URL is required');

const enabled = { get: (key: string, fallback?: string) => key === 'REQUEST_BPM_ENABLED' ? 'true' : fallback } as any;
const prisma = new PrismaClient({ datasources: { db: { url } } });
const config = new RequestProcessesService(prisma as any, enabled);
const runtime = new RequestRuntimeService(prisma as any, enabled);

const command = (expectedVersion: number) => ({
  expectedVersion,
  commandKey: randomUUID(),
  commandId: randomUUID(),
});

function actor(userId: string, collaboratorId: string): AuthenticatedUser {
  return {
    userId,
    email: `${userId}@example.invalid`,
    mustChangePassword: false,
    collaboratorId,
    permissions: [
      'request:create',
      'request:read',
      'request:update',
      'request:assign',
      'request_process:model',
      'request_process:publish',
      'request_category:create',
      'request_queue:manage',
    ],
    roles: [],
  };
}

async function phaseOne() {
  const prefix = `restart-${randomUUID()}`;
  const sector = await prisma.sector.create({ data: { code: prefix, name: prefix } });
  const job = await prisma.jobTitle.create({ data: { name: prefix } });
  const role = await prisma.role.create({
    data: {
      name: `${prefix}-role`,
      rolePermissions: {
        create: [
          'request:create', 'request:read', 'request:update', 'request:assign',
          'request_process:model', 'request_process:publish', 'request_category:create',
          'request_queue:manage',
        ].map((value) => {
          const [resource, action] = value.split(':');
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
  const persona = async (name: string) => {
    const collaborator = await prisma.collaborator.create({
      data: {
        fullName: `${prefix}-${name}`,
        rgEnc: 'synthetic',
        cpfEnc: 'synthetic',
        cpfHash: randomUUID(),
        corporateEmail: `${prefix}-${name}@example.invalid`,
        matricula: randomUUID(),
        sectorId: sector.id,
        jobTitleId: job.id,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `${prefix}-${name}@example.invalid`,
        passwordHash: 'synthetic-not-a-login',
        collaboratorId: collaborator.id,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { collaborator, user, current: actor(user.id, collaborator.id) };
  };
  const manager = await persona('manager');
  const executor = await persona('executor');
  const queue = await config.createQueue({
    sectorId: sector.id,
    name: prefix,
    members: [executor.collaborator.id],
    managers: [manager.collaborator.id],
  }, manager.current);
  const created = await config.createProcess({
    code: prefix,
    name: `${prefix} process`,
    description: 'restart fixture',
    sectorId: sector.id,
    triageQueueId: queue.id,
    executionQueueId: queue.id,
    publisherUserIds: [manager.user.id],
  }, manager.current);
  const report = await config.validateVersion(created.versionId, 0, manager.current);
  if (!report.valid || !('validatedHash' in report)) throw new Error('restart fixture definition invalid');
  await config.publishVersion(created.versionId, { expectedVersion: 0, validatedHash: report.validatedHash }, manager.current);
  const category = await prisma.requestCategory.findUniqueOrThrow({ where: { id: created.id } });
  await config.enableProcess(created.id, { expectedVersion: category.configRevision }, manager.current);

  const draft = await runtime.create({
    categoryId: created.id,
    versionId: created.versionId,
    title: 'Restart fixture request',
    description: 'Persist across processes',
    commandKey: randomUUID(),
    commandId: randomUUID(),
  }, manager.current);
  await runtime.submit(draft.id, command(0), manager.current);
  const submitted = await prisma.request.findUniqueOrThrow({ where: { id: draft.id } });
  const available = await prisma.activityInstance.findFirstOrThrow({
    where: { instance: { requestId: draft.id }, phase: 'triage' },
  });
  await runtime.claim(available.id, command(submitted.currentVersion), executor.current);
  const request = await prisma.request.findUniqueOrThrow({ where: { id: draft.id } });
  const activity = await prisma.activityInstance.findUniqueOrThrow({ where: { id: available.id } });
  const clocks = await prisma.requestSlaClock.findMany({
    where: { requestId: request.id },
    orderBy: { metric: 'asc' },
    select: {
      metric: true,
      budgetSeconds: true,
      elapsedSeconds: true,
      checkpointAt: true,
      originalTargetAt: true,
      targetAt: true,
      stoppedAt: true,
      breachedAt: true,
      intervals: {
        orderBy: { startAt: 'asc' },
        select: { kind: true, startAt: true, endAt: true, reason: true },
      },
    },
  });
  const result = {
    requestId: request.id,
    activityId: activity.id,
    userId: executor.user.id,
    collaboratorId: executor.collaborator.id,
    lockVersion: request.lockVersion,
    assigneeId: activity.assigneeId,
    activityState: activity.state,
    clocks,
  };
  await prisma.$disconnect();
  console.log(JSON.stringify(result));
}

async function phaseTwo() {
  const fixture = JSON.parse(process.env.BPM_RESTART_FIXTURE ?? '{}');
  const current = actor(fixture.userId, fixture.collaboratorId);
  const before = await prisma.request.findUniqueOrThrow({ where: { id: fixture.requestId } });
  const beforeActivity = await prisma.activityInstance.findUniqueOrThrow({ where: { id: fixture.activityId } });
  const beforeClocks = await prisma.requestSlaClock.findMany({
    where: { requestId: fixture.requestId },
    orderBy: { metric: 'asc' },
    select: {
      metric: true,
      budgetSeconds: true,
      elapsedSeconds: true,
      checkpointAt: true,
      originalTargetAt: true,
      targetAt: true,
      stoppedAt: true,
      breachedAt: true,
      intervals: {
        orderBy: { startAt: 'asc' },
        select: { kind: true, startAt: true, endAt: true, reason: true },
      },
    },
  });
  await runtime.complete(fixture.activityId, { ...command(before.lockVersion), resolution: 'Completed after process restart' }, current);
  const after = await prisma.request.findUniqueOrThrow({ where: { id: fixture.requestId } });
  const afterActivity = await prisma.activityInstance.findUniqueOrThrow({ where: { id: fixture.activityId } });
  const afterClocks = await prisma.requestSlaClock.findMany({
    where: { requestId: fixture.requestId },
    orderBy: { metric: 'asc' },
    select: {
      metric: true,
      budgetSeconds: true,
      elapsedSeconds: true,
      checkpointAt: true,
      originalTargetAt: true,
      targetAt: true,
      stoppedAt: true,
      breachedAt: true,
      intervals: {
        orderBy: { startAt: 'asc' },
        select: { kind: true, startAt: true, endAt: true, reason: true },
      },
    },
  });
  await prisma.$disconnect();
  console.log(JSON.stringify({
    before: { lockVersion: before.lockVersion, assigneeId: beforeActivity.assigneeId, state: beforeActivity.state, clocks: beforeClocks },
    after: { lockVersion: after.lockVersion, assigneeId: afterActivity.assigneeId, state: afterActivity.state, status: after.status, clocks: afterClocks },
  }));
}

try {
  if (process.env.BPM_RESTART_PHASE === 'one') await phaseOne();
  else if (process.env.BPM_RESTART_PHASE === 'two') await phaseTwo();
  else throw new Error('BPM_RESTART_PHASE must be one or two');
} catch (error) {
  await prisma.$disconnect();
  console.error(error);
  process.exitCode = 1;
}
