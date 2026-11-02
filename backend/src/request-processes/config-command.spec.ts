import { describe, expect, it } from 'vitest';
import { RequestProcessesService } from './request-processes.service.js';
describe('configuration unit of work and replay', () => {
  it('runs writes and receipt in one client, replays once and rejects a changed intent', async () => {
    const receipts = new Map();
    let operations = 0;
    let inTransaction = false;
    const tx: any = {
      $queryRaw: async () => [],
      requestCommandReceipt: {
        findUnique: async ({ where }: any) =>
          receipts.get(where.actorUserId_key.key),
        create: async ({ data }: any) => {
          expect(inTransaction).toBe(true);
          receipts.set(data.key, { ...data, id: 'receipt' });
        },
      },
    };
    const service = new RequestProcessesService(
      {
        user: {
          findUnique: async () => ({
            status: 'active',
            userRoles: [
              {
                role: {
                  rolePermissions: [
                    {
                      permission: {
                        resource: 'request_queue',
                        action: 'manage',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        },
        $transaction: async (fn: any) => {
          inTransaction = true;
          try {
            return await fn(tx);
          } finally {
            inTransaction = false;
          }
        },
      } as any,
      { get: () => 'true' } as any,
    );
    const user: any = { userId: 'u' };
    const body = { commandKey: 'key', commandId: 'id', name: 'Queue' };
    const operation = async () => {
      operations++;
      expect(inTransaction).toBe(true);
      return { id: 'queue' };
    };
    expect(
      await service.configCommand(
        user,
        'POST /bpm/queues',
        undefined,
        body,
        ['request_queue:manage'],
        operation,
      ),
    ).toEqual({ id: 'queue' });
    expect(
      await service.configCommand(
        user,
        'POST /bpm/queues',
        undefined,
        body,
        ['request_queue:manage'],
        operation,
      ),
    ).toEqual({ id: 'queue' });
    expect(operations).toBe(1);
    await expect(
      service.configCommand(
        user,
        'POST /bpm/queues',
        undefined,
        { ...body, name: 'Changed' },
        ['request_queue:manage'],
        operation,
      ),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });
});
