import { ConflictException, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../rbac/permissions.guard.js';
import { RequestProcessesController } from './request-processes.controller.js';
import { RequestProcessesService } from './request-processes.service.js';
import { ConfigCommandInterceptor } from './config-command.interceptor.js';

describe('A03 HTTP publication contract', () => {
  it('returns 409 for an old hash, lets one concurrent publisher move the pointer, and exposes the winner once', async () => {
    const state = {
      expectedVersion: 1,
      validatedHash: 'hash-new',
      publishedPointer: null as string | null,
      publicationCount: 0,
    };
    const service = {
      configCommand: async (_user: unknown, _scope: string, _id: string, body: any, _permissions: string[], operation: () => Promise<unknown>) => operation(),
      publishVersion: async (id: string, body: any) => {
        if (body.expectedVersion !== state.expectedVersion || body.validatedHash !== state.validatedHash)
          throw new ConflictException('VERSION_CONFLICT');
        if (state.publishedPointer) throw new ConflictException('VERSION_CONFLICT');
        state.publishedPointer = id;
        state.publicationCount++;
        return { id, bpmStatus: 'published', bpmContentHash: state.validatedHash, bpmRevision: 2 };
      },
    } as any;
    const module = await Test.createTestingModule({
      controllers: [RequestProcessesController],
      providers: [Reflector, ConfigCommandInterceptor, { provide: RequestProcessesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
        context.switchToHttp().getRequest().user = { permissions: ['request_process:publish'] };
        return true;
      } })
      .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    const versionId = 'version-a03';
    const command = () => ({ commandKey: randomUUID(), commandId: randomUUID(), expectedVersion: 1, validatedHash: 'hash-new' });
    try {
      const staleCommand = { commandKey: randomUUID(), commandId: randomUUID(), expectedVersion: 1, validatedHash: 'hash-old' };
      const stale = await request(app.getHttpServer())
        .post(`/bpm/versions/${versionId}/publish`)
        .set('idempotency-key', staleCommand.commandKey)
        .send(staleCommand);
      expect(stale.status).toBe(409);
      const firstCommand = command();
      const secondCommand = command();
      const results = await Promise.all([
        request(app.getHttpServer()).post(`/bpm/versions/${versionId}/publish`).set('idempotency-key', firstCommand.commandKey).send(firstCommand),
        request(app.getHttpServer()).post(`/bpm/versions/${versionId}/publish`).set('idempotency-key', secondCommand.commandKey).send(secondCommand),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(state.publishedPointer).toBe(versionId);
      expect(state.publicationCount).toBe(1);
    } finally {
      await app.close();
    }
  });
});
