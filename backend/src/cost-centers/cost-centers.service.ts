import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCostCenterDto } from './dto/create-cost-center.dto.js';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto.js';

@Injectable()
export class CostCentersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCostCenterDto) {
    if (dto.parentCostCenterId) await this.assertExists(dto.parentCostCenterId);

    return this.prisma.$transaction(async (tx) => {
      const code = await this.generateCode(tx, dto.parentCostCenterId);
      return tx.costCenter.create({
        data: {
          code,
          name: dto.name,
          sectorId: dto.sectorId,
          parentCostCenterId: dto.parentCostCenterId,
        },
      });
    });
  }

  findAll() {
    return this.prisma.costCenter.findMany({ orderBy: { code: 'asc' }, include: { sector: true } });
  }

  async findOne(id: string) {
    const costCenter = await this.prisma.costCenter.findUnique({ where: { id }, include: { sector: true } });
    if (!costCenter) throw new NotFoundException('Cost center not found');
    return costCenter;
  }

  async update(id: string, dto: UpdateCostCenterDto) {
    await this.findOne(id);
    return this.prisma.costCenter.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.costCenter.delete({ where: { id } });
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
