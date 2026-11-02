import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RequestProcessesController } from '../src/request-processes/request-processes.controller.js';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import { ConfigCommandInterceptor } from '../src/request-processes/config-command.interceptor.js';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../src/rbac/permissions.guard.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requireBpmTestDatabaseUrl } from './support/bpm-test-database.js';

describe.skipIf(!process.env.BPM_TEST_DATABASE_URL)(
  'A01 HTTP/PostgreSQL — administração BPM pela superfície real',
  () => {
    let prisma: PrismaService;
    let app: any;
    let categoryId: string;
    let versionId: string;
    const prefix = `a01-http-${randomUUID()}`;
    const processCode = `a01-${randomUUID().slice(0, 8)}`;
    const userId = randomUUID();
    const collaboratorId = randomUUID();
    const sectorId = randomUUID();
    const jobTitleId = randomUUID();
    const roleId = randomUUID();
    const permissionIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const user = {
      userId,
      sub: userId,
      email: `${prefix}@example.invalid`,
      permissions: [
        'request_queue:manage',
        'request_process:model',
        'request_process:publish',
        'request_category:create',
        'request:create',
      ],
      roles: [],
    } as any;
    const configCommand = () => ({
      commandKey: randomUUID(),
      commandId: randomUUID(),
    });
    const command = (expectedVersion: number) => ({
      expectedVersion,
      ...configCommand(),
    });

    beforeAll(async () => {
      const url = requireBpmTestDatabaseUrl();
      prisma = new PrismaService({ datasources: { db: { url } } } as any);
      await prisma.$connect();
      await prisma.sector.create({ data: { id: sectorId, code: prefix, name: prefix } });
      await prisma.jobTitle.create({ data: { id: jobTitleId, name: prefix } });
      const permissions = await Promise.all(
        [
          ['request_queue', 'manage'], ['request_process', 'model'],
          ['request_process', 'publish'], ['request_category', 'create'],
          ['request', 'create'],
        ].map(([resource, action], index) =>
          prisma.permission.upsert({
            where: { resource_action: { resource, action } },
            update: {},
            create: { id: permissionIds[index], resource, action },
          }),
        ),
      );
      await prisma.role.create({
        data: {
          id: roleId,
          name: prefix,
          rolePermissions: { create: permissions.map(({ id: permissionId }) => ({ permissionId })) },
        },
      });
      await prisma.collaborator.create({
        data: { id: collaboratorId, fullName: prefix, rgEnc: 'synthetic', cpfEnc: 'synthetic', cpfHash: prefix, corporateEmail: `${prefix}@example.invalid`, matricula: prefix, sectorId, jobTitleId },
      });
      await prisma.user.create({
        data: { id: userId, email: `${prefix}@example.invalid`, passwordHash: 'synthetic', collaboratorId, userRoles: { create: { roleId } } },
      });
      const module = await Test.createTestingModule({
        controllers: [RequestProcessesController],
        providers: [Reflector, ConfigCommandInterceptor, RequestProcessesService, { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: { get: () => 'true' } }],
      })
        .overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => { context.switchToHttp().getRequest().user = user; return true; } })
        .overrideGuard(PermissionsGuard).useValue({ canActivate: () => true })
        .compile();
      app = module.createNestApplication();
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
      await prisma?.$disconnect();
    });

    it('cria configuração pela UI-equivalente HTTP, publica/habilita e confirma catálogo, hash e autor', async () => {
      const queueCommand = configCommand();
      const queue = await request(app.getHttpServer()).post('/bpm/queues').set('idempotency-key', queueCommand.commandKey).send({
        sectorId, name: `${prefix}-queue`, members: [collaboratorId], managers: [collaboratorId], ...queueCommand,
      });
      expect(queue.status).toBe(201);
      expect(queue.body.bpmMembers).toEqual(expect.arrayContaining([
        expect.objectContaining({ collaboratorId, role: 'member' }),
        expect.objectContaining({ collaboratorId, role: 'manager' }),
      ]));
      const queueId = queue.body.id;

      const createCommand = configCommand();
      const created = await request(app.getHttpServer()).post('/bpm/processes').set('idempotency-key', createCommand.commandKey).send({
        code: processCode, name: 'A01 HTTP', description: 'Processo administrativo A01', sectorId,
        triageQueueId: queueId, executionQueueId: queueId, publisherUserIds: [userId], ...createCommand,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      categoryId = created.body.id;
      versionId = created.body.versionId;
      expect(created.body.versions?.[0]?.bpmDefinition?.nodes).toHaveLength(4);

      const definition = { ...created.body.versions[0].bpmDefinition, form: [{ key: 'description', label: 'Descrição', type: 'textarea', required: true }], sla: { firstResponseMinutes: 60, resolutionMinutes: 480 } };
      const patchCommand = command(0);
      const patched = await request(app.getHttpServer()).patch(`/bpm/versions/${versionId}`).set('idempotency-key', patchCommand.commandKey).send({ ...patchCommand, definition });
      expect(patched.status).toBe(200);
      const validateCommand = command(1);
      const validated = await request(app.getHttpServer()).post(`/bpm/versions/${versionId}/validate`).set('idempotency-key', validateCommand.commandKey).send(validateCommand);
      expect(validated.status).toBe(201);
      expect(validated.body.validatedHash).toMatch(/^[a-f0-9]{64}$/);
      const publishCommand = command(1);
      const published = await request(app.getHttpServer()).post(`/bpm/versions/${versionId}/publish`).set('idempotency-key', publishCommand.commandKey).send({ ...publishCommand, validatedHash: validated.body.validatedHash });
      expect(published.status, JSON.stringify(published.body)).toBe(201);
      expect(published.body.bpmStatus).toBe('published');
      expect(published.body.bpmContentHash).toBe(validated.body.validatedHash);
      expect(published.body.publishedBy).toBe(userId);
      const category = await prisma.requestCategory.findUniqueOrThrow({ where: { id: categoryId } });
      const enableCommand = command(category.configRevision);
      const enabled = await request(app.getHttpServer()).post(`/bpm/processes/${categoryId}/enable`).set('idempotency-key', enableCommand.commandKey).send(enableCommand);
      expect(enabled.status).toBe(201);
      const catalog = await request(app.getHttpServer()).get('/bpm/catalog');
      expect(catalog.status).toBe(200);
      const entry = catalog.body.find((item: any) => item.id === categoryId);
      expect(entry).toBeTruthy();
      expect(entry.runtimeEnabled).toBe(true);
      expect(entry.versions[0].bpmStatus).toBe('published');
    });
  },
);
