import { describe, expect, it } from 'vitest';
import { RequestRuntimeService } from './request-runtime.service.js';
describe('BPM attachment inclusion and explicit replacement', () => {
  it('preserves two separate files, versions only explicit replacement and replays without duplicate BYTEA', async () => {
    const rows: any[] = [];
    const receipts = new Map();
    const tx: any = {
      $queryRaw: async () => [],
      request: {
        findUniqueOrThrow: async () => ({ status: 'rascunho', lockVersion: 7 }),
        update: async () => undefined,
      },
      requestCommandReceipt: {
        findUnique: async ({ where }: any) =>
          receipts.get(where.actorUserId_key.key),
        create: async ({ data }: any) => {
          receipts.set(data.key, { ...data, id: data.key });
        },
      },
      bpmRequestAttachment: {
        aggregate: async () => ({
          _sum: { sizeBytes: rows.reduce((n, a) => n + a.sizeBytes, 0) },
        }),
        findFirst: async ({ where }: any) =>
          rows.find(
            (a) => a.id === where.id && a.requestId === where.requestId,
          ),
        create: async ({ data }: any) => {
          const row = { ...data, id: `file-${rows.length + 1}` };
          rows.push(row);
          return row;
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
                    { permission: { resource: 'request', action: 'comment' } },
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
    service.requestAccess = async () => ({
      status: 'rascunho',
      bpmInstances: [],
      requesterId: 'c',
      lockVersion: 7,
      categoryVersion: { bpmDefinition: { formAccess: {} } },
    });
    service.event = async () => ({ id: 'event' });
    const body: any = {
      filename: 'proof.pdf',
      contentBase64: Buffer.from('%PDF-1.7 synthetic').toString('base64'),
      fieldKey: 'docs',
      expectedVersion: 7,
      commandKey: 'upload-one',
      commandId: 'one',
    };
    const actor: any = { userId: 'u', collaboratorId: 'c' };
    const one = await service.attachment('r', body, actor);
    expect(one.currentVersion).toBe(8);
    const replay = await service.attachment('r', body, actor);
    expect(replay.id).toBe(one.id);
    expect(rows).toHaveLength(1);
    const two = await service.attachment(
      'r',
      { ...body, commandKey: 'upload-two', commandId: 'two' },
      actor,
    );
    expect(two.version).toBe(1);
    expect(rows[1].previousId).toBeUndefined();
    const replacement = await service.attachment(
      'r',
      {
        ...body,
        previousId: one.id,
        commandKey: 'replace-one',
        commandId: 'three',
      },
      actor,
    );
    expect(replacement.version).toBe(2);
    expect(rows[2].previousId).toBe(one.id);
    expect(rows[0].content.toString()).toContain('%PDF');
  });
});
