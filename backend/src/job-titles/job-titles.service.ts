import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type JobTitle } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateJobTitleDto } from './dto/create-job-title.dto.js';
import { UpdateJobTitleDto } from './dto/update-job-title.dto.js';

/**
 * Estado completo do cargo em `job_title.created` e `job_title.updated` (os satélites substituem o cache a
 * cada evento). Contrato: docs/dominio/cadastros.md e docs/mapa-interoperabilidade.md §6.
 */
export function jobTitleEventPayload(jobTitle: Pick<JobTitle, 'id' | 'name' | 'isTechnician'>): Record<string, unknown> {
  return { job_title_id: jobTitle.id, name: jobTitle.name, is_technician: jobTitle.isTechnician, active: true };
}

function rethrow(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new ConflictException('A job title with this name already exists');
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
    throw new ConflictException('Cannot delete a job title that still has linked collaborators');
  }
  throw err;
}

@Injectable()
export class JobTitlesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  create(dto: CreateJobTitleDto) {
    return this.prisma
      .$transaction(async (tx) => {
        const jobTitle = await tx.jobTitle.create({ data: { name: dto.name, isTechnician: dto.isTechnician ?? false } });
        await this.outbox.record(tx, 'job_title.created', jobTitleEventPayload(jobTitle));
        return jobTitle;
      })
      .catch(rethrow);
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
    return this.prisma
      .$transaction(async (tx) => {
        const jobTitle = await tx.jobTitle.update({ where: { id }, data: dto });
        await this.outbox.record(tx, 'job_title.updated', jobTitleEventPayload(jobTitle));
        return jobTitle;
      })
      .catch(rethrow);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma
      .$transaction(async (tx) => {
        const jobTitle = await tx.jobTitle.delete({ where: { id } });
        await this.outbox.record(tx, 'job_title.deleted', { job_title_id: jobTitle.id, name: jobTitle.name, active: false, deleted: true });
      })
      .catch(rethrow);
  }
}
