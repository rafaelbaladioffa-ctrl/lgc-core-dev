import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { Prisma } from '@prisma/client';
import {
  CreateBpmProcessDto,
  CreateBpmQueueDto,
  CreateVersionDto,
  GrantDto,
  PatchVersionDto,
  PublishVersionDto,
  UpdateBpmQueueDto,
} from './dto.js';

const P = [
  'request_process:model',
  'request_process:publish',
  'request_queue:manage',
];
import { validateFormSchema } from './forms/form-validator.js';
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class RequestProcessesService {
  private readonly commandContext =
    new AsyncLocalStorage<Prisma.TransactionClient>();
  constructor(
    private readonly rootPrisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private get prisma(): PrismaService {
    return (this.commandContext.getStore() ?? this.rootPrisma) as PrismaService;
  }
  private transaction<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const active = this.commandContext.getStore();
    return active ? run(active) : this.rootPrisma.$transaction(run);
  }
  async configCommand(
    user: AuthenticatedUser,
    route: string,
    target: string | undefined,
    body: Record<string, unknown>,
    permissions: string[],
    operation: () => Promise<unknown>,
  ) {
    for (const permission of permissions)
      await this.assertCurrentPermission(user, permission);
    if (route.includes('processes') && !target)
      await this.assertCurrentPermission(user, 'request_category:create');
    if (target && !route.includes('queues')) {
      const versionRoute = route.includes('versions/:id');
      const categoryId = versionRoute
        ? (
            await this.prisma.categoryVersion.findUniqueOrThrow({
              where: { id: target },
              select: { categoryId: true },
            })
          ).categoryId
        : target;
      const role =
        route.endsWith('/publish') || route.endsWith('/enable')
          ? 'publisher'
          : 'modeler';
      const grant = await this.prisma.processConfigGrant.findFirst({
        where: {
          categoryId,
          userId: user.userId,
          role,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (!grant) throw new ForbiddenException('Grant atual insuficiente');
    }
    const key = body.commandKey as string;
    const requestHash = hash({ route, target: target ?? null, body });
    return this.rootPrisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${user.userId}), hashtext(${key}))::text AS locked`;
      const existing = await tx.requestCommandReceipt.findUnique({
        where: { actorUserId_key: { actorUserId: user.userId, key } },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
        return existing.resultRef;
      }
      if (target)
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('bpm-config'), hashtext(${target}))::text AS locked`;
      const result = await this.commandContext.run(tx, operation);
      const jsonResult = JSON.parse(JSON.stringify(result));
      await tx.requestCommandReceipt.create({
        data: {
          commandId: body.commandId as string,
          actorUserId: user.userId,
          key,
          routeScope: route,
          requestHash,
          statusCode: 200,
          resultRef: jsonResult,
        },
      });
      return result;
    });
  }
  private enabled() {
    return this.config.get<string>('REQUEST_BPM_ENABLED', 'false') === 'true';
  }
  async capabilities(user: AuthenticatedUser) {
    const permissions: string[] = [];
    for (const p of P) {
      try {
        await this.assertCurrentPermission(user, p);
        permissions.push(p);
      } catch (e) {
        if (!(e instanceof ForbiddenException)) throw e;
      }
    }
    return {
      enabled: this.enabled(),
      format: 'axis-bpm/1',
      nodes: ['start', 'human', 'end'],
      permissions,
      limits: { fields: 200, nodes: 4, slaMinutes: [1, 120000] },
      fieldTypes: [
        'text','textarea','integer','decimal','date',
        'select','boolean','attachment',
        'money','reference','repeatable_table',
      ],
      commands: [
        'saveDraft','submit','claim','complete','release','reassign',
        'close','cancel','comment','attachment',
        'returnForCorrection','saveCorrection','resubmit',
        'requestInformation','respondInformation',
      ],
    };
  }
  private assertEnabled() {
    if (!this.enabled())
      throw new ForbiddenException('Piloto BPM desabilitado pelo servidor');
  }
  private async assertCurrentPermission(
    user: AuthenticatedUser,
    permission: string,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        status: true,
        userRoles: {
          select: {
            role: {
              select: {
                rolePermissions: {
                  select: {
                    permission: { select: { resource: true, action: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (
      !current ||
      current.status !== 'active' ||
      !current.userRoles.some((ur) =>
        ur.role.rolePermissions.some(
          (rp) =>
            `${rp.permission.resource}:${rp.permission.action}` === permission,
        ),
      )
    )
      throw new ForbiddenException('Permissão atual insuficiente');
  }
  private async assertQueue(queueId: string, sectorId: string) {
    const q = await this.prisma.queue.findUnique({
      where: { id: queueId },
      include: { sector: true },
    });
    if (!q || q.sectorId !== sectorId || !q.active)
      throw new BadRequestException(
        'Fila inexistente, inativa ou fora do setor',
      );
    return q;
  }
  private async eligible(collaboratorIds: string[]) {
    const rows = await this.prisma.collaborator.findMany({
      where: {
        id: { in: collaboratorIds },
        status: 'ativo',
        user: { status: 'active' },
      },
      select: { id: true },
    });
    return rows.map((x) => x.id);
  }
  async listQueues(user: AuthenticatedUser, sectorId?: string) {
    await this.assertCurrentPermission(user, 'request_queue:manage');
    return this.prisma.queue.findMany({
      where: { active: true, sectorId },
      include: {
        sector: { select: { id: true, name: true } },
        bpmMembers: {
          where: { active: true },
          include: { collaborator: { select: { id: true, fullName: true } } },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
  async listCollaborators(user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request_queue:manage');
    const users = await this.prisma.user.findMany({
      where: { status: 'active', collaborator: { status: 'ativo' } },
      select: {
        id: true,
        collaborator: {
          select: {
            id: true,
            fullName: true,
            sectorId: true,
            sector: { select: { name: true } },
          },
        },
        userRoles: {
          select: {
            role: {
              select: {
                rolePermissions: {
                  select: {
                    permission: { select: { resource: true, action: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { collaborator: { fullName: 'asc' } },
    });
    return users
      .filter((u) => u.collaborator)
      .map((u) => ({
        userId: u.id,
        collaboratorId: u.collaborator!.id,
        fullName: u.collaborator!.fullName,
        sectorId: u.collaborator!.sectorId,
        sectorName: u.collaborator!.sector.name,
        canPublish: u.userRoles.some((ur) =>
          ur.role.rolePermissions.some(
            (rp) =>
              rp.permission.resource === 'request_process' &&
              rp.permission.action === 'publish',
          ),
        ),
      }));
  }
  async createQueue(dto: CreateBpmQueueDto, user: AuthenticatedUser) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request_queue:manage');
    const members = await this.eligible(dto.members);
    const managers = await this.eligible(dto.managers ?? []);
    if (
      members.length !== dto.members.length ||
      managers.length !== (dto.managers ?? []).length
    )
      throw new BadRequestException(
        'Todos os membros precisam de colaborador e usuário ativo',
      );
    await this.prisma.sector.findUniqueOrThrow({ where: { id: dto.sectorId } });
    return this.prisma.queue.create({
      data: {
        sectorId: dto.sectorId,
        name: dto.name,
        bpmMembers: {
          create: [
            ...members.map((collaboratorId) => ({
              collaboratorId,
              role: 'member' as const,
            })),
            ...managers.map((collaboratorId) => ({
              collaboratorId,
              role: 'manager' as const,
            })),
          ],
        },
      },
      include: { bpmMembers: true },
    });
  }
  async updateQueue(
    id: string,
    dto: UpdateBpmQueueDto,
    user: AuthenticatedUser,
  ) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request_queue:manage');
    const existing = await this.prisma.queue.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Fila não encontrada');
    if (dto.sectorId !== existing.sectorId)
      throw new BadRequestException('Setor de uma fila existente é imutável');
    if (existing.revision !== dto.expectedVersion)
      throw new ConflictException('QUEUE_VERSION_CONFLICT');
    const members = await this.eligible(dto.members);
    const managers = await this.eligible(dto.managers ?? []);
    if (
      members.length !== dto.members.length ||
      managers.length !== (dto.managers ?? []).length
    )
      throw new BadRequestException('Membro inelegível');
    return this.transaction(async (tx) => {
      const changed = await tx.queue.updateMany({
        where: { id, revision: dto.expectedVersion },
        data: { name: dto.name, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('QUEUE_VERSION_CONFLICT');
      const desired = [
        ...members.map((collaboratorId) => ({
          collaboratorId,
          role: 'member' as const,
        })),
        ...managers.map((collaboratorId) => ({
          collaboratorId,
          role: 'manager' as const,
        })),
      ];
      await tx.requestQueueMember.updateMany({
        where: {
          queueId: id,
          active: true,
          NOT: {
            OR: desired.map((x) => ({
              collaboratorId: x.collaboratorId,
              role: x.role,
            })),
          },
        },
        data: { active: false, endsAt: new Date() },
      });
      for (const item of desired)
        await tx.requestQueueMember.upsert({
          where: {
            queueId_collaboratorId_role: {
              queueId: id,
              collaboratorId: item.collaboratorId,
              role: item.role,
            },
          },
          update: { active: true, endsAt: null },
          create: {
            queueId: id,
            collaboratorId: item.collaboratorId,
            role: item.role,
          },
        });
      return tx.queue.findUniqueOrThrow({
        where: { id },
        include: { bpmMembers: { where: { active: true } } },
      });
    });
  }
  async createProcess(dto: CreateBpmProcessDto, user: AuthenticatedUser) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request_process:model');
    await this.assertCurrentPermission(user, 'request_category:create');
    const [triage, execution] = await Promise.all([
      this.assertQueue(dto.triageQueueId, dto.sectorId),
      this.assertQueue(dto.executionQueueId, dto.sectorId),
    ]);
    const publisherIds = dto.publisherUserIds ?? [];
    const publishers = await this.prisma.user.findMany({
      where: {
        id: { in: publisherIds },
        status: 'active',
        userRoles: {
          some: {
            role: {
              rolePermissions: {
                some: {
                  permission: {
                    resource: 'request_process',
                    action: 'publish',
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });
    if (publishers.length !== new Set(publisherIds).size)
      throw new BadRequestException(
        'Todos os publicadores precisam estar ativos e possuir permissão de publicação',
      );
    return this.transaction(async (tx) => {
      const category = await tx.requestCategory.create({
        data: {
          code: dto.code,
          name: dto.name,
          sectorId: dto.sectorId,
          active: true,
          runtimeEnabled: false,
          versions: {
            create: {
              version: 1,
              formSchema: [],
              workflowSchema: { format: 'axis-bpm/1' },
              slaFirstResponseMinutes: 240,
              slaResolutionMinutes: 2880,
              bpmStatus: 'draft',
              bpmRevision: 0,
              bpmDefinition: this.definition(dto, triage.id, execution.id),
              bpmCalendarSnapshot: this.calendar(),
              publishedAt: null,
            },
          },
        },
        include: { versions: true },
      });
      await tx.processConfigGrant.createMany({
        data: [
          { categoryId: category.id, userId: user.userId, role: 'modeler' },
          ...publisherIds.map((userId) => ({
            categoryId: category.id,
            userId,
            role: 'publisher' as const,
          })),
        ],
        skipDuplicates: true,
      });
      return { ...category, versionId: category.versions[0].id };
    });
  }
  private definition(
    dto: CreateBpmProcessDto,
    triageQueueId: string,
    executionQueueId: string,
  ) {
    return {
      format: 'axis-bpm/1',
      capabilities: ['human_tasks'],
      nodes: [
        { id: 'start', type: 'start' },
        {
          id: 'triage',
          type: 'human',
          phase: 'triage',
          label: 'Conferir solicitação',
          queueId: triageQueueId,
          requiresResolution: true,
        },
        {
          id: 'execute',
          type: 'human',
          phase: 'execution',
          label: 'Atender solicitação',
          queueId: executionQueueId,
          requiresResolution: true,
        },
        { id: 'end', type: 'end', terminalOutcome: 'completed' },
      ],
      edges: [
        { from: 'start', to: 'triage' },
        { from: 'triage', to: 'execute' },
        { from: 'execute', to: 'end' },
      ],
      form: [],
      policy: {
        confidentiality: 'interna',
        requiresAcceptance: false,
        allowRepresentation: false,
        beneficiaryCanRead: true,
        executorMayBeRequester: false,
        closure: { mode: 'manual' },
      },
      sla: { firstResponseMinutes: 240, resolutionMinutes: 2880 },
      meta: { code: dto.code, name: dto.name, description: dto.description },
    };
  }
  private calendar() {
    return {
      timezone: 'America/Sao_Paulo',
      weekIntervals: {
        mon: [['08:00', '18:00']],
        tue: [['08:00', '18:00']],
        wed: [['08:00', '18:00']],
        thu: [['08:00', '18:00']],
        fri: [['08:00', '18:00']],
        sat: [],
        sun: [],
      },
      holidays: [],
    };
  }
  async listProcesses(user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request_process:model');
    return this.prisma.requestCategory.findMany({
      where: {
        bpmGrants: {
          some: {
            userId: user.userId,
            role: { in: ['modeler', 'publisher', 'auditor'] },
          },
        },
      },
      include: {
        bpmGrants: { select: { userId: true, role: true, restrictedRead: true } },
        versions: {
          where: { bpmStatus: { not: null } },
          orderBy: { version: 'desc' },
        },
      },
      orderBy: { name: 'asc' },
    });
  }
  async catalog(user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:create');
    const categories = await this.prisma.requestCategory.findMany({
      where: {
        runtimeEnabled: true,
        active: true,
        versions: { some: { bpmStatus: 'published' } },
      },
      include: { publishedBpmVersion: true },
      orderBy: { name: 'asc' },
    });
    return categories
      .filter((c) => c.publishedBpmVersion?.bpmStatus === 'published')
      .map((c) => {
        const v = c.publishedBpmVersion!;
        const definition = (v.bpmDefinition ?? {}) as any;
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          runtimeEnabled: c.runtimeEnabled,
          configRevision: c.configRevision,
          versions: [
            {
              id: v.id,
              version: v.version,
              bpmStatus: v.bpmStatus,
              bpmRevision: v.bpmRevision,
              bpmDefinition: {
                form: (definition.form ?? [])
                  .filter(
                    (f: any) => definition.formAccess?.[f.key] !== 'hidden',
                  )
                  .map((f: any) => ({
                    ...f,
                    readOnly: definition.formAccess?.[f.key] === 'read',
                  })),
              },
            },
          ],
        };
      });
  }
  async version(id: string, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request_process:model');
    const v = await this.prisma.categoryVersion.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!v) throw new NotFoundException('Versão não encontrada');
    const grant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId: v.categoryId,
        userId: user.userId,
        role: { in: ['modeler', 'publisher', 'auditor'] },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant) throw new ForbiddenException('Sem acesso à versão');
    return v;
  }
  async patchVersion(
    id: string,
    dto: PatchVersionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCurrentPermission(user, 'request_process:model');
    const v = await this.prisma.categoryVersion.findUnique({ where: { id } });
    if (!v || v.bpmStatus !== 'draft')
      throw new BadRequestException(
        'Somente versão BPM draft pode ser editada',
      );
    const grant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId: v.categoryId,
        userId: user.userId,
        role: 'modeler',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant)
      throw new ForbiddenException('Sem grant de modelador para este processo');
    if (v.bpmRevision !== dto.expectedVersion)
      throw new ConflictException('VERSION_CONFLICT');
    const report = this.validateDefinition(dto.definition);
    if (report.errors.length) throw new UnprocessableEntityException(report);
    return this.transaction(async (tx) => {
      const changed = await tx.categoryVersion.updateMany({
        where: { id, bpmRevision: dto.expectedVersion, bpmStatus: 'draft' },
        data: {
          bpmDefinition: dto.definition as Prisma.InputJsonValue,
          bpmRevision: { increment: 1 },
          bpmValidatedHash: null,
          bpmContentHash: null,
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      return tx.categoryVersion.findUniqueOrThrow({ where: { id } });
    });
  }
  validateDefinition(definition: Record<string, unknown>) {
    const errors: Array<{ path: string; message: string }> = [];
    const nodes = Array.isArray(definition.nodes)
      ? (definition.nodes as Array<Record<string, unknown>>)
      : [];
    const edges = Array.isArray(definition.edges)
      ? (definition.edges as Array<Record<string, unknown>>)
      : [];
    if (definition.format !== 'axis-bpm/1')
      errors.push({ path: 'format', message: 'Formato não suportado' });
    if (
      !Array.isArray(definition.capabilities) ||
      definition.capabilities.some((c) => c !== 'human_tasks')
    )
      errors.push({
        path: 'capabilities',
        message: 'P01 suporta somente human_tasks',
      });
    const policy = definition.policy as Record<string, any> | undefined;
    if (
      !policy ||
      policy.confidentiality !== 'interna' ||
      policy.requiresAcceptance !== false ||
      policy.allowRepresentation !== false ||
      policy.executorMayBeRequester === true ||
      policy.closure?.mode !== 'manual'
    )
      errors.push({ path: 'policy', message: 'Política P01 inválida' });
    const sla = definition.sla as Record<string, any> | undefined;
    if (
      !sla ||
      !Number.isInteger(sla.firstResponseMinutes) ||
      !Number.isInteger(sla.resolutionMinutes) ||
      sla.firstResponseMinutes < 1 ||
      sla.resolutionMinutes < 1 ||
      sla.firstResponseMinutes > 120000 ||
      sla.resolutionMinutes > 120000
    )
      errors.push({
        path: 'sla',
        message: 'Metas SLA devem estar entre 1 e 120000 minutos',
      });
    const expectedNodes = {
      start: 'start',
      triage: 'human',
      execute: 'human',
      end: 'end',
    };
    if (
      nodes.length !== 4 ||
      nodes.some(
        (n) =>
          typeof n.id !== 'string' ||
          expectedNodes[n.id as keyof typeof expectedNodes] !== n.type,
      ) ||
      Object.keys(expectedNodes).some((id) => !nodes.some((n) => n.id === id))
    )
      errors.push({
        path: 'nodes',
        message: 'P01 exige start, triage, execute e end',
      });
    if (
      nodes
        .filter((n) => n.type === 'human')
        .map((n) => n.phase)
        .sort()
        .join(',') !== 'execution,triage'
    )
      errors.push({
        path: 'nodes.phase',
        message: 'P01 exige exatamente triage e execution',
      });
    const expectedEdges = [
      ['start', 'triage'],
      ['triage', 'execute'],
      ['execute', 'end'],
    ];
    if (
      edges.length !== 3 ||
      edges.some(
        (e, i) =>
          e.from !== expectedEdges[i]?.[0] || e.to !== expectedEdges[i]?.[1],
      )
    )
      errors.push({
        path: 'edges',
        message: 'P01 exige três arestas lineares',
      });
    if (definition.form !== undefined) {
      const formErrors = validateFormSchema(definition.form, 200);
      for (const e of formErrors) errors.push(e);
    }
    return { valid: errors.length === 0, errors };
  }
  private async assertOperational(
    definition: Record<string, any>,
    sectorId: string,
  ) {
    for (const node of definition.nodes ?? [])
      if (node.type === 'human') {
        const q = await this.prisma.queue.findUnique({
          where: { id: node.queueId },
          include: {
            bpmMembers: {
              where: { active: true },
              include: { collaborator: { include: { user: true } } },
            },
          },
        });
        if (!q || q.sectorId !== sectorId || !q.active)
          throw new BadRequestException(`Fila inválida no nó ${node.id}`);
        if (
          !q.bpmMembers.some(
            (m) =>
              m.role === 'member' &&
              m.collaborator.status === 'ativo' &&
              m.collaborator.user?.status === 'active',
          )
        )
          throw new BadRequestException(
            `Fila sem membro elegível no nó ${node.id}`,
          );
      }
  }
  async validateVersion(
    id: string,
    expectedVersion: number,
    user: AuthenticatedUser,
  ) {
    await this.assertCurrentPermission(user, 'request_process:model');
    const v = await this.prisma.categoryVersion.findUniqueOrThrow({
      where: { id },
    });
    const grant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId: v.categoryId,
        userId: user.userId,
        role: 'modeler',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant)
      throw new ForbiddenException('Sem grant de modelador para este processo');
    const definition = (v.bpmDefinition ?? {}) as Record<string, unknown>;
    if (v.bpmStatus !== 'draft')
      throw new BadRequestException('Somente draft pode ser validado');
    if (v.bpmRevision !== expectedVersion)
      throw new ConflictException('VERSION_CONFLICT');
    const report = this.validateDefinition(definition);
    if (!report.valid) return report;
    const validatedHash = hash(definition);
    const changed = await this.prisma.categoryVersion.updateMany({
      where: { id, bpmRevision: expectedVersion, bpmStatus: 'draft' },
      data: { bpmValidatedHash: validatedHash },
    });
    if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
    return { ...report, validatedHash };
  }
  async createVersion(
    categoryId: string,
    dto: CreateVersionDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCurrentPermission(user, 'request_process:model');
    const category = await this.prisma.requestCategory.findUnique({
      where: { id: categoryId },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!category) throw new NotFoundException('Processo não encontrado');
    const grant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId,
        userId: user.userId,
        role: 'modeler',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant)
      throw new ForbiddenException('Sem grant de modelador para este processo');
    const current = category.versions[0];
    if (category.configRevision !== dto.expectedVersion)
      throw new ConflictException('CATEGORY_VERSION_CONFLICT');
    const definition = dto.cloneVersionId
      ? (
          await this.prisma.categoryVersion.findFirst({
            where: { categoryId, version: dto.cloneVersionId },
          })
        )?.bpmDefinition
      : current?.bpmDefinition;
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM request_categories WHERE id = ${categoryId} FOR UPDATE`;
      const changed = await tx.requestCategory.updateMany({
        where: { id: categoryId, configRevision: dto.expectedVersion },
        data: { configRevision: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException('CATEGORY_VERSION_CONFLICT');
      return tx.categoryVersion.create({
        data: {
          categoryId,
          version: (current?.version ?? 0) + 1,
          formSchema: (definition &&
          typeof definition === 'object' &&
          !Array.isArray(definition) &&
          'form' in definition
            ? (definition as any).form
            : []) as Prisma.InputJsonValue,
          workflowSchema: { format: 'axis-bpm/1' },
          slaFirstResponseMinutes: current?.slaFirstResponseMinutes ?? 240,
          slaResolutionMinutes: current?.slaResolutionMinutes ?? 2880,
          bpmStatus: 'draft',
          publishedAt: null,
          bpmDefinition: (definition ?? {}) as Prisma.InputJsonValue,
          bpmCalendarSnapshot: this.calendar(),
        },
      });
    });
  }
  async publishVersion(
    id: string,
    dto: PublishVersionDto,
    user: AuthenticatedUser,
  ) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request_process:publish');
    const v = await this.prisma.categoryVersion.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!v || v.bpmStatus !== 'draft')
      throw new BadRequestException('Versão BPM draft não encontrada');
    const grant =
      v &&
      (await this.prisma.processConfigGrant.findFirst({
        where: {
          categoryId: v.categoryId,
          userId: user.userId,
          role: 'publisher',
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      }));
    if (!grant)
      throw new ForbiddenException(
        'Sem grant de publicador para este processo',
      );
    if (v.bpmRevision !== dto.expectedVersion)
      throw new ConflictException('VERSION_CONFLICT');
    if (v.bpmValidatedHash !== dto.validatedHash)
      throw new ConflictException('VALIDATION_HASH_MISMATCH');
    const definition = (v.bpmDefinition ?? {}) as Record<string, unknown>;
    const report = this.validateDefinition(definition);
    if (!report.valid) throw new UnprocessableEntityException(report);
    await this.assertOperational(definition, v.category.sectorId);
    const holidays = await this.prisma.holiday.findMany({
      select: { date: true },
    });
    const calendarSnapshot = {
      ...this.calendar(),
      holidays: holidays.map((h) => h.date.toISOString().slice(0, 10)),
    };
    const contentHash = hash(definition);
    return this.transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM request_categories WHERE id = ${v.categoryId} FOR UPDATE`;
      const changed = await tx.categoryVersion.updateMany({
        where: { id, bpmRevision: dto.expectedVersion, bpmStatus: 'draft' },
        data: {
          bpmStatus: 'published',
          bpmContentHash: contentHash,
          publishedAt: new Date(),
          publishedBy: user.userId,
          bpmCalendarSnapshot: calendarSnapshot,
          slaFirstResponseMinutes: (definition.sla as any).firstResponseMinutes,
          slaResolutionMinutes: (definition.sla as any).resolutionMinutes,
          bpmRevision: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.requestCategory.update({
        where: { id: v.categoryId },
        data: { publishedBpmVersionId: id, configRevision: { increment: 1 } },
      });
      return tx.categoryVersion.findUniqueOrThrow({ where: { id } });
    });
  }
  async enableProcess(
    id: string,
    dto: { expectedVersion: number },
    user: AuthenticatedUser,
  ) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request_process:publish');
    const category = await this.prisma.requestCategory.findUnique({
      where: { id },
      include: {
        versions: {
          where: { bpmStatus: 'published' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!category?.versions[0])
      throw new BadRequestException('Publique uma versão antes de habilitar');
    const grant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId: id,
        userId: user.userId,
        role: 'publisher',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!grant)
      throw new ForbiddenException(
        'Sem grant de publicador para este processo',
      );
    if (category.configRevision !== dto.expectedVersion)
      throw new ConflictException('CATEGORY_VERSION_CONFLICT');
    if (!category.publishedBpmVersionId)
      throw new BadRequestException('Processo sem versão vigente publicada');
    const changed = await this.prisma.requestCategory.updateMany({
      where: { id, configRevision: dto.expectedVersion },
      data: { runtimeEnabled: true, configRevision: { increment: 1 } },
    });
    if (!changed.count)
      throw new ConflictException('CATEGORY_VERSION_CONFLICT');
    return this.prisma.requestCategory.findUniqueOrThrow({ where: { id } });
  }
  async grants(
    id: string,
    grants: GrantDto[],
    user: AuthenticatedUser,
    expectedVersion: number,
  ) {
    await this.assertCurrentPermission(user, 'request_process:model');
    const category = await this.prisma.requestCategory.findUniqueOrThrow({
      where: { id },
    });
    const actorGrant = await this.prisma.processConfigGrant.findFirst({
      where: {
        categoryId: id,
        userId: user.userId,
        role: 'modeler',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!actorGrant)
      throw new ForbiddenException('Sem grant de modelador para este processo');
    const targets = await this.prisma.user.findMany({
      where: { id: { in: grants.map((g) => g.userId) }, status: 'active' },
      select: { id: true },
    });
    if (targets.length !== new Set(grants.map((g) => g.userId)).size)
      throw new BadRequestException(
        'Todos os destinatários devem ser usuários ativos',
      );
    return this.transaction(async (tx) => {
      const changed = await tx.requestCategory.updateMany({
        where: { id, configRevision: expectedVersion },
        data: { configRevision: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException('CATEGORY_VERSION_CONFLICT');
      await tx.processConfigGrant.deleteMany({ where: { categoryId: id } });
      await tx.processConfigGrant.createMany({
        data: grants.map((g) => ({
          categoryId: category.id,
          userId: g.userId,
          role: g.role,
          restrictedRead: g.restrictedRead ?? false,
        })),
      });
      return tx.processConfigGrant.findMany({ where: { categoryId: id } });
    });
  }
}
