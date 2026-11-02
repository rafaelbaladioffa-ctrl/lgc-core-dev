import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRequestCategoryDto } from './dto/create-request-category.dto.js';
import type { Prisma } from '@prisma/client';

@Injectable()
export class RequestCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateRequestCategoryDto, publishedBy: string | null) {
    return this.prisma.requestCategory.create({
      data: {
        code: dto.code,
        name: dto.name,
        sectorId: dto.sectorId,
        parentCategoryId: dto.parentCategoryId,
        confidentiality: dto.confidentiality ?? 'interna',
        requiresAcceptance: dto.requiresAcceptance ?? false,
        useDynamicAuthority: dto.useDynamicAuthority ?? false,
        versions: {
          create: {
            version: 1,
            formSchema: dto.formSchema as Prisma.InputJsonValue,
            workflowSchema: dto.workflowSchema as Prisma.InputJsonValue,
            slaFirstResponseMinutes: dto.slaFirstResponseMinutes,
            slaResolutionMinutes: dto.slaResolutionMinutes,
            publishedBy,
          },
        },
      },
      include: { versions: true },
    });
  }

  /** Catalog for the portal/new-request screen: active categories with their latest version. */
  async findAllCatalog(sectorId?: string) {
    const categories = await this.prisma.requestCategory.findMany({
      where: { active: true, sectorId, versions: { some: { bpmStatus: null } } },
      include: {
        versions: {
          where: { bpmStatus: null },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
      orderBy: { name: 'asc' },
    });
    return categories.map((c) => ({ ...c, currentVersion: c.versions[0] ?? null, versions: undefined }));
  }

  async findOne(id: string) {
    const category = await this.prisma.requestCategory.findUnique({
      where: { id },
      include: {
        versions: {
          where: { bpmStatus: null },
          orderBy: { version: 'desc' },
        },
      },
    });
    if (!category || category.versions.length === 0)
      throw new NotFoundException('Categoria não encontrada');
    return category;
  }

  async latestVersion(categoryId: string) {
    const version = await this.prisma.categoryVersion.findFirst({
      where: { categoryId, bpmStatus: null },
      orderBy: { version: 'desc' },
    });
    if (!version) throw new NotFoundException('Categoria sem versão publicada');
    return version;
  }
}
