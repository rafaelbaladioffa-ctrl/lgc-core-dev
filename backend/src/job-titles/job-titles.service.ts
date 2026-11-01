import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateJobTitleDto } from './dto/create-job-title.dto.js';
import { UpdateJobTitleDto } from './dto/update-job-title.dto.js';

@Injectable()
export class JobTitlesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateJobTitleDto) {
    try {
      return await this.prisma.jobTitle.create({ data: { name: dto.name, isTechnician: dto.isTechnician ?? false } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A job title with this name already exists');
      }
      throw err;
    }
  }

  findAll() {
    return this.prisma.jobTitle.findMany({ orderBy: { name: 'asc' } });
  }

  async findOne(id: string) {
    const jobTitle = await this.prisma.jobTitle.findUnique({ where: { id } });
    if (!jobTitle) throw new NotFoundException('Job title not found');
    return jobTitle;
  }

  async update(id: string, dto: UpdateJobTitleDto) {
    await this.findOne(id);
    try {
      return await this.prisma.jobTitle.update({ where: { id }, data: dto });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A job title with this name already exists');
      }
      throw err;
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    try {
      await this.prisma.jobTitle.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('Cannot delete a job title that still has linked collaborators');
      }
      throw err;
    }
  }
}
