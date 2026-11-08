import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type BudgetMaterial } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/authenticated-request.js';
import type { CreateDestinationDto, CreateMaterialDto, UpdateDestinationDto, UpdateMaterialDto } from './catalogs.dto.js';

export const COST_PERMISSION = 'budget:read_cost';
const canSeeCost = (user: AuthenticatedUser) => user.permissions.includes(COST_PERMISSION);

/** Nome repetido vira 409 com mensagem em pt-BR. */
function duplicate(e: unknown, what: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(`Já existe ${what} com este nome.`);
  throw e;
}

const trimOrNull = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() || null);

/** Catálogos de material e destinos (projetos-especificacao §4.3). Custo real só com `budget:read_cost`. */
@Injectable()
export class CatalogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  presentMaterial(m: BudgetMaterial, cost: boolean) {
    const { realCost, ...rest } = m;
    return cost ? { ...m, realCost } : rest;
  }

  async listMaterials(user: AuthenticatedUser, includeInactive: boolean) {
    const rows = await this.prisma.budgetMaterial.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { name: 'asc' } });
    const cost = canSeeCost(user);
    return rows.map((m) => this.presentMaterial(m, cost));
  }

  async getMaterial(id: string, user: AuthenticatedUser) {
    const m = await this.prisma.budgetMaterial.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Item do catálogo não encontrado.');
    return this.presentMaterial(m, canSeeCost(user));
  }

  private guardCost(dto: { realCost?: string | null }, user: AuthenticatedUser) {
    if (dto.realCost !== undefined && !canSeeCost(user)) throw new ForbiddenException('O custo real só pode ser informado por quem vê custos (budget:read_cost).');
  }

  async createMaterial(dto: CreateMaterialDto, user: AuthenticatedUser) {
    this.guardCost(dto, user);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const m = await tx.budgetMaterial.create({
          data: {
            name: dto.name.trim(),
            manufacturer: trimOrNull(dto.manufacturer) ?? null,
            partNumber: trimOrNull(dto.partNumber)?.toUpperCase() ?? null,
            unit: dto.unit?.trim() || 'un',
            billedPrice: dto.billedPrice,
            realCost: dto.realCost ?? null,
            clientRef: trimOrNull(dto.clientRef) ?? null,
            active: dto.active ?? true,
            createdBy: user.userId,
            updatedBy: user.userId,
          },
        });
        await this.audit.record(user.userId, 'budget_material.created', 'budget_material', m.id, { name: m.name }, tx);
        return this.presentMaterial(m, canSeeCost(user));
      });
    } catch (e) {
      duplicate(e, 'um item');
    }
  }

  async updateMaterial(id: string, dto: UpdateMaterialDto, user: AuthenticatedUser) {
    this.guardCost(dto, user);
    const data: Prisma.BudgetMaterialUpdateInput = { updatedBy: user.userId };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.manufacturer !== undefined) data.manufacturer = trimOrNull(dto.manufacturer);
    if (dto.partNumber !== undefined) data.partNumber = trimOrNull(dto.partNumber)?.toUpperCase() ?? null;
    if (dto.unit !== undefined) data.unit = dto.unit.trim() || 'un';
    if (dto.billedPrice !== undefined) data.billedPrice = dto.billedPrice;
    if (dto.realCost !== undefined) data.realCost = dto.realCost;
    if (dto.clientRef !== undefined) data.clientRef = trimOrNull(dto.clientRef);
    if (dto.active !== undefined) data.active = dto.active;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.budgetMaterial.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Item do catálogo não encontrado.');
        const m = await tx.budgetMaterial.update({ where: { id }, data });
        await this.audit.record(user.userId, 'budget_material.updated', 'budget_material', id, { changedFields: Object.keys(data).filter((k) => k !== 'updatedBy') }, tx);
        return this.presentMaterial(m, canSeeCost(user));
      });
    } catch (e) {
      duplicate(e, 'um item');
    }
  }

  listDestinations(includeInactive: boolean) {
    return this.prisma.budgetDestination.findMany({ where: includeInactive ? {} : { active: true }, orderBy: { name: 'asc' } });
  }

  async getDestination(id: string) {
    const d = await this.prisma.budgetDestination.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Destino não encontrado.');
    return d;
  }

  async createDestination(dto: CreateDestinationDto, user: AuthenticatedUser) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const d = await tx.budgetDestination.create({
          data: {
            name: dto.name.trim(),
            kmRoundTrip: dto.kmRoundTrip,
            tollPerDay: dto.tollPerDay ?? '0',
            routeNotes: trimOrNull(dto.routeNotes) ?? null,
            active: dto.active ?? true,
            createdBy: user.userId,
            updatedBy: user.userId,
          },
        });
        await this.audit.record(user.userId, 'budget_destination.created', 'budget_destination', d.id, { name: d.name }, tx);
        return d;
      });
    } catch (e) {
      duplicate(e, 'um destino');
    }
  }

  async updateDestination(id: string, dto: UpdateDestinationDto, user: AuthenticatedUser) {
    const data: Prisma.BudgetDestinationUpdateInput = { updatedBy: user.userId };
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.kmRoundTrip !== undefined) data.kmRoundTrip = dto.kmRoundTrip;
    if (dto.tollPerDay !== undefined) data.tollPerDay = dto.tollPerDay;
    if (dto.routeNotes !== undefined) data.routeNotes = trimOrNull(dto.routeNotes);
    if (dto.active !== undefined) data.active = dto.active;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const exists = await tx.budgetDestination.findUnique({ where: { id }, select: { id: true } });
        if (!exists) throw new NotFoundException('Destino não encontrado.');
        const d = await tx.budgetDestination.update({ where: { id }, data });
        await this.audit.record(user.userId, 'budget_destination.updated', 'budget_destination', id, { changedFields: Object.keys(data).filter((k) => k !== 'updatedBy') }, tx);
        return d;
      });
    } catch (e) {
      duplicate(e, 'um destino');
    }
  }
}
