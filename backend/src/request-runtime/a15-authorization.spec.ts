import { describe, expect, it } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RequestRuntimeService } from './request-runtime.service.js';
import { RequestProcessesService } from '../request-processes/request-processes.service.js';

const author = {
  userId: 'user-author',
  collaboratorId: 'collab-author',
  permissions: ['request:update', 'request:read'],
  roles: [],
} as any;

function runtimeFixture() {
  let writes = 0;
  const row = {
    id: 'request-1',
    executionMode: 'bpm_v1',
    requesterId: author.collaboratorId,
    status: 'enviada',
    queue: { bpmMembers: [] },
    categoryVersion: { bpmDefinition: {}, categoryId: 'category-1' },
  } as any;
  const activity = {
    id: 'activity-1',
    state: 'available',
    phase: 'triage',
    candidates: [{ collaboratorId: author.collaboratorId }],
    instance: { requestId: row.id, request: row },
  } as any;
  const tx = {
    $queryRaw: async () => [],
    request: { updateMany: async () => { writes += 1; return { count: 1 }; } },
  } as any;
  const prisma = {
    user: {
      findUnique: async ({ where }: any) => ({
        status: 'active',
        collaboratorId: where.id === 'user-modeler' ? 'collab-modeler' : author.collaboratorId,
        userRoles: [{ role: { rolePermissions: (where.id === 'user-modeler' ? ['request:read'] : author.permissions).map((p: string) => {
          const [resource, action] = p.split(':');
          return { permission: { resource, action } };
        }) } }],
      }),
    },
    activityInstance: { findUnique: async () => activity },
    request: { findUnique: async () => row },
    processConfigGrant: { findFirst: async () => null },
    $transaction: async (fn: (value: any) => Promise<unknown>) => fn(tx),
  } as any;
  const service = new RequestRuntimeService(prisma, { get: () => 'true' } as any);
  return { service, writes: () => writes };
}

describe('A15 — authorization is explicit and has no side effects on denial', () => {
  it.each(['claim', 'complete'])('author cannot %s an activity even if incorrectly present as candidate', async (command) => {
    const { service, writes } = runtimeFixture();
    const dto = {
      expectedVersion: 0,
      commandId: `a15-${command}`,
      commandKey: `a15-${command}`,
      ...(command === 'complete' ? { resolution: 'Should not be accepted' } : {}),
    } as any;

    await expect(
      command === 'claim'
        ? service.claim('activity-1', dto, author)
        : service.complete('activity-1', dto, author),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(writes()).toBe(0);
  });

  it('a modeler grant does not authorize reading an operational request outside an explicit read scope', async () => {
    const { service } = runtimeFixture();
    const modeler = { ...author, userId: 'user-modeler', collaboratorId: 'collab-modeler', permissions: ['request:read'] } as any;
    await expect(service.detail('request-1', modeler)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a modeler with process permission cannot read a version without a process grant', async () => {
    let queriedGrant: any;
    const prisma = {
      user: { findUnique: async () => ({
        status: 'active',
        userRoles: [{ role: { rolePermissions: [{ permission: { resource: 'request_process', action: 'model' } }] } }],
      }) },
      categoryVersion: {
        findUnique: async () => ({ id: 'version-1', categoryId: 'category-1', category: {} }),
      },
      processConfigGrant: {
        findFirst: async (args: any) => { queriedGrant = args.where; return null; },
      },
    } as any;
    const service = new RequestProcessesService(prisma, { get: () => 'true' } as any);

    await expect(service.version('version-1', { userId: 'user-modeler' } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(queriedGrant).toMatchObject({ categoryId: 'category-1', userId: 'user-modeler', role: { in: ['modeler', 'publisher', 'auditor'] } });
  });
});
