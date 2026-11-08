import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CostCentersService } from './cost-centers.service.js';
import { CreateCostCenterDto } from './dto/create-cost-center.dto.js';
import { ReceiveCostCenterBudgetStatusDto } from './dto/budget-status.dto.js';

/** Eventos `cost_center.*` para os satélites (o Financeiro usa no rateio) e situação do orçamento
 * recebida do Financeiro (docs/integracao-centros-de-custo.md §1 e §4). */

const ROW = {
  id: 'cc-1',
  code: '100',
  name: 'Obras',
  sectorId: 'sec-1',
  parentCostCenterId: null,
  responsibleCollaboratorId: null,
  kind: 'administrativo',
  shortCode: null as string | null,
  budgetStatus: null as string | null,
  budgetPercent: null as Prisma.Decimal | null,
  budgetYear: null as number | null,
  budgetStatusAt: null as Date | null,
};

function fixture(row: typeof ROW = ROW) {
  const outbox = { record: vi.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    costCenter: {
      findUnique: vi.fn().mockResolvedValue(row),
      create: vi.fn(async ({ data }) => ({ ...row, ...data })),
      update: vi.fn(async ({ data }) => ({ ...row, ...data })),
      delete: vi.fn().mockResolvedValue(row),
    },
    auditEvent: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([{ nextval: 100n }]),
  };
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return { service: new CostCentersService(prisma, outbox as any), prisma, outbox };
}

const budgetBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  year: 2026, budget: '1000.00', committed: '600.00', realized: '450.00', percent: 105, status: 'estourado', computed_at: '2026-11-08T12:00:00.000Z', ...over,
});
const budgetDto = (over: Record<string, unknown> = {}) => budgetBody(over) as unknown as ReceiveCostCenterBudgetStatusDto;

describe('CostCentersService eventos', () => {
  it('criação emite cost_center.created na mesma transação, com tipo e sigla', async () => {
    const { service, prisma, outbox } = fixture();
    await service.create({ name: 'Obras', sectorId: 'sec-1', kind: 'equipe_tecnica', shortCode: 'DC-001-JAI' });
    expect(prisma.costCenter.create.mock.calls[0][0].data).toMatchObject({ kind: 'equipe_tecnica', shortCode: 'DC-001-JAI' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.created', expect.objectContaining({
      cost_center_id: 'cc-1', code: '100', name: 'Obras', sector_id: 'sec-1', kind: 'equipe_tecnica', short_code: 'DC-001-JAI', active: true,
    }));
  });

  it('edição emite cost_center.updated com o estado completo', async () => {
    const { service, prisma, outbox } = fixture();
    await service.update('cc-1', { name: 'Obras SP' });
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.updated', expect.objectContaining({ name: 'Obras SP', kind: 'administrativo', short_code: null, active: true }));
  });

  it('exclusão emite cost_center.updated com active false', async () => {
    const { service, prisma, outbox } = fixture();
    await service.remove('cc-1');
    expect(outbox.record).toHaveBeenCalledWith(prisma, 'cost_center.updated', expect.objectContaining({ cost_center_id: 'cc-1', active: false }));
  });

  it('sigla repetida responde 409', async () => {
    const { service, prisma } = fixture();
    prisma.costCenter.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.update('cc-1', { shortCode: 'DC-001-JAI' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('CreateCostCenterDto — sigla', () => {
  const errorsFor = async (shortCode: unknown) => {
    const dto = plainToInstance(CreateCostCenterDto, { name: 'X', sectorId: '7f1c1e1e-1111-4111-8111-111111111111', shortCode });
    return { dto, errors: await validate(dto) };
  };

  it('normaliza para maiúsculas e aceita o formato do contrato', async () => {
    const { dto, errors } = await errorsFor(' dc-001-jai ');
    expect(errors).toHaveLength(0);
    expect(dto.shortCode).toBe('DC-001-JAI');
  });

  it('vazio vira null (limpa a sigla)', async () => {
    const { dto, errors } = await errorsFor('');
    expect(errors).toHaveLength(0);
    expect(dto.shortCode).toBeNull();
  });

  it('recusa espaço, hífen nas pontas, duplo hífen e mais de 30 caracteres', async () => {
    for (const value of ['DC 001', '-DC', 'DC-', 'DC--1', 'A'.repeat(31), 'DC_1']) {
      expect((await errorsFor(value)).errors.length).toBeGreaterThan(0);
    }
  });
});

describe('situação do orçamento (Financeiro → Core)', () => {
  const satellite = { id: 'sat-fin', name: 'financeiro' };

  it('grava status, percentual, ano e instante, e audita com o satélite como origem', async () => {
    const { service, prisma, outbox } = fixture();
    const result = await service.receiveBudgetStatus('cc-1', satellite, budgetDto());
    expect(prisma.costCenter.update.mock.calls[0][0].data).toMatchObject({ budgetStatus: 'estourado', budgetYear: 2026, budgetStatusAt: new Date('2026-11-08T12:00:00.000Z') });
    expect(prisma.costCenter.update.mock.calls[0][0].data.budgetPercent.toFixed(2)).toBe('105.00');
    expect(result).toMatchObject({ cost_center_id: 'cc-1', applied: true, budget_status: 'estourado', budget_percent: '105.00', budget_year: 2026 });
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ aggregateType: 'cost_center', aggregateId: 'cc-1', event: 'cost_center.budget_status_received', actorId: null, source: 'integration:financeiro' }),
    });
    // Não ecoa evento de volta para o satélite.
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it('cálculo mais antigo que o gravado (entrega fora de ordem) é ignorado', async () => {
    const { service, prisma } = fixture({ ...ROW, budgetStatus: 'alerta', budgetYear: 2026, budgetStatusAt: new Date('2026-11-08T13:00:00.000Z'), budgetPercent: new Prisma.Decimal(85) });
    const result = await service.receiveBudgetStatus('cc-1', satellite, budgetDto());
    expect(prisma.costCenter.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ applied: false, budget_status: 'alerta', budget_percent: '85.00' });
    expect(prisma.auditEvent.create.mock.calls[0][0].data.event).toBe('cost_center.budget_status_ignored');
  });

  it('CC inexistente responde 404', async () => {
    const { service, prisma } = fixture();
    prisma.costCenter.findUnique.mockResolvedValue(null);
    await expect(service.receiveBudgetStatus('cc-x', satellite, budgetDto())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('DTO valida status, percentual e valores com 2 casas', async () => {
    const valid = plainToInstance(ReceiveCostCenterBudgetStatusDto, budgetBody({ budget: 1000 }));
    expect(await validate(valid)).toHaveLength(0);
    expect(valid.budget).toBe('1000.00');
    for (const over of [{ status: 'vermelho' }, { percent: 1000 }, { percent: -1 }, { committed: '10.123' }, { computed_at: 'ontem' }]) {
      const dto = plainToInstance(ReceiveCostCenterBudgetStatusDto, budgetBody(over));
      expect((await validate(dto)).length).toBeGreaterThan(0);
    }
  });
});
