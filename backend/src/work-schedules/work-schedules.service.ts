import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto.js';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto.js';

@Injectable()
export class WorkSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateWorkScheduleDto) {
    return this.prisma.workSchedule.create({ data: dto });
  }

  findAll() {
    return this.prisma.workSchedule.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const workSchedule = await this.prisma.workSchedule.findUnique({ where: { id } });
    if (!workSchedule) throw new NotFoundException('Work schedule not found');
    return workSchedule;
  }

  async update(id: string, dto: UpdateWorkScheduleDto) {
    await this.findOne(id);
    return this.prisma.workSchedule.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.workSchedule.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a work schedule that still has linked collaborators');
      }
      throw err;
    }
  }
}
