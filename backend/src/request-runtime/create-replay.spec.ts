import { describe, expect, it } from 'vitest';
import { RequestRuntimeService } from './request-runtime.service.js';

describe('create command replay', () => {
  it('returns the original draft after a newer version is published', async () => {
    const receipts = new Map<string, any>();
    let writes = 0;
    let versionReads = 0;
    let publishedVersionId = 'version-v1';
    const tx: any = {
      $executeRaw: async () => 1,
      $queryRaw: async (parts: TemplateStringsArray) =>
        String(parts[0]).includes('UPDATE request_number_counters')
          ? [{ last_value: 1 }]
          : [],
      requestCommandReceipt: {
        findUnique: async ({ where }: any) =>
          receipts.get(where.actorUserId_key.key),
        create: async ({ data }: any) => {
          const receipt = { ...data, id: 'receipt' };
          receipts.set(data.key, receipt);
          return receipt;
        },
      },
      categoryVersion: {
        findUnique: async () => {
          versionReads++;
          return {
            id: 'version-v1',
            categoryId: 'category',
            bpmStatus: 'published',
            bpmDefinition: { form: [], formAccess: {} },
            category: {
              sectorId: 'sector',
              confidentiality: 'internal',
              runtimeEnabled: true,
              publishedBpmVersionId: publishedVersionId,
            },
          };
        },
      },
      collaborator: {
        findUniqueOrThrow: async () => ({
          id: 'collaborator',
          sectorId: 'sector',
        }),
      },
      request: {
        create: async () => {
          writes++;
          return { id: 'request-v1', code: 'REQ-2026-000001', lockVersion: 0 };
        },
      },
    };
    const service = new RequestRuntimeService(
      {
        user: {
          findUnique: async () => ({
            status: 'active',
            collaboratorId: 'collaborator',
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
        $transaction: async (callback: any) => callback(tx),
      } as any,
      { get: () => 'true' } as any,
    );
    const command = {
      categoryId: 'category',
      versionId: 'version-v1',
      title: 'Draft',
      commandKey: 'same-create-intent',
      commandId: 'command-id',
    };
    const actor: any = {
      userId: 'user',
      collaboratorId: 'collaborator',
      permissions: ['request:create'],
      roles: [],
    };

    const first = await service.create(command, actor);
    publishedVersionId = 'version-v2';
    const replay = await service.create(command, actor);

    expect(replay).toEqual(first);
    expect(writes).toBe(1);
    expect(versionReads).toBe(1);
  });
});
