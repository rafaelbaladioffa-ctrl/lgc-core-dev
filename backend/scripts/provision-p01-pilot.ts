import { PrismaClient } from '@prisma/client';
import { RequestProcessesService } from '../src/request-processes/request-processes.service.js';
import type { AuthenticatedUser } from '../src/auth/authenticated-request.js';

const prisma = new PrismaClient();
const pilotCode = 'P01-PILOTO';
const pilotQueueName = 'P01 - Atendimento piloto';
const testerEmail = 'rafael.baladi@lgcinstalacoes.com.br';
const configPermissions = [
  ['request_process', 'model'],
  ['request_process', 'publish'],
  ['request_queue', 'manage'],
] as const;

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail) throw new Error('SEED_ADMIN_EMAIL is required');
  const [admin, tester] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: adminEmail },
      include: { collaborator: true },
    }),
    prisma.user.findUniqueOrThrow({
      where: { email: testerEmail },
      include: { collaborator: true },
    }),
  ]);
  if (!admin.collaborator || !tester.collaborator)
    throw new Error('Pilot users require active collaborator records');

  const permissions = await prisma.permission.findMany({
    where: {
      OR: configPermissions.map(([resource, action]) => ({ resource, action })),
    },
  });
  if (permissions.length !== configPermissions.length)
    throw new Error('P01 configuration permissions are missing');
  const role = await prisma.role.upsert({
    where: { name: 'p01_pilot_configurator' },
    update: {},
    create: {
      name: 'p01_pilot_configurator',
      description: 'Configuração pontual do piloto BPM P01',
    },
  });
  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: role.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: role.id } },
    update: {},
    create: { userId: admin.id, roleId: role.id },
  });

  const secondOperator = await prisma.user.findFirst({
    where: {
      id: { not: tester.id },
      status: 'active',
      collaborator: {
        status: 'ativo',
        sectorId: tester.collaborator.sectorId,
      },
      userRoles: {
        some: {
          role: {
            rolePermissions: {
              some: {
                permission: { resource: 'request', action: 'update' },
              },
            },
          },
        },
      },
    },
    include: { collaborator: true },
  });
  const operatorIds = [
    tester.collaborator.id,
    ...(secondOperator?.collaborator ? [secondOperator.collaborator.id] : []),
  ];
  const actor: AuthenticatedUser = {
    userId: admin.id,
    email: admin.email,
    collaboratorId: admin.collaborator.id,
    mustChangePassword: false,
    permissions: [],
    roles: [],
  };
  const service = new RequestProcessesService(
    prisma as any,
    { get: () => 'true' } as any,
  );

  let queue = await prisma.queue.findFirst({
    where: {
      sectorId: tester.collaborator.sectorId,
      name: pilotQueueName,
      active: true,
    },
  });
  if (!queue)
    queue = await service.createQueue(
      {
        sectorId: tester.collaborator.sectorId,
        name: pilotQueueName,
        members: operatorIds,
        managers: [tester.collaborator.id],
      },
      actor,
    );

  let category = await prisma.requestCategory.findUnique({
    where: { code: pilotCode },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });
  if (!category) {
    const created = await service.createProcess(
      {
        code: pilotCode,
        name: 'Solicitação piloto BPM',
        description: 'Fluxo linear de triagem, atendimento e encerramento.',
        sectorId: tester.collaborator.sectorId,
        triageQueueId: queue.id,
        executionQueueId: queue.id,
        publisherUserIds: [admin.id],
      },
      actor,
    );
    const report = await service.validateVersion(created.versionId, 0, actor);
    if (!report.valid || !('validatedHash' in report))
      throw new Error('Default P01 definition did not validate');
    await service.publishVersion(
      created.versionId,
      { expectedVersion: 0, validatedHash: report.validatedHash },
      actor,
    );
    category = await prisma.requestCategory.findUniqueOrThrow({
      where: { id: created.id },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
  }
  if (!category.runtimeEnabled) {
    await service.enableProcess(
      category.id,
      { expectedVersion: category.configRevision },
      actor,
    );
  }
  console.log(
    JSON.stringify({
      code: pilotCode,
      queue: pilotQueueName,
      operators: operatorIds.length,
      tester: testerEmail,
    }),
  );
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
