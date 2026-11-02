import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  validateAttachment,
  generateSafeFilename,
  MAX_REQUEST_TOTAL_BYTES,
} from '../requests/attachment-security.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { Prisma } from '@prisma/client';
import { fieldMode } from './field-policy.js';
import {
  addBusinessMinutes,
  businessSecondsBetween,
} from './business-calendar.js';
export { addBusinessMinutes } from './business-calendar.js';
import {
  AttachmentDto,
  CommandDto,
  CommentDto,
  CompleteActivityDto,
  CreateBpmRequestDto,
  DraftPatchDto,
  ReasonCommandDto,
} from './dto.js';

type Tx = Prisma.TransactionClient;
const snapshotCalendar = {
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
const statusByPhase = {
  triage: 'em_triagem',
  execution: 'em_atendimento',
} as const;
function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class RequestRuntimeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  private assertEnabled() {
    if (this.config.get<string>('REQUEST_BPM_ENABLED', 'false') !== 'true')
      throw new ForbiddenException('Piloto BPM desabilitado pelo servidor');
  }
  private async hasCurrentPermission(
    user: AuthenticatedUser,
    permission: string,
  ) {
    const current = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        status: true,
        collaboratorId: true,
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
    return !!(
      current &&
      current.status === 'active' &&
      current.collaboratorId === user.collaboratorId &&
      current.userRoles.some((ur) =>
        ur.role.rolePermissions.some(
          (rp) =>
            `${rp.permission.resource}:${rp.permission.action}` === permission,
        ),
      )
    );
  }
  private async assertCurrentPermission(
    user: AuthenticatedUser,
    permission: string,
  ) {
    if (!(await this.hasCurrentPermission(user, permission)))
      throw new ForbiddenException('Permissão atual insuficiente');
  }
  private async categoryVersion(
    categoryId: string,
    versionId: string,
    db: Pick<Tx, 'categoryVersion'> | PrismaService = this.prisma,
  ) {
    const v = await db.categoryVersion.findUnique({
      where: { id: versionId },
      include: { category: true },
    });
    if (
      !v ||
      v.categoryId !== categoryId ||
      v.bpmStatus !== 'published' ||
      v.category.publishedBpmVersionId !== v.id ||
      !v.category.runtimeEnabled
    )
      throw new BadRequestException('Processo BPM indisponível');
    return v;
  }
  private definition(v: { bpmDefinition: Prisma.JsonValue | null }) {
    const d = v.bpmDefinition;
    if (!d || typeof d !== 'object' || Array.isArray(d))
      throw new BadRequestException('Definição BPM ausente');
    return d as Record<string, any>;
  }
  private projectFields(
    definition: Record<string, any>,
    raw: Prisma.JsonValue | null,
    activities?: any[],
  ) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const hidden = new Set<string>();
    const access = definition.formAccess ?? {};
    for (const [key, value] of Object.entries(access))
      if (value === 'hidden' || (value as any)?.details === 'hidden')
        hidden.add(key);
    const activeIds = new Set(
      (activities ?? [])
        .filter((a) => ['available', 'claimed'].includes(a.state))
        .map((a) => a.nodeId),
    );
    for (const node of (definition.nodes ?? []).filter((n: any) =>
      activeIds.has(n.id),
    )) {
      for (const [key, value] of Object.entries(node.formAccess ?? {}))
        if (value === 'hidden' || (value as any)?.details === 'hidden')
          hidden.add(key);
    }
    return Object.fromEntries(
      Object.entries(raw).filter(([key]) => !hidden.has(key)),
    );
  }
  private assertWritableFields(
    definition: Record<string, any>,
    patch: Record<string, unknown>,
  ) {
    const access = definition.formAccess ?? {};
    const blocked = Object.keys(patch).filter(
      (key) =>
        ['hidden', 'read', 'readonly'].includes(access[key]) ||
        access[key]?.write === false,
    );
    if (blocked.length)
      throw new ForbiddenException(
        `Campos não editáveis: ${blocked.join(', ')}`,
      );
  }
  private recordFieldMode(r: any, user: AuthenticatedUser, key: string) {
    return fieldMode(
      this.definition(r.categoryVersion),
      {
        requesterId: r.requesterId,
        status: r.status,
        currentQueueId: r.queueId,
        activities: r.bpmInstances?.[0]?.activities ?? [],
        teamMember: !!r.queue?.bpmMembers.some(
          (m: any) => m.active && m.collaboratorId === user.collaboratorId,
        ),
      },
      user.collaboratorId,
      key,
    );
  }
  private attachmentVisible(
    r: any,
    fieldKey: string | null | undefined,
    user: AuthenticatedUser,
  ) {
    if (!fieldKey) return true;
    return this.recordFieldMode(r, user, fieldKey) !== 'hidden';
  }
  private async validateFields(
    definition: Record<string, any>,
    fields: Record<string, unknown> | undefined,
    submit = false,
  ) {
    const schema = Array.isArray(definition.form)
      ? (definition.form as Array<Record<string, any>>)
      : [];
    const values = fields ?? {};
    const errors: Record<string, string> = {};
    const allowed = new Set(schema.map((f) => f.key));
    for (const key of Object.keys(values))
      if (!allowed.has(key)) errors[key] = 'Campo desconhecido';
    for (const f of schema) {
      const value = values[f.key];
      if (value !== undefined && value !== null) {
        const ok =
          f.type === 'text' || f.type === 'textarea'
            ? typeof value === 'string'
            : f.type === 'integer'
              ? typeof value === 'number' && Number.isSafeInteger(value)
              : f.type === 'decimal'
                ? (() => {
                    const text =
                      typeof value === 'number' && Number.isFinite(value)
                        ? String(value)
                        : typeof value === 'string'
                          ? value
                          : '';
                    return /^-?\d{1,15}(\.\d{1,4})?$/.test(text);
                  })()
                : f.type === 'boolean'
                  ? typeof value === 'boolean'
                  : f.type === 'date'
                    ? typeof value === 'string' &&
                      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                      (() => {
                        const [y, m, day] = value.split('-').map(Number);
                        const parsed = new Date(Date.UTC(y, m - 1, day));
                        return (
                          parsed.getUTCFullYear() === y &&
                          parsed.getUTCMonth() === m - 1 &&
                          parsed.getUTCDate() === day
                        );
                      })()
                    : f.type === 'select'
                      ? typeof value === 'string' &&
                        (!Array.isArray(f.options) ||
                          f.options.some((o: any) =>
                            typeof o === 'string'
                              ? o === value
                              : o?.id === value,
                          ))
                      : f.type === 'attachment'
                        ? Array.isArray(value) &&
                          value.every((id) => typeof id === 'string')
                        : false;
        if (!ok) errors[f.key] = 'Tipo ou valor inválido';
        if (
          ok &&
          typeof value === 'string' &&
          Number.isInteger(f.maxLength) &&
          value.length > f.maxLength
        )
          errors[f.key] = 'Valor excede o limite do campo';
      }
      if (
        submit &&
        f.required &&
        (value === undefined ||
          value === null ||
          (typeof value === 'string' && value.trim() === '') ||
          (Array.isArray(value) && value.length === 0))
      )
        errors[f.key] = 'Campo obrigatório';
    }
    if (submit && errors.title) throw new BadRequestException(errors);
    if (Object.keys(errors).length)
      throw new BadRequestException({
        code: 'FIELD_VALIDATION',
        fields: errors,
      });
  }
  private async requestAccess(
    id: string,
    user: AuthenticatedUser,
    write = false,
  ) {
    const r = await this.prisma.request.findUnique({
      where: { id },
      include: {
        categoryVersion: { include: { category: true } },
        queue: { include: { bpmMembers: { where: { active: true } } } },
        bpmInstances: {
          include: {
            activities: { include: { candidates: true } },
            slaClocks: true,
          },
          orderBy: { cycle: 'desc' },
          take: 1,
        },
        bpmAttachments: {
          select: {
            id: true,
            filename: true,
            safeFilename: true,
            mimeType: true,
            sizeBytes: true,
            contentHash: true,
            fieldKey: true,
            version: true,
            uploadedBy: true,
            createdAt: true,
          },
        },
        bpmComments: true,
      },
    });
    if (!r) throw new NotFoundException('Requisição BPM não encontrada');
    if (r.executionMode !== 'bpm_v1')
      throw new ConflictException('WRONG_EXECUTOR');
    const isRequester = r.requesterId === user.collaboratorId;
    const isParticipant =
      isRequester ||
      (r.status !== 'rascunho' &&
        r.beneficiaryId === user.collaboratorId &&
        this.definition(r.categoryVersion).policy?.beneficiaryCanRead !==
          false);
    const member =
      r.status !== 'rascunho' &&
      r.queue?.bpmMembers.some(
        (m) => m.collaboratorId === user.collaboratorId && m.active,
      );
    const grant =
      r.status === 'rascunho'
        ? null
        : await this.prisma.processConfigGrant.findFirst({
            where: {
              categoryId: r.categoryVersion.categoryId,
              userId: user.userId,
              role: 'auditor',
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          });
    if (!isParticipant && !member && !grant)
      throw new NotFoundException('Requisição BPM não encontrada');
    if (write && !isRequester && !member)
      throw new ForbiddenException('Sem escopo para alterar esta requisição');
    return r;
  }
  private async receipt(
    tx: Tx,
    actorUserId: string,
    key: string,
    routeScope: string,
    body: unknown,
  ) {
    const target = (body as { requestId?: string }).requestId;
    if (target)
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${target} FOR UPDATE`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${actorUserId}), hashtext(${key}))::text AS locked`;
    const existing = await tx.requestCommandReceipt.findUnique({
      where: { actorUserId_key: { actorUserId, key } },
    });
    const requestHash = hash({
      routeScope,
      requestId: (body as { requestId?: string }).requestId ?? null,
      body,
    });
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw new ConflictException('IDEMPOTENCY_KEY_REUSED');
      return existing;
    }
    return { requestHash };
  }
  private async event(
    tx: Tx,
    requestId: string,
    instanceId: string,
    cycle: number,
    type: string,
    user: AuthenticatedUser,
    commandId: string,
    summary: Record<string, unknown>,
  ) {
    // Serialize the per-request sequence allocation inside the same transaction.
    await tx.request.update({
      where: { id: requestId },
      data: { updatedAt: new Date() },
    });
    const last = await tx.requestRuntimeEvent.findFirst({
      where: { requestId },
      orderBy: { sequence: 'desc' },
    });
    return tx.requestRuntimeEvent.create({
      data: {
        requestId,
        instanceId,
        cycle,
        sequence: (last?.sequence ?? 0) + 1,
        type,
        actorUserId: user.userId,
        actorCollaboratorId: user.collaboratorId,
        commandId,
        summary: summary as Prisma.InputJsonValue,
      },
    });
  }
  private async validateAttachmentRefs(
    requestId: string,
    definition: Record<string, any>,
    fields: Record<string, unknown>,
  ) {
    const attachmentIds = new Set<string>();
    for (const field of Array.isArray(definition.form) ? definition.form : []) {
      if (field.type !== 'attachment') continue;
      const value = fields[field.key];
      if (Array.isArray(value))
        for (const id of value)
          if (typeof id === 'string') attachmentIds.add(id);
    }
    if (!attachmentIds.size) return;
    const owned = await this.prisma.bpmRequestAttachment.findMany({
      where: { requestId, id: { in: [...attachmentIds] } },
      select: { id: true },
    });
    if (owned.length !== attachmentIds.size)
      throw new BadRequestException({
        code: 'FIELD_VALIDATION',
        fields: { attachment: 'Anexo não pertence à requisição' },
      });
  }
  private async stopClocks(
    tx: Tx,
    requestId: string,
    now: Date,
    metric?: 'first_response' | 'resolution',
  ) {
    const clocks = await tx.requestSlaClock.findMany({
      where: { requestId, stoppedAt: null, ...(metric ? { metric } : {}) },
    });
    for (const clock of clocks) {
      const holidays = (clock.calendarSnapshot as any)?.holidays ?? [];
      const elapsed = businessSecondsBetween(
        clock.checkpointAt,
        now,
        holidays,
        (clock.calendarSnapshot as any)?.timezone ?? 'America/Sao_Paulo',
      );
      const nextElapsed = clock.elapsedSeconds + elapsed;
      await tx.requestSlaClock.update({
        where: { id: clock.id },
        data: {
          elapsedSeconds: nextElapsed,
          checkpointAt: now,
          stoppedAt: now,
          breachedAt:
            clock.breachedAt ??
            (nextElapsed >= clock.budgetSeconds
              ? (clock.targetAt ?? now)
              : null),
        },
      });
      await tx.requestSlaInterval.updateMany({
        where: { clockId: clock.id, endAt: null },
        data: { endAt: now },
      });
    }
  }
  async create(dto: CreateBpmRequestDto, user: AuthenticatedUser) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request:create');
    if (!user.collaboratorId)
      throw new ForbiddenException('Usuário sem colaborador');
    const collaboratorId = user.collaboratorId;
    if (dto.beneficiaryId && dto.beneficiaryId !== user.collaboratorId)
      throw new ForbiddenException('Representação não permitida');
    return this.prisma.$transaction(async (tx) => {
      if (dto.commandKey) {
        const rec = await this.receipt(
          tx,
          user.userId,
          dto.commandKey,
          'create',
          dto,
        );
        if ('resultRef' in rec) return rec.resultRef as any;
      }
      const v = await this.categoryVersion(dto.categoryId, dto.versionId, tx);
      const d = this.definition(v);
      this.assertWritableFields(d, dto.fields ?? {});
      await this.validateFields(d, dto.fields);
      const requester = await tx.collaborator.findUniqueOrThrow({
        where: { id: collaboratorId },
      });
      const year = Number(
        new Intl.DateTimeFormat('en', {
          timeZone: 'America/Sao_Paulo',
          year: 'numeric',
        }).format(new Date()),
      );
      await tx.$executeRaw`INSERT INTO request_number_counters (year, last_value) VALUES (${year}, 0) ON CONFLICT (year) DO NOTHING`;
      const rows = await tx.$queryRaw<
        Array<{ last_value: number }>
      >`UPDATE request_number_counters SET last_value = last_value + 1 WHERE year = ${year} RETURNING last_value`;
      const code = `REQ-${year}-${String(rows[0].last_value).padStart(6, '0')}`;
      const created = await tx.request.create({
        data: {
          code,
          categoryVersionId: v.id,
          sectorId: v.category.sectorId,
          requesterSectorId: requester.sectorId,
          requesterId: requester.id,
          beneficiaryId: dto.beneficiaryId ?? requester.id,
          title: dto.title ?? '',
          description: dto.description ?? '',
          formData: (dto.fields ?? {}) as Prisma.InputJsonValue,
          executionMode: 'bpm_v1',
          status: 'rascunho',
          currentCycle: 0,
          confidentiality: v.category.confidentiality,
        },
      });
      const result = {
        id: created.id,
        code: created.code,
        currentVersion: created.lockVersion,
      };
      if (dto.commandKey && dto.commandId)
        await tx.requestCommandReceipt.create({
          data: {
            commandId: dto.commandId,
            actorUserId: user.userId,
            key: dto.commandKey,
            routeScope: 'create',
            requestHash: hash({
              routeScope: 'create',
              requestId: null,
              body: dto,
            }),
            requestId: created.id,
            statusCode: 201,
            resultRef: result,
          },
        });
      return result;
    });
  }
  async saveDraft(id: string, dto: DraftPatchDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:create');
    const r = await this.requestAccess(id, user, true);
    if (r.requesterId !== user.collaboratorId)
      throw new ForbiddenException('Somente o autor edita o rascunho');
    const d = this.definition(r.categoryVersion);
    const existingFields = (r.formData as Record<string, unknown> | null) ?? {};
    const fields = dto.fields
      ? { ...existingFields, ...dto.fields }
      : existingFields;
    this.assertWritableFields(d, dto.fields ?? {});
    await this.validateFields(d, fields);
    await this.validateAttachmentRefs(id, d, fields);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${id} FOR UPDATE`;
      const body = { ...dto, requestId: id };
      const rec = dto.commandKey
        ? await this.receipt(tx, user.userId, dto.commandKey, 'draft', body)
        : null;
      if (rec && 'id' in rec) return this.resultFromReceipt(tx, rec);
      if (r.status !== 'rascunho')
        throw new ConflictException('REQUEST_NOT_DRAFT');
      const updated = await tx.request.updateMany({
        where: {
          id,
          lockVersion: dto.expectedVersion,
          executionMode: 'bpm_v1',
          status: 'rascunho',
        },
        data: {
          title: dto.title ?? r.title,
          description: dto.description ?? r.description,
          formData: fields as Prisma.InputJsonValue,
          lockVersion: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictException('VERSION_CONFLICT');
      const saved = await tx.request.findUniqueOrThrow({
        where: { id },
      });
      const result = {
        requestId: id,
        currentVersion: saved.lockVersion,
        fields: this.projectFields(d, saved.formData),
      };
      if (dto.commandKey && dto.commandId)
        await tx.requestCommandReceipt.create({
          data: {
            commandId: dto.commandId,
            actorUserId: user.userId,
            key: dto.commandKey,
            routeScope: 'draft',
            requestHash: hash({ routeScope: 'draft', requestId: id, body }),
            requestId: id,
            statusCode: 200,
            resultRef: result,
          },
        });
      return result;
    });
  }
  async submit(id: string, dto: CommandDto, user: AuthenticatedUser) {
    this.assertEnabled();
    await this.assertCurrentPermission(user, 'request:create');
    const r = await this.requestAccess(id, user, true);
    if (r.requesterId !== user.collaboratorId)
      throw new ForbiddenException(
        'Somente rascunho do autor pode ser enviado',
      );
    const d = this.definition(r.categoryVersion);
    const sla = d.sla as
      { firstResponseMinutes?: number; resolutionMinutes?: number } | undefined;
    const firstResponseMinutes =
      sla?.firstResponseMinutes ?? r.categoryVersion.slaFirstResponseMinutes;
    const resolutionMinutes =
      sla?.resolutionMinutes ?? r.categoryVersion.slaResolutionMinutes;
    await this.validateFields(
      d,
      (r.formData as Record<string, unknown>) ?? {},
      true,
    );
    await this.validateAttachmentRefs(
      id,
      d,
      (r.formData as Record<string, unknown>) ?? {},
    );
    if (r.title.length < 10 || r.title.length > 120 || !r.description.trim())
      throw new BadRequestException({
        code: 'SUBMIT_VALIDATION',
        fields: {
          title: 'Título deve ter 10–120 caracteres',
          description: 'Descrição obrigatória',
        },
      });
    const triageNode = d.nodes.find((n: any) => n.phase === 'triage');
    const triageQueue = await this.prisma.queue.findUnique({
      where: { id: triageNode?.queueId },
      include: {
        bpmMembers: {
          where: { active: true },
          include: { collaborator: { include: { user: true } } },
        },
      },
    });
    if (!triageQueue)
      throw new BadRequestException('Fila de triagem não configurada');
    const eligible = triageQueue.bpmMembers.filter(
      (m) =>
        m.role === 'member' &&
        m.collaboratorId !== r.requesterId &&
        m.collaboratorId !== r.beneficiaryId &&
        m.collaborator.status === 'ativo' &&
        m.collaborator.user?.status === 'active',
    );
    const now = new Date();
    const calendar =
      (r.categoryVersion.bpmCalendarSnapshot as {
        holidays?: string[];
        timezone?: string;
      } | null) ?? snapshotCalendar;
    const holidays = calendar.holidays ?? [];
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'submit',
        { ...dto, requestId: id },
      );
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (r.status !== 'rascunho')
        throw new ConflictException('REQUEST_NOT_DRAFT');
      const changed = await tx.request.updateMany({
        where: { id, lockVersion: dto.expectedVersion, status: 'rascunho' },
        data: {
          status: 'enviada',
          currentCycle: 1,
          submittedAt: now,
          lockVersion: { increment: 1 },
          queueId: triageQueue.id,
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      const instance = await tx.processInstance.create({
        data: {
          requestId: id,
          cycle: 1,
          categoryVersionId: r.categoryVersionId,
          state: 'running',
          definitionSnapshot: d as Prisma.InputJsonValue,
          startedAt: now,
        },
      });
      const token = await tx.executionToken.create({
        data: {
          instanceId: instance.id,
          nodeId: 'triage',
          activationKey: '1:triage',
        },
      });
      const activity = await tx.activityInstance.create({
        data: {
          instanceId: instance.id,
          tokenId: token.id,
          nodeId: 'triage',
          activationKey: '1:triage',
          phase: 'triage',
          queueId: triageQueue.id,
          candidates: {
            create: eligible.map((m) => ({
              collaboratorId: m.collaboratorId,
              sourceResolver: 'queueMembers',
            })),
          },
        },
      });
      const responseTarget = addBusinessMinutes(
        now,
        firstResponseMinutes,
        holidays,
        calendar.timezone,
      );
      const solutionTarget = addBusinessMinutes(
        now,
        resolutionMinutes,
        holidays,
        calendar.timezone,
      );
      await tx.requestSlaClock.createMany({
        data: [
          {
            requestId: id,
            instanceId: instance.id,
            metric: 'first_response',
            activationKey: '1:first_response',
            calendarSnapshot: calendar,
            budgetSeconds: firstResponseMinutes * 60,
            checkpointAt: now,
            originalTargetAt: responseTarget,
            targetAt: responseTarget,
          },
          {
            requestId: id,
            instanceId: instance.id,
            metric: 'resolution',
            activationKey: '1:resolution',
            calendarSnapshot: calendar,
            budgetSeconds: resolutionMinutes * 60,
            checkpointAt: now,
            originalTargetAt: solutionTarget,
            targetAt: solutionTarget,
          },
        ],
      });
      const clocks = await tx.requestSlaClock.findMany({
        where: { instanceId: instance.id },
      });
      await tx.requestSlaInterval.createMany({
        data: clocks.map((clock) => ({
          clockId: clock.id,
          kind: 'running',
          startAt: now,
        })),
      });
      if (!eligible.length)
        await tx.requestRuntimeIncident.create({
          data: {
            requestId: id,
            instanceId: instance.id,
            activityId: activity.id,
            type: 'NO_ELIGIBLE_ASSIGNEE',
            safeDetails: { message: 'Aguardando definição de responsável' },
          },
        });
      const ev = await this.event(
        tx,
        id,
        instance.id,
        1,
        'request.submitted',
        user,
        dto.commandId,
        { activityId: activity.id, eligibleCount: eligible.length },
      );
      const receipt = await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'submit',
          requestHash: hash({
            routeScope: 'submit',
            requestId: id,
            body: { ...dto, requestId: id },
          }),
          requestId: id,
          statusCode: 200,
          resultRef: { requestId: id, activityId: activity.id, eventId: ev.id },
        },
      });
      return {
        requestId: id,
        activityId: activity.id,
        currentVersion: dto.expectedVersion + 1,
        receiptId: receipt.id,
      };
    });
  }
  private async resultFromReceipt(tx: Tx, rec: any) {
    const current =
      rec.requestId && (tx as any).request?.findUnique
        ? await tx.request.findUnique({
            where: { id: rec.requestId },
            select: { lockVersion: true },
          })
        : null;
    return {
      replay: true,
      requestId: rec.requestId,
      currentVersion: current?.lockVersion ?? rec.resultRef?.currentVersion,
      receiptId: rec.id,
    };
  }
  private async activity(
    id: string,
    user: AuthenticatedUser,
    requireCandidate = true,
  ) {
    const a = await this.prisma.activityInstance.findUnique({
      where: { id },
      include: { instance: { include: { request: true } }, candidates: true },
    });
    if (!a || a.instance.request.executionMode !== 'bpm_v1')
      throw new NotFoundException('Atividade BPM não encontrada');
    if (a.instance.request.requesterId === user.collaboratorId)
      throw new ForbiddenException('Autor não pode executar atividade própria');
    if (
      requireCandidate &&
      !a.candidates.some((c) => c.collaboratorId === user.collaboratorId)
    )
      throw new ForbiddenException('Você não é candidato desta atividade');
    return a;
  }
  async claim(id: string, dto: CommandDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:update');
    const a = await this.activity(id, user);
    const r = await this.requestAccess(a.instance.requestId, user, true);
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.receipt(tx, user.userId, dto.commandKey, 'claim', {
        ...dto,
        requestId: r.id,
        activityId: id,
      });
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (a.state !== 'available')
        throw new ConflictException('ACTIVITY_NOT_AVAILABLE');
      const locked = await tx.request.updateMany({
        where: { id: r.id, lockVersion: dto.expectedVersion },
        data: {
          lockVersion: { increment: 1 },
          status: statusByPhase[a.phase],
          assigneeId: user.collaboratorId,
        },
      });
      if (!locked.count) throw new ConflictException('VERSION_CONFLICT');
      const claimed = await tx.activityInstance.updateMany({
        where: { id, state: 'available' },
        data: {
          state: 'claimed',
          assigneeId: user.collaboratorId!,
          claimedAt: new Date(),
        },
      });
      if (!claimed.count) throw new ConflictException('ACTIVITY_NOT_AVAILABLE');
      await tx.executionToken.update({
        where: { id: a.tokenId },
        data: { state: 'active' },
      });
      await tx.activityAssignment.create({
        data: {
          activityId: id,
          toCollaboratorId: user.collaboratorId!,
          byUserId: user.userId,
        },
      });
      const ev = await this.event(
        tx,
        r.id,
        a.instanceId,
        r.currentCycle,
        'activity.claimed',
        user,
        dto.commandId,
        { activityId: id },
      );
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'claim',
          requestHash: hash({
            routeScope: 'claim',
            requestId: r.id,
            body: { ...dto, requestId: r.id, activityId: id },
          }),
          requestId: r.id,
          statusCode: 200,
          resultRef: {
            requestId: r.id,
            activityId: id,
            eventId: ev.id,
            currentVersion: dto.expectedVersion + 1,
          },
        },
      });
      return {
        requestId: r.id,
        activityId: id,
        status: statusByPhase[a.phase],
        currentVersion: dto.expectedVersion + 1,
      };
    });
  }
  async complete(
    id: string,
    dto: CompleteActivityDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCurrentPermission(user, 'request:update');
    const a = await this.activity(id, user);
    const r = await this.requestAccess(a.instance.requestId, user, true);
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'complete',
        { ...dto, requestId: r.id, activityId: id },
      );
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (a.state !== 'claimed' || a.assigneeId !== user.collaboratorId)
        throw new ForbiddenException('Atividade não atribuída a você');
      const locked = await tx.request.updateMany({
        where: { id: r.id, lockVersion: dto.expectedVersion },
        data: { lockVersion: { increment: 1 } },
      });
      if (!locked.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.activityInstance.update({
        where: { id },
        data: {
          state: 'completed',
          outcome: 'complete',
          resolution: dto.resolution,
          completedAt: now,
        },
      });
      await tx.executionToken.update({
        where: { id: a.tokenId },
        data: { state: 'consumed' },
      });
      await tx.activityAssignment.updateMany({
        where: { activityId: id, endedAt: null },
        data: { endedAt: now },
      });
      let status: string = 'concluida';
      let nextId: string | undefined;
      if (a.phase === 'triage') {
        const d = this.definition(r.categoryVersion);
        const node = d.nodes.find((n: any) => n.phase === 'execution');
        const q = await tx.queue.findUnique({
          where: { id: node.queueId },
          include: {
            bpmMembers: {
              where: { active: true },
              include: { collaborator: { include: { user: true } } },
            },
          },
        });
        const eligible =
          q?.bpmMembers.filter(
            (m) =>
              m.role === 'member' &&
              m.collaboratorId !== r.requesterId &&
              m.collaboratorId !== r.beneficiaryId &&
              m.collaborator.status === 'ativo' &&
              m.collaborator.user?.status === 'active',
          ) ?? [];
        const token = await tx.executionToken.create({
          data: {
            instanceId: a.instanceId,
            nodeId: 'execute',
            activationKey: '1:execute',
          },
        });
        const next = await tx.activityInstance.create({
          data: {
            instanceId: a.instanceId,
            tokenId: token.id,
            nodeId: 'execute',
            activationKey: '1:execute',
            phase: 'execution',
            queueId: q?.id,
            candidates: {
              create: eligible.map((m) => ({
                collaboratorId: m.collaboratorId,
                sourceResolver: 'queueMembers',
              })),
            },
          },
        });
        nextId = next.id;
        status = 'em_atendimento';
        await tx.request.update({
          where: { id: r.id },
          data: {
            status: 'em_atendimento',
            queueId: q?.id,
            assigneeId: null,
            firstResponseAt: now,
          },
        });
        await this.stopClocks(tx, r.id, now, 'first_response');
        if (!eligible.length)
          await tx.requestRuntimeIncident.create({
            data: {
              requestId: r.id,
              instanceId: a.instanceId,
              activityId: next.id,
              type: 'NO_ELIGIBLE_ASSIGNEE',
              safeDetails: { message: 'Aguardando definição de responsável' },
            },
          });
      } else {
        await tx.processInstance.update({
          where: { id: a.instanceId },
          data: { state: 'completed', completedAt: now },
        });
        await tx.request.update({
          where: { id: r.id },
          data: { status: 'concluida', completedAt: now },
        });
        await this.stopClocks(tx, r.id, now, 'resolution');
      }
      const ev = await this.event(
        tx,
        r.id,
        a.instanceId,
        r.currentCycle,
        'activity.completed',
        user,
        dto.commandId,
        { activityId: id, nextActivityId: nextId },
      );
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'complete',
          requestHash: hash({
            routeScope: 'complete',
            requestId: r.id,
            body: { ...dto, requestId: r.id, activityId: id },
          }),
          requestId: r.id,
          statusCode: 200,
          resultRef: {
            requestId: r.id,
            activityId: id,
            nextActivityId: nextId,
            eventId: ev.id,
            currentVersion: dto.expectedVersion + 1,
          },
        },
      });
      return {
        requestId: r.id,
        activityId: id,
        nextActivityId: nextId,
        status,
        currentVersion: dto.expectedVersion + 1,
      };
    });
  }
  async release(id: string, dto: ReasonCommandDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:update');
    const a = await this.activity(id, user, false);
    const r = await this.requestAccess(a.instance.requestId, user, true);
    const manager = r.queue?.bpmMembers.some(
      (m) => m.role === 'manager' && m.collaboratorId === user.collaboratorId,
    );
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'release',
        { ...dto, requestId: r.id, activityId: id },
      );
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (
        a.state !== 'claimed' ||
        (a.assigneeId !== user.collaboratorId && !manager)
      )
        throw new ForbiddenException(
          'Atividade não pode ser liberada por este ator',
        );
      const changed = await tx.request.updateMany({
        where: { id: r.id, lockVersion: dto.expectedVersion },
        data: {
          lockVersion: { increment: 1 },
          status: a.phase === 'triage' ? 'em_triagem' : 'em_atendimento',
          assigneeId: null,
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.activityInstance.update({
        where: { id },
        data: { state: 'available', assigneeId: null, claimedAt: null },
      });
      await tx.activityAssignment.updateMany({
        where: { activityId: id, endedAt: null },
        data: { endedAt: new Date(), reason: dto.reason },
      });
      await this.event(
        tx,
        r.id,
        a.instanceId,
        r.currentCycle,
        'activity.released',
        user,
        dto.commandId,
        { activityId: id },
      );
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'release',
          requestHash: hash({
            routeScope: 'release',
            requestId: r.id,
            body: { ...dto, requestId: r.id, activityId: id },
          }),
          requestId: r.id,
          statusCode: 200,
          resultRef: {
            requestId: r.id,
            activityId: id,
            currentVersion: dto.expectedVersion + 1,
          },
        },
      });
      return {
        requestId: r.id,
        activityId: id,
        currentVersion: dto.expectedVersion + 1,
      };
    });
  }
  async reassign(
    id: string,
    dto: import('./dto.js').ReassignDto,
    user: AuthenticatedUser,
  ) {
    await this.assertCurrentPermission(user, 'request:update');
    await this.assertCurrentPermission(user, 'request:assign');
    const a = await this.activity(id, user, false);
    const r = await this.requestAccess(a.instance.requestId, user, true);
    const manager = r.queue?.bpmMembers.some(
      (m) => m.role === 'manager' && m.collaboratorId === user.collaboratorId,
    );
    if (!manager)
      throw new ForbiddenException('Somente gestor da fila pode reatribuir');
    return this.prisma.$transaction(async (tx) => {
      const rec = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'reassign',
        { ...dto, requestId: r.id, activityId: id },
      );
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (
        a.state === 'completed' ||
        ['concluida', 'encerrada', 'cancelada'].includes(r.status)
      )
        throw new ConflictException('ACTIVITY_TERMINAL');
      const eligible = r.queue?.bpmMembers.some(
        (m) =>
          m.role === 'member' &&
          m.active &&
          m.collaboratorId === dto.assigneeId,
      );
      if (!eligible)
        throw new BadRequestException('Destino não é membro ativo da fila');
      if (
        dto.assigneeId === r.requesterId ||
        dto.assigneeId === r.beneficiaryId
      )
        throw new ForbiddenException(
          'Conflito de interesse: solicitante/beneficiário não pode executar',
        );
      const destination = await tx.user.findFirst({
        where: {
          collaboratorId: dto.assigneeId,
          status: 'active',
          collaborator: { status: 'ativo' },
        },
        select: { id: true },
      });
      if (!destination)
        throw new BadRequestException('Destino sem conta/colaborador ativo');
      const changed = await tx.request.updateMany({
        where: { id: r.id, lockVersion: dto.expectedVersion },
        data: { assigneeId: dto.assigneeId, lockVersion: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.activityInstance.update({
        where: { id },
        data: { assigneeId: dto.assigneeId, state: 'claimed' },
      });
      const candidate = await tx.activityCandidate.findFirst({
        where: {
          activityId: id,
          collaboratorId: dto.assigneeId,
          sourceResolver: 'managerAssignment',
        },
      });
      if (!candidate)
        await tx.activityCandidate.create({
          data: {
            activityId: id,
            collaboratorId: dto.assigneeId,
            sourceResolver: 'managerAssignment',
          },
        });
      await tx.requestRuntimeIncident.updateMany({
        where: { activityId: id, state: 'open', type: 'NO_ELIGIBLE_ASSIGNEE' },
        data: {
          state: 'resolved',
          resolvedBy: user.userId,
          resolvedAt: new Date(),
          resolution: dto.reason,
        },
      });
      await tx.activityAssignment.updateMany({
        where: { activityId: id, endedAt: null },
        data: { endedAt: new Date() },
      });
      await tx.activityAssignment.create({
        data: {
          activityId: id,
          toCollaboratorId: dto.assigneeId,
          byUserId: user.userId,
          reason: dto.reason,
        },
      });
      await this.event(
        tx,
        r.id,
        a.instanceId,
        r.currentCycle,
        'activity.reassigned',
        user,
        dto.commandId,
        { activityId: id, assigneeId: dto.assigneeId },
      );
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'reassign',
          requestHash: hash({
            routeScope: 'reassign',
            requestId: r.id,
            body: { ...dto, requestId: r.id, activityId: id },
          }),
          requestId: r.id,
          statusCode: 200,
          resultRef: {
            requestId: r.id,
            activityId: id,
            currentVersion: dto.expectedVersion + 1,
          },
        },
      });
      return {
        requestId: r.id,
        activityId: id,
        currentVersion: dto.expectedVersion + 1,
      };
    });
  }
  async close(id: string, dto: ReasonCommandDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:update');
    const r = await this.requestAccess(id, user, true);
    const manager = r.queue?.bpmMembers.some(
      (m) => m.role === 'manager' && m.collaboratorId === user.collaboratorId,
    );
    if (!manager)
      throw new ForbiddenException('Somente gestor da fila encerra');
    return this.prisma.$transaction(async (tx) => {
      const body = { ...dto, requestId: id };
      const rec = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'close',
        body,
      );
      if ('id' in rec) return this.resultFromReceipt(tx, rec);
      if (r.status !== 'concluida')
        throw new BadRequestException(
          'Somente requisição concluída pode ser encerrada',
        );
      const changed = await tx.request.updateMany({
        where: { id, lockVersion: dto.expectedVersion, status: 'concluida' },
        data: {
          status: 'encerrada',
          closedAt: new Date(),
          lockVersion: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.processInstance.updateMany({
        where: { requestId: id, cycle: r.currentCycle },
        data: { state: 'closed', closedAt: new Date() },
      });
      await this.event(
        tx,
        id,
        r.bpmInstances[0].id,
        r.currentCycle,
        'request.closed',
        user,
        dto.commandId,
        { reason: dto.reason },
      );
      const result = {
        requestId: id,
        status: 'encerrada',
        currentVersion: dto.expectedVersion + 1,
      };
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'close',
          requestHash: hash({ routeScope: 'close', requestId: id, body }),
          requestId: id,
          statusCode: 200,
          resultRef: result,
        },
      });
      return result;
    });
  }
  async cancel(id: string, dto: ReasonCommandDto, user: AuthenticatedUser) {
    const r = await this.requestAccess(id, user, true);
    const hasExecution = r.bpmInstances[0]?.activities.some(
      (a) => a.phase === 'execution',
    );
    const isRequester = r.requesterId === user.collaboratorId;
    const manager = r.queue?.bpmMembers.some(
      (m) => m.role === 'manager' && m.collaboratorId === user.collaboratorId,
    );
    const canCreate = await this.hasCurrentPermission(user, 'request:create');
    const canManage = await this.hasCurrentPermission(user, 'request:update');
    const authorMayCancel = !!isRequester && canCreate;
    const managerMayCancel = !!manager && canManage;
    if (!authorMayCancel && !managerMayCancel)
      throw new ForbiddenException('Sem permissão para cancelar');
    if (authorMayCancel && !managerMayCancel && hasExecution)
      throw new ForbiddenException(
        'Autor não pode cancelar após abrir execução',
      );
    return this.prisma.$transaction(async (tx) => {
      const body = { ...dto, requestId: id };
      const receipt = await this.receipt(
        tx,
        user.userId,
        dto.commandKey,
        'cancel',
        body,
      );
      if ('id' in receipt) return this.resultFromReceipt(tx, receipt);
      if (['concluida', 'encerrada', 'cancelada'].includes(r.status))
        throw new BadRequestException('Estado não permite cancelamento');
      const changed = await tx.request.updateMany({
        where: { id, lockVersion: dto.expectedVersion },
        data: {
          status: 'cancelada',
          closedAt: new Date(),
          lockVersion: { increment: 1 },
        },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      await tx.activityInstance.updateMany({
        where: {
          instance: { requestId: id },
          state: { in: ['available', 'claimed'] },
        },
        data: {
          state: 'cancelled',
          completedAt: new Date(),
          outcome: 'cancelled',
        },
      });
      await tx.activityAssignment.updateMany({
        where: {
          activityId: {
            in: (r.bpmInstances[0]?.activities ?? []).map((a) => a.id),
          },
          endedAt: null,
        },
        data: { endedAt: new Date(), reason: dto.reason },
      });
      await tx.executionToken.updateMany({
        where: {
          instance: { requestId: id },
          state: { in: ['active', 'waiting'] },
        },
        data: { state: 'cancelled' },
      });
      await tx.processInstance.updateMany({
        where: { requestId: id, cycle: r.currentCycle },
        data: { state: 'cancelled' },
      });
      await this.stopClocks(tx, id, new Date());
      await this.event(
        tx,
        id,
        r.bpmInstances[0]?.id,
        r.currentCycle,
        'request.cancelled',
        user,
        dto.commandId,
        { reason: dto.reason },
      );
      const result = {
        requestId: id,
        status: 'cancelada',
        currentVersion: dto.expectedVersion + 1,
      };
      await tx.requestCommandReceipt.create({
        data: {
          commandId: dto.commandId,
          actorUserId: user.userId,
          key: dto.commandKey,
          routeScope: 'cancel',
          requestHash: hash({ routeScope: 'cancel', requestId: id, body }),
          requestId: id,
          statusCode: 200,
          resultRef: result,
        },
      });
      return result;
    });
  }
  async list(
    user: AuthenticatedUser,
    query: { view?: 'mine' | 'queue'; cursor?: string; limit?: number } = {},
  ) {
    await this.assertCurrentPermission(user, 'request:read');
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const rows = await this.prisma.request.findMany({
      where: {
        executionMode: 'bpm_v1',
        ...(query.view === 'queue'
          ? {
              status: { notIn: ['rascunho', 'encerrada', 'cancelada'] },
              queue: {
                bpmMembers: {
                  some: {
                    collaboratorId: user.collaboratorId ?? '',
                    active: true,
                  },
                },
              },
            }
          : query.view === 'mine'
            ? { requesterId: user.collaboratorId ?? '' }
            : {}),
        OR: [
          { requesterId: user.collaboratorId ?? '' },
          {
            beneficiaryId: user.collaboratorId ?? '',
            status: { not: 'rascunho' },
            categoryVersion: {
              bpmDefinition: {
                path: ['policy', 'beneficiaryCanRead'],
                equals: true,
              },
            },
          },
          {
            queue: {
              bpmMembers: {
                some: {
                  collaboratorId: user.collaboratorId ?? '',
                  active: true,
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        lockVersion: true,
        currentCycle: true,
        createdAt: true,
        categoryVersion: {
          select: {
            category: { select: { id: true, name: true, code: true } },
            version: true,
          },
        },
      },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async detail(id: string, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:read');
    const r = await this.requestAccess(id, user);
    const inst = r.bpmInstances[0];
    const isRequester = r.requesterId === user.collaboratorId;
    const isManager = r.queue?.bpmMembers.some(
      (m) => m.role === 'manager' && m.collaboratorId === user.collaboratorId,
    );
    const isMember = r.queue?.bpmMembers.some(
      (m) => m.active && m.collaboratorId === user.collaboratorId,
    );
    const [canCreate, canExecute, canAssign, canComment] = await Promise.all(
      [
        'request:create',
        'request:update',
        'request:assign',
        'request:comment',
      ].map((p) => this.hasCurrentPermission(user, p)),
    );
    const assignmentTargets =
      isManager && canAssign && r.queueId
        ? await this.prisma.requestQueueMember.findMany({
            where: {
              queueId: r.queueId,
              role: 'member',
              active: true,
              collaboratorId: {
                notIn: [r.requesterId, r.beneficiaryId].filter(
                  (id): id is string => !!id,
                ),
              },
              collaborator: { status: 'ativo', user: { status: 'active' } },
            },
            select: {
              collaboratorId: true,
              collaborator: { select: { fullName: true } },
            },
          })
        : [];
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      description: r.description,
      fields: Object.fromEntries(
        Object.entries((r.formData as Record<string, unknown>) ?? {}).filter(
          ([key]) => this.recordFieldMode(r, user, key) !== 'hidden',
        ),
      ),
      status: r.status,
      currentVersion: r.lockVersion,
      assignmentTargets: assignmentTargets.map((m) => ({
        id: m.collaboratorId,
        label: m.collaborator.fullName,
      })),
      incidents: isManager
        ? await this.prisma.requestRuntimeIncident.findMany({
            where: { requestId: id, state: 'open' },
            select: {
              id: true,
              activityId: true,
              type: true,
              safeDetails: true,
            },
          })
        : [],
      cycle: r.currentCycle,
      category: r.categoryVersion.category,
      version: r.categoryVersion.version,
      schema: (this.definition(r.categoryVersion).form ?? []).filter(
        (f: any) => this.recordFieldMode(r, user, f.key) !== 'hidden',
      ),
      formAccess: Object.fromEntries(
        (this.definition(r.categoryVersion).form ?? [])
          .filter((f: any) => this.recordFieldMode(r, user, f.key) !== 'hidden')
          .map((f: any) => [f.key, this.recordFieldMode(r, user, f.key)]),
      ),
      activities: inst?.activities.map((a) => ({
        id: a.id,
        phase: a.phase,
        state: a.state,
        assigneeId: a.assigneeId,
        queueId: a.queueId,
        resolution: a.resolution,
        allowedActions: !canExecute
          ? []
          : a.state === 'available' &&
              a.candidates.some((c) => c.collaboratorId === user.collaboratorId)
            ? ['claim']
            : a.state === 'claimed' && a.assigneeId === user.collaboratorId
              ? ['complete', 'release']
              : isManager && ['available', 'claimed'].includes(a.state)
                ? [
                    ...(a.state === 'claimed' ? ['release'] : []),
                    ...(canAssign ? ['reassign'] : []),
                  ]
                : [],
      })),
      attachments: r.bpmAttachments
        .filter((a) => this.attachmentVisible(r, a.fieldKey, user))
        .map((a) => ({
          id: a.id,
          filename: a.filename,
          fieldKey: a.fieldKey,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
          version: a.version,
        })),
      comments: r.bpmComments.filter(
        (c) => c.visibility === 'publico' || isManager || isMember,
      ),
      sla: inst?.slaClocks.map((c) => ({
        metric: c.metric,
        targetAt: c.targetAt,
        elapsedSeconds:
          c.elapsedSeconds +
          (c.stoppedAt
            ? 0
            : businessSecondsBetween(
                c.checkpointAt,
                new Date(),
                (c.calendarSnapshot as any)?.holidays ?? [],
                (c.calendarSnapshot as any)?.timezone ?? 'America/Sao_Paulo',
              )),
        breachedAt:
          c.breachedAt ??
          (!c.stoppedAt && c.targetAt && c.targetAt <= new Date()
            ? c.targetAt
            : null),
      })),
      allowedActions: [
        ...(canCreate && isRequester && r.status === 'rascunho'
          ? ['saveDraft', 'submit', 'cancel']
          : []),
        ...(canExecute && isManager && r.status === 'concluida'
          ? ['close']
          : []),
        ...(canExecute &&
        isManager &&
        !['concluida', 'encerrada', 'cancelada'].includes(r.status)
          ? ['cancel']
          : []),
        ...(canComment ? ['comment'] : []),
      ],
    };
  }
  async comment(id: string, dto: CommentDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:comment');
    const r = await this.requestAccess(id, user, true);
    if (
      dto.visibility === 'interno' &&
      !r.queue?.bpmMembers.some((m) => m.collaboratorId === user.collaboratorId)
    )
      throw new ForbiddenException('Nota interna exige participante');
    return this.prisma.$transaction(async (tx) => {
      const body = { ...dto, requestId: id };
      const receipt = dto.commandKey
        ? await this.receipt(tx, user.userId, dto.commandKey, 'comment', body)
        : null;
      if (receipt && 'id' in receipt)
        return this.resultFromReceipt(tx, receipt);
      const changed = await tx.request.updateMany({
        where: { id, lockVersion: dto.expectedVersion ?? r.lockVersion },
        data: { lockVersion: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('VERSION_CONFLICT');
      const c = await tx.bpmRequestComment.create({
        data: {
          requestId: id,
          authorUserId: user.userId,
          authorCollaboratorId: user.collaboratorId,
          body: dto.body,
          visibility: dto.visibility ?? 'publico',
        },
      });
      await this.event(
        tx,
        id,
        r.bpmInstances[0]?.id,
        r.currentCycle,
        'comment.created',
        user,
        dto.commandId ?? randomUUID(),
        { commentId: c.id },
      );
      const result = {
        commentId: c.id,
        requestId: id,
        currentVersion: (dto.expectedVersion ?? r.lockVersion) + 1,
      };
      if (dto.commandKey && dto.commandId)
        await tx.requestCommandReceipt.create({
          data: {
            commandId: dto.commandId,
            actorUserId: user.userId,
            key: dto.commandKey,
            routeScope: 'comment',
            requestHash: hash({ routeScope: 'comment', requestId: id, body }),
            requestId: id,
            statusCode: 200,
            resultRef: result,
          },
        });
      return result;
    });
  }
  async attachment(id: string, dto: AttachmentDto, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:comment');
    const r = await this.requestAccess(id, user, true);
    if (r.status !== 'rascunho' || r.requesterId !== user.collaboratorId)
      throw new ForbiddenException(
        'Anexo de formulário exige rascunho do autor',
      );
    if (dto.fieldKey)
      this.assertWritableFields(this.definition(r.categoryVersion), {
        [dto.fieldKey]: true,
      });
    const content = Buffer.from(dto.contentBase64, 'base64');
    if (content.length > 25 * 1024 * 1024)
      throw new BadRequestException('Arquivo excede 25 MB');
    const mimeType = validateAttachment(content, dto.filename);
    const safe = generateSafeFilename(mimeType);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM requests WHERE id = ${id} FOR UPDATE`;
      const body = { ...dto, requestId: id };
      const receipt = dto.commandKey
        ? await this.receipt(
            tx,
            user.userId,
            dto.commandKey,
            'attachment',
            body,
          )
        : null;
      if (receipt && 'resultRef' in receipt) return receipt.resultRef as any;
      const current = await tx.request.findUniqueOrThrow({
        where: { id },
        select: { status: true, lockVersion: true },
      });
      if (
        current.status !== 'rascunho' ||
        (dto.expectedVersion !== undefined &&
          dto.expectedVersion !== current.lockVersion)
      )
        throw new ConflictException('VERSION_CONFLICT');
      const total = await tx.bpmRequestAttachment.aggregate({
        where: { requestId: id },
        _sum: { sizeBytes: true },
      });
      if (
        (total._sum.sizeBytes ?? 0) + content.length >
        MAX_REQUEST_TOTAL_BYTES
      )
        throw new BadRequestException('Total de anexos excede 100 MB');
      const previous = dto.previousId
        ? await tx.bpmRequestAttachment.findFirst({
            where: {
              id: dto.previousId,
              requestId: id,
              fieldKey: dto.fieldKey,
            },
            orderBy: { version: 'desc' },
            select: { id: true, version: true },
          })
        : null;
      if (dto.previousId && !previous)
        throw new BadRequestException('Anexo anterior inválido');
      const a = await tx.bpmRequestAttachment.create({
        data: {
          requestId: id,
          filename: dto.filename,
          safeFilename: safe,
          mimeType,
          sizeBytes: content.length,
          contentHash: createHash('sha256').update(content).digest('hex'),
          content,
          fieldKey: dto.fieldKey,
          previousId: previous?.id,
          version: (previous?.version ?? 0) + 1,
          uploadedBy: user.userId,
        },
      });
      await tx.request.update({
        where: { id },
        data: { lockVersion: { increment: 1 } },
      });
      await this.event(
        tx,
        id,
        r.bpmInstances[0]?.id,
        r.currentCycle,
        'attachment.uploaded',
        user,
        randomUUID(),
        { attachmentId: a.id, sizeBytes: content.length },
      );
      const result = {
        id: a.id,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        version: a.version,
        fieldKey: a.fieldKey,
        currentVersion: current.lockVersion + 1,
      };
      if (dto.commandKey && dto.commandId)
        await tx.requestCommandReceipt.create({
          data: {
            commandId: dto.commandId,
            actorUserId: user.userId,
            key: dto.commandKey,
            routeScope: 'attachment',
            requestHash: hash({
              routeScope: 'attachment',
              requestId: id,
              body,
            }),
            requestId: id,
            statusCode: 200,
            resultRef: result,
          },
        });
      return result;
    });
  }
  async download(id: string, attachmentId: string, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:read');
    const r = await this.requestAccess(id, user);
    const a = await this.prisma.bpmRequestAttachment.findFirst({
      where: { id: attachmentId, requestId: id },
    });
    if (!a) throw new NotFoundException('Anexo não encontrado');
    if (!this.attachmentVisible(r, a.fieldKey, user))
      throw new NotFoundException('Anexo não encontrado');
    return a;
  }
  async timeline(id: string, user: AuthenticatedUser) {
    await this.assertCurrentPermission(user, 'request:read');
    const r = await this.requestAccess(id, user);
    const files = new Set(
      r.bpmAttachments
        .filter((a) => this.attachmentVisible(r, a.fieldKey, user))
        .map((a) => a.id),
    );
    const team = r.queue?.bpmMembers.some(
      (m) => m.active && m.collaboratorId === user.collaboratorId,
    );
    const comments = new Set(
      r.bpmComments
        .filter((c) => c.visibility === 'publico' || team)
        .map((c) => c.id),
    );
    const events = await this.prisma.requestRuntimeEvent.findMany({
      where: { requestId: id },
      orderBy: { sequence: 'asc' },
      select: {
        id: true,
        type: true,
        sequence: true,
        summary: true,
        occurredAt: true,
        actorCollaboratorId: true,
      },
    });
    return events.filter((e) => {
      const summary = e.summary as Record<string, unknown>;
      return (
        !(
          typeof summary.attachmentId === 'string' &&
          !files.has(summary.attachmentId)
        ) &&
        !(
          typeof summary.commentId === 'string' &&
          !comments.has(summary.commentId)
        )
      );
    });
  }
}
