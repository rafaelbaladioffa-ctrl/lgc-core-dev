import { Test } from '@nestjs/testing';
import { ValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { RequestProcessesController } from './request-processes.controller.js';
import { RequestProcessesService } from './request-processes.service.js';
import { ConfigCommandInterceptor } from './config-command.interceptor.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { Reflector } from '@nestjs/core';

const definition = {
  format: 'axis-bpm/1',
  capabilities: ['human_tasks'],
  policy: {
    confidentiality: 'interna', requiresAcceptance: false,
    allowRepresentation: false, executorMayBeRequester: false,
    closure: { mode: 'manual' },
  },
  sla: { firstResponseMinutes: 60, resolutionMinutes: 120 },
  nodes: [
    { id: 'start', type: 'start' }, { id: 'triage', type: 'human', phase: 'triage' },
    { id: 'execute', type: 'human', phase: 'execution' }, { id: 'end', type: 'end' },
  ],
  edges: [
    { from: 'start', to: 'triage' }, { from: 'triage', to: 'execute' }, { from: 'execute', to: 'end' },
  ],
  form: [],
};

describe('A02 HTTP contract', () => {
  it('returns 422 with a localized error and never advances publication', async () => {
    let publishedPointer = 'published-v1';
    const validator = new RequestProcessesService({} as any, { get: () => 'true' } as any);
    const service = {
      configCommand: async (_user: unknown, _scope: string, _id: string, body: any, _permissions: string[], operation: () => Promise<unknown>) => operation(),
      patchVersion: async (_id: string, body: any) => {
        const report = validator.validateDefinition(body.definition);
        if (!report.valid) throw new UnprocessableEntityException(report);
        publishedPointer = 'must-not-change';
        return { id: 'version-1', bpmRevision: 1 };
      },
    } as any;
    const module = await Test.createTestingModule({
      controllers: [RequestProcessesController],
      providers: [Reflector, ConfigCommandInterceptor, { provide: RequestProcessesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
        context.switchToHttp().getRequest().user = { permissions: ['request_process:model'] };
        return true;
      } })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    const cases = [
      { path: 'edges', mutate: (d: any) => d.edges.push({ from: 'end', to: 'triage' }) },
      { path: 'nodes', mutate: (d: any) => d.nodes.push({ id: 'mystery', type: 'unknown' }) },
      { path: 'capabilities', mutate: (d: any) => d.capabilities.push('approval') },
    ];
    try {
      for (const testCase of cases) {
        const invalid = structuredClone(definition);
        testCase.mutate(invalid);
        const commandKey = '8b5a3c68-8d4e-4e8e-a5a9-2c7a31d4eb5a';
        const commandId = 'd6b06c68-cf0c-48f3-a6fb-6ccf4e8d3a4c';
        const response = await request(app.getHttpServer())
          .patch('/bpm/versions/version-1').set('idempotency-key', commandKey)
          .send({ commandKey, commandId, expectedVersion: 0, definition: invalid });
        expect(response.status).toBe(422);
        expect(response.body.error.errors).toEqual(expect.arrayContaining([
          expect.objectContaining({ path: expect.stringContaining(testCase.path) }),
        ]));
        expect(publishedPointer).toBe('published-v1');
      }
    } finally {
      await app.close();
    }
  });
});
