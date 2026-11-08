import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CostCenter, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateCostCenterDto } from './dto/create-cost-center.dto.js';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto.js';

/** Estado completo do centro de custo em todo evento `cost_center.*` (docs/dominio/cadastros.md §4). */
export function costCenterEventPayload(costCenter: CostCenter, active = true): Record<string, unknown> {
  return {
    cost_center_id: costCenter.id,
    code: costCenter.code,
    name: costCenter.name,
    sector_id: costCenter.sectorId,
    parent_cost_center_id: costCenter.parentCostCenterId,
    responsible_collaborator_id: costCenter.responsibleCollaboratorId,
    active,
  };
}

@Injectable()
export class CostCentersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateCostCenterDto) {
    if (dto.parentCostCenterId) await this.assertExists(dto.parentCostCenterId);

    return this.prisma.$transaction(async (tx) => {
      const code = await this.generateCode(tx, dto.parentCostCenterId);
      const costCenter = await tx.costCenter.create({
        data: {
          code,
          name: dto.name,
          sectorId: dto.sectorId,
          parentCostCenterId: dto.parentCostCenterId,
          responsibleCollaboratorId: dto.responsibleCollaboratorId,
        },
      });
      await this.outbox.record(tx, 'cost_center.created', costCenterEventPayload(costCenter));
      return costCenter;
    });
  }

  findAll() {
    return this.prisma.costCenter.findMany({ orderBy: { code: 'asc' }, include: { sector: true, responsibleCollaborator: { select: { id: true, fullName: true } } } });
  }

  async findOne(id: string) {
    const costCenter = await this.prisma.costCenter.findUnique({ where: { id }, include: { sector: true, responsibleCollaborator: { select: { id: true, fullName: true } } } });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return costCenter;
  }

  async update(id: string, dto: UpdateCostCenterDto) {
    await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const costCenter = await tx.costCenter.update({ where: { id }, data: dto });
      await this.outbox.record(tx, 'cost_center.updated', costCenterEventPayload(costCenter));
      return costCenter;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.$transaction(async (tx) => {
        const costCenter = await tx.costCenter.delete({ where: { id } });
        // Mesmo tipo de evento com `active: false`: o Financeiro já trata assim no cache.
        await this.outbox.record(tx, 'cost_center.updated', costCenterEventPayload(costCenter, false));
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a cost center that still has linked projects or sub-cost-centers');
      }
      throw err;
    }
  }

  private async assertExists(id: string): Promise<void> {
    const costCenter = await this.prisma.costCenter.findUnique({ where: { id } });
    if (!costCenter) throw new BadRequestException('Parent cost center not found');
  }

  /** Same hierarchical, race-free code generation scheme as SectorsService.generateCode. */
  private async generateCode(tx: Prisma.TransactionClient, parentCostCenterId?: string): Promise<string> {
    if (!parentCostCenterId) {
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('cost_center_root_code_seq') AS nextval`;
      return String(rows[0].nextval);
    }
    const parentRows = await tx.$queryRaw<Array<{ code: string }>>`SELECT code FROM cost_centers WHERE id = ${parentCostCenterId} FOR UPDATE`;
    const parentCode = parentRows[0]?.code;
    if (!parentCode) throw new BadRequestException('Parent cost center not found');
    const siblingCount = await tx.costCenter.count({ where: { parentCostCenterId } });
    return `${parentCode}.${siblingCount + 1}`;
  }
}
