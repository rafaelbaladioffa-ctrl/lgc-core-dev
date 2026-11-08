import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CostCenter, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { OutboxService } from '../integration/outbox.service.js';
import { CreateCostCenterDto } from './dto/create-cost-center.dto.js';
import { UpdateCostCenterDto } from './dto/update-cost-center.dto.js';
import type { ReceiveCostCenterBudgetStatusDto } from './dto/budget-status.dto.js';

/** Assinatura exigida do satélite que informa a situação do orçamento (o Financeiro mantém o cadastro de CC em cache). */
export const COST_CENTER_BUDGET_SUBSCRIPTION_EVENT = 'cost_center.updated';

/** Estado completo do centro de custo em todo evento `cost_center.*` (docs/dominio/cadastros.md §4). */
export function costCenterEventPayload(costCenter: CostCenter, active = true): Record<string, unknown> {
  return {
    cost_center_id: costCenter.id,
    code: costCenter.code,
    name: costCenter.name,
    sector_id: costCenter.sectorId,
    parent_cost_center_id: costCenter.parentCostCenterId,
    responsible_collaborator_id: costCenter.responsibleCollaboratorId,
    kind: costCenter.kind,
    short_code: costCenter.shortCode,
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

    return this.withShortCodeConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const code = await this.generateCode(tx, dto.parentCostCenterId);
        const costCenter = await tx.costCenter.create({
          data: {
            code,
            name: dto.name,
            sectorId: dto.sectorId,
            parentCostCenterId: dto.parentCostCenterId,
            responsibleCollaboratorId: dto.responsibleCollaboratorId,
            kind: dto.kind,
            shortCode: dto.shortCode ?? null,
          },
        });
        await this.outbox.record(tx, 'cost_center.created', costCenterEventPayload(costCenter));
        return costCenter;
      }),
    );
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
    // Campos de situação do orçamento (`budget_*`) não estão no DTO: só o Financeiro os grava (§4).
    return this.withShortCodeConflict(() =>
      this.prisma.$transaction(async (tx) => {
        const costCenter = await tx.costCenter.update({ where: { id }, data: dto });
        await this.outbox.record(tx, 'cost_center.updated', costCenterEventPayload(costCenter));
        return costCenter;
      }),
    );
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

  /** Sigla repetida (índice único `cost_centers_short_code_key`) vira 409 com mensagem traduzível. */
  private async withShortCodeConflict<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Cost center short code already in use');
      }
      throw err;
    }
  }

  /**
   * Situação do orçamento informada pelo Financeiro (docs/integracao-centros-de-custo.md §4).
   * Guarda só a faixa, o percentual, o ano e o instante do cálculo; valores ficam no Financeiro.
   * Entrega fora de ordem (retry do outbox): um cálculo mais antigo que o gravado é ignorado.
   * Auditoria em `audit_events` (sem usuário: a origem é o satélite).
   */
  async receiveBudgetStatus(id: string, satellite: { id: string; name: string }, dto: ReceiveCostCenterBudgetStatusDto) {
    const computedAt = new Date(dto.computed_at);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.costCenter.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Cost center not found');
      const stale = current.budgetStatusAt !== null && computedAt < current.budgetStatusAt;
      const before = { status: current.budgetStatus, percent: current.budgetPercent?.toString() ?? null, year: current.budgetYear, computed_at: current.budgetStatusAt };
      const saved = stale
        ? current
        : await tx.costCenter.update({
            where: { id },
            data: { budgetStatus: dto.status, budgetPercent: new Prisma.Decimal(dto.percent).toDecimalPlaces(2), budgetYear: dto.year, budgetStatusAt: computedAt },
          });
      await tx.auditEvent.create({
        data: {
          aggregateType: 'cost_center',
          aggregateId: id,
          event: stale ? 'cost_center.budget_status_ignored' : 'cost_center.budget_status_received',
          actorId: null,
          source: `integration:${satellite.name}`,
          beforeJson: before as Prisma.InputJsonValue,
          afterJson: {
            year: dto.year,
            budget: dto.budget,
            committed: dto.committed,
            realized: dto.realized,
            percent: dto.percent,
            status: dto.status,
            computed_at: dto.computed_at,
            satellite_id: satellite.id,
          },
        },
      });
      return {
        cost_center_id: saved.id,
        applied: !stale,
        budget_status: saved.budgetStatus,
        budget_percent: saved.budgetPercent?.toFixed(2) ?? null,
        budget_year: saved.budgetYear,
        budget_status_at: saved.budgetStatusAt,
      };
    });
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
