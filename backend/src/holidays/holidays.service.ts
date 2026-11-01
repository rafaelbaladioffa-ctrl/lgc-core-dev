import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateHolidayDto } from './dto/create-holiday.dto.js';

@Injectable()
export class HolidaysService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateHolidayDto) {
    return this.prisma.holiday.create({ data: { date: new Date(dto.date), name: dto.name } });
  }

  findAll() {
    return this.prisma.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  async remove(id: string) {
    const holiday = await this.prisma.holiday.findUnique({ where: { id } });
    if (!holiday) throw new NotFoundException('Feriado não encontrado');
    await this.prisma.holiday.delete({ where: { id } });
  }
}
