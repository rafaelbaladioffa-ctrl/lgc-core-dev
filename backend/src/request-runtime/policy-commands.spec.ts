import { describe, expect, it } from 'vitest';
import { RequestRuntimeService } from './request-runtime.service.js';
function fixture(actor: any, manager: boolean, requester: boolean) {
  const receipts = new Map<string, any>();
  let writes = 0;
  const row: any = {
    id: 'r',
    status: 'enviada',
    requesterId: requester ? actor.collaboratorId : 'other',
    currentCycle: 1,
    lockVersion: 4,
    queue: {
      bpmMembers: manager
        ? [
            {
              role: 'manager',
              active: true,
              collaboratorId: actor.collaboratorId,
            },
          ]
        : [],
    },
    bpmInstances: [],
  };
  const tx: any = {
    $queryRaw: async () => [],
    request: {
      updateMany: async ({ where, data }: any) => {
        if (where.lockVersion !== row.lockVersion) return { count: 0 };
        row.lockVersion++;
        if (data.status) row.status = data.status;
        writes++;
        return { count: 1 };
      },
      findUnique: async () => row,
    },
    requestCommandReceipt: {
      findUnique: async ({ where }: any) =>
        receipts.get(where.actorUserId_key.key),
      create: async ({ data }: any) => {
        receipts.set(data.key, { ...data, id: 'receipt' });
      },
    },
    activityInstance: { updateMany: async () => ({ count: 0 }) },
    activityAssignment: { updateMany: async () => ({ count: 0 }) },
    executionToken: { updateMany: async () => ({ count: 0 }) },
    processInstance: { updateMany: async () => ({ count: 0 }) },
    requestSlaClock: { findMany: async () => [] },
    bpmRequestComment: { create: async () => ({ id: 'comment' }) },
  };
  const service: any = new RequestRuntimeService(
    {
      user: {
        findUnique: async () => ({
          status: 'active',
          collaboratorId: actor.collaboratorId,
          userRoles: [
            {
              role: {
                rolePermissions: actor.permissions.map((p: string) => {
                  const [resource, action] = p.split(':');
                  return { permission: { resource, action } };
                }),
              },
            },
          ],
        }),
      },
      $transaction: async (fn: any) => fn(tx),
    } as any,
    { get: () => 'true' } as any,
  );
  service.requestAccess = async () => row;
  service.event = async () => ({ id: 'event' });
  return { service, writes: () => writes };
}
describe('current role and permission pairs for commands', () => {
  it.each([
    [true, false, ['request:create'], true],
    [true, false, ['request:update'], false],
    [false, true, ['request:update'], true],
    [false, true, ['request:create'], false],
    [false, false, ['request:update'], false],
    [false, false, ['request:create'], false],
  ])(
    'requester=%s manager=%s permissions=%s allowed=%s',
    async (requester, manager, permissions, allowed) => {
      const actor = { userId: 'u', collaboratorId: 'c', permissions };
      const f = fixture(actor, manager, requester);
      const command = {
        expectedVersion: 4,
        reason: 'Explicit cancellation',
        commandKey: 'cancel-command',
        commandId: 'command',
      };
      if (allowed) {
        await f.service.cancel('r', command, actor);
        expect((await f.service.cancel('r', command, actor)).replay).toBe(true);
        expect(f.writes()).toBe(1);
      } else {
        await expect(f.service.cancel('r', command, actor)).rejects.toThrow();
        expect(f.writes()).toBe(0);
      }
    },
  );
  it('comments increment the revision once, replay, and deny internal notes from an author outside the team', async () => {
    const actor = {
      userId: 'u',
      collaboratorId: 'c',
      permissions: ['request:comment'],
    };
    const f = fixture(actor, false, true);
    const command = {
      expectedVersion: 4,
      body: 'Public comment',
      commandKey: 'comment-key',
      commandId: 'id',
    };
    expect((await f.service.comment('r', command, actor)).currentVersion).toBe(
      5,
    );
    expect((await f.service.comment('r', command, actor)).replay).toBe(true);
    expect(f.writes()).toBe(1);
    await expect(
      f.service.comment(
        'r',
        { ...command, visibility: 'interno', commandKey: 'another-key' },
        actor,
      ),
    ).rejects.toThrow();
  });
});
