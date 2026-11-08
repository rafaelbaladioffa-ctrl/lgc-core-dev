import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateProjectDto } from './dto/create-project.dto.js';
import { UpdateProjectDto } from './dto/update-project.dto.js';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto.js';

/** Allowed forward transitions for the proposal → delivery lifecycle. */
const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  proposta: ['aprovado', 'encerrado'],
  aprovado: ['em_execucao', 'encerrado'],
  em_execucao: ['encerrado'],
  encerrado: [],
};

export const SNAPSHOT_INCLUDE = {
  costCenter: { select: { id: true, code: true, name: true } },
  site: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ProjectInclude;

type ProjectWithCostCenter = Prisma.ProjectGetPayload<{ include: typeof SNAPSHOT_INCLUDE }>;

/** `AAAA-MM-DD` → Date em UTC (coluna `DATE`); `null` apaga; `undefined` mantém. */
export function toDateOnly(value: string | null | undefined): Date | null | undefined {
  if (value === undefined || value === null) return value;
  return new Date(`${value}T00:00:00Z`);
}

export function formatDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Estado completo do projeto enviado em todo evento `project.*`. Os satélites (Financeiro,
 * Logística) guardam o último snapshot no cache, então cada evento precisa trazer tudo.
 * Contrato: docs/dominio/cadastros.md §10.
 */
export function projectEventPayload(project: ProjectWithCostCenter): Record<string, unknown> {
  return {
    project_id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    client_id: project.clientId,
    cost_center_id: project.costCenterId,
    cost_center_code: project.costCenter.code,
    cost_center_name: project.costCenter.name,
    site_id: project.siteId,
    site_code: project.site?.code ?? null,
    site_name: project.site?.name ?? null,
    responsible_collaborator_id: project.responsibleCollaboratorId,
    planned_start_date: formatDateOnly(project.plannedStartDate),
    planned_end_date: formatDateOnly(project.plannedEndDate),
  };
}

/**
 * Grava a mudança de status do projeto e o `project.status_changed` (com `previous_status`) na transação de quem
 * chama. Compartilhada pela tela (`ProjectsService.updateStatus`) e pelo Field (`field.project.started` leva o projeto a
 * `em_execucao`, PA-18): o mesmo evento sai nos dois caminhos. A validação da transição fica com quem chama.
 */
export async function changeProjectStatus(
  tx: Prisma.TransactionClient,
  outbox: Pick<OutboxService, 'record'>,
  id: string,
  previousStatus: ProjectStatus,
  status: ProjectStatus,
) {
  const updated = await tx.project.update({ where: { id }, data: { status }, include: SNAPSHOT_INCLUDE });
  await outbox.record(tx, 'project.status_changed', { ...projectEventPayload(updated), previous_status: previousStatus });
  return updated;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async create(dto: CreateProjectDto) {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new BadRequestException('Cliente não encontrado.');
    const plannedStartDate = toDateOnly(dto.plannedStartDate);
    const plannedEndDate = toDateOnly(dto.plannedEndDate);
    this.assertDateOrder(plannedStartDate ?? null, plannedEndDate ?? null);
    if (dto.siteId) await this.assertSiteUsable(dto.siteId, dto.clientId);

    return this.prisma.$transaction(async (tx) => {
      // nextval() on a native Postgres sequence is atomic: concurrent requests each get a
      // distinct, strictly increasing number, so the generated project code never collides
      // even under simultaneous creation (see PLANNING.md 5.9 and migration 20261030000000).
      const rows = await tx.$queryRaw<Array<{ nextval: bigint }>>`SELECT nextval('project_proposal_seq') AS nextval`;
      const proposalSequence = Number(rows[0].nextval);
      const code = buildProjectCode(client.code, proposalSequence, new Date());

      const project = await tx.project.create({
        data: {
          code,
          name: dto.name,
          clientId: dto.clientId,
          costCenterId: dto.costCenterId,
          responsibleCollaboratorId: dto.responsibleCollaboratorId,
          siteId: dto.siteId ?? null,
          plannedStartDate,
          plannedEndDate,
          status: dto.status ?? 'proposta',
          proposalSequence,
        },
        include: SNAPSHOT_INCLUDE,
      });
      await this.outbox.record(tx, 'project.created', projectEventPayload(project));
      return project;
    });
  }

  findAll() {
    return this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
  }

  /**
   * Avisos de "obra concluída no Field" para o responsável do projeto (PT-09, PA-18): projetos dele ainda abertos
   * (`aprovado` ou `em_execucao`) cuja obra o Field deu por concluída. Some sozinho quando o projeto é encerrado.
   */
  async fieldAlerts(collaboratorId: string | null) {
    if (!collaboratorId) return [];
    const works = await this.prisma.projectFieldWork.findMany({
      where: { completedAt: { not: null }, project: { responsibleCollaboratorId: collaboratorId, status: { in: ['aprovado', 'em_execucao'] } } },
      select: { completedAt: true, fieldProjectCode: true, project: { select: { id: true, code: true, name: true } } },
      orderBy: { completedAt: 'desc' },
    });
    return works.map((work) => ({
      projectId: work.project.id,
      projectCode: work.project.code,
      projectName: work.project.name,
      fieldProjectCode: work.fieldProjectCode,
      completedAt: work.completedAt!.toISOString(),
    }));
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return project;
  }

  async update(id: string, dto: UpdateProjectDto) {
    const current = await this.findOne(id);
    const plannedStartDate = toDateOnly(dto.plannedStartDate);
    const plannedEndDate = toDateOnly(dto.plannedEndDate);
    this.assertDateOrder(
      plannedStartDate === undefined ? current.plannedStartDate : plannedStartDate,
      plannedEndDate === undefined ? current.plannedEndDate : plannedEndDate,
    );
    // Só confere o site quando ele muda: projeto que já guarda um site depois inativado segue editável.
    if (dto.siteId && dto.siteId !== current.siteId) await this.assertSiteUsable(dto.siteId, current.clientId);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.update({
        where: { id },
        data: {
          name: dto.name,
          costCenterId: dto.costCenterId,
          responsibleCollaboratorId: dto.responsibleCollaboratorId,
          siteId: dto.siteId,
          plannedStartDate,
          plannedEndDate,
        },
        include: SNAPSHOT_INCLUDE,
      });
      await this.outbox.record(tx, 'project.updated', {
        ...projectEventPayload(project),
        changed_fields: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined),
      });
      return project;
    });
  }

  /** Mudança de status. A aprovação (`aprovado`) tem fluxo próprio: `ProjectApprovalService.approve` (PT-06). */
  async updateStatus(id: string, dto: UpdateProjectStatusDto) {
    if (dto.status === 'aprovado') throw new BadRequestException('A aprovação do projeto exige a cotação aceita e o site: use a aprovação do projeto.');
    if (dto.acceptedQuoteId !== undefined || dto.clientPoNumber !== undefined) {
      throw new BadRequestException('Cotação aceita e PO só valem na aprovação do projeto.');
    }
    const project = await this.findOne(id);
    const allowed = ALLOWED_TRANSITIONS[project.status];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(`Não é possível mudar o projeto de "${project.status}" para "${dto.status}".`);
    }
    return this.prisma.$transaction((tx) => changeProjectStatus(tx, this.outbox, id, project.status, dto.status));
  }

  /**
   * Exclusão física só para proposta sem requisições: depois disso o projeto já pode ter
   * orçamento no Financeiro ou movimentação na Logística, e o caminho é encerrar.
   */
  async remove(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { ...SNAPSHOT_INCLUDE, _count: { select: { requests: true } } },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    if (project.status !== 'proposta') {
      throw new ConflictException('Só é possível excluir projeto em proposta. Encerre o projeto.');
    }
    if (project._count.requests > 0) {
      throw new ConflictException('O projeto tem requisições vinculadas. Encerre o projeto em vez de excluir.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.project.delete({ where: { id } });
      // Os satélites tratam qualquer `project.*` pelo `status`; `encerrado` marca inativo no cache.
      await this.outbox.record(tx, 'project.deleted', { ...projectEventPayload(project), status: 'encerrado', deleted: true });
    });
  }

  /** Site do projeto: precisa existir, estar ativo e ser do mesmo cliente do projeto (PA-05). */
  private async assertSiteUsable(siteId: string, clientId: string): Promise<void> {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { clientId: true, active: true } });
    if (!site) throw new BadRequestException('Site não encontrado.');
    if (site.clientId !== clientId) throw new BadRequestException('O site não pertence ao cliente do projeto.');
    if (!site.active) throw new BadRequestException('O site está inativo. Escolha outro site ou reative este.');
  }

  private assertDateOrder(start: Date | null, end: Date | null): void {
    if (start && end && end < start) {
      throw new BadRequestException('A conclusão prevista não pode ser antes do início previsto.');
    }
  }
}

/**
 * `PROP-{código do cliente}.{seq}-{MMAA}`, com mês e ano no fuso de São Paulo (não no fuso do
 * processo: em container UTC, um projeto criado depois das 21h do último dia do mês ganhava o
 * mês seguinte).
 */
export function buildProjectCode(clientCode: number, proposalSequence: number, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', month: '2-digit', year: '2-digit' }).formatToParts(now);
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const proposal = String(proposalSequence).padStart(3, '0');
  return `PROP-${clientCode}.${proposal}-${month}${year}`;
}
