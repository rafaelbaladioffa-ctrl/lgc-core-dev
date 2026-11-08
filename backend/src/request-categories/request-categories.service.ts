import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRequestCategoryDto } from './dto/create-request-category.dto.js';
import { UpdateRequestCategoryDto } from './dto/update-request-category.dto.js';
import { UpdateCategoryDraftDto } from './dto/update-category-draft.dto.js';
import { findLatestPublishedVersion } from './category-kind.js';
import { validateKindRules, validateVersionContent, workflowCollaboratorIds } from './category-schema.validator.js';

const DEFAULT_SLA_FIRST_RESPONSE_MINUTES = 240;
const DEFAULT_SLA_RESOLUTION_MINUTES = 2880;

/** 400 com a lista de erros de validação (pt-BR), no mesmo formato do ValidationPipe. */
function invalid(errors: string[]): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', message: errors });
}

@Injectable()
export class RequestCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Cria a categoria e a versão 1 em rascunho. `kind` só é definido aqui. */
  async create(dto: CreateRequestCategoryDto, createdBy: string | null) {
    const content = {
      formSchema: dto.formSchema ?? [],
      workflowSchema: dto.workflowSchema ?? [],
      slaFirstResponseMinutes: dto.slaFirstResponseMinutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
      slaResolutionMinutes: dto.slaResolutionMinutes ?? DEFAULT_SLA_RESOLUTION_MINUTES,
    };
    const kind = dto.kind ?? 'padrao';
    const confidentiality = dto.confidentiality ?? 'interna';
    const useDynamicAuthority = dto.useDynamicAuthority ?? false;
    const errors = validateVersionContent({ ...content, kind, confidentiality, useDynamicAuthority });
    errors.push(...(await this.collaboratorErrors(content.workflowSchema)));
    if (errors.length) throw invalid(errors);
    await this.assertSectorExists(dto.sectorId);
    try {
      return await this.prisma.requestCategory.create({
        data: {
          code: dto.code,
          name: dto.name,
          sectorId: dto.sectorId,
          kind,
          confidentiality,
          requiresAcceptance: dto.requiresAcceptance ?? false,
          useDynamicAuthority,
          versions: {
            create: {
              version: 1,
              status: 'rascunho',
              formSchema: content.formSchema as Prisma.InputJsonValue,
              workflowSchema: content.workflowSchema as Prisma.InputJsonValue,
              slaFirstResponseMinutes: content.slaFirstResponseMinutes,
              slaResolutionMinutes: content.slaResolutionMinutes,
              createdBy,
            },
          },
        },
        include: { versions: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new ConflictException(`Já existe uma categoria com o código ${dto.code}.`);
      throw err;
    }
  }

  /** Usado só pelos seeds: cria a categoria já com a versão 1 **publicada**, sem passar pelo
   * rascunho. O conteúdo dos seeds é de confiança e não passa pelo validador. */
  createPublishedForSeed(
    dto: Omit<CreateRequestCategoryDto, 'formSchema' | 'workflowSchema' | 'slaFirstResponseMinutes' | 'slaResolutionMinutes'> & {
      formSchema: readonly object[];
      workflowSchema: readonly object[];
      slaFirstResponseMinutes: number;
      slaResolutionMinutes: number;
    },
    publishedBy: string | null,
  ) {
    return this.prisma.requestCategory.create({
      data: {
        code: dto.code,
        name: dto.name,
        sectorId: dto.sectorId,
        kind: dto.kind ?? 'padrao',
        confidentiality: dto.confidentiality ?? 'interna',
        requiresAcceptance: dto.requiresAcceptance ?? false,
        useDynamicAuthority: dto.useDynamicAuthority ?? false,
        versions: {
          create: {
            version: 1,
            status: 'publicada',
            formSchema: dto.formSchema as Prisma.InputJsonValue,
            workflowSchema: dto.workflowSchema as Prisma.InputJsonValue,
            slaFirstResponseMinutes: dto.slaFirstResponseMinutes,
            slaResolutionMinutes: dto.slaResolutionMinutes,
            publishedAt: new Date(),
            publishedBy,
            createdBy: publishedBy,
          },
        },
      },
      include: { versions: true },
    });
  }

  /** Catálogo da abertura de requisição: categorias ativas que têm versão **publicada**, com a
   * maior versão publicada como `currentVersion`. Rascunho nunca aparece aqui. */
  async findAllCatalog(sectorId?: string) {
    const categories = await this.prisma.requestCategory.findMany({
      // `envio_material` é criada pelo sistema ao aprovar o projeto: nunca aparece para abertura pela tela.
      where: { active: true, sectorId, kind: { not: 'envio_material' }, versions: { some: { status: 'publicada' } } },
      include: {
        versions: {
          where: { status: 'publicada' },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    return categories.map((c) => ({ ...c, currentVersion: c.versions[0] ?? null, versions: undefined }));
  }

  /** Lista da tela de administração: todas as categorias (inclusive inativas). */
  async findAllAdmin() {
    const categories = await this.prisma.requestCategory.findMany({
      include: {
        sector: { select: { id: true, name: true } },
        versions: { select: { version: true, status: true }, orderBy: { version: 'desc' } },
      },
      orderBy: { name: 'asc' },
    });
    return categories.map(({ versions, ...c }) => ({
      ...c,
      publishedVersion: versions.find((v) => v.status === 'publicada')?.version ?? null,
      hasDraft: versions.some((v) => v.status === 'rascunho'),
    }));
  }

  /** Categoria + todas as versões (inclusive rascunho), com o nome de quem criou/publicou. */
  async findOne(id: string) {
    const category = await this.prisma.requestCategory.findUnique({
      where: { id },
      include: {
        sector: { select: { id: true, name: true } },
        versions: { orderBy: { version: 'desc' } },
      },
    });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    const ids = [...new Set(category.versions.flatMap((v) => [v.createdBy, v.publishedBy]).filter((x): x is string => !!x))];
    const people = ids.length
      ? await this.prisma.collaborator.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = (cid: string | null) => (cid ? (people.find((p) => p.id === cid)?.fullName ?? null) : null);
    return {
      ...category,
      versions: category.versions.map((v) => ({ ...v, createdByName: nameOf(v.createdBy), publishedByName: nameOf(v.publishedBy) })),
    };
  }

  async update(id: string, dto: UpdateRequestCategoryDto) {
    const category = await this.prisma.requestCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    if (dto.sectorId) await this.assertSectorExists(dto.sectorId);
    if (dto.confidentiality !== undefined || dto.useDynamicAuthority !== undefined) {
      const errors = validateKindRules({
        kind: category.kind,
        confidentiality: dto.confidentiality ?? category.confidentiality,
        useDynamicAuthority: dto.useDynamicAuthority ?? category.useDynamicAuthority,
        workflowSchema: [],
      });
      if (errors.length) throw invalid(errors);
    }
    return this.prisma.requestCategory.update({
      where: { id },
      data: {
        name: dto.name,
        sectorId: dto.sectorId,
        confidentiality: dto.confidentiality,
        requiresAcceptance: dto.requiresAcceptance,
        useDynamicAuthority: dto.useDynamicAuthority,
        active: dto.active,
      },
    });
  }

  /** Cria o rascunho (versão = maior + 1) copiando a última publicada. */
  async createDraft(categoryId: string, createdBy: string | null) {
    const category = await this.prisma.requestCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    const existing = await this.prisma.categoryVersion.findFirst({ where: { categoryId, status: 'rascunho' } });
    if (existing) throw new ConflictException('Esta categoria já tem um rascunho em edição.');
    const published = await findLatestPublishedVersion(this.prisma, categoryId);
    const max = await this.prisma.categoryVersion.findFirst({ where: { categoryId }, orderBy: { version: 'desc' }, select: { version: true } });
    try {
      return await this.prisma.categoryVersion.create({
        data: {
          categoryId,
          version: (max?.version ?? 0) + 1,
          status: 'rascunho',
          formSchema: (published?.formSchema ?? []) as Prisma.InputJsonValue,
          workflowSchema: (published?.workflowSchema ?? []) as Prisma.InputJsonValue,
          slaFirstResponseMinutes: published?.slaFirstResponseMinutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
          slaResolutionMinutes: published?.slaResolutionMinutes ?? DEFAULT_SLA_RESOLUTION_MINUTES,
          createdBy,
        },
      });
    } catch (err) {
      // Índice único parcial (um rascunho por categoria) ou (categoryId, version) numa corrida.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
        throw new ConflictException('Esta categoria já tem um rascunho em edição.');
      throw err;
    }
  }

  async updateDraft(categoryId: string, dto: UpdateCategoryDraftDto) {
    const { category, draft } = await this.getDraftOrThrow(categoryId);
    const content = {
      formSchema: dto.formSchema ?? draft.formSchema,
      workflowSchema: dto.workflowSchema ?? draft.workflowSchema,
      slaFirstResponseMinutes: dto.slaFirstResponseMinutes ?? draft.slaFirstResponseMinutes,
      slaResolutionMinutes: dto.slaResolutionMinutes ?? draft.slaResolutionMinutes,
    };
    const errors = validateVersionContent({
      ...content,
      kind: category.kind,
      confidentiality: category.confidentiality,
      useDynamicAuthority: category.useDynamicAuthority,
    });
    errors.push(...(await this.collaboratorErrors(content.workflowSchema)));
    if (errors.length) throw invalid(errors);
    const res = await this.prisma.categoryVersion.updateMany({
      where: { id: draft.id, status: 'rascunho' },
      data: {
        formSchema: content.formSchema as Prisma.InputJsonValue,
        workflowSchema: content.workflowSchema as Prisma.InputJsonValue,
        slaFirstResponseMinutes: content.slaFirstResponseMinutes,
        slaResolutionMinutes: content.slaResolutionMinutes,
      },
    });
    if (res.count === 0) throw new ConflictException('O rascunho foi publicado ou descartado por outra pessoa.');
    return this.prisma.categoryVersion.findUniqueOrThrow({ where: { id: draft.id } });
  }

  /** Descarta o rascunho. Nunca apaga versão publicada (o filtro por status garante). */
  async discardDraft(categoryId: string) {
    const { draft } = await this.getDraftOrThrow(categoryId);
    const res = await this.prisma.categoryVersion.deleteMany({ where: { id: draft.id, status: 'rascunho' } });
    if (res.count === 0) throw new ConflictException('O rascunho foi publicado ou descartado por outra pessoa.');
    return { discarded: true, version: draft.version };
  }

  /** Publica o rascunho: valida tudo de novo e marca como publicada num update condicional
   * (`status = 'rascunho'`) — dois publicadores simultâneos: um vence, o outro recebe 409. */
  async publishDraft(categoryId: string, publishedBy: string | null) {
    const { category, draft } = await this.getDraftOrThrow(categoryId);
    const errors = validateVersionContent({
      formSchema: draft.formSchema,
      workflowSchema: draft.workflowSchema,
      slaFirstResponseMinutes: draft.slaFirstResponseMinutes,
      slaResolutionMinutes: draft.slaResolutionMinutes,
      kind: category.kind,
      confidentiality: category.confidentiality,
      useDynamicAuthority: category.useDynamicAuthority,
    });
    errors.push(...(await this.collaboratorErrors(draft.workflowSchema)));
    if (errors.length) throw invalid(errors);
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.categoryVersion.updateMany({
        where: { id: draft.id, status: 'rascunho' },
        data: { status: 'publicada', publishedAt: new Date(), publishedBy },
      });
      if (res.count === 0) throw new ConflictException('O rascunho já foi publicado ou descartado por outra pessoa.');
      return tx.categoryVersion.findUniqueOrThrow({ where: { id: draft.id } });
    });
  }

  /** Maior versão publicada da categoria; erro se não houver. */
  async latestPublishedVersion(categoryId: string) {
    const version = await findLatestPublishedVersion(this.prisma, categoryId);
    if (!version) throw new NotFoundException('Categoria sem versão publicada');
    return version;
  }

  private async getDraftOrThrow(categoryId: string) {
    const category = await this.prisma.requestCategory.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Categoria não encontrada');
    const draft = await this.prisma.categoryVersion.findFirst({ where: { categoryId, status: 'rascunho' } });
    if (!draft) throw new NotFoundException('Esta categoria não tem rascunho.');
    return { category, draft };
  }

  private async assertSectorExists(sectorId: string) {
    const sector = await this.prisma.sector.findUnique({ where: { id: sectorId }, select: { id: true } });
    if (!sector) throw new BadRequestException('Setor não encontrado.');
  }

  /** Colaboradores do fluxo precisam existir e estar ativos (status `ativo`). */
  private async collaboratorErrors(workflowSchema: unknown): Promise<string[]> {
    const ids = workflowCollaboratorIds(workflowSchema);
    if (ids.length === 0) return [];
    const found = await this.prisma.collaborator.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, status: true } });
    const errors: string[] = [];
    for (const id of ids) {
      const c = found.find((f) => f.id === id);
      if (!c) errors.push(`workflowSchema: colaborador ${id} não encontrado.`);
      else if (c.status !== 'ativo') errors.push(`workflowSchema: ${c.fullName} não está ativo e não pode aprovar.`);
    }
    return errors;
  }
}
