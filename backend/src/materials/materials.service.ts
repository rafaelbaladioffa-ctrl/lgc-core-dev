import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CreateMaterialDto, ListMaterialsQuery, UpdateMaterialDto } from './materials.dto.js';

const COST_FIELDS = ['averageCost', 'lastCost'] as const;

@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Custo só é exposto a quem tem `material:read_cost` (7.2). */
  private present<T extends Record<string, unknown>>(material: T, user: AuthenticatedUser): T {
    if (user.permissions.includes('material:read_cost')) return material;
    const copy: Record<string, unknown> = { ...material };
    for (const f of COST_FIELDS) delete copy[f];
    return copy as T;
  }

  private validateRules(m: { lotControlled?: boolean; expiryControlled?: boolean; minShelfLifeDays?: number | null; serialControlled?: boolean; exitMethod?: string; requiresAuthorization?: boolean; authorizationBy?: string | null }) {
    if (m.expiryControlled && !m.lotControlled) throw new BadRequestException('Material com controle de validade exige controle por lote.');
    if (m.minShelfLifeDays != null && !m.expiryControlled) throw new BadRequestException('A vida útil mínima só se aplica a material com controle de validade.');
    if (m.serialControlled && m.exitMethod && m.exitMethod !== 'SERIE_ESPECIFICA') {
      throw new BadRequestException('Material controlado por número de série deve usar o método de saída SERIE_ESPECIFICA.');
    }
    if (m.exitMethod === 'FEFO' && !m.expiryControlled) throw new BadRequestException('O método FEFO exige controle de validade.');
    if (m.requiresAuthorization && !m.authorizationBy) throw new BadRequestException('Informe quem autoriza (HSE, Qualidade, TI ou gestor).');
  }

  async list(query: ListMaterialsQuery, user: AuthenticatedUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.MaterialWhereInput = {
      ...(query.type && { type: query.type }),
      ...(query.category && { category: query.category }),
      status: query.status ?? 'ATIVO',
      ...(query.q && {
        OR: [
          { code: { contains: query.q, mode: 'insensitive' } },
          { shortDescription: { contains: query.q, mode: 'insensitive' } },
          { technicalDescription: { contains: query.q, mode: 'insensitive' } },
          { barcodes: { some: { code: query.q } } },
        ],
      }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.material.count({ where }),
      this.prisma.material.findMany({ where, orderBy: { code: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { stockUom: { select: { code: true, name: true } } } }),
    ]);
    return { total, page, pageSize, items: items.map((m) => this.present(m, user)) };
  }

  async get(id: string, user: AuthenticatedUser) {
    const material = await this.prisma.material.findUnique({ where: { id }, include: { stockUom: true, barcodes: true } });
    if (!material) throw new NotFoundException('Material não encontrado.');
    return this.present(material, user);
  }

  async versions(id: string) {
    await this.get(id, { permissions: [] } as unknown as AuthenticatedUser);
    return this.prisma.materialVersion.findMany({ where: { materialId: id }, orderBy: { version: 'desc' } });
  }

  async create(dto: CreateMaterialDto, user: AuthenticatedUser) {
    this.validateRules(dto);
    const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.stockUomId } });
    if (!uom || !uom.active) throw new BadRequestException('Unidade de estoque inexistente ou inativa.');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const material = await tx.material.create({ data: { ...dto, createdBy: user.userId } });
        await tx.materialVersion.create({ data: { materialId: material.id, version: 1, snapshot: this.snapshot(material), changedBy: user.userId, changeReason: 'Criação' } });
        await this.audit.record(user.userId, 'material.created', 'material', material.id, { code: material.code }, tx);
        return this.present(material, user);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe um material com o código ${dto.code}.`);
      throw e;
    }
  }

  /** Alteração material cria nova versão com snapshot completo (7.3.6). */
  async update(id: string, dto: UpdateMaterialDto, user: AuthenticatedUser) {
    const current = await this.prisma.material.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Material não encontrado.');
    if (current.status !== 'ATIVO') throw new BadRequestException('Material inativo ou substituído não aceita alterações.');
    const { changeReason, ...fields } = dto;
    const merged = { ...current, ...fields };
    this.validateRules(merged);
    if (dto.stockUomId && dto.stockUomId !== current.stockUomId) {
      const uom = await this.prisma.unitOfMeasure.findUnique({ where: { id: dto.stockUomId } });
      if (!uom?.active) throw new BadRequestException('Unidade de estoque inexistente ou inativa.');
    }
    return this.prisma.$transaction(async (tx) => {
      const next = current.currentVersion + 1;
      const material = await tx.material.update({ where: { id }, data: { ...fields, currentVersion: next, updatedBy: user.userId } });
      await tx.materialVersion.create({ data: { materialId: id, version: next, snapshot: this.snapshot(material), changedBy: user.userId, changeReason } });
      await this.audit.record(user.userId, 'material.updated', 'material', id, { version: next, fields: Object.keys(fields) }, tx);
      return this.present(material, user);
    });
  }

  /** Item com histórico nunca é excluído: apenas inativado (7.3.7). */
  async deactivate(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.material.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Material não encontrado.');
    if (current.status === 'INATIVO') return this.present(current, user);
    return this.prisma.$transaction(async (tx) => {
      const next = current.currentVersion + 1;
      const material = await tx.material.update({ where: { id }, data: { status: 'INATIVO', currentVersion: next, updatedBy: user.userId } });
      await tx.materialVersion.create({ data: { materialId: id, version: next, snapshot: this.snapshot(material), changedBy: user.userId, changeReason: 'Inativação' } });
      await this.audit.record(user.userId, 'material.deactivated', 'material', id, { version: next }, tx);
      return this.present(material, user);
    });
  }

  private snapshot(material: object): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(material)) as Prisma.InputJsonValue;
  }
}
