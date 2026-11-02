import { describe, expect, it } from 'vitest';
import { RequestRuntimeService } from './request-runtime.service.js';
const actor: any = {
  userId: 'u',
  collaboratorId: 'c',
  permissions: ['request:create', 'request:read'],
  roles: [],
};
function fixture() {
  let row: any = {
    id: 'r',
    requesterId: 'c',
    status: 'rascunho',
    lockVersion: 7,
    title: 'Title',
    description: 'Description',
    formData: { secret: 'keep', value: 'old' },
    categoryVersion: {
      bpmDefinition: {
        form: [
          { key: 'secret', type: 'text' },
          { key: 'value', type: 'text' },
        ],
        formAccess: { secret: 'hidden' },
      },
    },
  };
  const receipts = new Map<string, any>();
  let writes = 0;
  const tx: any = {
    $queryRaw: async () => [],
    request: {
      updateMany: async ({ where, data }: any) => {
        if (where.lockVersion !== row.lockVersion) return { count: 0 };
        writes++;
        row = { ...row, ...data, lockVersion: row.lockVersion + 1 };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => row,
      findUnique: async () => row,
    },
    requestCommandReceipt: {
      findUnique: async ({ where }: any) =>
        receipts.get(where.actorUserId_key.key),
      create: async ({ data }: any) => {
        const rec = { ...data, id: 'receipt' };
        receipts.set(data.key, rec);
        return rec;
      },
    },
  };
  const service: any = new RequestRuntimeService(
    {
      user: {
        findUnique: async () => ({
          status: 'active',
          collaboratorId: 'c',
          userRoles: [
            {
              role: {
                rolePermissions: [
                  { permission: { resource: 'request', action: 'create' } },
                ],
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
  return { service, getRow: () => row, writes: () => writes };
}
describe('draft command protocol', () => {
  it('replays a lost response without a second mutation, returning the current revision', async () => {
    const f = fixture();
    const command = {
      expectedVersion: 7,
      title: 'New title',
      fields: { value: 'new' },
      commandKey: 'same-intent-key',
      commandId: 'cmd',
    };
    expect(
      (await f.service.saveDraft('r', command, actor)).currentVersion,
    ).toBe(8);
    expect((await f.service.saveDraft('r', command, actor)).replay).toBe(true);
    expect(f.writes()).toBe(1);
    expect(f.getRow().formData.secret).toBe('keep');
  });
  it('rejects changed payload under the same key and stale revision without overwrite', async () => {
    const f = fixture();
    const command = {
      expectedVersion: 7,
      title: 'New title',
      commandKey: 'same-intent-key',
      commandId: 'cmd',
    };
    await f.service.saveDraft('r', command, actor);
    await expect(
      f.service.saveDraft('r', { ...command, title: 'different' }, actor),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
    await expect(
      f.service.saveDraft(
        'r',
        { ...command, commandKey: 'different-key' },
        actor,
      ),
    ).rejects.toThrow('VERSION_CONFLICT');
    expect(f.writes()).toBe(1);
  });
  it('denies protected field writes before any mutation', async () => {
    const f = fixture();
    await expect(
      f.service.saveDraft(
        'r',
        { expectedVersion: 7, fields: { secret: 'bad' } },
        actor,
      ),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
});
