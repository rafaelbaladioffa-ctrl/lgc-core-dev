import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSectorDto } from './dto/create-sector.dto.js';
import { UpdateSectorDto } from './dto/update-sector.dto.js';

@Injectable()
export class SectorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSectorDto) {
    if (dto.parentSectorId) await this.assertExists(dto.parentSectorId);

    return this.prisma.$transaction(async (tx) => {
      const code = await this.generateCode(tx, dto.parentSectorId);
      return tx.sector.create({
        data: {
          code,
          name: dto.name,
          parentSectorId: dto.parentSectorId,
          responsibleCollaboratorId: dto.responsibleCollaboratorId,
        },
      });
    });
  }

  findAll() {
    return this.prisma.sector.findMany({ orderBy: { code: 'asc' } });
  }

  async findOne(id: string) {
    const sector = await this.prisma.sector.findUnique({ where: { id } });
    if (!sector) throw new NotFoundException('Sector not found');
    return sector;
  }

  async update(id: string, dto: UpdateSectorDto) {
    await this.findOne(id);
    return this.prisma.sector.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.sector.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a sector that still has linked records (collaborators, cost centers, tickets, subsectors, etc.)');
      }
      throw err;
    }
  }

  private async assertExists(id: string): Promise<void> {
    const sector = await this.prisma.sector.findUnique({ where: { id } });
    if (!sector) throw new BadRequestException('Parent sector not found');
  }

  /**
   * Root sectors get a code from the "sector_root_code_seq" Postgres sequence (100, 200, 300,
   * ...) — atomic and race-free the same way client/project codes are.
   *
   * A child's code is "<parent.code>.<n>", n 1-based and scoped to that parent, recursively (a
   * child of "100.1" becomes "100.1.1", etc). Postgres sequences are global and pre-declared, so
   * they can't restart at 1 per parent on demand — instead this locks the parent row
   * (`SELECT ... FOR UPDATE`) inside the same transaction as the insert, so two concurrent
   * creates under the same parent serialize on that lock and never compute the same `n`.
   */
  private async generateCode(tx: Prisma.TransactionClient, parentSectorId?: string): Promise<string> {
    if (!parentSectorId) {
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('sector_root_code_seq') AS nextval`;
      return String(rows[0].nextval);
    }
    const parentRows = await tx.$queryRaw<Array<{ code: string }>>`SELECT code FROM sectors WHERE id = ${parentSectorId} FOR UPDATE`;
    const parentCode = parentRows[0]?.code;
    if (!parentCode) throw new BadRequestException('Parent sector not found');
    const siblingCount = await tx.sector.count({ where: { parentSectorId } });
    return `${parentCode}.${siblingCount + 1}`;
  }
}
