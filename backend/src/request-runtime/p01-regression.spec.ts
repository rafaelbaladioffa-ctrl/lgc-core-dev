import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  addBusinessMinutes,
  RequestRuntimeService,
} from './request-runtime.service.js';
import { RequestProcessesService } from '../request-processes/request-processes.service.js';

const config = { get: (_key: string, fallback: string) => fallback } as any;

describe('BPM P01 regressions', () => {
  it('keeps title/description outside the dynamic form schema', async () => {
    const service = new RequestRuntimeService({} as any, config) as any;
    await expect(
      service.validateFields({ form: [] }, {}, true),
    ).resolves.toBeUndefined();
  });

  it('rejects whitespace required fields, impossible dates, and excess decimal scale', async () => {
    const service = new RequestRuntimeService({} as any, config) as any;
    const definition = {
      form: [
        { key: 'name', type: 'text', required: true },
        { key: 'when', type: 'date' },
        { key: 'amount', type: 'decimal' },
      ],
    };
    await expect(
      service.validateFields(
        definition,
        { name: ' ', when: '2026-02-30', amount: '1.23456' },
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    [
      'decimal scale',
      { amount: 0.123456789 },
      { key: 'amount', type: 'decimal' },
    ],
    [
      'decimal precision',
      { amount: '12345678901234567890.1234' },
      { key: 'amount', type: 'decimal' },
    ],
    [
      'unsafe integer',
      { count: Number.MAX_SAFE_INTEGER + 1 },
      { key: 'count', type: 'integer' },
    ],
    [
      'text maxLength',
      { text: 'much longer' },
      { key: 'text', type: 'text', maxLength: 3 },
    ],
  ])('rejects %s individually', async (_label, values, field) => {
    const service = new RequestRuntimeService({} as any, config) as any;
    await expect(
      service.validateFields({ form: [field] }, values, true),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts holidays and weekends in the business calendar', () => {
    const monday = new Date('2026-11-02T11:00:00.000Z');
    const target = addBusinessMinutes(monday, 1200, ['2026-11-03']);
    expect(target.toISOString()).toBe('2026-11-04T21:00:00.000Z');
  });

  it('rejects a non-linear or malformed P01 graph', () => {
    const service = new RequestProcessesService({} as any, config) as any;
    const report = service.validateDefinition({
      format: 'axis-bpm/1',
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'end', type: 'end' },
      ],
      edges: [],
      form: [],
    });
    expect(report.valid).toBe(false);
    expect(
      report.errors.some((e: { path: string }) => e.path === 'nodes'),
    ).toBe(true);
  });

  it('accepts the canonical definition generated for a new process', () => {
    const service = new RequestProcessesService({} as any, config) as any;
    const definition = service.definition(
      { code: 'PROC', name: 'Processo', description: 'Descrição' },
      'queue-triage',
      'queue-exec',
    );
    expect(service.validateDefinition(definition).valid).toBe(true);
  });

  it('keeps publisher userId distinct from collaboratorId in the directory contract', async () => {
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
          findMany: async () => [
            {
              id: 'user-1',
              userRoles: [],
              collaborator: {
                id: 'collab-9',
                fullName: 'Pessoa',
                sectorId: 'sector-1',
                sector: { name: 'Setor de teste' },
              },
            },
          ],
        },
      } as any,
      config,
    );
    const rows = await service.listCollaborators({
      userId: 'manager',
      collaboratorId: 'collab-manager',
      permissions: ['request_queue:manage'],
      roles: [],
    } as any);
    expect(rows[0]).toMatchObject({
      userId: 'user-1',
      collaboratorId: 'collab-9',
    });
    expect(rows[0].userId).not.toBe(rows[0].collaboratorId);
  });

  it('configures a process atomically with a publisher User id', async () => {
    let grants: any[] = [];
    const actor = {
      userId: 'user-modeler',
      collaboratorId: 'collab-modeler',
      permissions: ['request_process:model', 'request_category:create'],
      roles: [],
    } as any;
    const current = {
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
    };
    const prisma = {
      user: {
        findUnique: async () => current,
        findMany: async () => [{ id: 'user-publisher' }],
      },
      queue: {
        findUnique: async ({ where }: any) => ({
          id: where.id,
          sectorId: 'sector-1',
          active: true,
        }),
      },
      $transaction: async (fn: any) =>
        fn({
          requestCategory: {
            create: async () => ({
              id: 'category-1',
              versions: [{ id: 'version-1' }],
            }),
          },
          processConfigGrant: {
            createMany: async ({ data }: any) => {
              grants = data;
            },
          },
        }),
    } as any;
    const service = new RequestProcessesService(prisma, {
      get: () => 'true',
    } as any);
    const result = await service.createProcess(
      {
        code: 'PROC',
        name: 'Processo',
        description: 'Descrição',
        sectorId: 'sector-1',
        triageQueueId: 'triage',
        executionQueueId: 'execution',
        publisherUserIds: ['user-publisher'],
      },
      actor,
    );
    expect(result.versionId).toBe('version-1');
    expect(
      grants.some(
        (g) => g.role === 'publisher' && g.userId === 'user-publisher',
      ),
    ).toBe(true);
  });

  it('merges draft fields and preserves omitted protected values', async () => {
    const service = new RequestRuntimeService(
      {
        user: {
          findUnique: async () => ({
            status: 'active',
            collaboratorId: 'collab',
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
        request: {
          updateMany: async ({ data }: any) => {
            (service as any).__stored = data.formData;
            return { count: 1 };
          },
          findUniqueOrThrow: async () => ({
            formData: (service as any).__stored,
          }),
        },
      } as any,
      config,
    ) as any;
    service.requestAccess = async () => ({
      status: 'rascunho',
      lockVersion: 0,
      requesterId: 'collab',
      formData: { private_value: 'keep', public_value: 'old' },
      categoryVersion: {
        bpmDefinition: {
          form: [
            { key: 'private_value', type: 'text' },
            { key: 'public_value', type: 'text' },
          ],
          formAccess: { private_value: 'hidden', public_value: 'write' },
        },
      },
    });
    service.prisma.$transaction = async (fn: any) => fn({ ...service.prisma, $queryRaw: async () => [] });
    const saved = await service.saveDraft(
      'request',
      { expectedVersion: 0, fields: { public_value: 'new' } },
      {
        userId: 'user',
        collaboratorId: 'collab',
        permissions: ['request:create'],
        roles: [],
      },
    );
    expect((service as any).__stored).toEqual({
      private_value: 'keep',
      public_value: 'new',
    });
    expect(saved.fields).toEqual({ public_value: 'new' });
  });

  it('records SLA breach at the configured deadline, not the stop time', async () => {
    let update: any;
    const service = new RequestRuntimeService({} as any, config) as any;
    const tx = {
      requestSlaInterval: { updateMany: async () => ({ count: 1 }) },
      requestSlaClock: {
        findMany: async () => [
          {
            id: 'clock',
            checkpointAt: new Date('2026-11-02T11:00:00Z'),
            elapsedSeconds: 0,
            budgetSeconds: 3600,
            targetAt: new Date('2026-11-02T12:00:00Z'),
            calendarSnapshot: { holidays: [] },
            breachedAt: null,
          },
        ],
        update: async (q: any) => {
          update = q.data;
        },
      },
    };
    await service.stopClocks(
      tx as any,
      'request',
      new Date('2026-11-02T13:00:00Z'),
      'resolution',
    );
    expect(update.breachedAt).toEqual(new Date('2026-11-02T12:00:00Z'));
  });

  it('rejects unsupported phase, capability, policy, and SLA metadata', () => {
    const service = new RequestProcessesService({} as any, config) as any;
    const definition = {
      format: 'axis-bpm/1',
      capabilities: ['unsupported_approval'],
      policy: {
        confidentiality: 'interna',
        requiresAcceptance: false,
        allowRepresentation: false,
        closure: { mode: 'manual' },
      },
      sla: { firstResponseMinutes: -1, resolutionMinutes: 0 },
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'triage', type: 'human', phase: 'wrong' },
        { id: 'execute', type: 'human', phase: 'execution' },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { from: 'start', to: 'triage' },
        { from: 'triage', to: 'execute' },
        { from: 'execute', to: 'end' },
      ],
      form: [],
    };
    const report = service.validateDefinition(definition);
    expect(report.valid).toBe(false);
    expect(report.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['capabilities', 'nodes.phase', 'sla']),
    );
  });
});
