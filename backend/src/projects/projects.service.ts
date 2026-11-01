import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto.js';
import { ProjectStatus } from '@prisma/client';

/** Allowed forward transitions for the proposal → delivery lifecycle. */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  proposta: ['aprovado', 'encerrado'],
  aprovado: ['em_execucao', 'encerrado'],
  em_execucao: ['encerrado'],
  encerrado: [],
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateProjectDto) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new BadRequestException('Client not found');

    return this.prisma.$transaction(async (tx) => {
      // nextval() on a native Postgres sequence is atomic: concurrent requests each get a
      // distinct, strictly increasing number, so the generated project code never collides
      // even under simultaneous creation (see PLANNING.md 5.9 and migration 20261030000000).
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('project_proposal_seq') AS nextval`;
      const proposalSequence = Number(rows[0].nextval);
      const code = this.buildCode(client.code, proposalSequence);

      const project = await tx.project.create({
        data: {
          code,
          clientId: dto.clientId,
          costCenterId: dto.costCenterId,
          responsibleCollaboratorId: dto.responsibleCollaboratorId,
          status: dto.status ?? 'proposta',
          proposalSequence,
        },
      });
      await this.outbox.record(tx, 'project.created', {
        project_id: project.id,
        code: project.code,
        status: project.status,
        client_id: project.clientId,
      });
      return project;
    });
  }

  findAll() {
    return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    await this.findOne(id);
    return this.prisma.project.update({
      where: { id },
      data: { costCenterId: dto.costCenterId, responsibleCollaboratorId: dto.responsibleCollaboratorId },
    });
  }

  async updateStatus(id: string, dto: UpdateProjectStatusDto) {
    const project = await this.findOne(id);
    const allowed = ALLOWED_TRANSITIONS[project.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Cannot transition project from "${project.status}" to "${dto.status}"`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({ where: { id }, data: { status: dto.status } });
      await this.outbox.record(tx, 'project.status_changed', {
        project_id: updated.id,
        code: updated.code,
        status: updated.status,
      });
      return updated;
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.project.delete({ where: { id } });
  }

  private async nextProposalSequence(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('project_proposal_seq') AS nextval`;
    return Number(rows[0].nextval);
  }

  private buildCode(clientCode: number, proposalSequence: number): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = String(now.getFullYear()).slice(-2);
    const proposal = String(proposalSequence).padStart(3, '0');
    return `PROP-${clientCode}.${proposal}-${month}${year}`;
  }
}
